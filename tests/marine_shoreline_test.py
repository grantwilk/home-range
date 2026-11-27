# /// script
# requires-python = ">=3.11"
# dependencies = ["geopandas==1.2.0"]
# ///
"""Check that marine-water classification only trims existing chart lines."""

import sys
import unittest
from pathlib import Path

import geopandas as gpd
import shapely
from shapely.geometry import LineString, MultiPolygon, Point, box

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from marine_shoreline import CRS, SHORE_ALIGNMENT_M, clip_to_marine_water


class MarineShoreTests(unittest.TestCase):
    def test_joins_bays_across_tiles_and_stops_at_river(self):
        ocean = box(47000, 0, 49000, 2000)
        bay = box(49000, 0, 50500, 2000)
        upstream_bay = box(53500, 0, 54500, 2000)
        sound = box(50500, 0, 51500, 2000)
        river = box(51500, 500, 53500, 1000)
        inland_harbor = box(54500, 0, 55500, 2000)
        water = gpd.GeoDataFrame(
            {
                "MTFCC": ["H2053", "H2051", "H3010", "H3010", "H3010"],
                "FULLNAME": [
                    "Ocean",
                    "Split Bay",
                    "Ossabaw Sound",
                    "Long Riv",
                    "Upriver Hbr",
                ],
            },
            geometry=[
                ocean,
                MultiPolygon([bay, upstream_bay]),
                sound,
                river,
                inland_harbor,
            ],
            crs=CRS,
        )
        # A continuous charted bank extends upstream. Its offshore counterpart
        # is another real shore. Neither the mask nor the tile can join the two.
        bank = LineString([(47000, 0), (56500, 0)])
        beach = LineString([(47000, 2000), (51500, 2000)])
        chart = gpd.GeoDataFrame(
            {"REGIONS": ["N", "N"]}, geometry=[bank, beach], crs=CRS
        )

        zones = gpd.GeoDataFrame(
            {"SZ_CODE": [2, 3], "EST_NAME": ["Ossabaw Sound", "Outer Bay"]},
            geometry=[sound, inland_harbor],
            crs=CRS,
        )
        result = clip_to_marine_water(chart, water, zones).to_crs(CRS)
        shore = shapely.union_all(result.geometry)
        self.assertEqual(set(result.REGIONS), {"N"})
        self.assertLess(shore.distance(Point(50000, 0)), 0.01)
        self.assertGreater(shore.distance(Point(54500, 0)), 2500)
        self.assertLess(shore.distance(Point(51500 + SHORE_ALIGNMENT_M, 0)), 0.01)
        self.assertGreater(shore.distance(Point(51500, 1000)), 999)
        self.assertAlmostEqual(shore.length, 9000 + SHORE_ALIGNMENT_M, places=2)

    def test_sound_name_cannot_turn_a_mapped_freshwater_river_into_coast(self):
        # Like Connecticut's H3010 “Long Island Sound” polygon, the name
        # continues through brackish and fresh river zones past the real sound.
        ocean = box(0, 0, 1000, 2000)
        misnamed = box(1000, 0, 18000, 2000)
        water = gpd.GeoDataFrame(
            {"MTFCC": ["H2053", "H3010"], "FULLNAME": ["Ocean", "Long Island Sound"]},
            geometry=[ocean, misnamed],
            crs=CRS,
        )
        zones = gpd.GeoDataFrame(
            {
                "SZ_CODE": [3, 2, 1],
                "EST_NAME": [
                    "Long Island Sound",
                    "Connecticut River",
                    "Connecticut River",
                ],
            },
            geometry=[
                box(0, 0, 3000, 2000),
                box(3000, 0, 6000, 2000),
                box(6000, 0, 13000, 2000),
            ],
            crs=CRS,
        )
        chart = gpd.GeoDataFrame(
            {"REGIONS": ["N"]}, geometry=[LineString([(0, 0), (18000, 0)])], crs=CRS
        )
        shore = shapely.union_all(
            clip_to_marine_water(chart, water, zones).to_crs(CRS).geometry
        )
        self.assertLess(shore.distance(Point(3000, 0)), 0.01)
        self.assertGreater(shore.distance(Point(5000, 0)), 1400)
        self.assertGreater(shore.distance(Point(15000, 0)), 11000)


if __name__ == "__main__":
    unittest.main()
