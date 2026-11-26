# /// script
# requires-python = ">=3.11"
# dependencies = ["exactextract==0.3.0", "geopandas==1.2.0", "netCDF4==1.7.5.1.post1"]
# ///
"""Build county mean annual snowfall. Run: uv run scripts/snowfall.py --cache /tmp/home-range-snowfall"""

import argparse
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

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/snowfall.json"
SOURCE = "https://www.nohrsc.noaa.gov/snowfall/"
DOCUMENTATION = (
    SOURCE + "data/resources/documents/PDD_National%20Gridded%20Snowfall%20Analysis.pdf"
)
EXTENT = (-126.0, 21.0, -66.0, 55.0)
WIDTH, HEIGHT = 1500, 850
# The 2020–21 archive ends on September 14 rather than September 30.
# Its unobserved late-season snowfall cannot be treated as zero.
SHA256 = {
    2009: "51e6d2ef98929931f7b96f8586ee7761d64d7696affa35abda280c3bd6f7a3c4",
    2010: "711884903e9468a2b3bdb0d036115877c7f62c1a76709523086b76a39d907765",
    2011: "fe807009e9c35b4730e20ab83b9dc448f22f657bb6e1ab32cbeef9097325399a",
    2012: "ed13a2d161875abe2e96cddb76255e5c798b538a9c35ac4f75175da346a2bd07",
    2013: "b467ada7b3b23ead0fdb613264b32908386c2c66b1255686045947fb7a57b10b",
    2014: "7b5a8152dbae0e05b717f54986780e872080f042948094674d2297743397e134",
    2015: "65cda2eff8efd5c1d2c999acdd8c448232fc9d888bb1a4c421cb10bcfa0f1885",
    2016: "d6c999cddb0f3f3b734b46983c4fba28bfef68c3603a19f4dce0f95ffc68c192",
    2017: "fc95d5b1e039166d6e7cdd06a0604950073e3ba1797cb99c357cb61c39e19d0a",
    2018: "27831c7291ee4dd9e646522e760db0c1396b59eabe52baf0139f1f645ceae5df",
    2019: "98e0b3dd2d6977d80474e097837c18d2ab4c79964f0e366cdf70663e3b955b1a",
    2020: "102bb7737b6d0001c375d5d79ef19413ab3a6216b9e7eca6d59a05fde8c93960",
    2022: "4300c672852c71fac0e3b5c44e1d89bcc2463b48643f6e12031fbc53c0f9b80c",
    2023: "77a730c2d67073cfb26691743bc41608e54e5361274e1ddcf22787e63dcaec52",
    2024: "0640c68ac13577fea27b03cc7f8bb6996ecb28d869afaa8f964947ebbb99f6ab",
    2025: "7cdc7eb0852dbf21e7f5673a2b645bf32f40649bf183323f437bb34b963308ba",
    2026: "f0ecf04c2c1f2f9f733b5698428703652d2a9db5e02fcfc852a523f5840bc043",
}


def read_season(path, year):
    with Dataset(path) as ds:
        v = ds["Data"]
        if not (
            v.standard_name == "thickness_of_snowfall_amount"
            and v.units == "m"
            and v.dimensions == ("lat", "lon")
            and v.shape == (HEIGHT, WIDTH)
            and v.start_date == f"{year - 1}-09-30 12:00:00 UTC"
            and v.stop_date == f"{year}-09-30 12:00:00 UTC"
            and ds["crs"].horizontal_datum == "WGS84"
        ):
            raise ValueError(
                f"Unexpected snowfall measure, grid, or incomplete season ending {year}"
            )
        for axis, n, first, last in (
            ("lat", HEIGHT, EXTENT[3], EXTENT[1]),
            ("lon", WIDTH, EXTENT[0], EXTENT[2]),
        ):
            edges = np.linspace(first, last, n + 1)
            bounds = np.column_stack((edges[:-1], edges[1:]))
            if not (
                np.allclose(ds[f"{axis}_bounds"][:], bounds, atol=1e-8, rtol=0)
                and np.allclose(ds[axis][:], bounds.mean(axis=1), atol=1e-8, rtol=0)
            ):
                raise ValueError(f"Unexpected {axis} coordinates in {year}")
        # Keep published zeros; one missing season disqualifies this cell from the mean.
        values = np.ma.filled(v[:], np.nan)
        if np.any(np.isfinite(values) & (values < 0)) or np.isinf(values).any():
            raise ValueError(f"Invalid accumulation in season ending {year}")
        return values


def county_inches(source, counties):
    conus = counties.loc[~counties.STATEFP.isin(("02", "15")), ["GEOID", "geometry"]]
    parts = conus.to_crs(4326).explode(index_parts=False)
    areas = area_totals(source, parts)
    rates = dict.fromkeys(counties.GEOID)
    coverage = {}
    for fips, (total, valid, area) in areas.iterrows():
        fraction = valid / area if area else 0
        if fraction >= MIN_COVERAGE:
            rates[fips] = round(float(total / valid / 0.0254), 1)
        if fraction < 0.99:
            coverage[fips] = round(100 * fraction, 2)
    return dict(sorted(rates.items())), coverage


def build(cache):
    total = np.zeros((HEIGHT, WIDTH), dtype=np.float64)
    for year, digest in SHA256.items():
        name = f"sfav2_CONUS_{year - 1}093012_to_{year}093012.nc"
        path = verified_download(cache / name, f"{SOURCE}data/{year}09/{name}", digest)
        total += read_season(path, year)
    counties = county_boundaries(cache)
    srs = counties.to_crs(4326).crs.to_wkt()
    source = NumPyRasterSource(total / len(SHA256), *EXTENT, nodata=np.nan, srs_wkt=srs)
    values, coverage = county_inches(source, counties)
    return {
        "title": "Average Annual Snowfall",
        "unit": "inches per year",
        "period": "2008–09 through 2025–26, excluding 2020–21",
        "yearsEnding": list(SHA256),
        "source": SOURCE,
        "credit": "NOAA National Gridded Snowfall Analysis",
        "documentation": DOCUMENTATION,
        "boundaries": BOUNDARIES,
        "method": "Mean of 17 complete September 30 noon UTC to September 30 noon UTC totals of newly fallen snow. NOAA combines reported snowfall with gridded estimates. Each 0.04° cell is weighted by its area inside the 2017 Census county boundary. Cells must have valid values in every included season and together cover at least 95% of the mapped county. Source meters are converted to inches and rounded to one decimal.",
        "caveat": "NOAA covers the contiguous U.S. Seasonal estimates include snow that melted between storms. The September 2021 archive lacks a complete seasonal total, so 2020–21 is excluded everywhere. Alaska, Hawaii and counties with insufficient grid coverage have no value.",
        "coverageBelow99Percent": coverage,
        "counties": values,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cache", type=Path, required=True, help="Download cache (about 40 MB)"
    )
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    data = build(args.cache)
    args.output.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        + "\n"
    )
    print(
        f"{sum(v is not None for v in data['counties'].values())} counties with snowfall estimates"
    )


if __name__ == "__main__":
    main()
