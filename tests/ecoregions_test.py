# /// script
# requires-python = ">=3.11"
# dependencies = ["exactextract==0.3.0", "geopandas==1.2.0", "rasterio==1.5.2"]
# ///
"""Run with uv run tests/ecoregions_test.py."""

import json
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import ecoregions as eco


def summarize(cover, region, climate, area=None):
    count = eco.joint_classes(
        *(np.array(a, dtype=np.uint8) for a in (cover, region, climate))
    )
    return eco.percentages(
        np.bincount(count, minlength=eco.CATEGORIES),
        len(cover) if area is None else area,
    )


class EcologyTests(unittest.TestCase):
    def test_water_inland_lakes_and_different_land_classifications(self):
        # A cultivated field and a town can fall in the same prairie region.
        # Both desert climates count; semiarid steppe stays separate.
        self.assertEqual(
            summarize([82, 24, 41, 11], [2, 2, 3, 3], [4, 5, 7, 4]),
            [66.7, 33.3, 66.7],
        )
        self.assertEqual(summarize([11, 11], [2, 3], [4, 5]), [None] * 3)
        self.assertEqual(summarize([82], [0], [7]), [None, None, 0])
        self.assertEqual(summarize([24], [1], [0]), [0, 0, None])

    def test_insufficient_coverage_and_trace_shares(self):
        self.assertEqual(summarize([41, 1], [2, 2], [7, 7]), [None] * 3)
        self.assertEqual(summarize([41, 41], [2, 0], [5, 5]), [None, None, 100])
        self.assertEqual(summarize([82] * 20, [2] * 20, [0] + [4] * 19), [100, 0, 100])
        self.assertEqual(summarize([82], [2], [4], area=2), [None] * 3)
        self.assertGreater(eco.share(1, 1_000_000, 1_000_000), 0)
        self.assertLess(eco.share(999_999, 1_000_000, 1_000_000), 100)

    def test_published_counties_and_independent_geographic_checks(self):
        data = json.loads(eco.OUTPUT.read_text())
        counties = data["counties"]
        geography = json.loads((ROOT / "data/geography.json").read_text())
        self.assertEqual(set(counties), {row["id"] for row in geography["counties"]})
        self.assertEqual(
            data["keys"], ["prairieRegion", "plainsRegion", "desertClimate"]
        )
        self.assertEqual(
            [sum(row[i] is not None for row in counties.values()) for i in range(3)],
            [3061, 3061, 3119],
        )
        for fips, (prairie, plains, desert) in counties.items():
            if fips[:2] in {"02", "15"}:
                self.assertEqual((prairie, plains), (None, None))
            self.assertEqual(prairie is None, plains is None)
            if prairie is not None:
                self.assertLessEqual(prairie + plains, 100.1)
            for share in (prairie, plains, desert):
                self.assertTrue(share is None or 0 <= share <= 100)

        # Independent 300 m systematic sample of NLCD centres. Explicitly
        # projected the sampled coordinates into the global climate grid and
        # tested EcoMap polygon containment. Allow 0.2 percentage points for
        # sampling near regional and coastal boundaries.
        for fips, expected in {
            "17019": [
                98.3,
                0,
                0,
            ],  # Champaign IL, prairie parkland and forest provinces
            "19035": [100, 0, 0],  # Cherokee IA
            "20083": [0, 100, 0],  # Hodgeman KS, Great Plains
            "48329": [0, 92.5, 0],  # Midland TX straddles regional boundaries
            "49045": [0, 0, 39.0],  # Tooele UT borders Great Salt Lake
            "06025": [
                0,
                0,
                99.7,
            ],  # Imperial CA, irrigated agriculture in desert climate
            "06037": [0, 0, 7.7],  # Los Angeles CA
            "02020": [None, None, 0],  # Anchorage AK
        }.items():
            for value, reference in zip(counties[fips], expected):
                if reference is None:
                    self.assertIsNone(value)
                else:
                    self.assertAlmostEqual(value, reference, delta=0.2, msg=fips)


if __name__ == "__main__":
    unittest.main()
