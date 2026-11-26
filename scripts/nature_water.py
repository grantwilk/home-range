# /// script
# requires-python = ">=3.11"
# dependencies = ["geopandas==1.2.0", "requests==2.32.5"]
# ///
"""Build named river centerlines and lake polygons from USGS hydrography."""

import argparse
import gzip
import hashlib
import json
import shutil
import tarfile
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import geopandas as gpd
import requests
import shapely
from nature_data import SCALE, TOLERANCE, parts_of, write_layer
from requests.adapters import HTTPAdapter
from shapely.geometry import MultiLineString, shape
from urllib3.util.retry import Retry

STREAMS = "https://prd-tnm.s3.amazonaws.com/StagedProducts/Small-scale/data/Hydrography/streaml010g.shp_nt00885.tar.gz"
STREAM_SHA = "437e423140c3880e8d40f1c15822e7f80022df848b782da2f78e5b96797dec31"
LAKE_SNAPSHOT_SHA = "7000a5432cc5af69a76b0dad2ece2d396a4af52072172970f9699bad9126d78e"
WATER = "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12"
# 400 international acres expressed in the source's square kilometers.
# Exclude intermittent, evaporating, sewage, tailings, and other industrial ponds.
LAKE_WHERE = (
    "AREASQKM >= 1.61874256896 AND FCODE IN "
    "(39000,39004,39009,39010,39011,39012,43600,43613,43615,43617,43618,43619,43621)"
)
RIVER_DEF = (
    "Straight-line distance to the mapped centerline of a named stream of Strahler "
    "order 3 or higher in the USGS 1:1,000,000-scale network. Stream order measures "
    "branching, not width or navigability. Includes mapped river paths through "
    "waterbodies. Excludes intermittent reaches, unnamed reaches, canals and "
    "aqueducts. The Hawaiian network has one qualifying reach, on the Waimea River. Public access varies."
)
LAKE_DEF = (
    "Straight-line distance to a mapped lake, pond or qualifying reservoir polygon "
    "with at least 400 acres of surface area in USGS high-resolution hydrography. "
    "Includes unnamed waterbodies, the Great Lakes, general reservoirs and water-storage "
    "reservoirs. Excludes features explicitly classified as intermittent or industrial "
    "ponds. Distances are zero inside the mapped water. Area is assessed for each "
    "source polygon. No Hawaii feature meets these size and type criteria: Halaliʻi Lake is seasonal. Public access and current levels vary."
)


def session():
    client = requests.Session()
    client.mount(
        "https://",
        HTTPAdapter(
            max_retries=Retry(
                total=4, backoff_factor=1, status_forcelist=(429, 500, 502, 503, 504)
            )
        ),
    )
    return client


def river_features(cache):
    archive = cache / STREAMS.rsplit("/", 1)[1]
    if not archive.exists():
        with (
            session() as client,
            client.get(STREAMS, stream=True, timeout=120) as response,
        ):
            response.raise_for_status()
            with archive.with_suffix(".part").open("wb") as out:
                for chunk in response.iter_content(1024 * 1024):
                    out.write(chunk)
            archive.with_suffix(".part").replace(archive)
    with archive.open("rb") as f:
        if hashlib.file_digest(f, "sha256").hexdigest() != STREAM_SHA:
            raise ValueError(f"Incorrect USGS archive checksum: {archive}")
    with tempfile.TemporaryDirectory() as tmp, tarfile.open(archive) as tf:
        for suffix in ("shp", "shx", "prj", "dbf"):
            name = f"streaml010g.{suffix}"
            with tf.extractfile(name) as src, (Path(tmp) / name).open("wb") as dest:
                shutil.copyfileobj(src, dest)
        df = gpd.read_file(
            Path(tmp) / "streaml010g.shp",
            columns=["Name", "Region", "Strahler", "Feature"],
            where="Region BETWEEN 1 AND 20 AND Strahler >= 3 AND Name IS NOT NULL AND Feature IN ('Stream','Artificial Path')",
            force_2d=True,
        ).to_crs(4326)
    if not {19, 20}.issubset(df.Region):
        raise ValueError("Alaska/Hawaii river region missing")
    for name, group in df.groupby("Name", sort=True):
        # Merge touching same-name reaches for a smaller download. Disjoint
        # waterways sharing a name stay separate; no new lines are drawn.
        lines = shapely.get_parts(group.geometry.array)
        yield name, shapely.line_merge(MultiLineString(lines.tolist()))


def arcgis(params):
    with session() as client:
        res = client.get(WATER + "/query", params=params, timeout=180)
        res.raise_for_status()
        data = res.json()
    if "error" in data:
        raise ValueError(data["error"])
    return data


