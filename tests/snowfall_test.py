# /// script
# requires-python = ">=3.11"
# dependencies = ["exactextract==0.3.0", "geopandas==1.2.0", "netCDF4==1.7.5.1.post1"]
# ///
"""Run: uv run tests/snowfall_test.py"""

import json
import sys
import unittest
from pathlib import Path

import geopandas as gpd
import numpy as np
from exactextract.raster import NumPyRasterSource
from pyproj import CRS
from shapely.geometry import box

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import snowfall


class SnowfallTests(unittest.TestCase):
    def test_overlapping_area_zeros_and_missing_seasons(self):
        counties = gpd.GeoDataFrame(
            {
                "GEOID": ["mix", "zero", "missing", "some", "AK", "HI"],
                "STATEFP": ["01"] * 4 + ["02", "15"],
            },
            geometry=[
                box(0.5, 0, 2, 1),
                box(0, 0, 1, 1),
                box(2, 0, 3, 1),
                box(1, 0, 3, 1),
                box(1, 0, 2, 1),
                box(1, 0, 2, 1),
            ],
            crs="EPSG:4326",
        )
        snow = NumPyRasterSource(
            np.array([[0, 0.381, np.nan]]),
            0,
            0,
            3,
            1,
            nodata=np.nan,
            srs_wkt=CRS.from_epsg(4326).to_wkt(),
        )
        rates, coverage = snowfall.county_inches(snow, counties)
        self.assertEqual(
            rates,
            {
                "mix": 10.0,
                "zero": 0.0,
                "missing": None,
                "some": None,
                "AK": None,
                "HI": None,
            },
        )
        self.assertEqual(coverage, {"missing": 0.0, "some": 50.0})

    def test_complete_seasons_and_mapped_counties(self):
        data = json.loads(snowfall.OUTPUT.read_text())
        self.assertEqual(
            data["yearsEnding"], [year for year in range(2009, 2027) if year != 2021]
        )
        geography = json.loads((ROOT / "data/geography.json").read_text())
        rates = data["counties"]
        self.assertEqual(rates.keys(), {row["id"] for row in geography["counties"]})
        self.assertTrue(
            all(
                value is None
                for code, value in rates.items()
                if code[:2] in ("02", "15")
            )
        )
        self.assertTrue(all(value is None or value >= 0 for value in rates.values()))
        # Independently integrated against clipped native pixel areas. Mountainous
        # counties such as King include snow well above city elevations.
        for code, expected in {
            "55025": 43.7,
            "08117": 220.0,
            "36075": 160.2,
            "53033": 121.6,
            "04013": 0.3,
            "51760": 11.4,
            "12086": 0.0,
            "06037": 3.8,
            "06075": None,
            "53055": None,
        }.items():
            self.assertEqual(rates[code], expected)
        for code, coverage in data["coverageBelow99Percent"].items():
            if coverage < 94.99:
                self.assertIsNone(rates[code])


if __name__ == "__main__":
    unittest.main()
