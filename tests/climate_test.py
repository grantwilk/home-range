"""Offline ingestion regressions. Run with uv run --with duckdb==2.0.1 tests/climate_test.py."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from build_climate import summarize_month


class ClimateDataTests(unittest.TestCase):
    def test_thresholds_calendar_padding_and_rejected_rows(self):
        # A tiny complete February, an incomplete month, a duplicate date,
        # and a sentinel in an otherwise complete county-month.
        db = duckdb.connect()
        db.execute("""
            CREATE TABLE daily AS
            SELECT id AS fips, 'cty' AS region_type, '' AS postal_code,
                   '' AS region_name, date '1991-02-01' + i::INT AS date,
                   '30.00' AS tmax, '12' AS tmin, '21' AS tavg,
                   CASE WHEN i=0 THEN '0.25' ELSE '0.26' END AS prcp
            FROM (VALUES ('01001'),('01003'),('01005'),('01007')) c(id), range(28) d(i)
        """)
        db.execute("DELETE FROM daily WHERE fips='01003' AND date=date '1991-02-07'")
        db.execute("INSERT INTO daily SELECT * FROM daily WHERE fips='01005' LIMIT 1")
        db.execute(
            "UPDATE daily SET tmin='-999.99' WHERE fips='01007' AND date=date '1991-02-01'"
        )
        db.execute(
            "INSERT INTO daily VALUES ('01001','cty','','',NULL,'-999.99','-999.99','-999.99','-999.99')"
        )
        with tempfile.TemporaryDirectory() as temp:
            file = Path(temp) / "sample.parquet"
            db.table("daily").to_parquet(str(file))
            rows = summarize_month(db, file, 1991, 2)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][:6], ("01001", 12, 30, 21, 27, 1))
        self.assertEqual(rows[0][6 + 86 - 60], 28)
        self.assertEqual(rows[0][6 + 87 - 60], 0)

    def test_shipped_coverage_and_invariants(self):
        data = json.loads((ROOT / "data/climate.json").read_text())["counties"]
        geo = {
            c["id"]
            for c in json.loads((ROOT / "data/geography.json").read_text())["counties"]
        }
        for county in data.values():
            self.assertEqual(county["janLow"], county["monthlyLow"][0])
            self.assertEqual(county["julHigh"], county["monthlyHigh"][6])
            self.assertEqual(
                county["coldLow"], county["monthlyLow"][county["coldMonth"] - 1]
            )
            self.assertEqual(
                county["hotHigh"], county["monthlyHigh"][county["hotMonth"] - 1]
            )
            self.assertTrue(
                all(
                    l <= h
                    for l, h in zip(
                        county["monthlyLow"], county["monthlyHigh"], strict=True
                    )
                )
            )
            if "heatDays" in county:
                self.assertEqual(len(county["heatDays"]), 51)
                self.assertEqual(
                    county["heatDays"], sorted(county["heatDays"], reverse=True)
                )
                self.assertAlmostEqual(
                    county["wetDays"] + county["dryDays"], 10958 / 30, delta=0.11
                )
        self.assertEqual(len([f for f in geo if "heatDays" in data.get(f, {})]), 3107)
        self.assertEqual(geo - data.keys(), {"02261", "51678"})
        self.assertNotIn("wetDays", data["15003"])
        self.assertNotIn("heatDays", data["02020"])

    def test_independent_spot_checks(self):
        # Independent scans of all dated source rows (July and January
        # have fixed lengths), plus NOAA's Honolulu monthly Fahrenheit records.
        data = json.loads((ROOT / "data/climate.json").read_text())["counties"]
        self.assertEqual(data["15003"]["janLow"], 63.1)
        for fips, expected in {
            "01001": (35.0, 91.7, 68.9, 116.2),
            "04013": (40.7, 104.5, 159.0, 53.2),
            "11001": (26.4, 88.2, 29.6, 128.4),
            "53033": (31.9, 72.4, 0.6, 212.7),
        }.items():
            c = data[fips]
            self.assertEqual(
                (c["janLow"], c["julHigh"], c["heatDays"][30], c["wetDays"]), expected
            )


if __name__ == "__main__":
    unittest.main()
