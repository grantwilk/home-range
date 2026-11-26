# /// script
# requires-python = ">=3.11"
# dependencies = ["shapely==2.2.0"]
# ///
"""Build the parks, forests, and preserves layer from USGS PAD-US 4.1 fee holdings."""

import argparse
import gzip
import hashlib
import json
import subprocess
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from tempfile import gettempdir
from urllib.parse import urlencode

from nature_data import SCALE, TOLERANCE, parts_of, write_layer
from shapely import make_valid, set_precision, union_all
from shapely.geometry import shape

SERVICE = (
    "https://edits.nationalmap.gov/arcgis/rest/services/PAD-US/PAD_US_4_1/MapServer/0"
)
COOK = (
    "https://services2.arcgis.com/I5Or36sMcO7Y9vQ3/arcgis/rest/services/"
    "Forest_Preserve_Boundary/FeatureServer/0"
)
ILLINOIS = (
    "https://services5.arcgis.com/vxriHwYuGDCBCbeh/arcgis/rest/services/"
    "Illinois_Protected_Natural_Lands/FeatureServer/1"
)
SOURCE = (
    "USGS PAD-US 4.1; Busse Woods: Forest Preserve District of Cook County, "
    "BOT/GIS, and Illinois Protected Natural Lands (David Holman)"
)
URL = "https://doi.org/10.5066/P96WBCHS"
PERIOD = "March 2025"
DEFINITION = (
    "Open-access fee holdings owned by federal, state, local, or regional governments. "
    "Includes National Parks, National Forests, State Parks, and officially named or "
    "classified state forests, forest preserves/reserves, nature preserves/reserves, "
    "natural area preserves and national preserves. Boundaries can contain water. "
    "Public access is the source classification; individual parcels may have rules "
    "or temporary closures. Coverage varies by agency and state. Excludes ordinary municipal parks, "
    "forest nurseries and headquarters, restricted or unknown access, and proclamation boundaries. "
    "Busse Woods uses the Illinois Protected Natural Lands named fee parcel intersected "
    "with the Forest Preserve District of Cook County’s holdings. The district lists it "
    "as open for visitors. Distance reaches the mapped area, not necessarily a public entrance."
)
OWNERS = ("FED", "STAT", "LOC", "DIST")
REGIONS = (
    "AK",
    "AL",
    "AR",
    "AZ",
    "CA",
    "CO",
    "CT",
    "DC",
    "DE",
    "FL",
    "GA",
    "HI",
    "IA",
    "ID",
    "IL",
    "IN",
    "KS",
    "KY",
    "LA",
    "MA",
    "MD",
    "ME",
    "MI",
    "MN",
    "MO",
    "MS",
    "MT",
    "NC",
    "ND",
    "NE",
    "NH",
    "NJ",
    "NM",
    "NV",
    "NY",
    "OH",
    "OK",
    "OR",
    "PA",
    "RI",
    "SC",
    "SD",
    "TN",
    "TX",
    "UT",
    "VA",
    "VT",
    "WA",
    "WI",
    "WV",
    "WY",
)
SPECIALTIES = (
    "STATE FOREST",
    "FOREST PRESERVE",
    "FOREST RESERVE",
    "NATURE PRESERVE",
    "NATURE RESERVE",
    "NATURAL AREA PRESERVE",
    "NATIONAL PRESERVE",
)


def sql_in(values):
    return "(" + ",".join(f"'{value}'" for value in values) + ")"


def selection():
    classes = [
        "Des_Tp IN ('NP','NF','SP')",
        "UPPER(Loc_Ds) IN "
        + sql_in((*SPECIALTIES, "STATE PARK", "NATIONAL PARK", "NATIONAL FOREST")),
    ]
    for term in SPECIALTIES:
        classes.append(f"UPPER(Unit_Nm) LIKE '%{term}%'")
        classes.append(f"UPPER(Loc_Nm) LIKE '%{term}%'")
    return (
        "Pub_Access='OA' AND Own_Type IN "
        + sql_in(OWNERS)
        + " AND State_Nm IN "
        + sql_in(REGIONS)
        + " AND ("
        + " OR ".join(classes)
        + ")"
    )


