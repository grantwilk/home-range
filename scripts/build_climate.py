# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb==2.0.1"]
# ///
"""Build the county climate layer from EpiNOAA's scaled county daily records.

Run: uv run scripts/build_climate.py --cache /tmp/home-range-epinoaa
"""

import argparse
import calendar
import json
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import duckdb
import monthly_counties

START, END = 1991, 2020
YEARS = END - START + 1
THRESHOLDS = range(60, 111)
S3 = "https://noaa-nclimgrid-daily-pds.s3.amazonaws.com"
BASE = S3 + "/EpiNOAA/v1-0-0/parquet/cty"
README = S3 + "/doc/nclimgrid-daily_v1-0-0_readme-web.txt"
DEST = Path(__file__).resolve().parents[1] / "data" / "climate.json"


def download_month(cache, year, month):
    filename = f"{year}{month:02}.parquet"
    dest = cache / filename
    if dest.exists():
        return dest
    temp = dest.with_suffix(".part")
    url = f"{BASE}/YEAR={year}/STATUS=scaled/{filename}"
    subprocess.run(
        ["curl", "-fsSL", "--retry", "4", "--max-time", "120", url, "-o", str(temp)],
        check=True,
    )
    os.replace(temp, dest)
    return dest


def summarize_month(db, path, year, month):
    # Keep temperatures in exact hundredths of °C for threshold comparisons.
    # Each source file pads short months to 31 rows with null dates.
    # Calendar checks below reject duplicate dates and incomplete county-months.
    heat_columns = ", ".join(
        f"count(*) FILTER (WHERE tmax * 9 + 160 >= {threshold * 5}) AS heat{threshold}"
        for threshold in THRESHOLDS
    )
    query = f"""
        WITH daily AS (
            SELECT CASE WHEN fips = '24511' AND postal_code = 'MD'
                                      AND region_name = 'DC: District of Columbia'
                               THEN '11001' ELSE fips END AS fips,
                   date::DATE AS day,
                   try_cast(tmax AS DECIMAL(8,2)) AS tmax,
                   try_cast(tmin AS DECIMAL(8,2)) AS tmin,
                   try_cast(tavg AS DECIMAL(8,2)) AS tavg,
                   try_cast(prcp AS DECIMAL(8,2)) AS precip
            FROM read_parquet(?)
            WHERE region_type = 'cty' AND date IS NOT NULL
        )
        SELECT fips, avg(tmin), avg(tmax), avg(tavg),
               count(*) FILTER (WHERE precip >= 0.254) AS wet,
               count(*) FILTER (WHERE precip < 0.254) AS dry,
               {heat_columns}
        FROM daily
        GROUP BY fips
        HAVING regexp_full_match(fips, '[0-9]{{5}}')
           AND count(*) = ? AND count(DISTINCT day) = ?
           AND min(day) = make_date(?, ?, 1)
           AND max(day) = make_date(?, ?, ?)
           AND count(*) FILTER (
               WHERE tmin BETWEEN -90 AND 65 AND tmax BETWEEN tmin AND 65
                 AND tavg BETWEEN -90 AND 65 AND precip BETWEEN 0 AND 2000
           ) = count(*)
        ORDER BY fips
    """
    days = calendar.monthrange(year, month)[1]
    return db.execute(
        query, [str(path), days, days, year, month, year, month, days]
    ).fetchall()


def summarize_county(months):
    """months[calendar month] contains one aggregate tuple per complete year."""
    if len(months) != 12 or any(len(rows) != YEARS for rows in months.values()):
        return None
    records = [months[month] for month in range(1, 13)]

    def monthly_f(index):
        return [
            sum(row[index] for row in years) / YEARS * 1.8 + 32 for years in records
        ]

    lows, highs, means = [monthly_f(i) for i in range(3)]
    result = monthly_counties.temperature_profile(lows, highs, means)
    totals = [
        sum(column) for column in zip(*(row[3:] for years in records for row in years))
    ]
    result["wetDays"], result["dryDays"], *result["heatDays"] = [
        round(count / YEARS, 1) for count in totals
    ]
    return result


def build(cache, output):
    cache.mkdir(parents=True, exist_ok=True)
    dates = [(y, m) for y in range(START, END + 1) for m in range(1, 13)]
    with ThreadPoolExecutor(max_workers=10) as pool:
        files = list(pool.map(lambda date: download_month(cache, *date), dates))
    db = duckdb.connect(config={"threads": 2})
    by_county = {}
    for path, (year, month) in zip(files, dates, strict=True):
        for fips, *values in summarize_month(db, path, year, month):
            by_county.setdefault(fips, {}).setdefault(month, []).append(values)
    db.close()
    counties = {}
    for fips, months in sorted(by_county.items()):
        result = summarize_county(months)
        if result is not None:
            counties[fips] = result
    if not counties:
        raise ValueError("No county has a complete climate record.")
    counties.update(monthly_counties.load_monthly())
    payload = {
        "period": [START, END],
        "source": "NOAA nClimGrid-Daily county area averages, EpiNOAA v1.0.0 scaled",
        "documentation": "https://arc.ncics.org/nclimgrid-overview/",
        "readme": README,
        "sourceTemplate": BASE + "/YEAR={year}/STATUS=scaled/{year}{month:02}.parquet",
        "sourceUnits": {"tmin": "°C", "tmax": "°C", "tavg": "°C", "prcp": "mm"},
        "methods": {
            "temperatures": "Mean of 30 annual calendar-month means, converted to °F. Coldest and hottest months use monthly mean temperature; ties use the earliest month.",
            "days": "Mean annual number of calendar days where county-area daily high ≥ named °F threshold or daily precipitation ≥ 0.254 mm (wet) or < 0.254 mm (dry). Leap days included.",
            "coverage": "Contiguous United States. Requires exactly one valid county record per calendar day in all 360 months. County boundaries follow the source FIPS vintage.",
            "precision": "Published figures are rounded to the nearest tenth.",
        },
        "monthlySource": {
            "coverage": "Alaska and Hawaii, temperature only. Direct county FIPS joins. All 360 monthly averages required for each temperature element.",
            "name": "NOAA nClimDiv county monthly, " + monthly_counties.RELEASE,
            "readme": monthly_counties.SOURCE + "/county-readme.txt",
            "files": [
                f"{monthly_counties.SOURCE}/climdiv-{element}-{monthly_counties.RELEASE}"
                for element in monthly_counties.ELEMENTS.values()
            ],
            "sourceUnits": "°F",
        },
        "counties": counties,
    }
    temp = output.with_suffix(".tmp")
    temp.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n")
    os.replace(temp, output)
    print(f"Wrote {len(counties):,} complete counties to {output}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=DEST)
    args = parser.parse_args()
    build(args.cache, args.output)
