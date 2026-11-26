# /// script
# requires-python = ">=3.11"
# dependencies = ["openpyxl==3.1.5"]
# ///
"""Build two nationwide facility directories. Run with uv run and optional --cache DIR."""

import argparse
import csv
import hashlib
import io
import json
import math
import re
import subprocess
import tempfile
from collections import Counter, defaultdict
from pathlib import Path
from zipfile import ZipFile

from openpyxl import load_workbook

OUTPUT = Path(__file__).resolve().parents[1] / "data" / "facilities"
STATE_CODES = (
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT "
    "NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY"
)
STATES = set(STATE_CODES.split())
CMS_PAGE = "https://data.cms.gov/provider-data/dataset/ynj2-r877"
HHS_PAGE = "https://datahub.hhs.gov/Hospital/HHS-IDs/vz64-k9wr"
FAA_PAGE = (
    "https://www.faa.gov/airports/planning_capacity/passenger_allcargo_stats/passenger"
)
NASR_PAGE = "https://www.faa.gov/air_traffic/flight_info/aeronav/Aero_Data/NASR_Subscription/2026-11-26/"
INPUTS = {
    "cms.csv": (
        "https://data.cms.gov/provider-data/sites/default/files/resources/6af7c44d77436e5a1caac3ce39a83fe9_1792599556/Complications_and_Deaths-Hospital.csv",
        "3cacd2a3b81226b70c72274259a907526588ba558eec5e14fb411553babc735a",
    ),
    "hhs.json": (
        "https://datahub.hhs.gov/resource/vz64-k9wr.json?%24limit=50000&%24order=hhs_id",
        "13cac50adaf6b20f3c429f3671bf792bc22466310940b3fc394a4cda1067b66c",
    ),
    "enplanements.xlsx": (
        FAA_PAGE + "/arp-cy2025-commercial-service-enplanements.xlsx",
        "91c8d4457e9558b8bcb65c2a27cd9b95062e3c7b443e58e9714ba77942777b40",
    ),
    "airports.zip": (
        "https://nfdc.faa.gov/webContent/28DaySub/extra/26_Nov_2026_APT_CSV.zip",
        "eef99c93e896073f2f8634232346de44ff833cc0a5113ca89cae15daab5a854b",
    ),
}
# Each reviewed STS participant reported a numeric isolated-CABG composite for
# Jan 2023–Dec 2025 and listed exactly one associated hospital. The HHS ID
# identifies that named campus; a group that lists multiple hospitals cannot
# disambiguate a provider. Source URLs are exported alongside the directory.
STS_CAMPUS_REPORTS = {
    "C490021-A": ("11204", "Lynchburg General Hospital"),
    "C440063-A": ("12010", "Johnson City Medical Center"),
    "C140223-A": ("12606", "Advocate Lutheran General Hospital"),
    "C350019-A": ("13704", "Altru Hospital"),
    "C140117-A": ("30009", "Presence Resurrection Medical Center"),
    "C520138-C": ("30047", "Aurora St. Luke's Medical Center"),
    "C520098-B": ("30090", "University of Wisconsin Hospital and Clinics"),
    "C060031-A": ("30123", "Penrose Hospital"),
    "C360068-B": ("30420", "Toledo Hospital"),
    "C450058-A": ("30444", "Baptist Medical Center"),
    "C100044-A": (
        "30521",
        "Martin Memorial Medical Center d/b/a Cleveland Clinic Martin North Hospital",
    ),
    "C100154-A": ("30549", "MCVI at South Miami Hospital"),
    "C670025-B": ("30559", "Baylor Scott & White The Heart Hospital - Plano"),
    "C330005-A": ("30590", "Buffalo General Medical Center / Gates Vascular Institute"),
    "C100088-D": ("30636", "Baptist Medical Center - Jacksonville"),
    "C330024-B": ("30741", "The Mount Sinai Hospital"),
    "C050107-A": ("30984", "Marian Regional Medical Center"),
    "C670034-A": ("30998", "Baylor Scott & White Medical Center Round Rock"),
    "C100007-C": ("31065", "AdventHealth Orlando"),
}
STREET_WORDS = {
    "STREET": "ST",
    "ROAD": "RD",
    "COURT": "CT",
    "DRIVE": "DR",
    "LANE": "LN",
    "BOULEVARD": "BLVD",
    "AVENUE": "AVE",
    "PARKWAY": "PKWY",
    "HIGHWAY": "HWY",
    "CIRCLE": "CIR",
    "PLACE": "PL",
    "TERRACE": "TER",
    "CENTER": "CTR",
    "NORTH": "N",
    "SOUTH": "S",
    "WEST": "W",
    "EAST": "E",
    "ONE": "1",
    "NORTHWEST": "NW",
    "NORTHEAST": "NE",
    "SOUTHWEST": "SW",
    "SOUTHEAST": "SE",
}


