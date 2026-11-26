# /// script
# requires-python = ">=3.11"
# dependencies = ["exactextract==0.3.0", "rasterio==1.5.2", "geopandas==1.2.0"]
# ///
"""Run: uv run tests/cloud_test.py"""

import sys
import unittest
from pathlib import Path

import geopandas as gpd
import numpy as np
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import cloud


class CloudCoverage(unittest.TestCase):
    def test_partial_cells_fill_and_zero(self):
        # Synthetic geometry exercises calculation only. These values are never published.
        polygons = gpd.GeoDataFrame(
            {"GEOID": ["boundary", "halfMissing", "zero", "fillOnly"]},
            geometry=[
                box(0.5, 0, 2, 1),
                box(1, 0, 3, 1),
                box(0, 0, 1, 1),
                box(2, 0, 3, 1),
            ],
            crs="EPSG:4326",
        )
        with (
            MemoryFile() as mem,
            mem.open(
                driver="GTiff",
                width=3,
                height=1,
                count=1,
                dtype="uint16",
                nodata=65535,
                crs="EPSG:4326",
                transform=from_origin(0, 1, 1, 1),
            ) as raster,
        ):
            raster.write(np.array([[0, 7500, 10001]], dtype="uint16"), 1)
            result = cloud.aggregate(raster, polygons)
        self.assertEqual(result["counties"], {"boundary": 50.0, "zero": 0.0})
        self.assertEqual(
            result["coverageBelow99Percent"], {"fillOnly": 0.0, "halfMissing": 50.0}
        )


if __name__ == "__main__":
    unittest.main()
