# /// script
# requires-python = ">=3.12"
# dependencies = ["exactextract==0.3.0", "geopandas==1.2.0", "netCDF4==1.7.5.1.post1", "scipy==1.18.1"]
# ///
"""Build 1991–2020 cloudy-day counts. Run: uv run scripts/cloud.py --cache /tmp/home-range-narr"""

import argparse
import calendar
import json
from datetime import datetime
from pathlib import Path

import numpy as np
import shapely
from county_raster import BOUNDARIES, MIN_COVERAGE, county_boundaries, verified_download
from netCDF4 import Dataset, date2num
from pyproj import CRS, Transformer
from scipy.sparse import csr_matrix

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/cloudyDays.json"
URL = "https://downloads.psl.noaa.gov/Datasets/NARR/Dailies/monolevel/tcdc.{year}.nc"
HOURLY_2016 = "https://downloads.psl.noaa.gov/Datasets/NARR/monolevel/tcdc.2016.nc"
HOURLY_SHA256 = "58c351893dd8060997d9b2799b128c431a2e7dbccf0aee277529716788feab40"
YEARS = range(1991, 2021)
THRESHOLD = 80
# EPSG:6931 is a north-polar Lambert azimuthal equal-area projection.
EQUAL_AREA = "EPSG:6931"
# NOAA ARL documents NCEP's spherical Earth radius: https://www.arl.noaa.gov/hysplit/cmapf-mapping-routines/
NCEP_RADIUS = 6_371_200
SHA256 = {
    1991: "66595212965be864bc7781228732d55608dd044294fd8b73b36ad8147b8b4db0",
    1992: "b8a36f63f22b157b7fbcdec593f04637ded9b9393c06fba109ea622eceb7a9fc",
    1993: "c44f2afd8d991f71e46a66006fec583facf2de4e8b54a25e1d53afc180c5d078",
    1994: "91aff14d9ab17add85094bb9ef7b082309fade61de0f584b128eb66ae4c00a10",
    1995: "e775d72e59a70df0c81b069b811e24e921c8519f5c2b7024ddab15be5774818c",
    1996: "4749de6e8b93077e77158c3811d4877e3ad1b702926bde39c7e76aa6bf151095",
    1997: "a9fae1a3959c9b081fc8cbbe46fcf0306f4a6aa114d211752a8abc0550cf9b11",
    1998: "39667679526aff5f2e423a4be52896fed4b82cf8f39b06c064e0b4ea3bbe7997",
    1999: "85f0e7d0c90c9db4202c37702a96243790ae666e7e705cab1b34de799f859587",
    2000: "7a76eb4f8663b36fd1709e2372d04e0d7c7e9928806c23f26d0d5d19ef8e320c",
    2001: "1b919a67cd2fb6980cf4026cb34372871659e8095d08600ac119acd2df915064",
    2002: "efcd3812fbcc4d1c7b971787d69ab60a431f667d498d37f3ef6da2a5ebd002e4",
    2003: "aeb6ce20005355f30dcc9413b81496804ded69fd7d9cb99143de5d56fd03724a",
    2004: "a2d6b28cfd894d149c438dcdc569198ef24f43406f29b8207485405ed7dc1025",
    2005: "e0ea1f840e5f914257271bde7a08a16301bbc320f3b07a0d0411e6b086175e8f",
    2006: "2adac09d5ce41d28e88900f27ead383c48b3a9ecf0b804a89b939fc7be0675a5",
    2007: "d17bed7d89dc6b7db18ee504a4bca38ac8a5b1d8b9f41291db3ab5fe197603af",
    2008: "299d5fc2d43d679e55f1998cd32879c9246a0c5fb4e43f7402a490e33140f16a",
    2009: "758112ae79611d726a867247d1dda343126a2d87afa7e8e165774fc4d46dc9d1",
    2010: "26b8ab43f0616e56430db9427aa03ee0cad516cb4c605418440b1a4e1672a0e1",
    2011: "51cb3005bf0b8cfc3f4574d4121868d65355b56b78e67f84dbe57f9bbf43fbf9",
    2012: "4db23f82f35210ba8a821e0d44110a2f634d874bcc85676bb3b50b472f39fe31",
    2013: "5baf69b97b6af2949390983622d18662d379d19474f56d6cdd243ee3351fbc48",
    2014: "ce80202585e44a22ae672f016af7550a91ac763f84d7205338756756c9288294",
    2015: "ca0dccb4f61f4f6390c8b3d2a319aa51b7ae28b627284f05f8cca94b5eef15be",
    2016: "5d0a0ec201a30f4fd7110f8b247ddc02c87bc09e576243df09b22020ec13525f",
    2017: "1a5456bfb828cfc285fef09d8679ed4662a56c8c3f7c1a9d580e197d7c18154c",
    2018: "12302b797270e82f114888962407c4fa9d1237f1c80245338fb87726abfa2a96",
    2019: "e645da2db4f8ba275d190bfcce5a0ba7d0759e9e88fc26c20b39a16e6148341e",
    2020: "0718bde686b4a4da3e092af58f67c434e0f87f0cf4b68c45a65d5965c9c62975",
}


