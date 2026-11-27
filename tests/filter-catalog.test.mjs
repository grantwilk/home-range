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
import { filterId, layers, maxFilters } from "../model.js";
import { writeViewUrl } from "../view-url.js";

test("the picker covers each current measure and older seasonal shares keep their names", () => {
  const entries = catalog.flatMap((group) => group.entries);
  assert.equal(entries.length, 13);
  assert.equal(
    canAddFilter(new Set(entries.flatMap((entry) => entry.keys))),
    true,
  );
  assert.equal(
    canAddFilter(new Set(Array.from({ length: maxFilters }, (_, i) => i))),
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

test("a subtype search selects available measures, including configurable copies", () => {
  for (const [term, group, key] of [
    ["freezing", "temperatureDays", "coldDays"],
    ["hot days", "temperatureDays", "heatDays"],
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
    const again = catalogMatches(new Set([key]), term).flatMap(
      (g) => g.entries,
    );
    if (["heatDays", "coldDays"].includes(key)) assert.equal(again[0].key, key);
    else assert.deepEqual(again, []);
  }
});

test("configurable cards retain separate identities when switching measures and removing siblings", () => {
  for (const [key, alternate] of [
    ["coldDays", "heatDays"],
    ["custom", "cities"],
  ]) {
    const first = newCard(key);
    const second = newCard(key, [first]);
    assert.equal(filterId(first), key);
    assert.equal(filterId(second), key + "~2");
    const another = newCard(alternate);
    const switched = changeSubtype(second, alternate, [first, second, another]);
    assert.equal(filterId(switched), alternate + "~2");
    const reclaimed = newCard(key, [first]);
    assert.equal(filterId(reclaimed), key + "~2");
    const restored = changeSubtype(switched, key, [first, reclaimed, switched]);
    assert.equal(filterId(restored), key + "~3");
    assert.equal(filterId(newCard(key, [restored])), key);
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
