# /// script
# requires-python = ">=3.11"
# dependencies = ["exactextract==0.3.0", "geopandas==1.2.0", "netCDF4==1.7.5.1.post1"]
# ///
"""Run: uv run tests/rainfall_test.py"""

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
import rainfall


class RainfallTests(unittest.TestCase):
    def test_phase_calendar_units_and_missing_values(self):
        # A daily millimetre of liquid falls after removing 2 mm of snow water.
        for year, days in [(1999, 28), (2000, 29)]:
            self.assertAlmostEqual(
                float(rainfall.liquid_month(0.003, 0.002, year, 2)), 0.001 * days
            )
        total = np.ma.array([0.002, 0, 0.001, 0.001, 0.001], mask=[0, 0, 0, 0, 1])
        snow = np.array([0.002, 0, 0.001005, 0.002, 0])
        actual = rainfall.liquid_month(total, snow, 2000, 1)
        np.testing.assert_array_equal(actual, [0, 0, 0, np.nan, np.nan])

    def test_area_weighting_and_antimeridian(self):
        # Four global cell centres at 0, 90, 180 and 270 degrees east.
        v = rainfall.longitude_wrap(np.array([[5.0, np.nan, 0.0, 8.0]]))
        np.testing.assert_array_equal(v, [[0, 8, 5, np.nan, 0]])
        raster = NumPyRasterSource(
            v, -225, 0, 225, 1, nodata=np.nan, srs_wkt=CRS.from_epsg(4326).to_wkt()
        )
        counties = gpd.GeoDataFrame(
            {"GEOID": ["mixed", "missing", "dateline", "dateline", "valid95"]},
            geometry=[
                box(-75, 0, 15, 1),
                box(0, 0, 80, 1),
                box(175, 0, 180, 1),
                box(-180, 0, -175, 1),
                box(0, 0, 46, 1),
            ],
            crs=4326,
        )
        self.assertEqual(
            rainfall.county_inches(raster, counties),
            {"mixed": 6.0, "missing": None, "dateline": 0.0, "valid95": 5.0},
        )

    def test_published_normals_and_direct_gridpoint_benchmarks(self):
        data = json.loads(rainfall.OUTPUT.read_text())
        counties = data["counties"]
        expected = {
            c["id"]
            for c in json.loads((ROOT / "data/geography.json").read_text())["counties"]
        }
        self.assertEqual(set(counties), expected)
        self.assertEqual(data["coverage"], 3142)
        self.assertEqual(data["period"], "1991–2020")
        self.assertTrue(all(v is not None and 0 <= v < 400 for v in counties.values()))
        self.assertEqual(set(data["monthlyCounties"]), expected)
        for fips, record in data["monthlyCounties"].items():
            self.assertEqual(len(record), 12)
            self.assertTrue(all(0 <= amount <= 35 for amount in record))
            self.assertAlmostEqual(sum(record), counties[fips], delta=0.66)
        # Direct monthly TP minus SF at 37.25 N, 76.75 W (Williamsburg).
        self.assertEqual(
            data["monthlyCounties"]["51830"],
            [3.1, 2.8, 4.0, 3.3, 3.6, 3.8, 4.3, 4.4, 4.6, 3.9, 3.3, 3.4],
        )
        # Each entire county fits inside one original quarter-degree cell.
        # Summing TP and SF directly from all 60 original files at those
        # centres independently checks the published zonal and temporal pipeline.
        for fips, value in {
            "15005": 13.0,
            "51830": 44.6,
            "44001": 40.0,
            "51770": 39.6,
        }.items():
            self.assertEqual(counties[fips], value, fips)


if __name__ == "__main__":
    unittest.main()
