# /// script
# requires-python = ">=3.11"
# dependencies = ["geopandas==1.2.0"]
# ///
"""Rebuild coastline and mountain-range layers with uv run scripts/nature_landforms.py."""

import argparse
import hashlib
import shutil
import tempfile
import urllib.request
from pathlib import Path

import geopandas as gpd
import shapely
from nature_data import write_layer
from shapely.geometry import box

COAST_URL = (
    "https://www2.census.gov/geo/tiger/TIGER2025/COASTLINE/tl_2025_us_coastline.zip"
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
    "gmba": (
        GMBA_URL,
        "3d67de8143beba5ce427cb2c3041194079fe070b371ac0a2bce91f3bc62d9d27",
    ),
    "states": (
        STATES_URL,
        "3e81cbb6cf5f60d9b01ef3e730afa14d61ce5f784252a0b33a696135e71447bc",
    ),
}
COAST_NAMES = {
    "Atlantic": "Atlantic shoreline",
    "Gulf": "Gulf shoreline",
    "Pacific": "Pacific shoreline",
    "Arctic": "Arctic shoreline",
    "Great Lakes": "Great Lakes shoreline",
}
COAST_DEFINITION = (
    "Straight-line distance to U.S. ocean, gulf, estuary or Great Lakes shoreline "
    "classified as coastline (L4150) by the Census Bureau. Includes Alaska, Hawaii "
    "and the U.S. shore of all five Great Lakes. A shoreline can be rocky, marshy "
    "or private. Beach type and public access are outside this dataset."
)
MOUNTAIN_DEFINITION = (
    "Straight-line distance to the U.S. portion of a named mountain-range footprint "
    "in the GMBA v2.0 Standard inventory, clipped to the 50 states and DC. A location "
    "inside its boundary has zero distance. Range boundaries reflect regional terrain "
    "and can enclose valleys. Trailheads and summits have different locations. "
    "Adapted from Snethlage et al. (2022), CC BY 4.0."
)


def source(cache, key):
    url, checksum = SOURCES[key]
    dest = cache / f"{key}.zip"
    if not dest.exists():
        with tempfile.NamedTemporaryFile(dir=cache, delete=False) as tmp:
            name = Path(tmp.name)
        try:
            with (
                urllib.request.urlopen(url, timeout=120) as response,
                name.open("wb") as out,
            ):
                shutil.copyfileobj(response, out)
            with name.open("rb") as inp:
                if hashlib.file_digest(inp, "sha256").hexdigest() != checksum:
                    raise ValueError(f"Unexpected download checksum for {url}")
            name.replace(dest)
        finally:
            name.unlink(missing_ok=True)
    else:
        with dest.open("rb") as inp:
            if hashlib.file_digest(inp, "sha256").hexdigest() != checksum:
                raise ValueError(f"Source checksum changed: {dest}")
    return dest


def coast_features(path, states):
    water = gpd.read_file(path, columns=["NAME", "MTFCC"]).to_crs(4326)
    if set(water.MTFCC) != {"L4150"}:
        raise ValueError("Unexpected TIGER coastline class")
    # The three disjoint envelopes separate the states from U.S. territories.
    # Retain whole original lines, including reefs and tiny offshore islands
    # missing from the more generalized state cartographic boundary file.
    regions = [
        states[~states.STUSPS.isin(["AK", "HI"])],
        states[states.STUSPS == "AK"],
        states[states.STUSPS == "HI"],
    ]
    envelopes = [box(*region.total_bounds).buffer(0.2) for region in regions]
    selected = water[water.intersects(shapely.union_all(envelopes))]
    if set(selected.NAME) != set(COAST_NAMES):
        raise ValueError("Unexpected coastal basin name or missing Great Lakes")
    for row in selected.itertuples():
        yield COAST_NAMES[row.NAME], row.geometry


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
            coast_features(source(args.cache, "coast"), states),
            source="U.S. Census Bureau, 2025 TIGER/Line Coastline",
            url=COAST_URL,
            period="2025 TIGER/Line",
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
