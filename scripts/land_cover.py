# /// script
# requires-python = ">=3.11"
# dependencies = ["exactextract==0.3.0", "geopandas==1.2.0", "rasterio==1.5.2"]
# ///
"""Summarize the native 30 m NLCD land classes inside 2017 county boundaries."""

import argparse
import json
import shutil
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from zipfile import ZipFile

import numpy as np
import rasterio
from county_raster import BOUNDARIES, MIN_COVERAGE, county_boundaries, verified_download
from rasterio.features import rasterize
from rasterio.windows import Window
from shapely.geometry import box

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/land-cover.json"
BASE = "https://www.mrlc.gov/downloads/sciweb1/shared/mrlc/data-bundles/"
SOURCE = "https://www.mrlc.gov/data"
# Each ZIP is pinned. The Alaska ERDAS header and external pixel file are a pair.
SOURCES = {
    "conus": (
        "Annual_NLCD_LndCov_2025_CU_C1V2.zip",
        "0e1441b5f69f505252bd62694f8136aa565f9a9c0c3f52a5e72b1bd64848a2d1",
        ["Annual_NLCD_LndCov_2025_CU_C1V2.tif"],
    ),
    "alaska": (
        "NLCD_2016_Land_Cover_AK_20200724.zip",
        "af8bf2e25d795a587625dd8f1630a0d5ba50692ca5d0226b8c765e41f67e9f85",
        [
            "NLCD_2016_Land_Cover_AK_20200724.img",
            "NLCD_2016_Land_Cover_AK_20200724.ige",
        ],
    ),
    "hawaii": (
        "HI_landcover_wimperv_9-30-08_se5.zip",
        "d50b55fec8ce41ebbf2771030e8b3839d7704edda931fd609cf27c995d44cb53",
        ["hi_landcover_wimperv_9-30-08_se5.img"],
    ),
}
CLASSES = {
    "forestCover": (41, 42, 43),
    "farmCover": (81, 82),
    "grassCover": (71, 72),
    "developedCover": (21, 22, 23, 24),
    "wetlandCover": (90, 91, 92, 93, 94, 95, 96, 97, 98, 99),
    "shrubCover": (51, 52),
    "barrenCover": (31, 32),
    "snowCover": (12,),
    "mossLichenCover": (73, 74),
}
# Dense indices keep block histograms small. Catch unexpected codes separately.
WATER = len(CLASSES)
MISSING = WATER + 1
UNKNOWN = WATER + 2
STRIDE = UNKNOWN + 1
LOOKUP = np.full(256, UNKNOWN, dtype=np.uint16)
LOOKUP[[0, 1, 250]] = MISSING
LOOKUP[11] = WATER
for index, codes in enumerate(CLASSES.values()):
    LOOKUP[list(codes)] = index


def source_raster(cache, region):
    name, digest, members = SOURCES[region]
    archive = verified_download(cache / name, BASE + name, digest)
    with ZipFile(archive) as z:
        for member in members:
            # Use CRC-checked extraction even when a previous build left a raster.
            with (
                z.open(member) as inp,
                tempfile.NamedTemporaryFile(dir=cache, delete=False) as out,
            ):
                temp = Path(out.name)
                try:
                    shutil.copyfileobj(inp, out, length=2**20)
                except BaseException:
                    temp.unlink(missing_ok=True)
                    raise
            temp.replace(cache / member)
    return cache / members[0]


def land_percentages(counts, polygon_pixels, alaska):
    land = counts[:WATER]
    land_total = int(land.sum())
    classified = land_total + counts[WATER]
    if land_total == 0 or classified < polygon_pixels * MIN_COVERAGE:
        return None
    shares = []
    for key, count in zip(CLASSES, land):
        if key == "mossLichenCover" and not alaska:
            # The source distinguishes these classes only in Alaska.
            shares.append(None)
            continue
        value = 100 * int(count) / land_total
        rounded = round(value, 1)
        # A 0..0 range means no mapped cells and 100..100 means all mapped cells.
        shares.append(float(f"{value:.12g}") if rounded in (0, 100) else rounded)
    return shares


