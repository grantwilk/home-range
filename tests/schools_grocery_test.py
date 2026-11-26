# /// script
# requires-python = ">=3.11"
# dependencies = ["geopandas==1.2.0"]
# ///
"""Verify facilities, selection rules, colocated sites and geographic coverage."""

import json
import sys
import unittest
from pathlib import Path

from shapely.geometry import box

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from facilities_schools_grocery import clean, grocery_rows, school_rows


class FacilityTests(unittest.TestCase):
    def test_grade_and_operating_status(self):
        sample = {
            "STATUS": "1",
            "VIRTUAL": "Not Virtual",
            "GSLO": "KG",
            "GSHI": "05",
            "NCESSCH": "1",
            "LSTATE": "MA ",
            "SCH_NAME": "Example",
            "LONCOD": -72,
            "LATCOD": 42,
        }
        self.assertEqual(len(list(school_rows([sample], []))), 1)
        for modifications in [
            {"GSLO": "PK", "GSHI": "PK"},
            {"GSLO": "AE", "GSHI": "AE"},
            {"STATUS": "6"},
            {"VIRTUAL": "Full Virtual"},
        ]:
            self.assertEqual(list(school_rows([dict(sample, **modifications)], [])), [])

    def test_locations_and_categories(self):
        points = [
            ("Public", "1", "MA ", "First campus", -72, 42),
            ("Private", "2", "MA", "Second campus", -72, 42),
            ("Private", "3", "MA", "Zero", -72, 0),
            ("Public", "1", "MA", "First campus", -72, 42),
            ("Private", "4", "MA", "Bad coordinate", -122, 39),
        ]
        result = clean(points, {"MA": box(-73, 41, -71, 43)})
        self.assertEqual(result["points"], [("First campus / Second campus", -72, 42)])
        self.assertEqual(result["namedFacilities"], 2)
        self.assertEqual(result["excluded"]["missingOrOutsideReportedState"], 2)
        self.assertEqual(
            list(grocery_rows([{"Store_Type": "Convenience Store"}], set())), []
        )

    def test_shipped_lists(self):
        for key, minimum in [("grocery", 35_000), ("schools", 105_000)]:
            d = json.loads((ROOT / "data" / "facilities" / f"{key}.json").read_text())
            points = d["points"]
            self.assertGreater(len(points), minimum)
            self.assertEqual(d["count"], len(points))
            self.assertEqual(d["fields"], ["name", "lon", "lat"])
            self.assertEqual(len({(lon, lat) for _, lon, lat in points}), len(points))
            self.assertTrue(
                all(
                    n.strip() and -180 <= x <= 180 and 18 < y < 72 and x != 0
                    for n, x, y in points
                )
            )
            self.assertEqual(len(d["countsByState"]), 51)
            self.assertEqual(sum(d["countsByState"].values()), len(points))
            self.assertTrue(all(d["countsByState"][s] > 15 for s in ("AK", "HI", "DC")))
            if key == "schools":
                self.assertGreater(d["countsBySourceType"]["Public"], 90_000)
                self.assertGreater(d["countsBySourceType"]["Private"], 20_000)
                self.assertIn(["Albertville Middle School", -86.2062, 34.2602], points)
            else:
                self.assertEqual(
                    set(d["countsBySourceType"]),
                    {
                        "Super Store",
                        "Supermarket",
                        "Large Grocery Store (2025 classification)",
                    },
                )
                self.assertGreater(
                    d["countsBySourceType"][
                        "Large Grocery Store (2025 classification)"
                    ],
                    2_000,
                )


if __name__ == "__main__":
    unittest.main()
