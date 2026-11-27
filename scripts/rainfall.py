# /// script
# requires-python = ">=3.11"
# dependencies = ["exactextract==0.3.0", "geopandas==1.2.0", "netCDF4==1.7.5.1.post1"]
# ///
"""Build county rainfall normals. Run: uv run scripts/rainfall.py --cache /tmp/home-range-rainfall"""

import argparse
import calendar
import json
from pathlib import Path

import numpy as np
from county_raster import (
    BOUNDARIES,
    MIN_COVERAGE,
    area_totals,
    county_boundaries,
    verified_download,
)
from exactextract.raster import NumPyRasterSource
from netCDF4 import Dataset
from pyproj import CRS

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/rainfall.json"
YEARS = range(1991, 2021)
URL = "https://data.gdex.ucar.edu/d633001/e5.moda.fc.sfc.accumu/{year}/"
VARIABLES = {"TP": (228, "m"), "SF": (144, "m of water equivalent")}
RESOLUTION = 0.25
# Quantization in separately archived TP and SF can produce tiny negative residuals.
TOLERANCE_M = 0.00001
METRES_PER_INCH = 0.0254
SHA256 = {
    1991: {
        "TP": "7e70ad228822b707e9851a32e6adba48ecf82e2cab2700d2197b3a627c326d49",
        "SF": "cefe8e5f55cd9f3d85a0d3879def66debf0e6d4308de9004088f85694543291b",
    },
    1992: {
        "TP": "4ab6c42e97a57172e84e2ffe454881fbd8714026bbb6bb8f1fb5452e62b0835e",
        "SF": "a7e54aee7aebcb6f4350063d91d6866dd67b59959d0517caa128b351d5fbbf25",
    },
    1993: {
        "TP": "6ac657ce3849ce6fe4f7a82210a62dd9c50a832e9db6825d41b580cfb324b672",
        "SF": "28e3212615fd3b0cfda902dbd12ead3ca34b264237c6665b07b77e7265f524ce",
    },
    1994: {
        "TP": "de5bb049f4172dbb5dffef1ee14d153bfc40f72f41eb12464c7f1d6edb145b82",
        "SF": "85f2b6e8b167203847b16807e6ce8629295810216ce9d4bcba3d1d6aa976cd30",
    },
    1995: {
        "TP": "fce6254ab2f46183aa2f79601961aab5a28c6283a0e59597d664823fbb5f2d91",
        "SF": "60c588d32d95a686577bdc4668bfe44e3e110141fac3ebb801d9b0810f2e6a65",
    },
    1996: {
        "TP": "c97224b46aad65520fc9dcc6a7e6269352b353076f0e4c4ec2c1bdaf6bcec197",
        "SF": "55a364354c022bc986cff6281953cb7eb2f59af207cffed69bee2429f3723f12",
    },
    1997: {
        "TP": "04a5ebb9ad211dc7b8fc94aa99eadb866fc2592048dd6c5c0153a921c8cbe418",
        "SF": "aa7d6414c5ceb23823f480e864d2c56f976f0a7230d25a665bbcb55b9bf2cd84",
    },
    1998: {
        "TP": "5b80d808cdc2eced2e79d47188ae32522651200aea36f7f54b85696dca5accef",
        "SF": "6d6cc7aad84679dc4e3d3e1dd712026247187169cb2158bcf889679ae334cc54",
    },
    1999: {
        "TP": "3a5749b6536fb89abdf46d3be0ba83163466605782aa720415a90a4c0527e39a",
        "SF": "00257b1b0f2dd108d242488ce13f5d5546639621e892f5472b5e788a6b8ad7cc",
    },
    2000: {
        "TP": "97e3ebf0514a1547fefa595b55ac73ae5baedffb0d1f5dbac8b503d2d73cfacd",
        "SF": "5ca909f931c98db3f909646b7862e3c07e3f364582fdd6c23f3bcc7f0e74c14d",
    },
    2001: {
        "TP": "79373a3e20f25c6b317f3679afe8e7d6f92f2a122ab6a9b5ff29f3eb9205463b",
        "SF": "3ab50107f7c551be1865440e52284bcc51946a7aa08c23f564ef780ec8efc9cd",
    },
    2002: {
        "TP": "6b15c1e711e833d21610eab6a7094fbeb24533f89ed27e26e895076ed926cc1c",
        "SF": "387a2231ebd8465df95cae81c13cf020142686e03c80589ddb72f700ce12f700",
    },
    2003: {
        "TP": "39f45c4bf4aefb0fbd4645dbd9d41e750891409920b39d31ced2590914b33b8c",
        "SF": "4bb9b3b31dbab774c56c51e9cd96830693c8b1cd56e8cab8b9cc303e29a93c84",
    },
    2004: {
        "TP": "ada7d968d0f615fda31d6f616d2062969a6d011cdfcb5853d7fb15850c1b3aef",
        "SF": "dec7e3677cdee7c2db0109a1d32be457d6e41c9235bb1ec6e46e5e594c4498ac",
    },
    2005: {
        "TP": "f9c5af09de1a06db3cf0ae151631c0f045820e300e458e7cc70a4ec30939439e",
        "SF": "31718d105fd1e6b55fea29151a92cd49d56e8dbb3e4221f750ab6f10acea578b",
    },
    2006: {
        "TP": "9e3a9d1a80824251df00ae1835ca238110a8c0d4739bf5c57564b8f4362cd811",
        "SF": "18cd5aa3c7817a1a325eeb63a764010ca1cf59ed0434854487df53a24ea7f910",
    },
    2007: {
        "TP": "caeb87808e24989fb59e258d9a5083d92c4073f6dec3234c03cadaff14d7f522",
        "SF": "53848296cadc39c798781d8264fa83f82f6ae23df621bece35e4e3769896df7b",
    },
    2008: {
        "TP": "b2457138a0680e47e877a1ab95dacdc7ddfd2c4bde7d06bb95fa5b2dc57dc8f5",
        "SF": "ee50bdae0785adc9cbd9e0d76be7b75ae296c1aede077b2b85c29fd548eda3eb",
    },
    2009: {
        "TP": "e0b23e8be4788dca67cda1f09ac7d0e262d23bf07211e709fc7de54fd4e9b9c2",
        "SF": "f2306830cadea5136e443d944764f1695fab4489754d8a5d4a6439dd007c71a1",
    },
    2010: {
        "TP": "bd25270bff7c18a5e3483d2d9d691098ac4db38e341aa0e2bf8f9fc4ec91c762",
        "SF": "5a00066c02f85c8b06300529f69b00a2d122468ede640d382f42ebfde39df707",
    },
    2011: {
        "TP": "8fd4f5fcf451eac3efcd4b5dab24011805aa1b609d0354f1eb2c609d34dc319b",
        "SF": "dcca7334026b7fd447f1895541d3cc1e6aa18d3eae799c04c41751c810094aa5",
    },
    2012: {
        "TP": "5d464250441b451bc9abf1c102b588add62a6f91582f62613d23027cf0b0733e",
        "SF": "215380fe09919fa2e3d934512379de5bd66d76e5d23d749ec0e4d2c98f3326ba",
    },
    2013: {
        "TP": "e887700121a9c1f30fed9d3822cbf689de59da2dba121cc6931bd17361d1a35e",
        "SF": "5a5b41b77482be0d46e11d9351d7aff33cea98814e1169a4ba2ad56d410ae12a",
    },
    2014: {
        "TP": "b1c42adde6d8495653e2f477e677c082bf8db09f32627a24060b34ae09c90713",
        "SF": "2fbf51dfe2cd069f97f408dc2793b4735a51b248acb5cb4601b0e5b4043f3d5b",
    },
    2015: {
        "TP": "17873793a0c528eab2ae99f548479ac1f5da8947f464cbb5857882db7b3e8915",
        "SF": "11909f655090cdf49a6583c985acc5d2a973d2bc4e9e6eccbcde3ab06473a17d",
    },
    2016: {
        "TP": "54e3bc345e98fb59b948d7b0d80eb15dce92f47720b126dcc04d4a2a5bfe216a",
        "SF": "046caca649448de75911dfc1b2010c0940518143136575d1dcabcf9e49c55a46",
    },
    2017: {
        "TP": "cf789f93cba011f363b5ee54eb8e4ca3d79b5984c19c21f59caa7d03a4898382",
        "SF": "1b42aefadbedf0526297ada4b34cc20c95dc94c6dba3e8208d556dafaf26fa85",
    },
    2018: {
        "TP": "e24b3bbe00a485e4579b9963d03d178accd3ee206cf56e95b6ec435aaef78eb4",
        "SF": "685bf5317bbb74f63782756330c135babab2f92a211d39a11121f56ed55103ab",
    },
    2019: {
        "TP": "c1d5fb3710615346f9ce2fb61530fbe6d517e4391c6adf24d8b5a74d9cf76d14",
        "SF": "9e8e1167d1ea35570c9f9d1850b090832632105048bb89e628c45ac4c54b94cf",
    },
    2020: {
        "TP": "844966a3ebddc21466164ba85823667a2b02942c7c74cd381429157fd1d292ba",
        "SF": "5b2c6b8f680d3c7beaf231de73ba87dea5b1d5374f7324b25002c6ab5a450704",
    },
}


