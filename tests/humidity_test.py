# /// script
# requires-python = ">=3.11"
# dependencies = ["exactextract==0.3.0", "geopandas==1.2.0", "netCDF4==1.7.5.1.post1"]
# ///
"""Validate the absolute humidity calculation, county weighting and published normals."""

import json
import sys
import unittest
from pathlib import Path

import geopandas as gpd
import numpy as np
from exactextract.raster import NumPyRasterSource
from shapely.geometry import box

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from county_raster import area_totals
from humidity import GEOGRAPHIC_CRS, Region, absolute_humidity, accumulate, county_means


class HumidityTests(unittest.TestCase):
    def test_density_uses_actual_vapor_pressure_and_kelvin(self):
        pressure = np.ma.array([2, 1, 0, 2, -0.01, 1, 1], mask=[0, 0, 0, 1, 0, 0, 0])
        low = np.array([10, 0, 12, 0, 2, 1, -280])
        high = np.array([30, 0, 18, 1, 3, 0, -275])
        result = absolute_humidity(pressure, low, high)
        np.testing.assert_allclose(result[:3], [14.783, 7.933, 0], atol=0.003)
        self.assertTrue(np.isnan(result[3:]).all())

    def test_each_year_is_converted_before_averaging_and_requires_complete_inputs(self):
        sums = np.zeros((12, 1, 2))
        region = Region(None, slice(0, 1), slice(0, 2), (0, 0, 2, 1), sums)
        for pressure, temperature in [(1.0, -20), (3.0, 30)]:
            fields = {
                key: {key: np.full(sums.shape, value, dtype=float)}
                for key, value in [
                    ("vap", pressure),
                    ("tmin", temperature),
                    ("tmax", temperature),
                ]
            }
            if temperature == -20:
                fields["vap"]["vap"][0, 0, 1] = np.nan
            accumulate([region], fields)
        expected = 0.5 * (1e6 / (461.5 * 253.15) + 3e6 / (461.5 * 303.15))
        np.testing.assert_allclose(sums[:, 0, 0] / 2, expected)
        np.testing.assert_allclose(sums[1:, 0, 1] / 2, expected)
        self.assertTrue(np.isnan(sums[0, 0, 1]))

    def test_area_weights_partial_cells_and_missing(self):
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
        raster = NumPyRasterSource(
            np.array([[2.0, 8.0, np.nan]]),
            xmin=0,
            ymin=0,
            xmax=3,
            ymax=1,
            nodata=np.nan,
            srs_wkt=GEOGRAPHIC_CRS,
        )
        # Include an artificial boundary between regions across two parts of one county.
        result = county_means(
            [
                area_totals(raster, group)
                for group in (polygons.iloc[:2], polygons.iloc[2:])
            ]
        )
        self.assertEqual(
            result, {"part": 4, "multi": 3.2, "missing": None, "above95": 8}
        )

    def test_shipped_records(self):
        humidity = json.loads((ROOT / "data/absolute-humidity.json").read_text())
        climate = json.loads((ROOT / "data/climate.json").read_text())["counties"]
        geography = json.loads((ROOT / "data/geography.json").read_text())["counties"]
        self.assertEqual(set(humidity["counties"]), {c["id"] for c in geography})
        self.assertEqual(humidity["period"], "1991–2020")
        self.assertEqual(humidity["unit"], "g/m³")
        monthly_coverage = np.zeros(12, dtype=int)
        for fips, record in humidity["counties"].items():
            months = record["monthlyAbsoluteHumidity"]
            self.assertEqual(len(months), 12)
            for i, v in enumerate(months):
                if v is not None:
                    self.assertTrue(0 <= v < 40)
                    monthly_coverage[i] += 1
            for field, month_field in (
                ("coldAbsoluteHumidity", "coldMonth"),
                ("hotAbsoluteHumidity", "hotMonth"),
            ):
                month = climate.get(fips, {}).get(month_field)
                self.assertEqual(record[field], months[month - 1] if month else None)
        np.testing.assert_array_equal(monthly_coverage, humidity["monthlyCoverage"])
        self.assertTrue(np.all(monthly_coverage > 2900))
        for field, count in humidity["coverage"].items():
            self.assertEqual(
                sum(row[field] is not None for row in humidity["counties"].values()),
                count,
            )

    def test_independent_county_intersections(self):
        # Computed directly from the 90 annual files using separate Shapely cell
        # intersections and spherical cell areas. Includes a strong monsoon cycle.
        rows = json.loads((ROOT / "data/absolute-humidity.json").read_text())[
            "counties"
        ]
        self.assertEqual(
            rows["04013"]["monthlyAbsoluteHumidity"],
            [5.2, 5.3, 5.5, 4.9, 5.5, 6.4, 12.2, 12.8, 10.7, 7.5, 5.8, 5.2],
        )
        for fips, november in {
            "11001": 5.6,
            "55025": 4.2,
            "12086": 15.1,
            "02090": 1.2,
            "15003": 16.1,
        }.items():
            self.assertEqual(rows[fips]["monthlyAbsoluteHumidity"][10], november)


if __name__ == "__main__":
    unittest.main()
