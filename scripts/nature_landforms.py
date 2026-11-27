# /// script
# requires-python = ">=3.11"
# dependencies = ["geopandas==1.2.0"]
# ///
"""Rebuild coastline and mountain-range layers with uv run scripts/nature_landforms.py."""

import argparse
import tempfile
from pathlib import Path

import geopandas as gpd
import shapely
from coastal_water import read_marine_water
from marine_shoreline import clip_to_marine_water
from nature_data import verified_file, write_layer
from shapely.geometry import box

COAST_URL = (
    "https://www2.census.gov/geo/tiger/TIGER2025/COASTLINE/tl_2025_us_coastline.zip"
)
SHORELINE_URL = "https://coast.noaa.gov/htdata/Shoreline/us_medium_shoreline.zip"
LEGAL_STATES_URL = (
    "https://www2.census.gov/geo/tiger/TIGER2025/STATE/tl_2025_us_state.zip"
)
GMBA_URL = (
    "https://data.earthenv.org/mountains/standard/GMBA_Inventory_v2.0_standard.zip"
)
STATES_URL = "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_500k.zip"
SOURCES = {
    "coast": (
        COAST_URL,
        "c88e68274b72e7cfded0bb0846c8c78f2c078e5f361973792a84c67b0975459c",
    ),
    "shoreline": (
        SHORELINE_URL,
        "3a5d7e0d36824fc96e58148b681c15478f6a10a99e669274e2041164217a13e8",
    ),
    "legal-states": (
        LEGAL_STATES_URL,
        "59a220888a8d9be8117c4fcd38f542bd02d81abf0d198c78113595ad540dd957",
    ),
    "gmba": (
        GMBA_URL,
        "3d67de8143beba5ce427cb2c3041194079fe070b371ac0a2bce91f3bc62d9d27",
    ),
    "states": (
        STATES_URL,
        "3e81cbb6cf5f60d9b01ef3e730afa14d61ce5f784252a0b33a696135e71447bc",
    ),
}
SALINITY_URL = (
    "https://www.ncei.noaa.gov/data/oceans/archive/arc0074/0127396/1.1/data/0-data/"
    "edited_shapefiles_Apr17_2015/edited_shapefiles/united_states_salinity_3_zones"
)
SALINITY_CHECKSUMS = {
    "dbf": "af304ab1b81ba930e2d3a59111fc80af2ca6ee1cf8ea0366663866cc97042f67",
    "prj": "84cf5b9a3c1a444f83ac30ff76f8c5035990223027ba69b2f4d628388adcbd65",
    "shp": "7e37032eb655526cedff03be4c4cbf880fe6f5312d69e3238dd8c591738acfdb",
    "shx": "d820ff72d0dfaafafd04be64adf556d0b53a301da32243b04ea3f3d1f776e63e",
}
COAST_NAMES = {
    "Atlantic": "Atlantic shoreline",
    "Gulf": "Gulf shoreline",
    "Pacific": "Pacific shoreline",
    "Arctic": "Arctic shoreline",
    "Great Lakes": "Great Lakes shoreline",
}
COAST_DEFINITION = (
    "Straight-line miles to the nearest mapped ocean, bay, sound or Great Lakes shore. "
    "In the contiguous states, 2025 Census marine water areas identify where NOAA’s "
    "charted shoreline meets ocean-connected bays and sounds. NOAA’s mapped estuaries "
    "corroborate waters with conflicting river and bay labels. A 250-meter allowance "
    "aligns the two maps near shore. Riverbanks end near mapped mouths. "
    "Local salinity varies with tides and river flow. The NOAA shoreline was compiled "
    "in 1998 from 1988–1992 charts. Alaska, Hawaii and the Great Lakes use the "
    "2025 Census coastline."
)
MOUNTAIN_DEFINITION = (
    "Straight-line distance to the U.S. portion of a named mountain-range footprint "
    "in the GMBA v2.0 Standard inventory, clipped to the 50 states and DC. A location "
    "inside its boundary has zero distance. Range boundaries reflect regional terrain "
    "and can enclose valleys. Trailheads and summits have different locations. "
    "Adapted from Snethlage et al. (2022), CC BY 4.0."
)


def source(cache, key):
    return verified_file(cache / f"{key}.zip", *SOURCES[key])


def read_estuary_zones(cache):
    for ext, checksum in SALINITY_CHECKSUMS.items():
        verified_file(cache / f"salinity.{ext}", f"{SALINITY_URL}.{ext}", checksum)
    return gpd.read_file(cache / "salinity.shp", columns=["SZ_CODE", "EST_NAME"])