def source_file(cache, year, key):
    parameter, _ = VARIABLES[key]
    name = f"e5.moda.fc.sfc.accumu.128_{parameter}_{key.lower()}.ll025sc.{year}010100_{year}120100.nc"
    return verified_download(
        cache / name, URL.format(year=year) + name, SHA256[year][key]
    )


def validate(ds, year, key):
    variable = ds[key]
    parameter, units = VARIABLES[key]
    dates = [year * 1000000 + m * 10000 + 100 for m in range(1, 13)]
    if (
        variable.dimensions != ("time", "latitude", "longitude")
        or variable.ecmwf_parameter != parameter
        or variable.units != units
        or variable.rda_dataset_group
        != "ERA5 monthly mean atmospheric surface forecast (accumulated) [netCDF4]"
        or not np.array_equal(ds["utc_date"][:], dates)
        or not np.array_equal(ds["latitude"][:], np.arange(90, -90.25, -0.25))
        or not np.array_equal(ds["longitude"][:], np.arange(0, 360, 0.25))
    ):
        raise ValueError(f"Unexpected {key} field, dates, units, or grid for {year}")


def liquid_month(total, snow, year, month):
    """Convert the two monthly means of daily accumulation to monthly liquid metres."""
    total = np.ma.asarray(total, dtype="float64").filled(np.nan)
    snow = np.ma.asarray(snow, dtype="float64").filled(np.nan)
    liquid = total - snow
    valid = (total >= -TOLERANCE_M) & (snow >= -TOLERANCE_M) & (liquid >= -TOLERANCE_M)
    return (
        np.where(valid, np.maximum(0, liquid), np.nan)
        * calendar.monthrange(year, month)[1]
    )


