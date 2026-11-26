# /// script
# requires-python = ">=3.11"
# dependencies = ["exactextract==0.3.0", "rasterio==1.5.2", "geopandas==1.2.0"]
# ///
"""Calculate area-weighted county elevations from the USGS GMTED2010 mean grid."""

import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile

import rasterio
from county_raster import (
    BOUNDARIES,
    MIN_COVERAGE,
    area_totals,
    county_boundaries,
    verified_download,
)
from exactextract.raster import RasterioRasterSource

SOURCE = "https://edcintl.cr.usgs.gov/downloads/sciweb1/shared/topo/downloads/GMTED/Grid_ZipFiles/mn30_grd.zip"
DIGEST = "dfd0d6c6486f4da22109be6107c93a70ef9917a5b6f954cd82d87cf8b920149d"
OUTPUT = Path(__file__).resolve().parents[1] / "data/elevation.json"


def county_elevations(dem, counties):
    polygons = (
        counties[["GEOID", "geometry"]].to_crs(dem.crs).explode(index_parts=False)
    )
    totals = area_totals(RasterioRasterSource(dem), polygons.reset_index(drop=True))
    return {
        fips: round(float(total / valid / 0.3048))
        if area > 0 and valid / area >= MIN_COVERAGE
        else None
        for fips, (total, valid, area) in totals.iterrows()
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    cache = parser.parse_args().cache
    cache.mkdir(parents=True, exist_ok=True)
    path = verified_download(cache / "mn30_grd.zip", SOURCE, DIGEST)
    counties = county_boundaries(cache)
    with TemporaryDirectory(dir=cache) as tmp, ZipFile(path) as archive:
        archive.extractall(tmp)
        with rasterio.open(Path(tmp) / "mn30_grd") as dem:
            if dem.crs.to_epsg() != 4326 or abs(dem.res[0] * 3600 - 30) > 0.001:
                raise ValueError("Unexpected GMTED2010 coordinate system or grid size")
            means = county_elevations(dem, counties)
    if set(means) != set(counties.GEOID):
        raise ValueError("Elevation catalog does not match the 2017 counties")
    payload = {
        "title": "Average County Elevation",
        "unit": "ft",
        "source": "USGS and NGA, GMTED2010 mean elevation, 30 arc-seconds",
        "documentation": "https://pubs.usgs.gov/of/2011/1073/",
        "raster": SOURCE,
        "sha256": DIGEST,
        "boundaries": BOUNDARIES,
        "method": "Each terrain cell contributes its mean elevation in proportion to its spherical area inside the shoreline-clipped 2017 Census county boundary. Valid zero and negative elevations are included. Counties require 95% valid mapped area. The county mean is converted from meters to feet and rounded to the nearest foot.",
        "counties": means,
    }
    OUTPUT.write_text(
        json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n"
    )
    print(f"Built {sum(v is not None for v in means.values())} county elevations")


if __name__ == "__main__":
    main()
