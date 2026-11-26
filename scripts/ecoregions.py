# /// script
# requires-python = ">=3.11"
# dependencies = ["exactextract==0.3.0", "geopandas==1.2.0", "rasterio==1.5.2"]
# ///
"""Calculate county shares of mapped land in ecological regions and desert climates."""

import argparse
import json
import shutil
import tempfile
from pathlib import Path
from zipfile import ZipFile

import geopandas as gpd
import numpy as np
import rasterio
from county_raster import BOUNDARIES, MIN_COVERAGE, county_boundaries, verified_download
from land_cover import (
    LOOKUP,
    MISSING,
    SOURCES,
    UNKNOWN,
    WATER,
    county_counts,
    source_raster,
)
from rasterio.features import rasterize
from rasterio.warp import reproject
from shapely.geometry import box

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/ecoregions.json"
ECO_URL = "https://data.fs.usda.gov/geodata/edw/edw_resources/shp/S_USA.ECOSYS_ECOMAPDIVISIONS_2025.zip"
ECO_HASH = "383bda2028c33fe0b18ebe43191c3aabea8100cad8dea011f7a78d82ed94025d"
CLIMATE_URL = "https://ndownloader.figshare.com/files/61012822?download=full"
CLIMATE_HASH = "bb84453d4541f1a0bc5a804ead83f483c19ce70f16a5197f6d3a7b6a63e65562"
CLIMATE_TIF = "1991_2020/koppen_geiger_0p00833333.tif"
FOREST_SERVICE = {
    "source": "https://apps.fs.usda.gov/ArcX/rest/services/EDW/EDW_Ecomap2025_01/MapServer",
    "credit": "USDA Forest Service · EcoMap 2025",
    "period": "2025 ecoregion map",
    "denominator": "County land assigned to a Forest Service ecological division.",
}
MEASURES = {
    "prairieRegion": {
        **FOREST_SERVICE,
        "name": "Prairie Parkland Region",
        "definition": "Share of mapped county land in EcoMap’s Prairie Parkland Division (350), including the Prairie Peninsula, Cross Timbers, and Texas Gulf provinces. Farms, woods and towns can all lie within this region.",
    },
    "plainsRegion": {
        **FOREST_SERVICE,
        "name": "Great Plains Region",
        "definition": "Share of mapped county land in EcoMap’s Great Plains Division (450), which includes dry steppe, grassland and shrub landscapes. It can also contain cropland and towns.",
    },
    "desertClimate": {
        "name": "Desert Climate",
        "period": "1991–2020",
        "credit": "Beck et al. (2023) · Köppen–Geiger climate maps",
        "source": "https://doi.org/10.6084/m9.figshare.21789074.v2",
        "license": "CC BY 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "denominator": "County land with a historical Köppen–Geiger climate class.",
        "definition": "Share of mapped county land classified as hot desert (BWh) or cold desert (BWk) from long-term temperature and precipitation. Semi-arid steppe is a separate climate class.",
    },
}
# Combined classes for the land-only histogram. Region: missing, other, prairie,
# plains. Climate: missing, other, desert. Keep open water and no-data separate.
CLIMATE_TYPES = 3
CATEGORIES = 2 + 4 * CLIMATE_TYPES


def region_polygons(path, crs):
    regions = gpd.read_file(path, columns=["DIVISION_C", "DIVISION_N"])
    names = dict(zip(regions.DIVISION_C, regions.DIVISION_N))
    if (
        len(names) != 12
        or names.get("350") != "Prairie Parkland Division"
        or names.get("450") != "Great Plains Division"
    ):
        raise ValueError("Unexpected EcoMap division list")
    regions["category"] = (
        regions.DIVISION_C.map({"350": 2, "450": 3}).fillna(1).astype(int)
    )
    regions = regions.to_crs(crs).explode(index_parts=False)
    regions.geometry = regions.geometry.make_valid(
        method="structure", keep_collapsed=False
    )
    return regions.explode(index_parts=False).reset_index(drop=True)


def joint_classes(cells, region, koppen):
    cover = LOOKUP[cells]
    if np.any(cover == UNKNOWN) or np.max(koppen) > 30:
        raise ValueError("Unexpected land cover or climate class")
    climate = np.where(koppen == 0, 0, np.where((koppen == 4) | (koppen == 5), 2, 1))
    land = 2 + region * CLIMATE_TYPES + climate.astype(np.uint8)
    return np.where(cover == WATER, 0, np.where(cover == MISSING, 1, land))


