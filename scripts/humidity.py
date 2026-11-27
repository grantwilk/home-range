# /// script
# requires-python = ">=3.11"
# dependencies = ["exactextract==0.3.0", "geopandas==1.2.0", "netCDF4==1.7.5.1.post1"]
# ///
"""Build county absolute humidity normals. Run with uv run scripts/humidity.py --cache DIR.

The 90 native TerraClimate files require approximately 16 GB of cache space.
"""

import argparse
import csv
import json
from contextlib import ExitStack
from dataclasses import dataclass
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from county_raster import (
    BOUNDARIES,
    MIN_COVERAGE,
    area_totals,
    county_boundaries,
    verified_download,
)
from exactextract.raster import NumPyRasterSource
from netCDF4 import Dataset, num2date
from pyproj import CRS

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
YEARS = range(1991, 2021)
VARIABLES = {"vap": "kPa", "tmin": "degC", "tmax": "degC"}
SOURCE = (
    "https://thredds.northwestknowledge.net/thredds/fileServer/TERRACLIMATE_ALL/data/"
)
CHECKSUMS = ROOT / "scripts/sources/absolute-humidity-sha256.csv"
FIELDS = {"coldAbsoluteHumidity": "coldMonth", "hotAbsoluteHumidity": "hotMonth"}
RESOLUTION = 1 / 30
GEOGRAPHIC_CRS = CRS.from_epsg(4326).to_wkt()


def absolute_humidity(pressure, low, high):
    """Monthly mean water-vapor density (g/m³) from actual vapor pressure (kPa) and °C."""
    pressure, low, high = [
        np.ma.asarray(a, dtype=np.float64).filled(np.nan) for a in (pressure, low, high)
    ]
    kelvin = 273.15 + (low + high) / 2
    valid = (pressure >= 0) & (kelvin > 0) & (low <= high)
    return np.divide(
        pressure * 1_000_000,
        461.5 * kelvin,
        where=valid,
        out=np.full_like(kelvin, np.nan),
    )


def validate_grid(dataset, year, key, lat, lon):
    variable = dataset[key]
    time = dataset["time"]
    dates = num2date(time[:], time.units, time.calendar)
    if (
        dataset.version != "v1.1"
        or variable.units != VARIABLES[key]
        or variable.dimensions != ("time", "lat", "lon")
        or [(d.year, d.month) for d in dates]
        != [(year, month) for month in range(1, 13)]
        or not np.array_equal(dataset["lat"][:], lat)
        or not np.array_equal(dataset["lon"][:], lon)
    ):
        raise ValueError(
            f"Unexpected TerraClimate version, units, grid, or dates: {year} {key}"
        )


@dataclass
class Region:
    polygons: gpd.GeoDataFrame
    rows: slice
    columns: slice
    extent: tuple[float, float, float, float]
    sums: np.ndarray


def county_regions(polygons, lat, lon):
    if not (
        np.allclose(np.diff(lat), -RESOLUTION, atol=1e-9, rtol=0)
        and np.allclose(np.diff(lon), RESOLUTION, atol=1e-9, rtol=0)
    ):
        raise ValueError("Unexpected native TerraClimate cell size or orientation")
    west, north = lon[0] - RESOLUTION / 2, lat[0] + RESOLUTION / 2
    parts = (
        polygons[["GEOID", "geometry"]]
        .to_crs(4326)
        .explode(index_parts=False)
        .reset_index(drop=True)
    )
    regions = np.select(
        [
            parts.GEOID.str.startswith("02") & (parts.bounds.minx > 0),
            parts.GEOID.str.startswith("02"),
            parts.GEOID.str.startswith("15"),
        ],
        ["aleutians-east", "alaska", "hawaii"],
        default="contiguous",
    )
    result = []
    for _, group in parts.groupby(regions):
        xmin, ymin, xmax, ymax = group.total_bounds
        x0 = int(np.floor((xmin - west) / RESOLUTION))
        x1 = int(np.ceil((xmax - west) / RESOLUTION))
        y0 = int(np.floor((north - ymax) / RESOLUTION))
        y1 = int(np.ceil((north - ymin) / RESOLUTION))
        if not (0 <= x0 < x1 <= len(lon) and 0 <= y0 < y1 <= len(lat)):
            raise ValueError("County bounds extend outside the native grid")
        extent = (
            west + RESOLUTION * x0,
            north - RESOLUTION * y1,
            west + RESOLUTION * x1,
            north - RESOLUTION * y0,
        )
        result.append(
            Region(
                group,
                slice(y0, y1),
                slice(x0, x1),
                extent,
                np.zeros((12, y1 - y0, x1 - x0)),
            )
        )
    return result


def annual_files(cache):
    with CHECKSUMS.open() as stream:
        hashes = {
            (int(row["year"]), row["variable"]): row["sha256"]
            for row in csv.DictReader(stream)
        }
    if set(hashes) != {(year, key) for year in YEARS for key in VARIABLES}:
        raise ValueError("Incomplete set of annual source checksums")
    for year in YEARS:
        files = {}
        for key in VARIABLES:
            name = f"TerraClimate_{key}_{year}.nc"
            files[key] = verified_download(
                cache / name, SOURCE + name, hashes[year, key]
            )
        yield year, files