def county_counts(raster, counties, workers=4, *, classify=None, stride=STRIDE):
    """Histogram native cells by county; optional classifier returns dense category indices.

    classify(src, window, cells) can overlay another classification on the NLCD land
    mask. The returned count vectors include every cell whose center fell inside
    the relevant footprint, including separately classified missing/water cells.
    """
    with rasterio.open(raster) as src:
        if (
            src.res != (30, 30)
            or src.dtypes != ("uint8",)
            or "Albers" not in src.crs.to_wkt()
        ):
            raise ValueError("Expected the equal-area NLCD 30-metre class grid")
        width, height = src.width, src.height
        polys = counties.to_crs(src.crs).reset_index(drop=True)
    # The Alaskan and Hawaiian county footprints can contain widely separated islands.
    pieces = polys.geometry.explode(index_parts=True)
    shapes = pieces.to_numpy()
    ids = pieces.index.get_level_values(0).to_numpy() + 1
    tree = pieces.sindex
    block = 2048
    label_dtype = np.min_scalar_type((len(polys) + 1) * stride - 1)

    def stripe(y):
        counts = np.zeros((len(polys) + 1, stride), dtype=np.int64)
        with rasterio.open(raster) as src:
            for x in range(0, width, block):
                window = Window(x, y, min(block, width - x), min(block, height - y))
                bounds = box(*src.window_bounds(window))
                selected = tree.query(bounds, predicate="intersects")
                if not len(selected):
                    continue
                cells = src.read(1, window=window)
                # Each 30 m square contributes by its centre. County 0 is outside.
                labels = rasterize(
                    [(shapes[i], int(ids[i]) * stride) for i in selected],
                    out_shape=cells.shape,
                    transform=src.window_transform(window),
                    dtype=label_dtype,
                )
                if classify is None:
                    labels += LOOKUP[cells]
                else:
                    classes = classify(src, window, cells)
                    if (
                        classes.shape != cells.shape
                        or classes.dtype.kind != "u"
                        or classes.max() >= stride
                    ):
                        raise ValueError(
                            "Expected one unsigned class index per source cell"
                        )
                    labels += classes
                counts += np.bincount(labels.ravel(), minlength=counts.size).reshape(
                    counts.shape
                )
        return counts

    with ThreadPoolExecutor(max_workers=workers) as pool:
        counts = sum(pool.map(stripe, range(0, height, block)))
    if classify is None and counts[1:, UNKNOWN].any():
        raise ValueError("An unrecognized NLCD class occurred in a county")
    return {
        r.GEOID: (counts[i + 1], r.geometry.area / 900) for i, r in polys.iterrows()
    }


def build(cache):
    cache.mkdir(parents=True, exist_ok=True)
    counties = county_boundaries(cache)
    values = {}
    for region in SOURCES:
        raster = source_raster(cache, region)
        states = counties.STATEFP
        mask = {
            "conus": ~states.isin(["02", "15"]),
            "alaska": states == "02",
            "hawaii": states == "15",
        }[region]
        counts = county_counts(raster, counties[mask])
        values.update(
            {
                fips: land_percentages(c, n, region == "alaska")
                for fips, (c, n) in counts.items()
            }
        )
        print(f"Processed {len(counts)} {region} county footprints", flush=True)
    if set(values) != set(counties.GEOID):
        raise ValueError("County geography mismatch")
    return {
        "keys": list(CLASSES),
        "period": "2025 contiguous U.S. · 2016 Alaska · 2001 Hawaii",
        "defaultPeriod": "2025",
        "periodByState": {"02": "2016", "15": "2001"},
        "credit": "USGS National Land Cover Database",
        "source": SOURCE,
        "boundaries": BOUNDARIES,
        "unit": "percent of classified land",
        "archives": {k: BASE + s[0] for k, s in SOURCES.items()},
        "classCodes": CLASSES,
        "method": "Count native 30 m equal-area NLCD cells whose centers fall inside each shoreline-clipped 2017 Census county. Require classified cells, including open water, covering at least 95% of the county polygon area. Exclude open water and missing cells from the land denominator. Group mutually exclusive land classes, including wetlands. Round shares to tenths; preserve trace shares near 0% and 100%. Moss and lichen are distinguished only by the Alaska product.",
        "counties": dict(sorted(values.items())),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    data = build(args.cache)
    args.output.write_text(
        json.dumps(data, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        + "\n"
    )