def classifier(regions, climate_tif):
    # Bounds queries consider individual islands. Clip full divisions to the
    # current tile before rasterization to avoid retransmitting national outlines.
    tree = regions.sindex if regions is not None else None

    def classify(src, window, cells):
        transform = src.window_transform(window)
        region = np.zeros(cells.shape, dtype=np.uint8)
        if tree is not None:
            bounds = src.window_bounds(window)
            selected = tree.query(box(*bounds), predicate="intersects")
            if len(selected):
                subset = regions.iloc[selected]
                pieces = subset.geometry.clip_by_rect(*bounds)
                shapes = [
                    (geom, int(c))
                    for geom, c in zip(pieces, subset.category)
                    if not geom.is_empty
                ]
                if shapes:
                    rasterize(shapes, out=region, transform=transform)
        # Nearest-neighbor sampling preserves the native categories of the
        # ~1 km climate grid. Do not infer climate from the NLCD land class.
        koppen = np.zeros(cells.shape, dtype=np.uint8)
        with rasterio.open(climate_tif) as climate:
            reproject(
                rasterio.band(climate, 1),
                koppen,
                dst_crs=src.crs,
                dst_transform=transform,
                src_nodata=0,
                dst_nodata=0,
                tolerance=0.005,
            )
        return joint_classes(cells, region, koppen)

    return classify


def share(cells, classified, land):
    if not classified or classified < land * MIN_COVERAGE:
        return None
    value = 100 * int(cells) / int(classified)
    rounded = round(value, 1)
    return float(f"{value:.12g}") if rounded in (0, 100) else rounded


def percentages(counts, polygon_pixels):
    land = counts[2:].reshape(4, CLIMATE_TYPES)
    total_land = land.sum()
    if not total_land or total_land + counts[0] < polygon_pixels * MIN_COVERAGE:
        return [None] * len(MEASURES)
    regions = land.sum(axis=1)
    climates = land.sum(axis=0)
    mapped_region = regions[1:].sum()
    return [
        share(regions[2], mapped_region, total_land),
        share(regions[3], mapped_region, total_land),
        share(climates[2], climates[1:].sum(), total_land),
    ]


def build(cache, land_cache):
    cache.mkdir(parents=True, exist_ok=True)
    land_cache.mkdir(parents=True, exist_ok=True)
    regions_zip = verified_download(cache / "ecomap.zip", ECO_URL, ECO_HASH)
    climate_zip = verified_download(cache / "beck.zip", CLIMATE_URL, CLIMATE_HASH)
    counties = county_boundaries(land_cache)
    result = {}
    with ZipFile(climate_zip) as archive, tempfile.TemporaryDirectory(dir=cache) as tmp:
        climate = Path(tmp) / "classification.tif"
        with archive.open(CLIMATE_TIF) as src, climate.open("wb") as out:
            shutil.copyfileobj(src, out)
        with rasterio.open(climate) as src:
            if (
                src.shape != (21600, 43200)
                or src.crs.to_epsg() != 4326
                or src.nodata != 0
            ):
                raise ValueError("Unexpected Köppen–Geiger grid")
        for group in SOURCES:
            raster = source_raster(land_cache, group)
            with rasterio.open(raster) as src:
                regions = (
                    region_polygons(regions_zip, src.crs) if group == "conus" else None
                )
            states = counties.STATEFP
            mask = {
                "conus": ~states.isin(["02", "15"]),
                "alaska": states == "02",
                "hawaii": states == "15",
            }[group]
            counts = county_counts(
                raster,
                counties[mask],
                classify=classifier(regions, climate),
                stride=CATEGORIES,
            )
            result.update(
                {
                    fips: percentages(count, area)
                    for fips, (count, area) in counts.items()
                }
            )
            print(f"Processed {len(counts)} {group} counties", flush=True)
    return {
        "keys": list(MEASURES),
        "measures": MEASURES,
        "boundaries": BOUNDARIES,
        "sources": [ECO_URL, CLIMATE_URL, "https://www.mrlc.gov/data"],
        "method": "Count the centres of native equal-area 30 m NLCD cells inside 2017 county outlines. Exclude open water and unclassified cells. Assign EcoMap 2025 divisions by point in polygon in the contiguous U.S. Sample the nearest native 30-arcsecond 1991–2020 climate class over mapped land in all 50 states. Require classified NLCD cells including open water over 95% of the county footprint, and the relevant climate or regional classification on 95% of mapped county land. Report percent of land assigned a class in that source. Values at regional boundaries are approximate. Round to tenths, preserving trace overlaps near 0 and 100.",
        "counties": dict(sorted(result.items())),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--land-cover-cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    result = build(args.cache, args.land_cover_cache)
    args.output.write_text(
        json.dumps(result, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        + "\n"
    )
