# /// script
# requires-python = ">=3.12"
# dependencies = ["exactextract==0.3.0", "geopandas==1.2.0", "netCDF4==1.7.5.1.post1", "scipy==1.18.1"]
# ///
"""Run: uv run tests/cloud_test.py"""

import json
import sys
import unittest
from pathlib import Path

import geopandas as gpd
import numpy as np
from scipy.sparse import csr_matrix
from shapely.geometry import box

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import cloud


class CloudyDays(unittest.TestCase):
    def test_classify_daily_county_mean_inclusively(self):
        # An 80% county mean may include a much clearer cell. Both cells contribute
        # before classification, and a value immediately below 80 does not count.
        weights = csr_matrix([[0.8, 0.2]])
        values = np.array([[100, 0], [75, 100], [74.999, 100], [0, 0], [100, 100]])
        cloudy, covered = cloud.count_days(weights, values)
        self.assertEqual((cloudy[0], covered[0]), (3, 5))

    def test_missing_values_and_partial_footprint(self):
        # Area weights use the whole county, including any area beyond the grid.
        weights = csr_matrix([[0.95, 0.05], [0.94, 0.06], [0.5, 0.4]])
        values = np.array(
            [[80, -9.96921e36], [100, 9.96921e36], [0, np.nan], [100, 100]]
        )
        cloudy, covered = cloud.count_days(weights, values)
        np.testing.assert_array_equal(cloudy, [3, 1, 0])
        np.testing.assert_array_equal(covered, [4, 1, 0])

    def test_area_weights_clip_partial_cells(self):
        counties = gpd.GeoDataFrame(
            geometry=[box(20, -50, 150, 50), box(-150, -50, -25, 50)],
            crs=cloud.EQUAL_AREA,
        )
        w, used = cloud.county_weights(
            counties, cloud.EQUAL_AREA, np.array([0, 100]), np.array([0, 100])
        )
        full = np.zeros((2, 4))
        full[:, used] = w.toarray()
        np.testing.assert_allclose(full, [[30 / 130, 100 / 130, 0, 0], [0.2, 0, 0, 0]])

    def test_published_counts(self):
        data = json.loads(cloud.OUTPUT.read_text())
        geography = json.loads((ROOT / "data/geography.json").read_text())
        self.assertEqual(
            set(data["counties"]), {row["id"] for row in geography["counties"]}
        )
        self.assertEqual(data["daysEvaluated"], 10_958)
        self.assertEqual(data["thresholdPercent"], 80)
        self.assertEqual(data["period"], "1991–2020")
        # Independently counted directly from the NOAA annual files. The first four
        # lie in a single cell and can be checked without a polygon-weighting implementation.
        for code, total in {
            "36081": 1575,
            "15005": 3354,
            "34017": 1650,
            "51610": 1693,
            "55025": 1698,
            "04013": 502,
            "06075": 1383,
            "53033": 3147,
        }.items():
            self.assertEqual(data["counties"][code], round(total / 30, 1))
        self.assertTrue(all(0 <= d <= 366 for d in data["counties"].values()))
        self.assertLess(data["coverageBelow99_9Percent"]["15003"], 100)


if __name__ == "__main__":
    unittest.main()
