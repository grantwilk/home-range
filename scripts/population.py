# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Build county resident population estimates. Run: uv run scripts/population.py"""

import csv
import hashlib
import io
import json
import urllib.request
from collections import Counter
from pathlib import Path
from zipfile import ZipFile

DATA = Path(__file__).resolve().parents[1] / "data"
BASE = "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/"
COUNTY = BASE + "counties/totals/co-est2025-alldata.csv"
TOWNS = BASE + "cities/totals/sub-est2025_9.csv"
CROSSWALK = "https://www2.census.gov/geo/docs/reference/ct_change/ct_cou_to_cousub_crosswalk.txt"
GAZETTEER = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2017_Gazetteer/2017_Gaz_counties_national.zip"
HASHES = {
    GAZETTEER: "919aa22b692596d140ca435002f4010a65a4311e77909cd3ed0f3e01e48ba580",
    COUNTY: "4f5a499d851e2cb48fd7a5405e5a9235453a8a66933657aacd10df0e264f35d5",
    TOWNS: "207ca066573e67abd2b1d654fc39ee3ba915387ef7e6d3902389cbdc389ce757",
    CROSSWALK: "13ad002564e30e6dcd1df112fdaa985f2cd0cdb908f7f3017cd2723db294cff8",
}


def verified_bytes(url):
    with urllib.request.urlopen(url, timeout=60) as source:
        raw = source.read()
    if hashlib.sha256(raw).hexdigest() != HASHES[url]:
        raise ValueError(f"Census source changed. Review before rebuilding: {url}")
    return raw


def read_source(url, encoding="latin1", delimiter=","):
    return csv.DictReader(
        io.StringIO(verified_bytes(url).decode(encoding)), delimiter=delimiter
    )


def land_areas(ids):
    with ZipFile(io.BytesIO(verified_bytes(GAZETTEER))) as archive:
        rows = archive.read("2017_Gaz_counties_national.txt").decode("latin1")
    areas = {}
    for row in csv.DictReader(io.StringIO(rows), delimiter="\t"):
        code = row["GEOID"]
        if code in ids:
            area = int(row["ALAND"])
            if area <= 0 or code in areas:
                raise ValueError(f"Invalid or duplicate county land area: {code}")
            areas[code] = area
    if areas.keys() != ids:
        raise ValueError("Missing land area for a mapped county")
    return dict(sorted(areas.items()))


def estimates(rows, level, code_fields):
    result = {}
    for row in rows:
        if row["SUMLEV"] == level:
            code = "".join(row[field] for field in code_fields)
            count = row["POPESTIMATE2025"]
            if code in result or not count.isdecimal():
                raise ValueError(f"Duplicate identifier or invalid population: {code}")
            result[code] = int(count)
    return result


def connecticut(towns, crosswalk, regions):
    # The crosswalk also contains unpopulated undefined areas and footer notes.
    old_county = {}
    for row in crosswalk:
        if row["COUSUB_LSAD"] == "43":  # Legal town
            town = row["NEW_COUSUB_GEOID"]
            if town in old_county:
                raise ValueError(f"Duplicate Connecticut town {town}")
            old_county[town] = row["OLD_COUSUB_GEOID"][:5]
    if len(towns) != 169 or towns.keys() != old_county.keys():
        raise ValueError(
            "Connecticut town estimates and crosswalk must match one-to-one."
        )
    by_county, by_region = Counter(), Counter()
    for town, count in towns.items():
        by_county[old_county[town]] += count
        by_region[town[:5]] += count
    if by_region != regions or len(by_county) != 8:
        raise ValueError(
            "Connecticut towns failed to reconcile to the nine planning regions."
        )
    return by_county


def main():
    current = list(read_source(COUNTY))
    population = estimates(current, "050", ("STATE", "COUNTY"))
    states = estimates(current, "040", ("STATE",))
    ct_regions = {code: n for code, n in population.items() if code.startswith("09")}
    towns = estimates(read_source(TOWNS), "061", ("STATE", "COUNTY", "COUSUB"))
    ct_counties = connecticut(
        towns, read_source(CROSSWALK, "utf-8-sig", "|"), ct_regions
    )
    for key in ct_regions:
        del population[key]
    population.update(ct_counties)
    population["02261"] = population.pop("02063") + population.pop("02066")

    boundaries = json.loads((DATA / "geography.json").read_text())["counties"]
    if set(population) != {c["id"] for c in boundaries}:
        raise ValueError(
            "County IDs differ from the atlas; review the boundary mapping."
        )
    state_totals = Counter()
    for fips, count in population.items():
        state_totals[fips[:2]] += count
    if state_totals != states:
        raise ValueError(
            "Mapped populations must sum to each published state estimate."
        )
    payload = {
        "title": "County Population",
        "period": "July 1, 2025",
        "unit": "residents",
        "credit": "U.S. Census Bureau, Population Estimates Program, Vintage 2025",
        "source": "https://www.census.gov/data/datasets/time-series/demo/popest/2020s-counties-total.html",
        "sourceFile": COUNTY,
        "landAreaSource": GAZETTEER,
        "landAreaM2": land_areas(population.keys()),
        "variable": "POPESTIMATE2025",
        "townEstimates": TOWNS,
        "townCrosswalk": CROSSWALK,
        "alaskaSplit": "https://www.census.gov/programs-surveys/geography/technical-documentation/county-changes.2010.html",
        "coverage": len(population),
        "aggregations": {
            **dict.fromkeys(
                sorted(ct_counties), "Sum of town estimates for this former county."
            ),
            "02261": "Sum of the Chugach and Copper River census area estimates.",
        },
        "method": (
            "Resident population of each named county or equivalent on July 1, 2025. "
            "The map uses 2017 outlines, so later minor boundary adjustments may differ. "
            "The eight former Connecticut counties sum the 169 town estimates using the Census crosswalk. "
            "Alaska’s former Valdez-Cordova sums its two successor areas, Chugach and Copper River. "
            "Every state total reconciles to the published Vintage 2025 estimate."
        ),
        "counties": dict(sorted(population.items())),
    }
    output = DATA / "population.json"
    tmp = output.with_suffix(".tmp")
    tmp.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    )
    tmp.replace(output)
    print(
        f"{len(population):,} mapped counties; {sum(population.values()):,} residents."
    )


if __name__ == "__main__":
    main()