def coast_features(chart_path, census_path, legal_path, water, estuary_zones, states):
    # TIGER state boundaries extend into territorial waters, unlike cartographic
    # state outlines trimmed to the coast. Clip existing lines; never construct
    # shore by taking the boundary of a clipped polygon.
    legal = gpd.read_file(legal_path, columns=["STATEFP", "STUSPS"]).to_crs(4326)
    contiguous = legal[
        (legal.STATEFP.astype(int) < 60) & ~legal.STUSPS.isin(["AK", "HI"])
    ]
    if len(contiguous) != 49:
        raise ValueError("Expected contiguous states and DC for the shoreline clip")
    country = shapely.union_all(contiguous.geometry)
    shapely.prepare(country)
    chart = gpd.read_file(
        chart_path,
        columns=["REGIONS", "S_ARC_CODE"],
        where="S_ARC_CODE = 1 AND REGIONS <> 'L'",
    ).to_crs(4326)
    # Regional overlaps are duplicated in the NOAA archive, including GS/SG
    # across the Florida Keys. A normalized line has the same key in either direction.
    chart = chart.loc[~chart.geometry.normalize().duplicated()]
    names = {
        "P": "Pacific shoreline",
        "N": "Atlantic shoreline",
        "M": "Atlantic shoreline",
        "S": "Atlantic shoreline",
        "MN": "Atlantic shoreline",
        "NM": "Atlantic shoreline",
        "G": "Gulf shoreline",
        "GS": "Florida Keys shoreline",
        "SG": "Florida Keys shoreline",
    }
    if not set(chart.REGIONS).issubset(names) or set(chart.S_ARC_CODE) != {1}:
        raise ValueError("Unexpected NOAA shoreline classes")
    inside = shapely.covers(country, chart.geometry.array)
    chart = chart.copy()
    chart.loc[~inside, "geometry"] = chart.geometry[~inside].intersection(country)
    for row in clip_to_marine_water(chart, water, estuary_zones).itertuples():
        yield names[row.REGIONS], row.geometry

    census = gpd.read_file(census_path, columns=["NAME", "MTFCC"]).to_crs(4326)
    if set(census.MTFCC) != {"L4150"}:
        raise ValueError("Unexpected TIGER coastline class")
    # AK and HI features already belong to the U.S. Census source; envelopes
    # separate them from territorial datasets and retain offshore islands.
    for state in ["AK", "HI"]:
        zone = box(*states.loc[states.STUSPS == state].total_bounds).buffer(0.2)
        for row in census[census.intersects(zone)].itertuples():
            yield COAST_NAMES[row.NAME], row.geometry
    for geom in census.loc[census.NAME == "Great Lakes"].geometry:
        yield COAST_NAMES["Great Lakes"], geom


def mountain_features(path, states):
    ranges = gpd.read_file(
        path,
        columns=["GMBA_V2_ID", "MapName", "MapUnit", "CountryISO"],
        where="MapUnit = 'Basic' AND CountryISO LIKE '%USA%'",
    ).to_crs(4326)
    if (
        len(ranges) != 1279
        or not ranges.GMBA_V2_ID.is_unique
        or not ranges.is_valid.all()
    ):
        raise ValueError("Unexpected basic mountain-range inventory")
    country = shapely.union_all(states.geometry)
    shapely.prepare(country)
    for row in ranges.sort_values("GMBA_V2_ID").itertuples():
        shape = row.geometry
        if not country.intersects(shape):
            continue
        if not country.covers(shape):
            # The envelope cuts reduce overlay cost when the national outline
            # contains distant islands. The mask remains the actual US geometry.
            xmin, ymin, xmax, ymax = shape.bounds
            local = shapely.clip_by_rect(
                country, xmin - 0.01, ymin - 0.01, xmax + 0.01, ymax + 0.01
            )
            shape = shape.intersection(shapely.make_valid(local))
        yield row.MapName, shape


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cache",
        type=Path,
        default=Path(tempfile.gettempdir()) / "home-range-landforms",
    )
    parser.add_argument(
        "--layer", choices=["both", "coast", "mountains"], default="both"
    )
    args = parser.parse_args()
    args.cache.mkdir(exist_ok=True, parents=True)
    states = gpd.read_file(
        source(args.cache, "states"), columns=["STUSPS", "STATEFP"]
    ).to_crs(4326)
    states = states[states.STATEFP.astype(int) < 60]
    if len(states) != 51:
        raise ValueError("Expected 50 states and the District of Columbia")
    if args.layer in {"both", "coast"}:
        write_layer(
            "coast",
            coast_features(
                source(args.cache, "shoreline"),
                source(args.cache, "coast"),
                source(args.cache, "legal-states"),
                read_marine_water(args.cache),
                read_estuary_zones(args.cache),
                states,
            ),
            source="NOAA National Ocean Service, Medium Resolution Digital Vector Shoreline and Estuarine Salinity Zones; U.S. Census Bureau, TIGER/Line Area Hydrography and Coastline",
            url="https://shoreline.noaa.gov/med-res.html",
            period="1998 shoreline · 1999 estuarine zones · 2025 TIGER/Line",
            definition=COAST_DEFINITION,
            geometry="line",
        )
    if args.layer in {"both", "mountains"}:
        write_layer(
            "mountains",
            mountain_features(source(args.cache, "gmba"), states),
            source="Snethlage et al., Global Mountain Biodiversity Assessment v2.0 Standard (CC BY 4.0); U.S. Census Bureau 2024 boundaries",
            url="https://doi.org/10.48601/earthenv-t9k2-1407",
            period="GMBA v2.0 · 2022",
            definition=MOUNTAIN_DEFINITION,
            geometry="area",
        )


if __name__ == "__main__":
    main()