def fetch(service=SERVICE, **params):
    url = service + "/query?" + urlencode({"f": "json", **params})
    result = subprocess.run(
        [
            "curl",
            "--fail",
            "--silent",
            "--show-error",
            "--compressed",
            "--retry",
            "3",
            "--max-time",
            "240",
            url,
        ],
        capture_output=True,
        check=True,
    )
    content = json.loads(result.stdout)
    if "error" in content:
        raise RuntimeError(content["error"])
    return content


def fetch_batch(ids, cache):
    # The cache key includes all parameters that affect the source geometries.
    params = {
        "f": "geojson",
        "objectIds": ",".join(map(str, ids)),
        "outSR": 4326,
        "maxAllowableOffset": 0.00015,
        "geometryPrecision": 6,
        "returnGeometry": "true",
        "outFields": "OBJECTID,Unit_Nm,Loc_Nm,Loc_Ds,Own_Type,Des_Tp,State_Nm,Pub_Access",
    }
    digest = hashlib.sha256(urlencode(params).encode()).hexdigest()[:20]
    path = cache / f"4.1-{digest}.geojson.gz"
    if not path.exists():
        content = fetch(**params)
        if content.get("exceededTransferLimit") or {
            item["properties"]["OBJECTID"] for item in content["features"]
        } != set(ids):
            raise ValueError(
                "USGS returned incomplete results for " + params["objectIds"]
            )
        temp = path.with_suffix(".tmp")
        with gzip.open(temp, "wt", compresslevel=2) as stream:
            json.dump(content, stream, separators=(",", ":"))
        temp.replace(path)
    return path


def source_records(cache):
    cache.mkdir(parents=True, exist_ok=True)
    result = fetch(where=selection(), returnIdsOnly="true")
    ids = sorted(result["objectIds"])
    if not ids or len(ids) != len(set(ids)):
        raise ValueError("Expected a nonempty collection of unique PAD-US records")
    batches = [ids[i : i + 55] for i in range(0, len(ids), 55)]
    with ThreadPoolExecutor(max_workers=6) as pool:
        for path in pool.map(lambda batch: fetch_batch(batch, cache), batches):
            with gzip.open(path) as stream:
                yield from json.load(stream)["features"]


def busse_woods(cache, snapshot):
    # Cook County publishes all district holdings as one multipart record.
    # The state's named conservation inventory identifies just Ned Brown, whose
    # public name and access the district confirms at fpdcc.com/places/locations/busse-woods/.
    # Intersect the two published polygons instead of labeling nearby district holdings.
    options = {
        "f": "geojson",
        "outSR": 4326,
        "geometryPrecision": 6,
        "returnGeometry": "true",
    }
    queries = [
        (
            ILLINOIS,
            "Site_Name='Ned Brown Preserve' AND Org='Forest Preserve District of Cook County' AND Owner_Type='Fee Simple' AND County='Cook'",
            "Site_Name,Org,Owner_Type",
        ),
        (COOK, "1=1", "OBJECTID"),
    ]
    outlines = []
    for role, (service, where, fields) in zip(
        ("named", "holding"), queries, strict=True
    ):
        path = cache / f"busse-{role}-{snapshot}.geojson.gz"
        if path.exists():
            with gzip.open(path) as stream:
                raw = json.load(stream)
        else:
            raw = fetch(service, where=where, outFields=fields, **options)
            if raw.get("exceededTransferLimit") or len(raw["features"]) != 1:
                raise ValueError(
                    f"Recheck the Cook County {role} boundary before rebuilding"
                )
            with gzip.open(path, "wt") as stream:
                json.dump(raw, stream, separators=(",", ":"))
        outline = shape(raw["features"][0]["geometry"])
        if not outline.is_valid:
            outline = make_valid(outline, method="structure", keep_collapsed=False)
        outlines.append(outline)
    mapped, holding = outlines
    intersection = mapped.intersection(holding)
    if intersection.area < 0.90 * mapped.area:
        raise ValueError(
            "The named Busse Woods boundary disagrees with current district holdings"
        )
    yield "Busse Woods (Ned Brown Preserve)", intersection


