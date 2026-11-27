# /// script
# requires-python = ">=3.11"
# dependencies = ["exactextract==0.3.0", "geopandas==1.2.0", "rasterio==1.5.2"]
# ///
"""Run with uv run tests/land_cover_test.py."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.transform import from_origin
from shapely.geometry import MultiPolygon, box

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import land_cover as cover


class LandCoverTests(unittest.TestCase):
    def test_land_denominator_trace_percentages_and_coverage(self):
        counts = np.zeros(cover.STRIDE, dtype=int)
        counts[:2] = (50, 50)
        counts[cover.WATER] = 100
        values = cover.land_percentages(counts, 210, alaska=False)
        self.assertEqual(values[:2], [50, 50])
        self.assertEqual(values[2], 0)
        self.assertIsNone(values[-1])  # Moss and lichen not distinguished here.
        self.assertIsNone(cover.land_percentages(counts, 211, alaska=False))
        counts[:2] = (1, 9999)
        values = cover.land_percentages(counts, 10100, alaska=True)
        self.assertEqual(values[:2], [0.01, 99.99])
        self.assertEqual(values[-1], 0)
        counts[:2] = 0
        self.assertIsNone(cover.land_percentages(counts, 100, alaska=True))

    def test_split_county_pixels_water_and_nodata(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "grid.tif"
            with rasterio.open(
                path,
                "w",
                driver="GTiff",
                width=5,
                height=2,
                count=1,
                dtype="uint8",
                crs="EPSG:5070",
                transform=from_origin(0, 60, 30, 30),
                nodata=250,
            ) as src:
                src.write(
                    np.array(
                        [[41, 11, 21, 82, 1], [81, 12, 11, 42, 250]], dtype="uint8"
                    ),
                    1,
                )
            frame = gpd.GeoDataFrame(
                {"GEOID": ["mixed", "developed", "missing"]},
                geometry=[
                    MultiPolygon([box(0, 0, 60, 60), box(90, 0, 120, 60)]),
                    box(60, 0, 90, 60),
                    box(120, 0, 150, 60),
                ],
                crs="EPSG:5070",
            )
            counts = cover.county_counts(path, frame, workers=1)

            def row(key):
                return cover.land_percentages(*counts[key], alaska=False)

            self.assertEqual(row("mixed"), [40, 40, 0, 0, 0, 0, 0, 20, None])
            self.assertEqual(row("developed")[3], 100)
            self.assertIsNone(row("missing"))

    def test_geography_and_independent_raster_samples(self):
        data = json.loads(cover.OUTPUT.read_text())
        expected = {
            r["id"]
            for r in json.loads((cover.ROOT / "data/geography.json").read_text())[
                "counties"
            ]
        }
        self.assertEqual(set(data["counties"]), expected)
        self.assertEqual(data["keys"], list(cover.CLASSES))
        for fips, values in data["counties"].items():
            if values is None:
                continue
            self.assertEqual(len(values), len(cover.CLASSES))
            self.assertEqual(values[-1] is None, not fips.startswith("02"))
            known = [v for v in values if v is not None]
            self.assertTrue(all(0 <= v <= 100 for v in known))
            self.assertAlmostEqual(sum(known), 100, delta=0.45)
        # Independently clip each native grid by its single county polygon
        # (rasterio.mask) and count the ungrouped source codes in that window.
        samples = [
            ("55025", "farmCover", 57.7),
            ("17031", "developedCover", 86.5),
            ("31171", "grassCover", 96.0),
            ("06075", "developedCover", 97.8),
            ("15003", "developedCover", 29.1),
            ("02110", "barrenCover", 13.4),
        ]
        for fips, key, expected in samples:
            self.assertEqual(data["counties"][fips][data["keys"].index(key)], expected)


if __name__ == "__main__":
    unittest.main()
