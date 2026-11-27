import test from "node:test";
import assert from "node:assert/strict";
import {
  catalog,
  catalogMatches,
  entryFor,
  canAddFilter,
  newCard,
  changeSubtype,
} from "../filter-catalog.js";
import { layers } from "../model.js";
import { writeViewUrl } from "../view-url.js";

test("the picker covers each current measure and older seasonal shares keep their names", () => {
  const entries = catalog.flatMap((group) => group.entries);
  assert.equal(entries.length, 13);
  assert.equal(
    canAddFilter(new Set(entries.flatMap((entry) => entry.keys))),
    false,
  );
  for (const key of ["coldLow", "hotHigh"])
    assert.equal(entryFor(key).name, layers[key].name);
  assert.deepEqual(
    entries.flatMap((entry) => entry.keys).sort(),
    Object.keys(layers)
      .filter((key) => !["coldLow", "hotHigh"].includes(key))
      .sort(),
  );
});

test("a subtype search selects an available match and never offers a duplicate", () => {
  for (const [term, group, key] of [
    ["november high", "temperature", "novHigh"],
    ["cardiac surgery", "distance", "hospitals"],
    ["middle school", "distance", "schools"],
    ["volcano", "hazard", "VLCN_RISKS"],
    ["great lakes", "nature", "coast"],
    ["forest preserve", "nature", "parks"],
    ["fox river", "nature", "rivers"],
    ["powers lake", "nature", "lakes"],
    ["sunny", "cloudyDays", "cloudyDays"],
    ["annual rainfall", "annualPrecipitation", "rainfall"],
    ["annual snowfall", "annualPrecipitation", "snowfall"],
  ]) {
    const [first] = catalogMatches(new Set(), term).flatMap((g) => g.entries);
    assert.equal(first.entry.id, group);
    assert.equal(first.key, key);
    assert.deepEqual(catalogMatches(new Set([key]), term), []);
  }
});

test("the County Crime picker offers one card family with two distinct measures", () => {
  const group = catalog.find((g) => g.name === "Population & Nearby Places");
  const crime = group.entries.find((entry) => entry.id === "crime");
  assert.equal(crime.name, "County Crime");
  assert.equal(crime.label, "Measure");
  assert.deepEqual(crime.keys, ["violentCrimeRate", "homicideRate"]);
  const [result] = catalogMatches(
    new Set(["violentCrimeRate"]),
    "crime",
  ).flatMap((g) => g.entries);
  assert.equal(result.entry.id, "crime");
  assert.equal(result.key, "homicideRate");
  assert.deepEqual(catalogMatches(new Set(crime.keys), "crime"), []);
});

test("switching subtypes keeps compatible edits and restores a previously used custom list privately", () => {
  const tornado = newCard("TRND_RISKS");
  Object.assign(tornado, { min: 4.55, max: 23.42, on: false });
  const flood = changeSubtype(tornado, "IFLD_RISKS");
  assert.equal(flood.min, 4.55);
  assert.equal(flood.max, 23.42);
  assert.equal(flood.on, false);
  flood.max = 70;
  assert.equal(changeSubtype(flood, tornado.key).max, 23.42);
  const school = newCard("schools");
  const custom = changeSubtype(school, "custom");
  assert.equal(custom.max, layers.custom.radius);
  assert.equal(custom.on, false);
  custom.points = [["My Home", -89.41, 43.07]];
  custom.on = true;
  const nearby = changeSubtype(custom, "grocery");
  const url = writeViewUrl(
    "https://example.org/",
    { county: [nearby], mode: "all", layer: "grocery", cutoff: 90 },
    [1, 0, 0],
  );
  assert.equal(url.hash, "");
  assert.deepEqual(changeSubtype(nearby, "custom").points, custom.points);
});

test("rainfall and snowfall remember their own limits when switching measures", () => {
  const rain = newCard("rainfall");
  rain.min = 25;
  rain.max = 35.5;
  const snow = changeSubtype(rain, "snowfall");
  assert.deepEqual([snow.min, snow.max], layers.snowfall.domain);
  snow.max = 10;
  const restored = changeSubtype(snow, "rainfall");
  assert.deepEqual([restored.min, restored.max], [25, 35.5]);
  assert.equal(changeSubtype(restored, "snowfall").max, 10);
});
