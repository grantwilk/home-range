# /// script
# requires-python = ">=3.11"
# dependencies = ["exactextract==0.3.0", "rasterio==1.5.2", "geopandas==1.2.0"]
# ///
"""Build county mean cloud frequency. Run: uv run scripts/cloud.py --cache /tmp/home-range-cloud"""

import argparse
import json
from pathlib import Path

import numpy as np
import rasterio
from county_raster import (
    BOUNDARIES,
    MIN_COVERAGE,
    area_totals,
    county_boundaries,
    verified_download,
)
from exactextract.raster import RasterioRasterSource

RASTER = "https://data.earthenv.org/cloud/MODCF_meanannual.tif"
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "cloud.json"


class CloudRaster(RasterioRasterSource):
    """EarthEnv defines every value above 10000 as fill."""

    def read_window(self, x0, y0, nx, ny):
        raw = super().read_window(x0, y0, nx, ny)
        return np.ma.masked_greater(raw, 10000, copy=False)


def aggregate(raster, counties):
    polygons = counties[["GEOID", "geometry"]].to_crs(raster.crs)
    # Split offshore islands and antimeridian-crossing Alaskan counties before processing.
    polygons = polygons.explode(index_parts=False).reset_index(drop=True)
    areas = area_totals(CloudRaster(raster), polygons)
    return {
        "counties": {
            fips: round(float(total / valid / 100), 1)
            for fips, (total, valid, area) in areas.iterrows()
            if area > 0 and valid / area >= MIN_COVERAGE
        },
        "coverageBelow99Percent": {
            fips: round(float(valid / area * 100), 2) if area else 0
            for fips, (_, valid, area) in areas.iterrows()
            if not area or valid / area < 0.99
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cache",
        type=Path,
        required=True,
        help="Directory for source downloads (715 MB)",
    )
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    cloud_path = verified_download(
        args.cache / "annual.tif",
        RASTER,
        "ed8c67d259bd02ab9960f8b385299b374ee906d2924c33e80759faf594acfa46",
    )
    counties = county_boundaries(args.cache)
    with rasterio.open(cloud_path) as raster:
        data = aggregate(raster, counties)
    source = {
        "title": "Mean Annual Cloud Frequency",
        "period": "2000–2014",
        "unit": "%",
        "credit": "Wilson & Jetz (2016), EarthEnv Global 1-km Cloud Frequency v1",
        "license": "CC BY-NC 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-nc/4.0/",
        "source": "https://www.earthenv.org/cloud.html",
        "documentation": "https://www.earthenv.org/metadata/Cloud_DataDescription.pdf",
        "paper": "https://doi.org/10.1371/journal.pbio.1002415",
        "caveat": "Terra and Aqua sample at approximately 10:30 a.m. and 1:30 p.m. local time. At high latitudes the satellites lack daylight observations during polar winter, and the authors report that cloud frequency can be biased high above 60° latitude.",
        "raster": RASTER,
        "boundaries": BOUNDARIES,
        "method": "Mean frequency of cloud detection at daytime satellite overpasses on the native 30 arcsecond grid. Each cell contributes in proportion to its spherical area inside the 2017 Census 1:500,000 county polygon. Fill values are excluded. Counties need at least 95% valid mapped area. Values are rounded to 0.1 percentage points.",
    }
    OUTPUT.write_text(
        json.dumps(
            {**source, **data},
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        )
        + "\n"
    )
    print(
        f"{len(data['counties'])}/{len(counties)} counties; {len(data['coverageBelow99Percent'])} below 99% valid area"
    )


if __name__ == "__main__":
    main()