def edges(centers):
    mid = (centers[:-1] + centers[1:]) / 2
    return np.r_[2 * centers[0] - mid[0], mid, 2 * centers[-1] - mid[-1]]


def source_grid(ds):
    mapping = ds["Lambert_Conformal"]
    crs = CRS.from_cf(
        {
            **{key: mapping.getncattr(key) for key in mapping.ncattrs()},
            "earth_radius": NCEP_RADIUS,
        }
    )
    x = np.asarray(ds["x"][:], dtype=float)
    y = np.asarray(ds["y"][:], dtype=float)
    if (
        len(x) != 349
        or len(y) != 277
        or not all(np.allclose(np.diff(axis), 32_463, atol=10) for axis in (x, y))
    ):
        raise ValueError("Unexpected NARR grid size or spacing")
    # The NOAA CF-projected axes and its auxiliary geographic coordinates agree
    # within 250 m across this 32 km grid, including Hawaii and the Aleutians.
    gx, gy = Transformer.from_crs(4326, crs, always_xy=True).transform(
        ds["lon"][:], ds["lat"][:]
    )
    if np.max(np.hypot(gx - x, gy - y[:, None])) > 250:
        raise ValueError("Projected cell centres disagree with NOAA latitude/longitude")
    # The geographic centre coordinates preserve finer precision than the rounded
    # metre axes. In this rectilinear grid the column and row means reproduce
    # every published centre to within 9 metres.
    center_x = gx.mean(axis=0)
    center_y = gy.mean(axis=1)
    if np.max(np.hypot(gx - center_x, gy - center_y[:, None])) > 9:
        raise ValueError("NOAA geographic centres do not form the expected grid")
    return crs, center_x, center_y


def county_weights(counties, native_crs, x, y):
    """Return rows of actual county area fractions and their flattened source cells."""
    # Split the Census multipart geometries first, especially the Aleutian chain,
    # so tiny islands retain their true share of the total county area.
    parts = counties.to_crs(native_crs).geometry.explode(index_parts=False)
    rows = np.asarray(parts.index)
    projected = np.asarray(parts)
    ex, ey = edges(x), edges(y)
    cells = shapely.box(ex[:-1], ey[:-1, None], ex[1:], ey[1:, None]).ravel()
    part_idx, cell_idx = shapely.STRtree(cells).query(projected, predicate="intersects")
    used, local_idx = np.unique(cell_idx, return_inverse=True)
    transform = Transformer.from_crs(native_crs, EQUAL_AREA, always_xy=True).transform

    def equal_area(features):
        # Densification preserves native Lambert cell edges when measuring surface area.
        return shapely.transform(
            shapely.segmentize(features, 2_000), transform, interleaved=False
        )

    pieces = shapely.make_valid(equal_area(projected))
    cells = equal_area(cells[used])
    total = np.bincount(rows, weights=shapely.area(pieces), minlength=len(counties))
    # Intersections are batched to limit memory for the intricate Alaskan coast.
    weights = np.empty(len(part_idx))
    for start in range(0, len(part_idx), 1024):
        sl = slice(start, start + 1024)
        overlap = shapely.intersection(pieces[part_idx[sl]], cells[local_idx[sl]])
        weights[sl] = shapely.area(overlap) / total[rows[part_idx[sl]]]
    return csr_matrix(
        (weights, (rows[part_idx], local_idx)), shape=(len(counties), len(used))
    ), used


def count_days(weights, values):
    """Classify each county after averaging each UTC day's valid grid cells."""
    valid = np.isfinite(values) & (values >= 0) & (values <= 100)
    area = weights @ valid.T
    covered = area >= MIN_COVERAGE - 1e-12
    # Centre the sums on the cutoff to preserve exactly 80% as an inclusive match.
    departure = weights @ np.where(valid, values - THRESHOLD, 0).T
    cloudy = covered & (departure >= -1e-12)
    return cloudy.sum(axis=1), covered.sum(axis=1)


def validate_year(ds, year):
    t = ds["time"]
    start = date2num(datetime(year, 1, 1), t.units)
    expected = start + 24 * np.arange(365 + calendar.isleap(year))
    bounds = np.column_stack((expected, expected + 24))
    v = ds["tcdc"]
    if not (
        v.units == "%"
        and v.standard_name == "cloud_area_fraction"
        and v.statistic == "Mean"
        and v.dimensions == ("time", "y", "x")
        and t.coordinate_defines == "start"
        and len(t) == len(expected)
    ):
        raise ValueError(f"Unexpected variable or incomplete year in {year}")
    malformed = (t[:] != expected) | np.any(ds["time_bnds"][:] != bounds, axis=1)
    dates = np.flatnonzero(malformed)
    if not np.array_equal(dates, np.arange(212, 244) if year == 2016 else []):
        raise ValueError(f"Unexpected daily time bounds in {year}")
    return dates


