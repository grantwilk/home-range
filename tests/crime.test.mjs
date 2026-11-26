import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  countyReading,
  freshFilter,
  layers,
  outcome,
  parseView,
} from "../model.js";
import { readViewUrl, writeViewUrl } from "../view-url.js";

const key = "violentCrimeRate";
const readData = (name) =>
  JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url)));
const { counties, homicide } = readData("crime");
const geography = new Set(
  readData("geography").counties.map((county) => county.id),
);
const place = (id) => ({
  values: { [key]: counties[id], homicideRate: homicide[id] },
});

test("the county map preserves the published crime rates, zeros, and gaps", () => {
  // County Health Rankings 2022 analytic CSV, county rows of v043_rawvalue.
  // https://www.countyhealthrankings.org/sites/default/files/media/document/analytic_data2022.csv
  for (const id of Object.keys(counties)) assert.ok(geography.has(id), id);
  const all = [...geography].map((id) => counties[id]);
  const known = all.filter(Number.isFinite);
  assert.equal(known.length, 2951);
  assert.equal(known.filter((rate) => rate === 0).length, 40);
  assert.equal(all.filter((rate) => rate == null).length, 191);
  assert.equal(Math.min(...known), 0);
  assert.equal(Math.max(...known), 1819.5);
  for (const [id, expected] of [
    ["55025", 227], // Dane County, WI
    ["17031", 619.8], // Cook County, IL
    ["29510", 1819.5], // St. Louis city, MO
    ["02261", 315.6], // Former Valdez-Cordova Census Area, AK
    ["55078", 0], // Menominee County, WI
    ["15005", null], // Kalawao County, HI
  ])
    assert.equal(counties[id] ?? null, expected, id);
});

test("homicide mortality keeps its source geography, published rates, and suppressed values", () => {
  // CHR November 2025 supplement, v015_rawvalue. Dane's 89 deaths over
  // 3,885,512 resident-years give 2.3 deaths per 100,000 residents per year.
  for (const id of Object.keys(homicide)) assert.ok(geography.has(id), id);
  const all = [...geography].map((id) => homicide[id]);
  const valid = all.filter(Number.isFinite);
  assert.equal(valid.length, 1447);
  assert.equal(all.filter((rate) => rate == null).length, 1695);
  assert.equal(Math.max(...valid), 62.8);
  for (const [id, expected] of [
    ["55025", 2.3],
    ["17031", 16.2],
    ["29510", 49.7],
    ["09001", 3.0], // The supplement retains the historical Connecticut counties.
    ["55078", null], // Suppressed, despite the published zero in the police measure.
    ["02261", null], // This Alaska boundary has no corresponding supplement row.
  ])
    assert.equal(homicide[id] ?? null, expected, id);
});

test("an inclusive crime range keeps its precision through sharing and separates zero from missing", () => {
  const metric = layers[key];
  assert.equal(metric.name, "Reported Violent Crime Rate");
  assert.equal(metric.unit, "per 100k");
  assert.deepEqual(metric.domain, [0, 2000]);
  assert.deepEqual(layers.homicideRate.domain, [0, 65]);
  const zero = { ...freshFilter(key, true), max: 0 };
  const single = { ...zero, min: 619.8, max: 619.8 };
  const mortality = {
    ...freshFilter("homicideRate", true),
    min: 16.2,
    max: 16.2,
  };
  const url = writeViewUrl(
    "https://example.org/home-range/",
    {
      county: [single, mortality],
      mode: "all",
      layer: key,
      cutoff: 90,
    },
    [1, 0, 0],
  );
  assert.equal(url.searchParams.get(key), "619.8..619.8");
  const restored = parseView(readViewUrl(url, assert.fail), assert.fail);
  assert.equal(restored.layer, key);
  assert.equal(url.searchParams.get("homicideRate"), "16.2..16.2");
  assert.deepEqual(restored.county, [single, mortality]);
  for (const mode of ["all", "any"]) {
    assert.equal(outcome(place("17031"), restored.county, mode), true);
    assert.equal(outcome(place("55078"), [zero], mode), true);
    assert.equal(outcome(place("55025"), [zero], mode), false);
    assert.equal(outcome(place("15005"), [zero], mode), null);
  }
  assert.equal(outcome(place("55078"), [zero, mortality], "any"), true);
  assert.equal(outcome(place("55078"), [zero, mortality], "all"), null);
  assert.equal(countyReading(place("55078"), key), "0 per 100k");
  assert.equal(countyReading(place("15005"), key), "No data");
});
