"""Prepare the marine water polygons used to identify U.S. river mouths."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import geopandas as gpd
import pandas as pd
from nature_data import verified_file

AREA_WATER_URL = "https://www2.census.gov/geo/tiger/TIGER2025/AREAWATER/"
MANIFEST = Path(__file__).with_name("sources") / "marine_water_2025.sha256"


def marine_water_candidates(water):
    """Include marine classes and Census river polygons explicitly named for marine waters."""
    marine = water.MTFCC.isin(["H2051", "H2053"])
    if "FULLNAME" in water:
        # Match the final word so names such as Bay River cannot qualify.
        named = water.FULLNAME.str.contains(
            r"(?:^|\s)(?:bay|sound|snd|gulf|glf|harbor|harbour|hbr)\s*$",
            case=False,
            na=False,
        )
        marine |= (water.MTFCC == "H3010") & named
    return water.loc[marine]


def county_water(directory, fips, expected):
    filename = f"tl_2025_{fips}_areawater.zip"
    archive = verified_file(directory / filename, AREA_WATER_URL + filename, expected)
    polygons = gpd.read_file(
        archive,
        columns=["MTFCC", "FULLNAME"],
        where="MTFCC IN ('H2051', 'H2053', 'H3010')",
    )
    polygons = marine_water_candidates(polygons)
    if polygons.empty or polygons.crs.to_epsg() != 4269:
        raise ValueError(f"Expected marine features in NAD83 for county {fips}")
    return polygons


def read_marine_water(cache):
    """Read the candidate water polygons from the verified Census county archives."""
    directory = cache / "areawater-2025"
    directory.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=6) as workers:
        jobs = []
        for line in MANIFEST.read_text().splitlines():
            if line and not line.startswith("#"):
                digest, fips = line.split()
                jobs.append(workers.submit(county_water, directory, fips, digest))
        return pd.concat([job.result() for job in jobs], ignore_index=True)
