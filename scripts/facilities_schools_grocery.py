# /// script
# requires-python = ">=3.11"
# dependencies = ["geopandas==1.2.0"]
# ///
"""Build the school and grocery facility layers from NCES and USDA directories.

uv run scripts/facilities_schools_grocery.py --cache /tmp/home-range-facilities
"""

import argparse
import csv
import gzip
import hashlib
import io
import json
import math
import re
import subprocess
import time
import zipfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlencode

import geopandas as gpd
import shapely

BASE = "https://nces.ed.gov/opengis/rest/services/K12_School_Locations/"
PUBLIC = BASE + "EDGE_ADMINDATA_PUBLICSCH_2425/MapServer/1"
PRIVATE = BASE + "EDGE_GEOCODE_PRIVATESCH_2324/MapServer/0"
SNAP = "https://services1.arcgis.com/RLQu0rK7h4kbsBq5/arcgis/rest/services/snap_retailer_location_data/FeatureServer/0"
HISTORICAL = "https://www.fns.usda.gov/sites/default/files/resource-files/snap-retailer-locator-data2005-2025.zip"
STATES = "https://www2.census.gov/geo/tiger/GENZ2017/shp/cb_2017_us_state_500k.zip"
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "facilities"
SOURCE_FIELDS = {
    "public": "NCESSCH,SCH_NAME,LSTATE,LATCOD,LONCOD,GSHI,GSLO,VIRTUAL,STATUS",
    "private": "PPIN,NAME,STATE,LAT,LON",
    "snap": "Record_ID,Store_Name,Store_Street_Address,City,State,Zip_Code,Store_Type,Latitude,Longitude",
}


def fetch_json(url, **params):
    address = url + "?" + urlencode({"f": "json", **params})
    for attempt in range(3):
        body = subprocess.check_output(
            ["curl", "-fsSL", "--retry", "3", "--max-time", "90", address]
        )
        try:
            data = json.loads(body)
            if "error" not in data:
                return data
            failure = str(data["error"])
        except ValueError as error:
            failure = str(error)
        time.sleep(attempt + 1)
    raise ValueError(f"Source query failed: {url}: {failure}")


def snapshot(cache, key, url, where="1=1", revision=None):
    """Verify each query page against the provider's exact list of object IDs."""
    file = cache / f"{key}-{revision or 'v1'}.json.gz"
    if file.exists():
        return json.loads(gzip.decompress(file.read_bytes()))
    query = url + "/query"
    catalog = fetch_json(query, where=where, returnIdsOnly="true")
    fid = catalog["objectIdFieldName"]
    ids = sorted(catalog["objectIds"])
    if not ids or len(ids) != len(set(ids)):
        raise ValueError("Invalid ArcGIS object ID catalog.")
    page_size = 950
    pages = [ids[i : i + page_size] for i in range(0, len(ids), page_size)]

    def load(expected):
        result = fetch_json(
            query,
            where=f"({where}) AND {fid} >= {expected[0]} AND {fid} <= {expected[-1]}",
            outFields=f"{fid},{SOURCE_FIELDS[key]}",
            returnGeometry="false",
            orderByFields=fid,
        )
        rows = [f["attributes"] for f in result["features"]]
        if [r[fid] for r in rows] != expected or result.get("exceededTransferLimit"):
            raise ValueError(f"Incomplete {key} batch {expected[0]}–{expected[-1]}")
        return rows

    with ThreadPoolExecutor(max_workers=8) as pool:
        rows = [r for page in pool.map(load, pages) for r in page]
    if revision and fetch_json(url)["editingInfo"]["dataLastEditDate"] != revision:
        raise ValueError("USDA published a new revision during download; rerun.")
    temp = file.with_suffix(".tmp")
    temp.write_bytes(
        gzip.compress(json.dumps(rows, separators=(",", ":")).encode(), mtime=0)
    )
    temp.replace(file)
    return rows


def verified_file(cache, name, url, digest):
    file = cache / name
    if not file.exists():
        temp = file.with_suffix(".part")
        subprocess.run(
            ["curl", "-fsSL", "--retry", "3", url, "-o", str(temp)], check=True
        )
        temp.replace(file)
    if hashlib.sha256(file.read_bytes()).hexdigest() != digest:
        raise ValueError(f"Source checksum mismatch: {file}")
    return file