def lake_features(cache):
    # Anchor each page to the selected object IDs; verify all IDs before use.
    lakecache = cache / "lakes-400-v1"
    lakecache.mkdir(exist_ok=True)
    index = lakecache / "ids.json"
    if not index.exists():
        data = arcgis({"f": "json", "where": LAKE_WHERE, "returnIdsOnly": "true"})
        ids = sorted(data["objectIds"])
        if len(set(ids)) != len(ids) or len(ids) < 3000:
            raise ValueError("Incomplete national waterbody ID response")
        index.write_text(json.dumps(ids))
    ids = json.loads(index.read_text())

    def fetch(batch):
        label = hashlib.sha256(json.dumps(batch).encode()).hexdigest()[:16]
        file = lakecache / (label + ".json.gz")
        if not file.exists():
            data = arcgis(
                {
                    "f": "geojson",
                    "objectIds": ",".join(map(str, batch)),
                    "outFields": "OBJECTID,GNIS_NAME,REACHCODE,FTYPE,AREASQKM",
                    "returnGeometry": "true",
                    "outSR": 4326,
                    "maxAllowableOffset": 0.0002,
                    "geometryPrecision": 6,
                }
            )
            expected = sorted(f["properties"]["OBJECTID"] for f in data["features"])
            if expected != batch:
                raise ValueError(
                    f"USGS returned {len(expected)} of {len(batch)} lake polygons"
                )
            temp = file.with_suffix(".tmp")
            temp.write_bytes(
                gzip.compress(
                    json.dumps(data["features"], separators=(",", ":")).encode(),
                    mtime=0,
                )
            )
            temp.replace(file)
        return file

    digest = hashlib.sha256()
    with ThreadPoolExecutor(5) as pool:
        for file in pool.map(
            fetch, [ids[i : i + 140] for i in range(0, len(ids), 140)]
        ):
            for feature in sorted(
                json.loads(gzip.decompress(file.read_bytes())),
                key=lambda f: f["properties"]["OBJECTID"],
            ):
                digest.update(
                    json.dumps(feature, separators=(",", ":"), sort_keys=True).encode()
                )
                p = feature["properties"]
                geom = shape(feature["geometry"])
                # NHD covers territories too. Omit those HUCs and use location
                # for the handful of records without a watershed identifier.
                if p["REACHCODE"] and not 1 <= int(p["REACHCODE"][:2]) <= 20:
                    continue
                x, y = geom.representative_point().coords[0]
                if y < 24 and not (-161 <= x <= -154 and 18 <= y <= 23):
                    continue
                if geom.is_empty or not p["AREASQKM"] >= 1.61874256896:
                    raise ValueError(f"Invalid USGS waterbody {p['OBJECTID']}")
                generic = (
                    "Unnamed reservoir" if p["FTYPE"] == 436 else "Unnamed lake or pond"
                )
                # Repair the source rings before rounding. Snap using GEOS topology
                # rules so a narrow island cannot cross its lake shoreline when encoded.
                if not geom.is_valid:
                    geom = shapely.make_valid(
                        geom, method="structure", keep_collapsed=False
                    )
                geom = shapely.set_precision(geom.simplify(TOLERANCE), 1 / SCALE)
                if geom.is_empty:
                    raise ValueError(
                        f"Lake disappeared after simplifying: {p['OBJECTID']}"
                    )
                for part in parts_of(geom, "area"):
                    # A simplified hole may enclose another small island. Verify the
                    # exact operation the encoder applies to a multipart component.
                    simplified = part.simplify(TOLERANCE)
                    if not simplified.is_valid:
                        part = shapely.make_valid(
                            simplified, method="structure", keep_collapsed=False
                        )
                    yield p["GNIS_NAME"] or generic, part
    if digest.hexdigest() != LAKE_SNAPSHOT_SHA:
        raise ValueError(
            "USGS source changed; review the waterbody snapshot before publication"
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cache",
        type=Path,
        default=Path(tempfile.gettempdir()) / "home-range-nature-water",
    )
    parser.add_argument("--layer", choices=["rivers", "lakes", "both"], default="both")
    args = parser.parse_args()
    args.cache.mkdir(exist_ok=True, parents=True)
    if args.layer in ("rivers", "both"):
        write_layer(
            "rivers",
            river_features(args.cache),
            source="U.S. Geological Survey, US National Atlas, One Million-Scale Streams",
            url=STREAMS,
            period="March 2014",
            definition=RIVER_DEF,
            geometry="line",
        )
    if args.layer in ("lakes", "both"):
        write_layer(
            "lakes",
            lake_features(args.cache),
            source="U.S. Geological Survey, National Hydrography Dataset, high-resolution waterbodies",
            url=WATER,
            period="USGS service snapshot, November 2026",
            definition=LAKE_DEF,
            geometry="area",
        )