def accumulate(regions, inputs):
    for region in regions:
        # Limit temporary arrays to one native chunk height at a time.
        for start in range(region.rows.start, region.rows.stop, 128):
            stop = min(start + 128, region.rows.stop)
            window = (slice(None), slice(start, stop), region.columns)
            readings = [inputs[key][key][window] for key in ("vap", "tmin", "tmax")]
            offset = start - region.rows.start
            region.sums[:, offset : offset + stop - start] += absolute_humidity(
                *readings
            )


def county_means(stats):
    totals = pd.concat(stats).groupby(level=0).sum()
    return {
        fips: round(float(total / valid), 1)
        if area > 0 and valid >= MIN_COVERAGE * area
        else None
        for fips, (total, valid, area) in totals.iterrows()
    }


def build(climate, polygons, sources):
    regions = []
    seen = []
    for year, files in sources:
        with ExitStack() as stack:
            inputs = {
                key: stack.enter_context(Dataset(path)) for key, path in files.items()
            }
            if not regions:
                lat, lon = (
                    np.asarray(inputs["vap"][axis][:]) for axis in ("lat", "lon")
                )
                regions = county_regions(polygons, lat, lon)
            for key, dataset in inputs.items():
                validate_grid(dataset, year, key, lat, lon)
            accumulate(regions, inputs)
        seen.append(year)
        print(f"Processed {year}", flush=True)
    if seen != list(YEARS):
        raise ValueError(
            "Expected exactly one input triplet per year, 1991 through 2020"
        )
    counties = {
        fips: {"monthlyAbsoluteHumidity": []}
        for fips in sorted(polygons.GEOID.unique())
    }
    for month in range(12):
        stats = []
        for region in regions:
            xmin, ymin, xmax, ymax = region.extent
            # NaN propagation requires all three inputs for all 30 years at each pixel.
            source = NumPyRasterSource(
                region.sums[month] / len(YEARS),
                xmin=xmin,
                ymin=ymin,
                xmax=xmax,
                ymax=ymax,
                nodata=np.nan,
                srs_wkt=GEOGRAPHIC_CRS,
            )
            stats.append(area_totals(source, region.polygons))
        for fips, value in county_means(stats).items():
            counties[fips]["monthlyAbsoluteHumidity"].append(value)
    for fips, record in counties.items():
        for field, month_key in FIELDS.items():
            month = climate.get(fips, {}).get(month_key)
            if month is not None and month not in range(1, 13):
                raise ValueError(f"Invalid {month_key} for {fips}: {month}")
            record[field] = (
                None if month is None else record["monthlyAbsoluteHumidity"][month - 1]
            )
    return counties


def payload(counties):
    return {
        "title": "Monthly Absolute Humidity",
        "period": "1991–2020",
        "unit": "g/m³",
        "credit": "Abatzoglou et al. · Climatology Lab · TerraClimate v1.1",
        "license": "CC BY 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "source": "https://www.climatologylab.org/terraclimate.html",
        "citation": "Abatzoglou, J.T., Hegewisch, K.C., Yin, C. and D.A. Kalashnikov (2026). TerraClimate v1.1, An Updated Global Climate and Climatic Water Balance Dataset with Climate Scenarios. Scientific Data.",
        "sourceAcknowledgments": "TerraClimate v1.1 uses CHELSA climatologies v2.1 (Karger et al., 2021), CRU TS (Harris et al., 2020), and ERA5 (Hersbach et al., 2020).",
        "originalPaper": "https://doi.org/10.1038/sdata.2017.191",
        "sourceTemplate": SOURCE + "TerraClimate_{variable}_{year}.nc",
        "boundaries": BOUNDARIES,
        "method": "Estimated near-surface water-vapor density in grams per cubic meter, January through December. For each native 1/30-degree TerraClimate v1.1 pixel and month-year, divide actual vapor pressure (Pa) by 461.5 times absolute air temperature (K), then convert kg/m³ to g/m³. Monthly temperature is the midpoint of mean daily minimum and maximum temperatures. Using monthly mean inputs approximates the mean of daily densities. Average each calendar month across 1991–2020, then weight pixels by the spherical area intersecting 2017 Census 1:500,000 county polygons. Each published value requires complete 30-year pixel records covering at least 95% of the county polygon. The seasonal values select the county’s NOAA 1991–2020 coldest or hottest month. Rounded to 0.1 g/m³.",
        "coverage": {
            field: sum(row[field] is not None for row in counties.values())
            for field in FIELDS
        },
        "monthlyCoverage": [
            sum(
                row["monthlyAbsoluteHumidity"][i] is not None
                for row in counties.values()
            )
            for i in range(12)
        ],
        "counties": counties,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    polygons = county_boundaries(args.cache)
    climate = json.loads((DATA / "climate.json").read_text())
    if climate["period"] != [1991, 2020]:
        raise ValueError("Review the NOAA seasonal month-selection period")
    dataset = payload(build(climate["counties"], polygons, annual_files(args.cache)))
    output = DATA / "absolute-humidity.json"
    temp = output.with_suffix(".tmp")
    temp.write_text(
        json.dumps(dataset, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        + "\n"
    )
    temp.replace(output)
    print("Monthly coverage:", dataset["monthlyCoverage"])
    print("Seasonal coverage:", dataset["coverage"])


if __name__ == "__main__":
    main()
