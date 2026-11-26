# /// script
# requires-python = ">=3.11"
# dependencies = ["geopandas==1.2.0"]
# ///
"""Rebuild place points with uv run scripts/facilities_cities.py --cache /tmp/atlas."""

import argparse
import csv
import io
import json
import tempfile
import unicodedata
import urllib.request
import zipfile
from collections import Counter
from pathlib import Path

import geopandas as gpd
from shapely import Point

BASE = "https://www2.census.gov"
GAZ = BASE + "/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/"
BOUNDARIES = BASE + "/geo/tiger/GENZ2024/shp/"
ACS = (
    BASE
    + "/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b01003.dat"
)
GNIS = "https://prd-tnm.s3.amazonaws.com/StagedProducts/GeographicNames/Topical/PopulatedPlaces_National_Text.zip"
INPUTS = {
    "gaz2024.zip": GAZ + "2024_Gaz_place_national.zip",
    "subs2024.zip": GAZ + "2024_Gaz_cousubs_national.zip",
    "acs.dat": ACS,
    "gn.zip": GNIS,
    "places2024.zip": BOUNDARIES + "cb_2024_us_place_500k.zip",
    "subs-shapes.zip": BOUNDARIES + "cb_2024_us_cousub_500k.zip",
}
DATA = Path(__file__).resolve().parents[1] / "data"
OUTPUT = DATA / "facilities/cities.json"
SUFFIXES = (
    " city and borough",
    " city",
    " town",
    " village",
    " CDP",
    " borough",
    " municipality",
)
TOWN_STATES = {"CT", "MA", "ME", "NH", "NY", "RI", "VT", "WI"}


def gazetteer(path):
    with zipfile.ZipFile(path) as archive:
        lines = archive.read(archive.namelist()[0]).decode("utf-8-sig").splitlines()
    return [
        r
        for r in csv.DictReader((s.rstrip() for s in lines), delimiter="\t")
        if r["USPS"] != "PR"
    ]


def short_name(raw):
    for suffix in SUFFIXES:
        if raw.endswith(suffix):
            return raw.removesuffix(suffix)
    return raw


def populations(path):
    result = {}
    with path.open() as table:
        for r in csv.DictReader(table, delimiter="|"):
            if r["GEO_ID"].startswith(("1600000US", "0600000US")):
                geoid = r["GEO_ID"][9:]
                if geoid in result or not r["B01003_E001"].isdigit():
                    raise ValueError(
                        f"Invalid or duplicate population estimate {geoid}"
                    )
                result[geoid] = int(r["B01003_E001"])
    return result


def folded(name):
    return unicodedata.normalize("NFC", name).casefold()


def land_replacements(cache, rows):
    """Verify the published GNIS features selected for the 2024 Gazetteer snapshot."""
    crosswalk = json.loads(
        (Path(__file__).parent / "sources/city_gnis_2024.json").read_text()
    )
    selected = {r["GEOID"]: r for r in rows if r["GEOID"] in crosswalk}
    if selected.keys() != crosswalk.keys():
        raise ValueError("Unknown Census GEOID in the 2024 city-point crosswalk")
    boundaries = {}
    for geoid_len, archive_name in [(7, "places2024.zip"), (10, "subs-shapes.zip")]:
        ids = [geoid for geoid in selected if len(geoid) == geoid_len]
        if not ids:
            continue
        condition = "GEOID IN (" + ",".join("'" + v + "'" for v in ids) + ")"
        frame = gpd.read_file(
            cache / archive_name, columns=["GEOID"], where=condition
        ).to_crs(4326)
        boundaries.update(zip(frame.GEOID, frame.geometry, strict=True))
    by_feature = {}
    for geoid, feature_id in crosswalk.items():
        by_feature.setdefault(feature_id, []).append(geoid)
    result = {}
    with (
        zipfile.ZipFile(cache / "gn.zip") as archive,
        archive.open("Text/PopulatedPlaces_National.txt") as file,
    ):
        for gn in csv.DictReader(
            io.TextIOWrapper(file, encoding="utf-8-sig"), delimiter="|"
        ):
            for geoid in by_feature.get(gn["feature_id"], ()):
                lon, lat = float(gn["prim_long_dec"]), float(gn["prim_lat_dec"])
                if (
                    gn["feature_class"] != "Populated Place"
                    or gn["state_numeric"] != geoid[:2]
                    or folded(gn["feature_name"])
                    != folded(short_name(selected[geoid]["NAME"]))
                    or not boundaries[geoid].covers(Point(lon, lat))
                    or geoid in result
                ):
                    raise ValueError(
                        f"USGS feature no longer matches Census geography {geoid}"
                    )
                result[geoid] = (lon, lat, gn["feature_id"])
    if result.keys() != selected.keys():
        raise ValueError(
            "Missing verified USGS feature in the 2024 city-point crosswalk"
        )
    return result


