"""Common inputs and area-weighted zonal statistics for the county rasters."""

import hashlib
import shutil
import tempfile
import urllib.request
from pathlib import Path

import geopandas as gpd
from exactextract import exact_extract

BOUNDARIES = "https://www2.census.gov/geo/tiger/GENZ2017/shp/cb_2017_us_county_500k.zip"
MIN_COVERAGE = 0.95
CENSUS_SHA256 = "d14db6b3034dbf42916067106fa753aad3cbc443ddbd87df6d2784adb8e00ff4"


def verified_download(path, url, digest):
    if not path.exists():
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as dest:
            temp = Path(dest.name)
            try:
                with urllib.request.urlopen(url, timeout=120) as src:
                    shutil.copyfileobj(src, dest)
            except BaseException:
                temp.unlink(missing_ok=True)
                raise
        temp.replace(path)
    with path.open("rb") as f:
        actual = hashlib.file_digest(f, "sha256").hexdigest()
    if actual != digest:
        raise ValueError(f"Source checksum mismatch. Remove {path} before retrying.")
    return path


def county_boundaries(cache):
    path = verified_download(cache / "counties.zip", BOUNDARIES, CENSUS_SHA256)
    counties = gpd.read_file(path)
    counties = counties[counties.STATEFP.astype(int) <= 56]
    if len(counties) != 3142 or not counties.GEOID.is_unique:
        raise ValueError("Unexpected county vintage or duplicate FIPS")
    return counties


def area_totals(source, polygons):
    """Combine each polygon part's value integral and mapped areas by FIPS."""
    operations = [
        "total=sum(coverage_weight=area_spherical_km2)",
        "valid=count(coverage_weight=area_spherical_km2)",
        "area=count(coverage_weight=area_spherical_km2,default_value=0)",
    ]
    rows = exact_extract(
        source,
        polygons,
        operations,
        include_cols=["GEOID"],
        output="pandas",
    )
    return rows.groupby("GEOID", sort=True)[["total", "valid", "area"]].sum()
