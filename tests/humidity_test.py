# /// script
# requires-python = ">=3.11"
# dependencies = ["exactextract==0.3.0", "rasterio==1.5.2", "geopandas==1.2.0"]
# ///
"""Offline area weighting, packing, missing-data and shipped-coverage checks."""

import json
import sys
import unittest
from pathlib import Path

import geopandas as gpd
import numpy as np
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from shapely.geometry import box

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from humidity import aggregate_month


class HumidityTests(unittest.TestCase):
    def test_weighting_partial_cells_packing_and_missing(self):
        polygons = gpd.GeoDataFrame(
            {
                "GEOID": ["part", "multi", "multi", "missing", "above95"],
                "geometry": [
                    box(0, 0, 1.5, 1),
                    box(0, 0, 1, 1),
                    box(1.75, 0, 2, 1),
                    box(1, 0, 3, 1),
                    box(1.04, 0, 2.04, 1),
                ],
            },
            crs="EPSG:4326",
        )
        with (
            MemoryFile() as memory,
            memory.open(
                driver="GTiff",
                width=3,
                height=1,
                count=1,
                dtype="uint16",
                crs="EPSG:4326",
                transform=from_origin(0, 1, 1, 1),
                nodata=65535,
            ) as raster,
        ):
            raster.scales = (0.01,)
            raster.write(np.array([[2000, 8000, 65535]], dtype="uint16"), 1)
            values = aggregate_month(raster, polygons)
        self.assertEqual(values["part"], 40)
        self.assertEqual(values["multi"], 32)
        self.assertIsNone(values["missing"])
        # Above the threshold with a representable margin avoids floating-point
        # ambiguity of an exactly 95.000000% intersection.
        self.assertEqual(values["above95"], 80)

    def test_shipped_records(self):
        humidity = json.loads((ROOT / "data/humidity.json").read_text())
        climate = json.loads((ROOT / "data/climate.json").read_text())["counties"]
        polygons = {
            c["id"]
            for c in json.loads((ROOT / "data/geography.json").read_text())["counties"]
        }
        self.assertEqual(set(humidity["counties"]), polygons)
        self.assertEqual(humidity["period"], "1981–2010")
        for field, count in humidity["coverage"].items():
            values = [
                (fips, c[field])
                for fips, c in humidity["counties"].items()
                if c[field] is not None
            ]
            self.assertEqual(len(values), count)
            self.assertGreater(count, 3000)
            for fips, v in values:
                self.assertIn(fips, climate)
                self.assertTrue(0 <= v <= 100)
        monthly_coverage = [0] * 12
        for fips, row in humidity["counties"].items():
            monthly = row["monthlyHumidity"]
            self.assertEqual(len(monthly), 12)
            for month, reading in enumerate(monthly):
                if reading is not None:
                    self.assertTrue(0 <= reading <= 100)
                    monthly_coverage[month] += 1
            for season, month_field in (
                ("coldHumidity", "coldMonth"),
                ("hotHumidity", "hotMonth"),
            ):
                month = climate.get(fips, {}).get(month_field)
                self.assertEqual(row[season], monthly[month - 1] if month else None)
        self.assertEqual(monthly_coverage, humidity["monthlyCoverage"])
        self.assertTrue(all(count > 3000 for count in monthly_coverage))
        # Independent cell-by-cell polygon intersections on all 12 source rasters
        # in the District of Columbia, weighted by each cell's spherical area.
        self.assertEqual(
            humidity["counties"]["11001"]["monthlyHumidity"],
            [55.8, 54.9, 54.3, 54.5, 56.3, 56.8, 56.9, 58.1, 57.8, 56.9, 56.5, 56.4],
        )
        # Separately computed from native CHELSA cells intersecting these
        # counties. The five checks include Jan/Jul, Feb/Aug, Jan/Sep and Dec/Jul.
        for fips, (cold, hot) in {
            "11001": (55.8, 56.9),
            "51720": (59.4, 63.8),
            "15005": (63.7, 65.7),
            "06075": (63.0, 66.5),
            "04013": (47.7, 41.0),
        }.items():
            self.assertEqual(humidity["counties"][fips]["coldHumidity"], cold)
            self.assertEqual(humidity["counties"][fips]["hotHumidity"], hot)
        for county in ("51678", "02261"):
            row = humidity["counties"][county]
            self.assertIsNone(row["coldHumidity"])
            self.assertIsNone(row["hotHumidity"])
            self.assertTrue(
                all(reading is not None for reading in row["monthlyHumidity"])
            )


if __name__ == "__main__":
    unittest.main()