def archived_file(cache, key):
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / key
    url, digest = INPUTS[key]
    if path.exists():
        raw = path.read_bytes()
    else:
        raw = subprocess.check_output(
            [
                "curl",
                "--fail",
                "--location",
                "--silent",
                "--show-error",
                "--retry",
                "2",
                "--max-time",
                "120",
                url,
            ]
        )
    if hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError(f"{key} differs from the reviewed release")
    if not path.exists():
        path.write_bytes(raw)
    return path


def source_files(keys):
    return [{"url": INPUTS[k][0], "sha256": INPUTS[k][1]} for k in keys]


def street_key(address):
    words = re.findall(r"[A-Z0-9]+", address.upper().replace(".", ""))
    return " ".join(STREET_WORDS.get(word, word) for word in words)


def address_key(street, state, zip_code):
    return street_key(street or ""), state, (zip_code or "")[:5]


def separation_miles(left, right):
    lon1, lat1, lon2, lat2 = map(math.radians, [*left, *right])
    a = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 3958.76 * 2 * math.asin(min(1, math.sqrt(a)))


def hospital_location(provider, sites):
    if not sites:
        return "noHhsRecord", None
    first = sites[0]
    reference = address_key(first.get("address"), first.get("state"), first.get("zip"))
    if any(
        address_key(s.get("address"), s.get("state"), s.get("zip")) != reference
        for s in sites
    ):
        return "multipleOrUnresolvedCampuses", None
    cms = address_key(provider["Address"], provider["State"], provider["ZIP Code"])
    city = provider["City/Town"].strip().upper()
    same_city = city and all(s.get("city", "").strip().upper() == city for s in sites)
    if (
        not cms[0]
        or cms[:2] != reference[:2]
        or not ((cms[2] and cms[2] == reference[2]) or same_city)
    ):
        return "addressMismatch", None
    coords = set()
    for site in sites:
        official = site.get("geocoded_hospital_address", {})
        if official.get("type") != "Point" or len(official.get("coordinates", [])) != 2:
            return "unverifiedCoordinates", None
        point = tuple(official["coordinates"])
        if not -180 <= point[0] <= 180 or not 0 < point[1] <= 90:
            return "unverifiedCoordinates", None
        # Cross-check HHS' published geocoder result against its source system.
        try:
            lat, lon = map(float, site["geohash"].split(","))
        except (KeyError, ValueError):
            return "unverifiedCoordinates", None
        if (
            not -180 <= lon <= 180
            or not 0 < lat <= 90
            or separation_miles(point, (lon, lat)) > 1
        ):
            return "unverifiedCoordinates", None
        coords.add(point)
    if len(coords) != 1:
        return "unverifiedCoordinates", None
    return "mapped", coords.pop()


def hospital_directory(cms, hhs):
    by_ccn = defaultdict(list)
    for site in hhs:
        if site.get("ccn"):
            by_ccn[site["ccn"]].append(site)
    campus_reports = {}
    counts = Counter()
    points = []
    states = set()
    seen = set()
    for row in cms:
        if row["State"] not in STATES or row["Measure ID"] != "MORT_30_CABG":
            continue
        denominator = row["Denominator"]
        if not denominator.isdecimal() or int(denominator) == 0:
            continue
        if (row["Start Date"], row["End Date"]) != ("07/01/2022", "06/30/2025"):
            raise ValueError("Unexpected CABG reporting period")
        ccn = row["Facility ID"]
        if ccn in seen:
            raise ValueError(f"Duplicate provider {ccn}")
        seen.add(ccn)
        sites = by_ccn[ccn]
        reason, coords = hospital_location(row, sites)
        name = row["Facility Name"]
        if reason == "multipleOrUnresolvedCampuses":
            for site in sites:
                report = STS_CAMPUS_REPORTS.get(site["hhs_id"])
                if not report:
                    continue
                campus_reason, campus_coords = hospital_location(row, [site])
                if campus_reason != "mapped":
                    raise ValueError(f"Cannot verify STS campus address for {ccn}")
                report_id, name = report
                campus_reports[site["hhs_id"]] = {
                    "hospital": name,
                    "url": f"https://publicreporting.sts.org/participant/{report_id}",
                }
                reason, coords = "mapped", campus_coords
                break
        counts[reason] += 1
        if coords:
            states.add(row["State"])
            name = f"{name} · {row['City/Town']}, {row['State']}"
            points.append([name, *[round(v, 6) for v in coords]])
    return {
        "title": "Hospitals reporting heart bypass surgery",
        "source": "Centers for Medicare & Medicaid Services, HHS and the Society of Thoracic Surgeons",
        "url": CMS_PAGE,
        "period": "July 2022–June 2025",
        "definition": (
            "Hospitals with a published positive case count for Medicare’s coronary artery bypass graft "
            "(CABG) mortality measure. Points mark verified provider addresses. For multi-campus providers, the Society of Thoracic Surgeons must identify the individual hospital in a single-site bypass report. "
            "Unresolved campuses and providers with suppressed case counts are omitted. "
            "Coverage is partial and describes historical procedures."
        ),
        "coverage": {
            "qualifyingProviders": len(seen),
            **dict(sorted(counts.items())),
            "statesAndDistrictMapped": sorted(states),
        },
        "sourceDetails": {
            "cmsRelease": "2026-11-12",
            "measure": "MORT_30_CABG",
            "locationSource": HHS_PAGE,
            "hhsLocationSnapshot": "2024-05-03",
            "locationMatch": "Matching CCN, normalized street, state and either city or five-digit ZIP. "
            "HHS must identify one physical address and point, or a reviewed STS report must isolate one campus. "
            "The HHS source-system and geocoded coordinates must agree within one mile.",
            "campusReportsPeriod": "January 2023–December 2025",
            "campusReportsReviewed": "2026-11-26",
            "campusReports": campus_reports,
            "uwHospitalAddressSource": "https://www.uwhealth.org/services/heart-care",
            "files": source_files(["cms.csv", "hhs.json"]),
        },
        "count": len(points),
        "fields": ["name", "lon", "lat"],
        "points": sorted(points),
    }