def prepare_polygons(pieces):
    polygons = []
    for piece in pieces:
        for part in parts_of(piece, "area"):
            if not part.is_valid:
                part = make_valid(part, method="structure", keep_collapsed=False)
            for valid in parts_of(part, "area"):
                simplified = valid.simplify(TOLERANCE, preserve_topology=True)
                snapped = set_precision(simplified, 1 / SCALE, mode="pointwise")
                if not snapped.is_valid:
                    snapped = make_valid(
                        snapped, method="structure", keep_collapsed=False
                    )
                polygons.extend(parts_of(snapped, "area"))
    if len(pieces) > 1:
        # Remove internal seams without bridging disconnected parcels.
        polygons = parts_of(union_all(polygons, grid_size=1 / SCALE), "area")
    for polygon in polygons:
        # GEOS can move an exterior beyond a tiny adjacent hole even with
        # topology-preserving simplification. Validate the writer's final step.
        candidate = polygon.simplify(TOLERANCE, preserve_topology=True)
        if candidate.is_valid:
            yield polygon
        else:
            yield from parts_of(
                make_valid(candidate, method="structure", keep_collapsed=False), "area"
            )


def observations(cache, snapshot):
    regions = Counter()
    parcels = defaultdict(list)
    for item in source_records(cache):
        props = item["properties"]
        if (
            props["Own_Type"] not in OWNERS
            or props["Pub_Access"] != "OA"
            or props["State_Nm"] not in REGIONS
        ):
            raise ValueError(f"Unexpected record in parks inventory: {props}")
        name = (props["Unit_Nm"] or props["Loc_Nm"] or "").strip()
        if any(word in name.casefold() for word in ("nursery", "headquarters")):
            continue
        if name.casefold() in {"", "unknown", "unnamed"}:
            category = {
                "SP": "State Park",
                "NF": "National Forest",
                "NP": "National Park",
            }
            name = f"Unnamed {category.get(props['Des_Tp'], 'Preserve')} ({props['State_Nm']})"
        if not item["geometry"]:
            raise ValueError(f"Missing boundary on PAD-US record {props['OBJECTID']}")
        geom = shape(item["geometry"])
        if geom.is_empty or geom.geom_type not in {"Polygon", "MultiPolygon"}:
            raise ValueError(f"Invalid polygon on PAD-US record {props['OBJECTID']}")
        regions[props["State_Nm"]] += 1
        parcels[(props["State_Nm"], name)].append(geom)
    for name, poly in busse_woods(cache, snapshot):
        parcels[("IL", name)].append(poly)
    for (_, name), pieces in sorted(parcels.items()):
        for polygon in prepare_polygons(pieces):
            yield name, polygon
    print(f"{sum(regions.values()):,} PAD-US records across {len(regions)} states/DC")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cache", type=Path, default=Path(gettempdir()) / "home-range-parks" / "source"
    )
    parser.add_argument(
        "--snapshot",
        type=date.fromisoformat,
        default=date.today(),
        help="Date of the locally cached Cook County supplement (default today)",
    )
    args = parser.parse_args()
    if args.snapshot != date.today() and not all(
        (args.cache / f"busse-{role}-{args.snapshot}.geojson.gz").exists()
        for role in ("named", "holding")
    ):
        parser.error(
            "Historic Cook County snapshots require previously downloaded source files"
        )

    write_layer(
        "parks",
        observations(args.cache, args.snapshot),
        geometry="area",
        source=SOURCE,
        url=URL,
        period=f"{PERIOD}; Busse Woods snapshot {args.snapshot}",
        definition=DEFINITION,
    )