def climate_grid(cache):
    # All dates are required in each grid cell. Ordinary summation propagates missing inputs.
    total = np.zeros((12, 721, 1440))
    for year in YEARS:
        with (
            Dataset(source_file(cache, year, "TP")) as tp,
            Dataset(source_file(cache, year, "SF")) as sf,
        ):
            validate(tp, year, "TP")
            validate(sf, year, "SF")
            for i in range(12):
                total[i] += liquid_month(tp["TP"][i], sf["SF"][i], year, i + 1)
    return total / (len(YEARS) * METRES_PER_INCH)


def longitude_wrap(values):
    # The antimeridian goes through a published cell centre. Split this cell at
    # the map seam by repeating its value at both edges of the county raster.
    shifted = np.roll(values, values.shape[1] // 2, axis=1)
    return np.column_stack([shifted, shifted[:, 0]])


def county_inches(raster, counties):
    polygons = (
        counties[["GEOID", "geometry"]]
        .to_crs(4326)
        .explode(index_parts=False)
        .reset_index(drop=True)
    )
    areas = area_totals(raster, polygons)
    return {
        fips: round(float(total / valid), 1)
        if area > 0 and valid >= MIN_COVERAGE * area
        else None
        for fips, (total, valid, area) in areas.iterrows()
    }


def build(cache):
    cache.mkdir(parents=True, exist_ok=True)
    ncar = cache / "ncar"
    ncar.mkdir(exist_ok=True)
    counties = county_boundaries(cache)
    half = RESOLUTION / 2
    monthly = climate_grid(ncar)

    def extract(grid):
        raster = NumPyRasterSource(
            longitude_wrap(grid),
            -180 - half,
            -90 - half,
            180 + half,
            90 + half,
            nodata=np.nan,
            srs_wkt=CRS.from_epsg(4326).to_wkt(),
        )
        return county_inches(raster, counties)

    values = extract(monthly.sum(axis=0))
    by_month = [extract(grid) for grid in monthly]
    if set(values) != set(counties.GEOID):
        raise ValueError("Rainfall county IDs do not match the 2017 Census geography")
    payload = {
        "title": "Average Annual Rainfall",
        "credit": "Copernicus Climate Change Service (C3S), ERA5 via NSF NCAR GDEX",
        "source": "https://gdex.ucar.edu/datasets/d633001/",
        "documentation": "https://doi.org/10.24381/cds.f17050d7",
        "accumulationDocumentation": "https://confluence.ecmwf.int/display/CKB/ERA5%3A+data+documentation",
        "license": "CC BY 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "period": "1991–2020",
        "unit": "in/year",
        "boundaries": BOUNDARIES,
        "method": (
            "ERA5 modeled daily liquid precipitation is monthly mean total precipitation (TP) "
            "minus snowfall water equivalent (SF), both in metres per day. Each calendar month's "
            "mean is multiplied by its number of days, including leap days. Totals are summed over "
            "1991–2020, divided by 30 and converted to inches. Negative residuals within 0.01 mm/day "
            "of zero are set to zero for differences attributable to source precision. Larger negative "
            "residuals and missing inputs invalidate that cell's normal. Native 0.25° cells are weighted "
            "by their spherical area inside shoreline-clipped 2017 Census polygons. Each county requires "
            "95% coverage by cells with complete records for the period selected (30 calendar months or all 360 months). County means are rounded to one decimal inch."
        ),
        "coverage": sum(v is not None for v in values.values()),
        "counties": values,
        "monthlyCounties": {fips: [m[fips] for m in by_month] for fips in values},
    }
    temp = OUTPUT.with_suffix(".tmp")
    temp.write_text(
        json.dumps(payload, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        + "\n"
    )
    temp.replace(OUTPUT)
    print(f"Built {payload['coverage']} county rainfall normals")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", required=True, type=Path)
    build(parser.parse_args().cache)
