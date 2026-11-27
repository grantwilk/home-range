# /// script
# requires-python = ">=3.11"
# dependencies = ["exactextract==0.3.0", "rasterio==1.5.2", "geopandas==1.2.0"]
# ///
"""Build the 12 calendar-month relative humidity normals for each county.

Run with uv run scripts/humidity.py --cache /tmp/home-range-humidity.
The 12 native global rasters occupy about 5.4 GB.
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
    3: "2b5f5ea810787088d56c0d7e9fa3cd236d6817a5e91ea343b2e8569ee133e984",
    4: "4d7756c04b6ad90f16b70fec47e512d80060ac5c79d69cfbe8c33a6427027eff",
    5: "c9ea5fd18f21ffd3d2673190403c3be685243403272dfd4b66ae2467a46b59ae",
    6: "a6a4b55b13c2293a4411751e77e4c482516161d142365bdd6640db837243c837",
    7: "e1bdace41155353fa600e6f1a51a1bda5bdb9f86585392a5e8d2368a95c3e379",
    8: "f0c4d80eade2d324e285240fab0e13932091b98df875d39887cb876a41ac0bca",
    9: "d7b905714d7291f87664adf8c41d71374d4337c9b3b78dca20d3777c812e4a10",
    10: "7be8267ff03c91eb90abf669e600c4a4552c3f51c1024a232134e9dc3777b64c",
    11: "0460775b65cfa66688edc6334f582ab6878e9500ac041a61e0e29a78ff1fec5e",
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
    counties = {
        fips: {"monthlyHumidity": []} for fips in sorted(polygons.GEOID.unique())
    }
    with ThreadPoolExecutor(max_workers=3) as pool:
        files = pool.map(lambda m: read_month(m, cache), range(1, 13))
        for path in files:
            with rasterio.open(path) as raster:
                validate_metadata(raster)
                values = aggregate_month(raster, polygons)
            for fips, record in counties.items():
                record["monthlyHumidity"].append(values[fips])

    # Keep the two temperature-selected months used by existing shared links.
    for fips, record in counties.items():
        for field, month_key in FIELDS.items():
            month = climate.get(fips, {}).get(month_key)
            if month is not None and month not in range(1, 13):
                raise ValueError(f"Invalid {month_key} for {fips}: {month}")
            record[field] = (
                None if month is None else record["monthlyHumidity"][month - 1]
            )
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
        "title": "Average Monthly Relative Humidity",
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
        "method": "Monthly values are 1981–2010 mean near-surface relative humidity, in January through December order. Native 30-arcsecond CHELSA modeled land pixels are weighted by their spherical area inside 2017 Census 1:500,000 polygons. Each monthly value requires at least 95% valid mapped area. Seasonal fields select the coldest and hottest months from the county’s 1991–2020 NOAA mean temperatures, when available. Values are percent, rounded to one decimal.",
        "coverage": {
            f: sum(c[f] is not None for c in counties.values()) for f in FIELDS
        },
        "monthlyCoverage": [
            sum(c["monthlyHumidity"][i] is not None for c in counties.values())
            for i in range(12)
        ],
        "counties": counties,
    }
    output = DATA / "humidity.json"
    temp = output.with_suffix(".tmp")
    temp.write_text(
        json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        + "\n"
    )
    temp.replace(output)
    print("Monthly coverage:", payload["monthlyCoverage"])
    print("Seasonal coverage:", payload["coverage"])


if __name__ == "__main__":
    main()
