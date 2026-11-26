"""Read NOAA's county monthly Fahrenheit records for Alaska and Hawaii.

The bundled snapshot contains the original fixed-width rows for 1991–2020.
To reproduce that extract from the original November 2026 release, put the
three national files in a directory and run this module with --extract DIR.
"""

import argparse
import gzip
from collections import defaultdict
from pathlib import Path

RELEASE = "v1.0.0-20261105"
ELEMENTS = {"28": "tmincy", "27": "tmaxcy", "02": "tmpccy"}
STATE_FIPS = {"49": "15", "50": "02"}
SOURCE = "https://www.ncei.noaa.gov/monitoring-content/data/us/climdiv/monthly/current"
SNAPSHOT = Path(__file__).with_name("sources") / "ak-hi-1991-2020.txt.gz"


def temperature_profile(lows, highs, means):
    cold = min(range(12), key=means.__getitem__)
    hot = max(range(12), key=means.__getitem__)
    return {
        "janLow": round(lows[0], 1),
        "julHigh": round(highs[6], 1),
        "coldMonth": cold + 1,
        "coldLow": round(lows[cold], 1),
        "hotMonth": hot + 1,
        "hotHigh": round(highs[hot], 1),
        "monthlyLow": [round(value, 1) for value in lows],
        "monthlyHigh": [round(value, 1) for value in highs],
    }


def extract(directory, snapshot=SNAPSHOT):
    lines = []
    for code, element in ELEMENTS.items():
        with (directory / f"climdiv-{element}-{RELEASE}").open("rb") as file:
            for line in file:
                if line[:2].decode() in STATE_FIPS and 1991 <= int(line[7:11]) <= 2020:
                    if line[5:7].decode() != code:
                        raise ValueError(f"Unexpected element in {element}")
                    lines.append(line[:95] + b"\n")
    snapshot.parent.mkdir(parents=True, exist_ok=True)
    snapshot.write_bytes(gzip.compress(b"".join(lines), mtime=0))


def load_monthly(snapshot=SNAPSHOT):
    records = defaultdict(lambda: defaultdict(dict))
    with gzip.open(snapshot, "rt", encoding="ascii") as source:
        for line in source:
            state, county, element = line[:2], line[2:5], line[5:7]
            years = records[STATE_FIPS[state] + county][element]
            year = int(line[7:11])
            if year in years:
                raise ValueError(f"Repeated monthly data for {state}{county}, {year}")
            values = [float(line[pos : pos + 7]) for pos in range(11, 95, 7)]
            if all(-90 <= v <= 140 for v in values):
                years[year] = values
    profiles = {}
    expected_years = set(range(1991, 2021))
    for fips, elements in records.items():
        if any(set(elements[code]) != expected_years for code in ELEMENTS):
            continue
        profiles[fips] = temperature_profile(
            *[
                [sum(column) / len(column) for column in zip(*elements[key].values())]
                for key in ("28", "27", "02")
            ]
        )
    return profiles


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extract", required=True, type=Path)
    extract(parser.parse_args().extract)
