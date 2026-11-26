import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { countyHazards, hazardLayers } from "../hazards.js";
import { outcome, freshFilter, parseView, countyReading } from "../model.js";

const data = JSON.parse(
  readFileSync(new URL("../data/hazards.json", import.meta.url)),
);
function county(fips) {
  const { values, ratings } = countyHazards(data, fips);
  return { values, hazardRatings: ratings };
}
const range = (key, min, max) => ({ ...freshFilter(key, true), min, max });

test("the hazard catalog offers each national risk field exactly once", () => {
  assert.deepEqual(Object.keys(hazardLayers).sort(), [...data.fields].sort());
  assert.equal(data.fields.length, 19);
  assert.equal(Object.keys(data.counties).length, 3133);
});
test("hurricane filtering distinguishes a real zero, an inapplicable hazard, and a boundary mismatch", () => {
  const zero = range("HRCN_RISKS", 0, 0);
  const positive = range("HRCN_RISKS", 0.01, 100);
  for (const mode of ["all", "any"]) {
    for (const [fips, noRisk, ranked] of [
      ["06037", true, false],
      ["02020", true, false],
      ["55025", false, true],
      ["09001", null, null],
    ]) {
      assert.equal(outcome(county(fips), [zero], mode), noRisk);
      assert.equal(outcome(county(fips), [positive], mode), ranked);
    }
  }
  assert.match(countyReading(county("06037"), zero.key), /^0 \/ 100/);
  assert.equal(countyReading(county("02020"), zero.key), "Not applicable");
  assert.equal(
    countyReading(county("09001"), zero.key),
    "No matching county boundary",
  );
});
test("hazard percentiles round-trip at hundredth precision and unknowns combine with other filters", () => {
  const tsunami = range("TSUN_RISKS", 96.92, 96.92);
  assert.deepEqual(
    parseView({ county: [tsunami], layer: tsunami.key }).county,
    [tsunami],
  );
  assert.equal(outcome(county("41007"), [tsunami], "all"), true);
  assert.equal(
    countyReading(county("41007"), tsunami.key),
    "96.92 / 100 · Very High",
  );
  const miami = county("12086");
  assert.equal(countyReading(miami, tsunami.key), "Insufficient data");
  for (const [other, min, max, all, any] of [
    ["RISK_SCORE", 99, 100, null, true],
    ["HRCN_RISKS", 0, 20, false, null],
  ]) {
    const filters = [tsunami, range(other, min, max)];
    assert.equal(outcome(miami, filters, "all"), all);
    assert.equal(outcome(miami, filters, "any"), any);
  }
});
