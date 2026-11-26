import test from "node:test";
import assert from "node:assert/strict";
import {
  catalog,
  catalogMatches,
  newCard,
  changeSubtype,
} from "../filter-catalog.js";
import { layers } from "../model.js";
import { writeViewUrl } from "../view-url.js";

test("the picker entries cover all measures exactly once", () => {
  const entries = catalog.flatMap((group) => group.entries);
  assert.equal(entries.length, 10);
  assert.deepEqual(
    entries.flatMap((entry) => entry.keys).sort(),
    Object.keys(layers).sort(),
  );
});

test("a subtype search selects an available match and never offers a duplicate", () => {
  for (const [term, group, key] of [
    ["cardiac surgery", "distance", "hospitals"],
    ["middle school", "distance", "schools"],
    ["volcano", "hazard", "VLCN_RISKS"],
    ["great lakes", "nature", "coast"],
    ["forest preserve", "nature", "parks"],
    ["fox river", "nature", "rivers"],
    ["powers lake", "nature", "lakes"],
    ["sunny", "cloud", "cloud"],
  ]) {
    const [first] = catalogMatches(new Set(), term).flatMap((g) => g.entries);
    assert.equal(first.entry.id, group);
    assert.equal(first.key, key);
    assert.deepEqual(catalogMatches(new Set([key]), term), []);
  }
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
