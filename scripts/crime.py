# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Build the two county rates from checksum-verified County Health Rankings CSVs."""

import argparse
import csv
import hashlib
import io
import json
import math
import subprocess
import tempfile
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data"
MEDIA = "https://www.countyhealthrankings.org/sites/default/files/media/document/"
VIOLENT_CSV = MEDIA + "analytic_data2022.csv"
VIOLENT_SHA = "0135f89bf7d3929105b1aa1427da8a93a2e9f6d57d479aad70428d4ff02fa822"
HOMICIDE_CSV = MEDIA + "analytic_supplement_20251104.csv"
HOMICIDE_SHA = "68f124101f56e9eec88299e55d29ccd5e59270d7dac91ac1c01fc21434a6ec3a"


def read_source(url, expected, local):
    if local:
        raw = local.read_bytes()
    else:
        raw = subprocess.check_output(
            [
                "curl",
                "--fail",
                "--silent",
                "--show-error",
                "--location",
                "--retry",
                "3",
                "--max-time",
                "120",
                url,
            ]
        )
    if hashlib.sha256(raw).hexdigest() != expected:
        raise ValueError(
            f"County Health Rankings source changed. Review {url} before rebuilding."
        )
    return io.StringIO(raw.decode("utf-8-sig"), newline="")


def county_rates(rows, ids, measure):
    """Copy the published rate. Use the published totals only to verify its units."""
    result = dict.fromkeys(sorted(ids))
    seen = set()
    for row in csv.DictReader(rows):
        if row["countycode"] == "000":
            continue
        fips = row["fipscode"]
        if (
            fips != row["statecode"] + row["countycode"]
            or len(fips) != 5
            or not fips.isdigit()
            or fips in seen
        ):
            raise ValueError(f"Unexpected or duplicate CHR county identifier: {fips}")
        seen.add(fips)
        if fips not in result:
            continue
        if measure == "v043":
            if row["year"] != "2022":
                raise ValueError(f"Unexpected violent-crime release year for {fips}")
        elif row["supplement"] != "11/4/2025":
            raise ValueError(f"Unexpected homicide data release date for {fips}")
        raw = row[f"{measure}_rawvalue"].strip()
        if not raw:
            continue
        rate = Decimal(raw)
        count = Decimal(row[f"{measure}_numerator"])
        population = Decimal(row[f"{measure}_denominator"])
        if not rate.is_finite() or rate < 0 or population <= 0 or count < 0:
            raise ValueError(f"Invalid {measure} rate or denominator for {fips}")
        if not math.isclose(
            rate, 100000 * count / population, rel_tol=1e-8, abs_tol=1e-8
        ):
            raise ValueError(
                f"Published {measure} rate does not agree with units for {fips}"
            )
        if measure == "v015" and count < 10:
            raise ValueError(
                f"Unexpected unsuppressed homicide count below 10 for {fips}"
            )
        result[fips] = float(rate.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))
    return result


def build(violence, mortality, geography):
    ids = {c["id"] for c in geography}
    if len(ids) != 3142 or len(geography) != len(ids):
        raise ValueError("Expected a complete map of the 2017 county identifiers")
    # The 2022 annual CSV has one descriptive header before its machine-readable header.
    next(violence)
    violent = county_rates(violence, ids, "v043")
    homicide = county_rates(mortality, ids, "v015")
    coverage = sum(x is not None for x in violent.values())
    homicide_coverage = sum(x is not None for x in homicide.values())
    return {
        "period": "2014 and 2016",
        "source": "County Health Rankings & Roadmaps, 2022 Annual Data Release; FBI Uniform Crime Reporting",
        "sourceUrl": VIOLENT_CSV,
        "documentation": MEDIA + "2022%20Analytic%20Documentation.pdf",
        "sha256": VIOLENT_SHA,
        "measureUrl": MEDIA + "Trends%20documentation%202022.pdf#page=18",
        "field": "v043_rawvalue",
        "unit": "reported violent offenses per 100,000 residents per year",
        "definition": "Annual rate of violent crimes reported to participating law enforcement agencies in 2014 and 2016, using the population covered by reporting agencies. The rate includes homicide, forcible rape, robbery, and aggravated assault. Agency participation and reporting practices vary. County Health Rankings advises against comparisons across states.",
        "coverage": coverage,
        "missing": len(ids) - coverage,
        "counties": violent,
        "homicideMetadata": {
            "period": "2017–2023",
            "source": "County Health Rankings & Roadmaps, November 4, 2025 Supplemental Data Release; National Center for Health Statistics mortality files and Census Population Estimates Program",
            "sourceUrl": HOMICIDE_CSV,
            "documentation": MEDIA
            + "Analytic%20Dataset%20Codebook%20Supplemental%20Release_November2025.pdf",
            "measureUrl": "https://www.countyhealthrankings.org/health-data/community-conditions/social-and-economic-factors/safety-and-social-support/homicides",
            "sha256": HOMICIDE_SHA,
            "field": "v015_rawvalue",
            "unit": "homicide deaths per 100,000 residents per year",
            "definition": "Annual homicide death rate by county of residence, using death certificates for 2017–2023 and the sum of annual population estimates. The publisher withholds county rates with fewer than 10 deaths over the seven years.",
            "coverage": homicide_coverage,
            "missing": len(ids) - homicide_coverage,
        },
        "homicide": homicide,
        "method": "Rates use published county values rounded to the nearest tenth. Exact five-digit FIPS codes join the 2017 map to each release. Blank rates and unmatched county identifiers remain null.",
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--violent-csv", type=Path, help="Use the official 2022 CSV already on disk."
    )
    p.add_argument(
        "--homicide-csv",
        type=Path,
        help="Use the original November 4, 2025 supplemental CSV already on disk.",
    )
    p.add_argument("--output", type=Path, default=DATA / "crime.json")
    args = p.parse_args()
    result = build(
        read_source(VIOLENT_CSV, VIOLENT_SHA, args.violent_csv),
        read_source(HOMICIDE_CSV, HOMICIDE_SHA, args.homicide_csv),
        json.loads((DATA / "geography.json").read_text())["counties"],
    )
    with tempfile.NamedTemporaryFile(
        dir=args.output.parent, delete=False, mode="w", encoding="utf-8"
    ) as tmp:
        path = Path(tmp.name)
        try:
            json.dump(
                result, tmp, ensure_ascii=False, allow_nan=False, separators=(",", ":")
            )
            tmp.write("\n")
        except BaseException:
            path.unlink(missing_ok=True)
            raise
    path.chmod(0o644)
    path.replace(args.output)
    print(
        f"{result['coverage']:,} violent crime rates and {result['homicideMetadata']['coverage']:,} homicide rates."
    )


if __name__ == "__main__":
    main()