def repair_2016(cache, dates, daily):
    """Recompute July 31–August 31 using all eight properly timestamped samples."""
    path = verified_download(cache / "three-hourly.2016.nc", HOURLY_2016, HOURLY_SHA256)
    with Dataset(path) as ds:
        ds.set_auto_mask(False)
        t = ds["time"]
        expected = date2num(datetime(2016, 1, 1), t.units) + 3 * np.arange(366 * 8)
        v = ds["tcdc"]
        if not (
            v.units == "%"
            and v.GRIB_name == "TCDC"
            and v.dimensions == ("time", "y", "x")
            and np.array_equal(t[:], expected)
            and all(
                np.array_equal(ds[key][:], daily[key][:])
                for key in ("lat", "lon", "x", "y")
            )
        ):
            raise ValueError("Unexpected 2016 three-hourly data")
        means = {}
        for d in dates:
            samples = v[8 * d : 8 * (d + 1)]
            valid = np.all(
                np.isfinite(samples) & (samples >= 0) & (samples <= 100), axis=0
            )
            means[d] = np.where(valid, samples.mean(axis=0, dtype=float), np.nan)
        return means


def build(cache):
    counties = county_boundaries(cache).sort_values("GEOID").reset_index(drop=True)
    counts = np.zeros((12, len(counties)), dtype=int)
    month_days = np.zeros(12, dtype=int)
    valid_days = counts.copy()
    for year in YEARS:
        path = verified_download(
            cache / f"tcdc.{year}.nc", URL.format(year=year), SHA256[year]
        )
        with Dataset(path) as ds:
            ds.set_auto_mask(False)
            bad_dates = validate_year(ds, year)
            replacements = repair_2016(cache, bad_dates, ds) if len(bad_dates) else {}
            crs, x, y = source_grid(ds)
            if year == YEARS.start:
                weights, used = county_weights(counties, crs, x, y)
                first_grid = crs, x, y
            elif crs != first_grid[0] or not all(
                np.array_equal(a, b) for a, b in zip((x, y), first_grid[1:])
            ):
                raise ValueError(f"Grid changed in {year}")
            v = ds["tcdc"]
            start = 0
            for month in range(12):
                days = calendar.monthrange(year, month + 1)[1]
                month_days[month] += days
                chunk = v[start : start + days]
                for day in range(start, start + len(chunk)):
                    if day in replacements:
                        chunk[day - start] = replacements[day]
                values = chunk.reshape(len(chunk), -1)[:, used]
                cloudy, covered = count_days(weights, values)
                counts[month] += cloudy
                valid_days[month] += covered
                start += days
        print(year, flush=True)
    n_days = sum(365 + calendar.isleap(y) for y in YEARS)
    coverage = np.asarray(weights.sum(axis=1)).ravel()
    return {
        "title": "Average Annual Cloudy Days",
        "period": "1991–2020",
        "unit": "days per year",
        "credit": "NCEP North American Regional Reanalysis (NARR), provided by NOAA Physical Sciences Laboratory",
        "source": "https://psl.noaa.gov/data/gridded/data.narr.html",
        "raster": URL,
        "timeCorrection": "For July 31 through August 31, 2016, the published daily file has irregular UTC bounds. We recomputed those 32 daily means from the eight three-hourly NOAA samples on each UTC date.",
        "timeCorrectionSource": HOURLY_2016,
        "gridMethod": "Grid-cell edges fall halfway between neighboring NOAA latitude/longitude cell centers projected to the native spherical Lambert grid. County intersections are measured in a northern equal-area projection.",
        "gridDocumentation": "https://psl.noaa.gov/data/narr/format.html",
        "boundaries": BOUNDARIES,
        "method": "A cloudy day has at least 80% county-wide mean total cloud cover across the UTC day, including nighttime. NOAA averages eight three-hourly model estimates. Each native grid cell is weighted by the surface area it occupies inside the 2017 Census county boundary. The number of qualifying dates in all 30 complete calendar years is divided by 30, including leap days, and rounded to one decimal.",
        "caveat": "The model's approximately 32 km grid can obscure neighborhood or island differences. Each county needs valid data across at least 95% of its mapped area on every day. Counties with insufficient coverage have no value.",
        "daysEvaluated": n_days,
        "thresholdPercent": THRESHOLD,
        "coverageBelow99_9Percent": {
            fips: round(100 * area, 3)
            for fips, area in zip(counties.GEOID, coverage)
            if area < 0.999
        },
        "counties": {
            fips: round(int(n) / len(YEARS), 1) if nvalid == n_days else None
            for fips, n, nvalid in zip(
                counties.GEOID, counts.sum(axis=0), valid_days.sum(axis=0)
            )
        },
        "monthlyCounties": {
            fips: [
                round(int(n) / len(YEARS), 1) if nvalid == days else None
                for n, nvalid, days in zip(month_counts, coverage_days, month_days)
            ]
            for fips, month_counts, coverage_days in zip(
                counties.GEOID, counts.T, valid_days.T
            )
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cache", type=Path, required=True, help="Source cache (1.6 GB)"
    )
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    result = build(args.cache)
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        + "\n"
    )


if __name__ == "__main__":
    main()