def airport_directory(enplanements, nasr):
    ranked = {
        r["Locid"]: r
        for r in enplanements
        if r["ST"] in STATES and r["S/L"] == "P" and r["Hub"] in {"S", "M", "L"}
    }
    madison = ranked["MSN"]
    if (madison["ST"], madison["Hub"], madison["CY 25 Enplanements"]) != (
        "WI",
        "S",
        1226462,
    ):
        raise ValueError("FAA Madison benchmark changed")
    points = []
    seen = set()
    for row in nasr:
        code = row["ARPT_ID"]
        if code not in ranked or row["SITE_TYPE_CODE"] != "A":
            continue
        if row["EFF_DATE"] != "2026/11/26" or row["ARPT_STATUS"] != "O" or code in seen:
            raise ValueError(f"Expected one open, current airport for {code}")
        seen.add(code)
        source = ranked[code]
        lon, lat = float(row["LONG_DECIMAL"]), float(row["LAT_DECIMAL"])
        if not -180 <= lon <= 180 or not 0 < lat <= 90:
            raise ValueError(f"Invalid coordinate for {code}")
        name = f"{source['Airport Name']} ({code}) · {source['City']}, {source['ST']}"
        points.append([name, round(lon, 6), round(lat, 6)])
    if seen != ranked.keys():
        raise ValueError(
            f"Missing FAA airport coordinates for {sorted(ranked.keys() - seen)}"
        )
    return {
        "title": "Small, medium and large hub airports",
        "source": "Federal Aviation Administration",
        "url": FAA_PAGE,
        "period": "2025 passenger boardings",
        "definition": "FAA small, medium and large primary commercial-service hubs in the 50 states "
        "and DC. Madison, Wisconsin (MSN), was a small hub with 1,226,462 passenger boardings in 2025. "
        "Distances use the FAA airport reference point.",
        "coverage": {
            "mapped": len(points),
            "byHubSize": dict(Counter(r["Hub"] for r in ranked.values())),
        },
        "sourceDetails": {
            "airportCategories": "https://www.faa.gov/airports/planning_capacity/categories",
            "locationSource": NASR_PAGE,
            "locationEffectiveDate": "2026-11-26",
            "files": source_files(["enplanements.xlsx", "airports.zip"]),
        },
        "count": len(points),
        "fields": ["name", "lon", "lat"],
        "points": sorted(points),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cache",
        type=Path,
        default=Path(tempfile.gettempdir()) / "home-range-hospital-airport-data",
    )
    args = parser.parse_args()
    with archived_file(args.cache, "cms.csv").open(
        encoding="utf-8-sig", newline=""
    ) as f:
        hospitals = hospital_directory(
            csv.DictReader(f),
            json.loads(archived_file(args.cache, "hhs.json").read_bytes()),
        )
    book = load_workbook(
        archived_file(args.cache, "enplanements.xlsx"), read_only=True, data_only=True
    )
    try:
        rows = iter(book.active.values)
        header = next(rows)
        with (
            ZipFile(archived_file(args.cache, "airports.zip")) as archive,
            archive.open("APT_BASE.csv") as source,
        ):
            airports = airport_directory(
                (dict(zip(header, row)) for row in rows),
                csv.DictReader(io.TextIOWrapper(source, encoding="utf-8-sig")),
            )
    finally:
        book.close()
    OUTPUT.mkdir(exist_ok=True, parents=True)
    for key, directory in (("hospitals", hospitals), ("airports", airports)):
        (OUTPUT / f"{key}.json").write_text(
            json.dumps(directory, ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        print(key, directory["coverage"])


if __name__ == "__main__":
    main()