def generate(cache):
    places = gazetteer(cache / "gaz2024.zip")
    place_ansi = {r["ANSICODE"] for r in places}
    footprint_keys = ("USPS", "ALAND", "AWATER", "INTPTLAT", "INTPTLONG")
    place_footprints = {tuple(r[k] for k in footprint_keys) for r in places}
    towns = [
        r
        for r in gazetteer(cache / "subs2024.zip")
        if r["USPS"] in TOWN_STATES
        and r["FUNCSTAT"] in {"A", "B", "C"}
        and r["NAME"].endswith(" town")
        and r["ANSICODE"] not in place_ansi
        and tuple(r[k] for k in footprint_keys) not in place_footprints
    ]
    records = places + towns
    if len({r["GEOID"] for r in records}) != len(records):
        raise ValueError("Duplicate geography identifier")
    pop = populations(cache / "acs.dat")
    replacements = land_replacements(cache, records)
    labels = Counter((short_name(r["NAME"]), r["USPS"]) for r in records)
    official = Counter((r["NAME"], r["USPS"]) for r in records)
    points = []
    missing = []
    for r in records:
        name = short_name(r["NAME"])
        if labels[(name, r["USPS"])] > 1:
            name = r["NAME"]
            if official[(name, r["USPS"])] > 1:
                name += " (" + r["GEOID"] + ")"
        lon, lat = float(r["INTPTLONG"]), float(r["INTPTLAT"])
        if r["GEOID"] in replacements:
            lon, lat, _ = replacements[r["GEOID"]]
        estimate = pop.get(r["GEOID"])
        label = f"{name}, {r['USPS']}"
        if estimate is None:
            missing.append(label)
        points.append([label, lon, lat, estimate])
    if len({p[0] for p in points}) != len(points):
        raise ValueError("Unresolved duplicate display labels")
    return {
        "title": "Cities and Census Places",
        "source": "U.S. Census Bureau Gazetteer and ACS table B01003; USGS GNIS for verified on-land alternatives.",
        "url": "https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.2024.html",
        "period": "2020–2024 ACS, 2024 geography",
        "definition": "Distances use the Census representative point for each incorporated place and census-designated place in the 50 states and DC, plus functioning municipal towns classified as county subdivisions in New England, New York and Wisconsin. For 142 places whose published Census point fell outside the land coverage used when this 2024 directory was prepared, a recorded USGS populated-place feature supplies the coordinates. Its name, state and location inside the Census boundary are verified on rebuild. Coextensive town and place records are counted once. Population is the five-year ACS B01003 estimate for that geographic area. Places without an estimate still support name lookup.",
        "sources": list(INPUTS.values()),
        "censusPlaces": len(places),
        "municipalTowns": len(towns),
        "missingPopulation": missing,
        "gnisReplacements": {k: v[2] for k, v in sorted(replacements.items())},
        "fields": ["name", "lon", "lat", "population"],
        "points": sorted(points, key=lambda r: r[0]),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    cache = parser.parse_args().cache
    cache.mkdir(exist_ok=True, parents=True)
    for name, url in INPUTS.items():
        path = cache / name
        if not path.exists():
            with tempfile.NamedTemporaryFile(dir=cache, delete=False) as tmp:
                urllib.request.urlretrieve(url, tmp.name)
            Path(tmp.name).replace(path)
    output = generate(cache)
    OUTPUT.parent.mkdir(exist_ok=True, parents=True)
    OUTPUT.write_text(
        json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n"
    )
    print(
        len(output["points"]),
        "destinations,",
        len(output["gnisReplacements"]),
        "GNIS replacements;",
        len(output["missingPopulation"]),
        "missing estimates.",
    )
