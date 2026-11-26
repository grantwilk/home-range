"""Verify the bundled FEMA snapshot and importer without downloading any inputs."""

import json
import sys
import unittest
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "scripts"))
import hazards


class HazardSnapshot(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads((PROJECT / "data/hazards.json").read_text())

    def pair(self, county, field):
        i = self.data["fields"].index(field)
        row = self.data["counties"][county]
        return row["scores"][i], self.data["ratingLabels"][row["ratings"][i]]

    def test_release_schema_and_exact_fips_coverage(self):
        atlas = {
            c["id"]
            for c in json.loads((PROJECT / "data/geography.json").read_text())[
                "counties"
            ]
        }
        fields = self.data["fields"]
        self.assertEqual(fields[0], "RISK_SCORE")
        self.assertEqual(
            set(fields[1:]),
            {
                abbr + "_RISKS"
                for abbr in (
                    "AVLN",
                    "CFLD",
                    "CWAV",
                    "DRGT",
                    "ERQK",
                    "HAIL",
                    "HWAV",
                    "HRCN",
                    "ISTM",
                    "IFLD",
                    "LNDS",
                    "LTNG",
                    "SWND",
                    "TRND",
                    "TSUN",
                    "VLCN",
                    "WFIR",
                    "WNTW",
                )
            },
        )
        self.assertEqual(len(fields), 19)
        self.assertEqual(self.data["period"], "December 2025")
        self.assertEqual(self.data["version"], "1.20.0")
        self.assertEqual(self.data["sha256"], hazards.SHA256)
        self.assertEqual(len(self.data["counties"]), 3133)
        self.assertEqual(
            set(self.data["counties"]) | set(self.data["unmatched"]), atlas
        )
        self.assertEqual(atlas - set(self.data["counties"]), hazards.UNMATCHED)
        self.assertTrue(
            set(self.data["counties"]).isdisjoint({"02063", "02066", "09110", "72001"})
        )

    def test_published_county_examples_and_null_reasons(self):
        self.assertEqual(self.pair("06037", "RISK_SCORE"), (100, "Very High"))
        self.assertEqual(self.pair("17031", "IFLD_RISKS"), (99.94, "Very High"))
        self.assertEqual(self.pair("12086", "CFLD_RISKS"), (99.6, "Very High"))
        self.assertEqual(self.pair("06037", "WFIR_RISKS"), (99.94, "Very High"))
        self.assertEqual(self.pair("02013", "CFLD_RISKS"), (0, "No Rating"))
        self.assertEqual(self.pair("01003", "TSUN_RISKS"), (None, "Insufficient Data"))
        self.assertEqual(self.pair("17031", "VLCN_RISKS"), (None, "Not Applicable"))

    def test_all_scores_and_ratings_round_trip_without_status_loss(self):
        labels = self.data["ratingLabels"]
        for row in self.data["counties"].values():
            self.assertEqual(len(row["scores"]), 19)
            self.assertEqual(len(row["ratings"]), 19)
            for score, index in zip(row["scores"], row["ratings"], strict=True):
                self.assertTrue(0 <= index < len(labels))
                label = labels[index]
                self.assertEqual(
                    score is None, label in ("Not Applicable", "Insufficient Data")
                )
                self.assertEqual(score == 0, label == "No Rating")
                if score is not None:
                    self.assertTrue(0 <= score <= 100)
                    self.assertEqual(score, round(score, 2))

    def test_corrupted_archive_or_contradictory_input_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "checksum"):
            hazards.build(b"changed archive", [])
        for raw, label in [
            ("0", "Very Low"),
            ("", "No Rating"),
            ("2", "Not Applicable"),
            ("NaN", "Very Low"),
            ("-1", "Very Low"),
            ("101", "Very High"),
            ("1", "bogus"),
        ]:
            with self.subTest(raw=raw, label=label), self.assertRaises(ValueError):
                hazards.score_and_rating(raw, label)
        self.assertEqual(hazards.score_and_rating("12.345", "Very Low")[0], 12.35)


if __name__ == "__main__":
    unittest.main()
