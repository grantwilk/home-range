"""Offline checks for the pinned July 1, 2025 resident estimates."""

import json
import unittest
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data"


class PopulationTests(unittest.TestCase):
    def test_vintage_totals_and_reconstructed_counties(self):
        snapshot = json.loads((DATA / "population.json").read_text())
        counties = snapshot["counties"]
        map_ids = {
            c["id"]
            for c in json.loads((DATA / "geography.json").read_text())["counties"]
        }
        self.assertEqual(snapshot["period"], "July 1, 2025")
        self.assertEqual(counties.keys(), map_ids)
        self.assertEqual(snapshot["coverage"], 3142)
        self.assertEqual(
            set(snapshot["aggregations"]),
            {"02261"} | {f for f in map_ids if f.startswith("09")},
        )
        self.assertTrue(
            all(type(value) is int and value >= 0 for value in counties.values())
        )
        self.assertEqual(sum(counties.values()), 341_784_857)
        self.assertEqual(counties["06037"], max(counties.values()))
        self.assertEqual(counties["06037"], 9_694_934)
        self.assertEqual(counties["48301"], 52)
        self.assertEqual(counties["11001"], 693_645)
        self.assertEqual(counties["02261"], 6_553 + 2_666)
        self.assertEqual(counties["09001"], 990_441)
        self.assertEqual(
            sum(n for fips, n in counties.items() if fips.startswith("09")), 3_688_496
        )


if __name__ == "__main__":
    unittest.main()