def normalize(text):
    return re.sub(r"\W+", " ", str(text or "").casefold()).strip()


def store_identity(record_id, state, name, street, zip_code):
    return (
        str(record_id),
        state,
        normalize(name),
        normalize(street),
        str(zip_code).strip().zfill(5),
    )


def historic_large_stores(cache):
    archive = verified_file(
        cache,
        "snap-historical.zip",
        HISTORICAL,
        "872a6f814a63514a1f1b0c4517a90309a9fbb01d97d6e4dbb1e8b20421c08cce",
    )
    with (
        zipfile.ZipFile(archive) as zip_file,
        zip_file.open("Historical SNAP Retailer Locator Data 2005-2025.csv") as raw,
    ):
        rows = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig"))
        return {
            store_identity(
                r["Record ID"],
                r["State"],
                r["Store Name"],
                r["Street Number"].strip() + " " + r["Street Name"].strip(),
                r["Zip Code"],
            )
            for r in rows
            if r["Store Type"] == "Large Grocery Store" and not r["End Date"].strip()
        }


def geographies(cache):
    file = verified_file(
        cache,
        "cb_2017_us_state_500k.zip",
        STATES,
        "f2b5b94d209284280a1564036f1efb4ab09c5db350920637354b6490a980dc72",
    )
    states = gpd.read_file(file).to_crs(4326)
    # A small tolerance admits coastal/generalized-border geocodes. Positive
    # longitude is valid for Alaskan islands west of the antimeridian.
    shapes = {
        s.STUSPS: s.geometry.buffer(0.02)
        for s in states.itertuples()
        if int(s.STATEFP) <= 56
    }
    for geom in shapes.values():
        shapely.prepare(geom)
    return shapes


def clean(rows, shapes):
    """Input rows are (sector, identifier, state, name, longitude, latitude)."""
    stats, states, categories = Counter(), Counter(), Counter()
    seen_ids, places = set(), set()
    locations = {}
    for sector, identifier, state, name, lon, lat in rows:
        state = str(state or "").strip().upper()
        if state not in shapes:
            stats["outside50StatesAndDC"] += 1
            continue
        if not identifier or not name or not str(name).strip():
            stats["missingIdentity"] += 1
            continue
        try:
            lon, lat = float(lon), float(lat)
        except (ValueError, TypeError):
            lon = lat = 0
        if (
            not math.isfinite(lon)
            or not math.isfinite(lat)
            or not lon
            or not lat
            or not shapely.intersects_xy(shapes[state], lon, lat)
        ):
            stats["missingOrOutsideReportedState"] += 1
            continue
        official_id = sector, str(identifier)
        if official_id in seen_ids:
            stats["repeatedSourceId"] += 1
            continue
        seen_ids.add(official_id)
        name = " ".join(str(name).split())
        lon, lat = round(lon, 5), round(lat, 5)
        identity = (normalize(name), lon, lat)
        if identity in places:
            stats["repeatedNamedLocation"] += 1
            continue
        places.add(identity)
        xy = (lon, lat)
        if xy not in locations:
            locations[xy] = []
            states[state] += 1
        locations[xy].append(name)
        categories[sector] += 1
    if set(states) != set(shapes):
        raise ValueError(
            f"Missing geographic coverage: {sorted(shapes.keys() - states.keys())}"
        )
    return {
        "fields": ["name", "lon", "lat"],
        "count": len(locations),
        "namedFacilities": sum(categories.values()),
        "coordinates": "Source geocodes in decimal degrees, rounded to five decimals. Named facilities at the same mapped position share one point. Points outside their reported state's 2017 Census outline plus a 0.02° edge tolerance are excluded.",
        "countsBySourceType": dict(sorted(categories.items())),
        "countsByState": dict(sorted(states.items())),
        "excluded": dict(stats),
        "points": [
            (" / ".join(sorted(names)), lon, lat)
            for (lon, lat), names in sorted(locations.items())
        ],
    }


