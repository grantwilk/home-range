# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Build county risk scores from FEMA's December 2025 National Risk Index.

Run uv run scripts/hazards.py, or pass --archive PATH to use a downloaded ZIP.
"""

import argparse
import csv
import hashlib
import io
import json
import re
import tempfile
import urllib.request
import zipfile
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data"
SOURCE = "https://www.fema.gov/flood-maps/products-tools/national-risk-index"
ARCHIVE_URL = "https://www.fema.gov/about/reports-and-data/openfema/nri/v120/NRI_Table_Counties.zip"
SHA256 = "b99dae90a317b16630d7f9b1faa4a2784d5ca458761c1d3ab9646f046df9d072"
PERIOD = "December 2025"
VERSION = "1.20.0"
RATING_LABELS = (
    "Very Low",
    "Relatively Low",
    "Relatively Moderate",
    "Relatively High",
    "Very High",
    "No Rating",
    "Not Applicable",
    "Insufficient Data",
)
UNMATCHED = {
    "02261",
    "09001",
    "09003",
    "09005",
    "09007",
    "09009",
    "09011",
    "09013",
    "09015",
}


def csv_rows(archive, name):
    with (
        archive.open(name) as raw,
        io.TextIOWrapper(raw, encoding="utf-8-sig", newline="") as text,
    ):
        yield from csv.DictReader(text)


def score_and_rating(raw, label):
    """Keep the release's actual score, including zero, and its separate classification."""
    index = RATING_LABELS.index(label)
    if not raw:
        if label not in {"Not Applicable", "Insufficient Data"}:
            raise ValueError(f"Unexpected blank score rated {label}")
        return None, index
    score = Decimal(raw)
    if not score.is_finite() or not 0 <= score <= 100:
        raise ValueError(f"Invalid risk score {raw}")
    if label in {"Not Applicable", "Insufficient Data"} or (score == 0) != (
        label == "No Rating"
    ):
        raise ValueError(f"Unexpected paired score/rating: {raw}, {label}")
    return float(score.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)), index


def build(archive_bytes, atlas):
    if hashlib.sha256(archive_bytes).hexdigest() != SHA256:
        raise ValueError(
            "FEMA archive checksum changed. Verify the source release before rebuilding."
        )
    atlas_ids = {c["id"] for c in atlas}
    if len(atlas_ids) != len(atlas):
        raise ValueError("Duplicate atlas county identifier")
    counties = {}
    seen = set()
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        info = list(csv_rows(archive, "NRI_HazardInfo.csv"))
        fields = ["RISK_SCORE"] + [r["Prefix"] + "_RISKS" for r in info]
        rating_fields = ["RISK_RATNG"] + [r["Prefix"] + "_RISKR" for r in info]
        if len(set(fields)) != 19 or any(r["NRI_VER"] != PERIOD for r in info):
            raise ValueError("FEMA hazard inventory changed")
        dictionary = {
            r["Field Name"]: r for r in csv_rows(archive, "NRIDataDictionary.csv")
        }
        for field in fields + rating_fields:
            if dictionary[field]["Version"] != VERSION:
                raise ValueError(f"Unexpected data dictionary version for {field}")
        for row in csv_rows(archive, "NRI_Table_Counties.csv"):
            fips = row["STCOFIPS"]
            if (
                not re.fullmatch(r"[0-9]{5}", fips)
                or fips in seen
                or row["NRI_VER"] != PERIOD
            ):
                raise ValueError(
                    f"Invalid/duplicate county or wrong FEMA vintage: {fips}"
                )
            seen.add(fips)
            if fips not in atlas_ids:
                continue
            pairs = [
                score_and_rating(row[k], row[r])
                for k, r in zip(fields, rating_fields, strict=True)
            ]
            scores, ratings = zip(*pairs, strict=True)
            counties[fips] = {"scores": scores, "ratings": ratings}
    unmatched = atlas_ids - seen
    if len(seen) != 3232 or unmatched != UNMATCHED:
        raise ValueError(
            "County coverage changed. Review FEMA and map boundary vintages."
        )
    return {
        "title": "FEMA National Risk Index",
        "period": PERIOD,
        "version": VERSION,
        "credit": "Federal Emergency Management Agency (FEMA), National Risk Index county release, December 2025.",
        "source": SOURCE,
        "sourceFile": ARCHIVE_URL,
        "sha256": SHA256,
        "documentation": "https://www.fema.gov/sites/default/files/documents/fema_national-risk-index_technical-documentation.pdf",
        "fields": fields,
        "hazardPeriods": {r["Prefix"] + "_RISKS": r["PeriodOfRecord"] for r in info},
        "ratingLabels": RATING_LABELS,
        "sourceCountyCount": len(seen),
        "coverage": len(counties),
        "unmatched": sorted(unmatched),
        "method": "Published county risk scores and ratings for the composite and 18 hazards. The index combines expected annual loss with social vulnerability and community resilience. Higher scores represent greater relative risk. Scores are rounded to two decimal places. FEMA's numeric zero and No Rating are preserved, and blank scores retain their Not Applicable or Insufficient Data classification. Exact identifier joins use the atlas's 2017 county boundaries. Eight former Connecticut counties and Alaska's former Valdez–Cordova Census Area lack matching FEMA identifiers. The release date identifies the dataset vintage; hazard observation periods vary.",
        "counties": dict(sorted(counties.items())),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--archive", type=Path, help="Use the official county ZIP already on disk."
    )
    parser.add_argument("--output", type=Path, default=DATA / "hazards.json")
    args = parser.parse_args()
    if args.archive:
        contents = args.archive.read_bytes()
    else:
        with urllib.request.urlopen(ARCHIVE_URL, timeout=120) as response:
            contents = response.read()
    result = build(
        contents, json.loads((DATA / "geography.json").read_text())["counties"]
    )
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=args.output.parent, delete=False
    ) as tmp:
        json.dump(
            result, tmp, ensure_ascii=False, separators=(",", ":"), allow_nan=False
        )
        tmp.write("\n")
        name = Path(tmp.name)
    name.chmod(0o644)  # Published site assets must be readable by the web server.
    name.replace(args.output)
    print(
        f"{result['coverage']:,} counties, {len(result['fields'])} fields, {len(result['unmatched'])} unmatched boundaries."
    )


if __name__ == "__main__":
    main()
