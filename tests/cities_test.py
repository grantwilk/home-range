"""Verify source anchors and identity handling in the bundled place-point layer."""

import json
import unittest
from pathlib import Path


class CityPoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(
            (
                Path(__file__).resolve().parents[1] / "data/facilities/cities.json"
            ).read_text()
        )
        cls.rows = {
            name: (lon, lat, value) for name, lon, lat, value in cls.data["points"]
        }

    def test_benchmarks_and_state_coverage(self):
        self.assertEqual(self.rows["Aurora, IL"], (-88.290099, 41.763455, 179898))
        self.assertEqual(self.rows["Chicago, IL"], (-87.684939, 41.837045, 2711226))
        self.assertEqual(len({name.rsplit(", ", 1)[1] for name in self.rows}), 51)
        self.assertEqual(len(self.rows), len(self.data["points"]))
        self.assertEqual(
            len(self.rows), self.data["censusPlaces"] + self.data["municipalTowns"]
        )

    def test_unknowns_do_not_become_zero_and_coextensive_towns_are_deduplicated(self):
        unknown = {name for name, (_, _, value) in self.rows.items() if value is None}
        self.assertEqual(unknown, set(self.data["missingPopulation"]))
        self.assertEqual(len(unknown), 3)
        self.assertIn("West Hartford, CT", self.rows)
        self.assertNotIn("West Hartford town, CT", self.rows)
        self.assertNotIn("West Hartford CDP, CT", self.rows)

    def test_offshore_san_francisco_uses_the_verified_usgs_feature(self):
        self.assertEqual(self.data["gnisReplacements"]["0667000"], "277593")
        self.assertEqual(self.rows["San Francisco, CA"], (-122.4194444, 37.775, 830235))


if __name__ == "__main__":
    unittest.main()