def school_rows(public, private):
    high_grades = {"KG", "UG", *(f"{grade:02}" for grade in range(1, 14))}
    for r in public:
        if (
            r["STATUS"] not in ("1", "3", "4", "5", "8")
            or r["VIRTUAL"] == "Full Virtual"
        ):
            continue
        if r["GSHI"] not in high_grades or r["GSLO"] in ("13", "AE", "M", "N"):
            continue
        yield (
            "Public",
            r["NCESSCH"],
            r["LSTATE"],
            r["SCH_NAME"],
            r["LONCOD"],
            r["LATCOD"],
        )
    for r in private:
        yield "Private", r["PPIN"], r["STATE"], r["NAME"], r["LON"], r["LAT"]


def grocery_rows(rows, large):
    for r in rows:
        category = r["Store_Type"]
        if category == "Grocery Store":
            identity = store_identity(
                r["Record_ID"],
                r["State"],
                r["Store_Name"],
                r["Store_Street_Address"],
                r["Zip_Code"],
            )
            if identity not in large:
                continue
            category = "Large Grocery Store (2025 classification)"
        if category in (
            "Supermarket",
            "Super Store",
            "Large Grocery Store (2025 classification)",
        ):
            yield (
                category,
                r["Record_ID"],
                r["State"],
                r["Store_Name"],
                r["Longitude"],
                r["Latitude"],
            )


def write(name, metadata, records):
    file = OUTPUT / (name + ".json")
    tmp = file.with_suffix(".tmp")
    tmp.write_text(
        json.dumps(
            {**metadata, **records},
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        )
        + "\n"
    )
    tmp.replace(file)
    print(
        name,
        records["count"],
        records["countsBySourceType"],
        records["excluded"],
        flush=True,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    args = parser.parse_args()
    args.cache.mkdir(exist_ok=True, parents=True)
    OUTPUT.mkdir(exist_ok=True, parents=True)
    shapes = geographies(args.cache)
    revision = fetch_json(SNAP)["editingInfo"]["dataLastEditDate"]
    with ThreadPoolExecutor(max_workers=3) as pool:
        public = pool.submit(snapshot, args.cache, "public", PUBLIC)
        private = pool.submit(snapshot, args.cache, "private", PRIVATE)
        snap = pool.submit(
            snapshot,
            args.cache,
            "snap",
            SNAP,
            "Store_Type IN ('Super Store','Supermarket','Grocery Store')",
            revision,
        )
        large = historic_large_stores(args.cache)
        schools = clean(school_rows(public.result(), private.result()), shapes)
        write(
            "schools",
            {
                "title": "K–12 schools",
                "source": "NCES EDGE, Common Core of Data and Private School Universe Survey",
                "url": "https://nces.ed.gov/programs/edge/Geographic/SchoolLocations",
                "period": "Public 2024–25 · Private 2023–24",
                "definition": "Geocoded public and private schools offering K–12 or comparable ungraded instruction. Public campuses must have an operating status and eligible grade span. Known fully virtual, preschool-only and adult-only public schools are excluded. Private coverage reflects the NCES private school survey. Geocodes are reported site locations; enrollment boundaries and availability are not provided.",
                "license": "Public domain (NCES)",
                "sources": [
                    PUBLIC,
                    PRIVATE,
                    "https://nces.ed.gov/surveys/pss/index.asp",
                ],
            },
            schools,
        )
        groceries = clean(grocery_rows(snap.result(), large), shapes)
    date = datetime.fromtimestamp(revision / 1000, UTC).date().isoformat()
    write(
        "grocery",
        {
            "title": "Larger grocery stores",
            "source": "USDA SNAP Retailer Locator",
            "url": "https://www.fns.usda.gov/snap/retailer-locator",
            "period": date,
            "definition": "Currently SNAP-authorized Supermarkets and Super Stores, plus currently authorized Grocery Stores matched to an active Large Grocery Store in USDA’s December 31, 2025 archive by retailer ID, state, name, street address and ZIP code. Excludes convenience stores and unidentified-size grocers. Some full-service grocers do not participate in SNAP.",
            "license": "USDA public data; the publisher lists no additional use restrictions.",
            "sources": [SNAP, HISTORICAL],
        },
        groceries,
    )


if __name__ == "__main__":
    main()
