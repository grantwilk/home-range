# /// script
# requires-python = ">=3.11"
# dependencies = ["shapely==2.2.0"]
# ///
"""Verify the published park polygons and excluded inholdings."""

import gzip
import json
import unittest
from pathlib import Path

from nature_landforms_test import pairs
from shapely import Point, Polygon

LAYER = Path(__file__).resolve().parents[1] / "data/nature/parks.json.gz"
CHECKS = {
    "Busse Woods (Ned Brown Preserve)": ((-87.989, 42.025), True),
    "Yellowstone National Park": ((-110.82691, 44.46090), True),
    "Hawai'i Volcanoes National Park": ((-155.259, 19.430), True),
    "Tongass National Forest": ((-134.544, 58.423), True),
    "Kettle Moraine State Forest-Lapham Peak Unit": ((-88.3942, 43.03412), True),
    "Waterfall Glen": ((-87.964855, 41.70041), True),
    "White Mountain National Forest": ((-71.81736, 44.006918), False),
}


class ParksTests(unittest.TestCase):
    def test_release_polygons_and_park_interiors(self):
        with gzip.open(LAYER) as stream:
            layer = json.load(stream)
        self.assertEqual(layer["geometry"], "area")
        self.assertGreater(len(layer["parts"]), 50000)
        self.assertIn("March 2025", layer["period"])
        self.assertIn("Public access", layer["definition"])
        self.assertTrue(set(CHECKS).issubset(layer["names"]))
        self.assertFalse(any("nursery" in name.lower() for name in layer["names"]))
        containing = set()
        holes = 0
        argonne = Point(-87.9773, 41.714)
        for name_id, *paths in layer["parts"]:
            name = layer["names"][name_id]
            rings = [list(pairs(path, layer["scale"])) for path in paths]
            poly = Polygon(rings[0], rings[1:])
            self.assertTrue(poly.is_valid and poly.area > 0, name)
            self.assertLess(poly.bounds[2] - poly.bounds[0], 25, name)
            if name in CHECKS and poly.covers(Point(CHECKS[name][0])):
                containing.add(name)
            # The preserve wraps around Argonne National Laboratory. Its parcel
            # must stay outside even though nearby public land shares a boundary.
            if name == "Waterfall Glen":
                self.assertFalse(poly.covers(argonne))
            holes += len(poly.interiors)
        self.assertEqual(containing, {name for name in CHECKS if CHECKS[name][1]})
        self.assertGreater(holes, 1000)


if __name__ == "__main__":
    unittest.main()
