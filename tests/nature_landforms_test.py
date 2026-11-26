# /// script
# requires-python = ">=3.11"
# dependencies = ["shapely==2.2.0"]
# ///
"""Check published, encoded shorelines and mountain areas at independent landmarks."""

import gzip
import json
import unittest
from pathlib import Path

from shapely import LineString, Point, Polygon, STRtree, get_coordinates

NATURE = Path(__file__).resolve().parents[1] / "data/nature"


def pairs(text, scale):
    """Decode one printable delta-encoded longitude/latitude sequence."""
    deltas = []
    value = shift = 0
    for char in text:
        digit = ord(char) - 63
        value |= (digit & 31) << shift
        if digit >= 32:
            shift += 5
        else:
            deltas.append(value // 2 if not value & 1 else -(value // 2) - 1)
            value = shift = 0
    if shift or len(deltas) % 2:
        raise ValueError("Incomplete coordinate")
    x = y = 0
    for dx, dy in zip(deltas[::2], deltas[1::2], strict=True):
        x += dx
        y += dy
        yield x / scale, y / scale


class LandformTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.layers = {}
        for key in ["coast", "mountains"]:
            with gzip.open(NATURE / f"{key}.json.gz", "rt") as source:
                layer = json.load(source)
            shapes, names = [], []
            for name_id, *encoded in layer["parts"]:
                rings = [list(pairs(ring, layer["scale"])) for ring in encoded]
                shape = (
                    LineString(rings[0])
                    if key == "coast"
                    else Polygon(rings[0], rings[1:])
                )
                shapes.append(shape)
                names.append(layer["names"][name_id])
            cls.layers[key] = (STRtree(shapes), names)

    def test_all_great_lakes_and_distinct_ocean_shorelines(self):
        tree, labels = self.layers["coast"]
        for location, lon, lat, basin in [
            ("Duluth / Superior", -92.09273, 46.78081, "Great Lakes"),
            ("Chicago / Michigan", -87.602, 41.891, "Great Lakes"),
            ("Cleveland / Erie", -81.738, 41.490, "Great Lakes"),
            ("Alpena / Huron", -83.431, 45.06, "Great Lakes"),
            ("Olcott / Ontario", -78.717, 43.338, "Great Lakes"),
            ("Santa Monica", -118.49, 34.008, "Pacific"),
            ("Atlantic City", -74.426, 39.353, "Atlantic"),
            ("Galveston", -94.786, 29.293, "Gulf"),
            ("Nome", -165.4058, 64.499, "Pacific"),
            ("Utqiagvik", -156.791, 71.297, "Arctic"),
            ("Waikiki", -157.831, 21.272, "Pacific"),
        ]:
            with self.subTest(location=location):
                p = Point(lon, lat)
                index = tree.nearest(p)
                self.assertEqual(labels[index], basin + " shoreline")
                self.assertLess(tree.geometries[index].distance(p), 0.008)
        denver = Point(-104.99, 39.74)
        self.assertGreater(tree.geometries[tree.nearest(denver)].distance(denver), 10)

    def test_range_footprints_contain_published_summits_and_exclude_plains(self):
        tree, labels = self.layers["mountains"]
        for name, lon, lat in [
            ("Mauna Kea", -155.47, 19.82),
            ("Denali Range", -151.006, 63.07),
            ("Longs Peak Massif", -105.6158, 40.255),
            ("Mount Rainier Massif", -121.76, 46.85),
            ("Mount Washington Massif", -71.3033, 44.27),
        ]:
            with self.subTest(name=name):
                p = Point(lon, lat)
                index = tree.nearest(p)
                self.assertEqual(labels[index], name)
                self.assertTrue(tree.geometries[index].contains(p))
        lincoln = Point(-96.68, 40.8)
        self.assertGreater(tree.geometries[tree.nearest(lincoln)].distance(lincoln), 4)

    def test_every_encoded_geometry_is_valid_and_has_no_dateline_spikes(self):
        for key, (tree, labels) in self.layers.items():
            self.assertGreater(len(labels), 3500)
            for shape in tree.geometries:
                self.assertTrue(shape.is_valid and not shape.is_empty)
                # Each component in either dataset is on one side of the dateline.
                xy = get_coordinates(shape)
                self.assertLess(xy[:, 0].max() - xy[:, 0].min(), 25)
            if key == "mountains":
                self.assertTrue(any(len(shape.interiors) for shape in tree.geometries))


if __name__ == "__main__":
    unittest.main()
