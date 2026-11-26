# /// script
# requires-python = ">=3.11"
# dependencies = ["exactextract==0.3.0", "rasterio==1.5.2", "geopandas==1.2.0"]
# ///
"""Build monthly relative humidity for each county's coldest and hottest month.

Run with uv run scripts/humidity.py --cache /tmp/home-range-humidity.
The seven global rasters used by the current temperature catalog need 3.2 GB.
"""

import argparse
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import rasterio
from county_raster import (
    BOUNDARIES,
    MIN_COVERAGE,
    area_totals,
    county_boundaries,
    verified_download,
)
from exactextract.raster import RasterioRasterSource

DATA = Path(__file__).resolve().parents[1] / "data"
SOURCE = "https://os.unil.cloud.switch.ch/chelsa02/chelsa/global/climatologies/hurs/1981-2010/"
TEMPLATE = SOURCE + "CHELSA_hurs_{month:02d}_1981-2010_V.2.1.tif"
SHA256 = {
    1: "8fba5d20c34aa793364106eafe5dfbdd5c1acc35223a148f0df20c9095cdb9be",
    2: "1df5b5bfb8883f11f5a80a988df4cff5d1020f7a81cd8264f8f41e3b331bd17a",
    6: "a6a4b55b13c2293a4411751e77e4c482516161d142365bdd6640db837243c837",
    7: "e1bdace41155353fa600e6f1a51a1bda5bdb9f86585392a5e8d2368a95c3e379",
    8: "f0c4d80eade2d324e285240fab0e13932091b98df875d39887cb876a41ac0bca",
    9: "d7b905714d7291f87664adf8c41d71374d4337c9b3b78dca20d3777c812e4a10",
    12: "4420a47ca900873b01c17c0ca587fc59fa937e80c772a631ce4a379a178904c9",
}
FIELDS = {"coldHumidity": "coldMonth", "hotHumidity": "hotMonth"}


def read_month(month, cache):
    return verified_download(
        cache / f"month-{month:02d}.tif", TEMPLATE.format(month=month), SHA256[month]
    )


def validate_metadata(raster):
    tags = raster.tags()
    expected = {
        "variable": "hurs",
        "variable_unit": "percent",
        "datetime": "1981-2010",
        "source_id": "CHELSA_V2.1",
    }
    if any(tags.get(k) != v for k, v in expected.items()):
        raise ValueError("Unexpected humidity variable, unit, period, or version.")
    if (
        raster.crs.to_epsg() != 4326
        or raster.scales != (0.01,)
        or raster.offsets != (0.0,)
        or raster.nodata != 65535
    ):
        raise ValueError("Unexpected CHELSA raster encoding.")


def aggregate_month(raster, polygons):
    # RasterioRasterSource masks nodata and applies the GeoTIFF's 0.01 scale.
    # default_value treats missing pixels as present only in the denominator.
    areas = area_totals(RasterioRasterSource(raster), polygons)
    result = {}
    for fips, (total, valid, area) in areas.iterrows():
        fraction = valid / area if area > 0 else 0
        mean = total / valid if fraction >= MIN_COVERAGE else None
        if mean is not None and not 0 <= mean <= 100.00001:
            raise ValueError(f"Out-of-range mean relative humidity for {fips}: {mean}")
        result[fips] = round(float(mean), 1) if mean is not None else None
    return result


def build(climate, polygons, cache):
    # Process components separately for multipart areas crossing the date line.
    polygons = (
        polygons[["GEOID", "geometry"]]
        .to_crs(4326)
        .explode(index_parts=False)
        .reset_index(drop=True)
    )
    counties = {fips: dict.fromkeys(FIELDS) for fips in sorted(polygons.GEOID.unique())}
    selected = {}
    for fips in counties:
        for field, month_key in FIELDS.items():
            month = climate.get(fips, {}).get(month_key)
            if month is not None:
                if month not in range(1, 13):
                    raise ValueError(f"Invalid {month_key} for {fips}: {month}")
                selected.setdefault(month, {}).setdefault(fips, []).append(field)
    months = sorted(selected)
    with ThreadPoolExecutor(max_workers=3) as pool:
        files = list(pool.map(lambda m: read_month(m, cache), months))
    for month, path in zip(months, files, strict=True):
        wanted = selected[month]
        with rasterio.open(path) as raster:
            validate_metadata(raster)
            values = aggregate_month(raster, polygons[polygons.GEOID.isin(wanted)])
        for fips, fields in wanted.items():
            for field in fields:
                counties[fips][field] = values[fips]
    return counties


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    polygons = county_boundaries(args.cache)
    climate = json.loads((DATA / "climate.json").read_text())
    if climate["period"] != [1991, 2020]:
        raise ValueError(
            "NOAA temperature period changed; review month-selection metadata."
        )
    counties = build(climate["counties"], polygons, args.cache)
    payload = {
        "title": "Relative Humidity in the Coldest and Hottest Months",
        "period": "1981–2010",
        "monthSelectionPeriod": "1991–2020",
        "unit": "%",
        "credit": "Karger et al. (2021), CHELSA-climatologies v2.1; Brun et al. (2022), CHELSA-BIOCLIM+",
        "license": "CC0 1.0",
        "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
        "source": "https://www.chelsa-climate.org/datasets/chelsa_climatologies",
        "paper": "https://doi.org/10.5194/essd-14-5573-2022",
        "rasterTemplate": TEMPLATE,
        "boundaries": BOUNDARIES,
        "method": "Each figure is the 1981–2010 mean near-surface relative humidity for the calendar month identified as coldest or hottest by the county's 1991–2020 NOAA mean temperature. Native 30-arcsecond CHELSA modeled land pixels are weighted by their spherical area inside 2017 Census 1:500,000 polygons. Values require at least 95% valid mapped area and a known extreme month. Units are percent, rounded to one decimal.",
        "coverage": {
            f: sum(c[f] is not None for c in counties.values()) for f in FIELDS
        },
        "counties": counties,
    }
    output = DATA / "humidity.json"
    temp = output.with_suffix(".tmp")
    temp.write_text(
        json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        + "\n"
    )
    temp.replace(output)
    print(payload["coverage"])


if __name__ == "__main__":
    main()
