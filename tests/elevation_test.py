# /// script
# requires-python = ">=3.11"
# dependencies = ["exactextract==0.3.0", "rasterio==1.5.2", "geopandas==1.2.0"]
# ///
"""Check the published county joins and elevation averaging at boundaries."""

import json
import sys
import unittest
from pathlib import Path

import geopandas as gpd
import numpy as np
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from shapely.geometry import box

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from elevation import county_elevations


class CountyElevationTests(unittest.TestCase):
    def test_partial_cell_weights_zero_negative_and_missing(self):
        shapes = gpd.GeoDataFrame(
            {
                "GEOID": ["mixed", "sea", "missing"],
                "geometry": [box(0.5, 0, 2, 1), box(1, 0, 2, 1), box(2, 0, 3, 1)],
            },
            crs=4326,
        )
        with (
            MemoryFile() as mem,
            mem.open(
                driver="GTiff",
                width=3,
                height=1,
                count=1,
                dtype="int16",
                crs="EPSG:4326",
                transform=from_origin(0, 1, 1, 1),
                nodata=-32768,
            ) as dem,
        ):
            dem.write(np.array([[-30, 0, -32768]], dtype="int16"), 1)
            self.assertEqual(
                county_elevations(dem, shapes),
                {"mixed": -33, "sea": 0, "missing": None},
            )

    def test_coverage_and_independently_calculated_counties(self):
        data = ROOT / "data"
        means = json.loads((data / "elevation.json").read_text())["counties"]
        ids = {
            c["id"]
            for c in json.loads((data / "geography.json").read_text())["counties"]
        }
        self.assertEqual(set(means), ids)
        self.assertEqual(len(ids), 3142)
        self.assertTrue(all(isinstance(ft, int) for ft in means.values()))
        for fips, ft in {
            "08111": 11405,
            "08065": 10948,
            "55025": 954,
            "02016": 772,
            "15005": 1187,
            "22071": 7,
            "22075": 2,
        }.items():
            self.assertEqual(means[fips], ft, fips)


if __name__ == "__main__":
    unittest.main()
