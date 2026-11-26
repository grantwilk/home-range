# /// script
# requires-python = ">=3.11"
# dependencies = ["shapely==2.2.0"]
# ///
"""Check the bundled hydrography against independent gauges and mapped lake interiors."""

import gzip
import json
import unittest
from pathlib import Path

from nature_landforms_test import pairs
from shapely import LineString, Point, Polygon, STRtree

NATURE = Path(__file__).resolve().parents[1] / "data/nature"


def load_water(key):
    with gzip.open(NATURE / f"{key}.json.gz", "rt") as f:
        data = json.load(f)
    shapes, labels = [], []
    for name_id, *paths in data["parts"]:
        rings = [list(pairs(path, data["scale"])) for path in paths]
        geom = Polygon(rings[0], rings[1:]) if key == "lakes" else LineString(rings[0])
        shapes.append(geom)
        labels.append(data["names"][name_id])
    return STRtree(shapes), labels


class WaterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rivers = load_water("rivers")
        cls.lakes = load_water("lakes")

    def test_fox_river_in_aurora(self):
        # USGS station 05551500, independent of the National Atlas geometry.
        gauge = Point(-88.308960333677, 41.7708625019611)
        tree, labels = self.rivers
        i = tree.nearest(gauge)
        self.assertEqual(labels[i], "Fox River")
        self.assertLess(gauge.distance(tree.geometries[i]), 0.002)

    def test_lake_interiors_and_shoreline(self):
        # Powers Lake is WI DNR WBIC 744200; NHD area 1.827 km² (451.46 acres).
        tree, labels = self.lakes
        for lon, lat, name in [
            (-88.303, 42.54, "Powers Lake"),
            (-87.45, 43.0, "Lake Michigan"),
            (-122.25, 47.62, "Lake Washington"),
        ]:
            p = Point(lon, lat)
            i = tree.nearest(p)
            self.assertEqual(labels[i], name)
            self.assertTrue(tree.geometries[i].contains(p))
        # Lake proximity follows the actual edge even when the nearest spot
        # on water is far from the lake's representative point.
        michigan = Point(-87.45, 43.0)
        self.assertGreater(
            michigan.distance(tree.geometries[tree.nearest(michigan)].centroid), 1
        )

    def test_coverage_and_geometry(self):
        river_tree, river_names = self.rivers
        self.assertGreater(len(river_names), 4000)
        self.assertIn("Waimea River", river_names)
        self.assertIn("Yukon River", river_names)
        lake_tree, lake_names = self.lakes
        self.assertGreater(len(lake_names), 10000)
        self.assertIn("Iliamna Lake", lake_names)
        for tree in (river_tree, lake_tree):
            for g in tree.geometries:
                self.assertTrue(g.is_valid and not g.is_empty)
                self.assertLess(g.bounds[2] - g.bounds[0], 20)


if __name__ == "__main__":
    unittest.main()
