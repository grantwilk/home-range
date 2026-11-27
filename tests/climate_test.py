"""Offline ingestion regressions. Run with uv run --with duckdb==2.0.1 tests/climate_test.py."""

import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from build_climate import cold_histograms, summarize_month


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

    def test_strict_cold_thresholds_and_dc_identifier(self):
        db = duckdb.connect()
        # -40°C equals -40°F. The two values near -34.44°C straddle -30°F.
        # Zero Celsius equals 32°F, and lows beyond either endpoint still count once.
        temperatures = [-51.12, -40.01, -40, -39.99, -34.45, -34.44, -0.01, 0, 0.01, 16]
        db.execute(
            """
            CREATE TABLE daily AS SELECT '24511' AS fips,
               'MD' AS postal_code, 'DC: District of Columbia' AS region_name,
               'cty' AS region_type, date '1991-01-01' + n::INT AS date, tmin
            FROM unnest(?) WITH ORDINALITY AS lows(tmin, n)
        """,
            [temperatures],
        )
        with tempfile.TemporaryDirectory() as temp:
            file = Path(temp) / "sample.parquet"
            db.table("daily").to_parquet(str(file))
            self.assertEqual(
                cold_histograms(db, [file]),
                {
                    "11001": {
                        -60: 1,
                        -40: 1,
                        -39: 2,
                        -30: 1,
                        -29: 1,
                        32: 1,
                        33: 2,
                        61: 1,
                    }
                },
            )

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
            self.assertEqual("coldDays" in county, "heatDays" in county)
            if "heatDays" in county:
                self.assertEqual(len(county["coldDays"]), 121)
                self.assertEqual(county["coldDays"], sorted(county["coldDays"]))
                self.assertGreaterEqual(county["coldDays"][0], 0)
                self.assertLessEqual(county["coldDays"][-1], round(10958 / 30, 1))
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

    def test_monthly_threshold_files_and_daily_source_counts(self):
        data = json.loads((ROOT / "data/climate.json").read_text())["counties"]
        expected = {fips for fips, record in data.items() if "wetDays" in record}
        for month in range(1, 13):
            path = ROOT / "data/monthly-days" / f"{month:02}.json.gz"
            with gzip.open(path, "rt") as source:
                table = json.load(source)
            self.assertEqual(table["month"], month)
            self.assertEqual(set(table["counties"]), expected)
            for hot, cold in table["counties"].values():
                self.assertEqual(len(hot), 51)
                self.assertEqual(len(cold), 121)
                self.assertEqual(hot, sorted(hot, reverse=True))
                self.assertEqual(cold, sorted(cold))
                self.assertTrue(
                    0 <= min(hot[-1], cold[0]) <= max(hot[0], cold[-1]) <= 31
                )
            # Direct comparisons against all daily rows from Dane County's
            # 30 January, July, and November records (90 F highs, 0 F lows).
            if month in [1, 7, 11]:
                hot, cold = table["counties"]["55025"]
                actual = (hot[30], cold[60], data["55025"]["monthlyWetDays"][month - 1])
                self.assertEqual(
                    actual,
                    {1: (0, 7.5, 9.1), 7: (2.8, 0, 11.9), 11: (0, 0, 8.9)}[month],
                )

    def test_independent_spot_checks(self):
        # Independent scans of all dated source rows (July and January
        # have fixed lengths), plus NOAA's Honolulu monthly Fahrenheit records.
        data = json.loads((ROOT / "data/climate.json").read_text())["counties"]
        # Direct comparisons against daily Fahrenheit lows across all 10,958
        # dates at -30°F, 0°F and 32°F, independent of the cumulative histogram.
        for fips, expected in {
            "27077": (3.0, 55.9, 188.8),
            "55025": (0.1, 15.8, 147.5),
            "11001": (0.0, 0.2, 81.3),
            "04013": (0.0, 0.0, 4.8),
        }.items():
            self.assertEqual(
                tuple(data[fips]["coldDays"][t + 60] for t in (-30, 0, 32)), expected
            )
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
