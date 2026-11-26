# /// script
# requires-python = ">=3.11"
# dependencies = ["openpyxl==3.1.5"]
# ///
"""Check facility coverage, positive surgery evidence and physical campus matching."""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from facilities_hospitals_airports import STATES, hospital_directory, hospital_location


class HospitalAirportTests(unittest.TestCase):
    def setUp(self):
        self.provider = {
            "Facility ID": "123456",
            "Facility Name": "Sample Hospital",
            "Address": "101 MAIN STREET",
            "State": "WI",
            "ZIP Code": "53705",
            "City/Town": "MADISON",
            "Measure ID": "MORT_30_CABG",
            "Denominator": "26",
            "Start Date": "07/01/2022",
            "End Date": "06/30/2025",
        }
        self.site = {
            "ccn": "123456",
            "hhs_id": "C123456-A",
            "address": "101 MAIN ST",
            "state": "WI",
            "zip": "53705",
            "city": "MADISON",
            "geohash": "43.07,-89.43",
            "geocoded_hospital_address": {
                "type": "Point",
                "coordinates": [-89.43, 43.07],
            },
        }

    def test_require_positive_published_case_count_and_right_measure(self):
        samples = [dict(self.provider, Denominator=v) for v in ["Not Available", "0"]]
        samples.append(dict(self.provider, **{"Measure ID": "MORT_30_AMI"}))
        self.assertFalse(hospital_directory(samples, [self.site])["points"])
        self.assertEqual(hospital_directory([self.provider], [self.site])["count"], 1)

    def test_multicampus_and_inconsistent_addresses_or_coordinates(self):
        second = dict(self.site, address="102 MAIN ST", hhs_id="C123456-B")
        self.assertEqual(
            hospital_directory([self.provider], [self.site, second])["count"], 0
        )
        for changes in [
            {"address": "99 MAIN ST"},
            {"zip": "53718", "city": "MIDDLETON"},
            {"geohash": "-89.43,43.07"},
            {"geohash": "42,-88"},
        ]:
            self.assertIsNone(
                hospital_location(self.provider, [dict(self.site, **changes)])[1]
            )
        self.assertEqual(
            hospital_location(self.provider, [dict(self.site, zip="53706")])[0],
            "mapped",
        )

    def test_published_geographic_benchmarks(self):
        airports = self.directory("airports")
        self.assertEqual(airports["coverage"]["byHubSize"], {"S": 77, "M": 34, "L": 30})
        for code, lon, lat in [
            ("MSN", -89.337504, 43.139879),
            ("ORD", -87.90815, 41.97694),
        ]:
            matches = [r[1:] for r in airports["points"] if f"({code})" in r[0]]
            self.assertEqual(matches, [[lon, lat]])
        self.assertFalse(any("(SJU)" in r[0] for r in airports["points"]))

        hospitals = self.directory("hospitals")
        coverage = hospitals["coverage"]
        self.assertEqual(set(coverage["statesAndDistrictMapped"]), STATES)
        self.assertEqual(coverage["qualifyingProviders"], 861)
        self.assertEqual(coverage["mapped"], 614)
        self.assertEqual(
            sum(
                coverage[k]
                for k in [
                    "mapped",
                    "multipleOrUnresolvedCampuses",
                    "noHhsRecord",
                    "addressMismatch",
                    "unverifiedCoordinates",
                ]
            ),
            coverage["qualifyingProviders"],
        )
        self.assertIn(
            ["RHODE ISLAND HOSPITAL · PROVIDENCE, RI", -71.409401, 41.811347],
            hospitals["points"],
        )
        self.assertIn(
            [
                "University of Wisconsin Hospital and Clinics · MADISON, WI",
                -89.431544,
                43.077187,
            ],
            hospitals["points"],
        )
        self.assertEqual(
            hospitals["sourceDetails"]["campusReports"]["C520098-B"]["url"],
            "https://publicreporting.sts.org/participant/30090",
        )
        for d in [airports, hospitals]:
            self.assertEqual(d["count"], len(d["points"]))
            self.assertEqual(d["count"], len({(x, y) for _, x, y in d["points"]}))
            self.assertEqual(d["fields"], ["name", "lon", "lat"])

    @staticmethod
    def directory(key):
        return json.loads((ROOT / "data" / "facilities" / (key + ".json")).read_text())


if __name__ == "__main__":
    unittest.main()
