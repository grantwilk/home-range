import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { coverKeys, landscapeValues, landShareLabel } from "../landscape.js";
import {
  countyReading,
  freshFilter,
  layers,
  outcome,
  parseView,
} from "../model.js";
import { readViewUrl, writeViewUrl } from "../view-url.js";
import { catalogMatches } from "../filter-catalog.js";

const read = (name) =>
  JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url)));
const range = (key, min, max) => ({ ...freshFilter(key, true), min, max });

test("landscape sources join by county and measure; unavailable types remain unknown", () => {
  const ids = new Set(read("geography").counties.map((c) => c.id));
  const data = read("land-cover");
  assert.deepEqual(new Set(data.keys), new Set(coverKeys));
  for (const [id, row] of Object.entries(data.counties)) {
    assert.ok(ids.has(id), id);
    if (!row) continue;
    assert.equal(row.length, coverKeys.length);
    const shares = row.filter(Number.isFinite);
    assert.ok(shares.every((n) => n >= 0 && n <= 100));
    if (shares.length) {
      assert.ok(Math.abs(shares.reduce((s, n) => s + n, 0) - 100) <= 0.5, id);
    }
  }
  const unseen = { values: landscapeValues(data, "99999") };
  assert.equal(countyReading(unseen, coverKeys[0]), "No data");
  assert.equal(outcome(unseen, [range(coverKeys[0], 0, 100)], "all"), null);
});

test("mixed landscapes can satisfy both covers; a trace of development differs from zero", () => {
  const county = [
    range("farmCover", 40, 60),
    range("forestCover", 40, 60),
    range("developedCover", 0, 0),
  ];
  const url = writeViewUrl(
    "https://example.org/home-range/",
    { county, mode: "all", layer: "forestCover", cutoff: 90 },
    [1, 0, 0],
  );
  const saved = parseView(readViewUrl(url, assert.fail), assert.fail);
  assert.deepEqual(saved.county, county);
  assert.equal(saved.layer, "forestCover");
  const values = { farmCover: 50, forestCover: 50, developedCover: 0 };
  assert.equal(outcome({ values }, saved.county, "all"), true);
  values.developedCover = 0.001;
  assert.equal(outcome({ values }, saved.county, "all"), false);
  assert.equal(outcome({ values }, saved.county, "any"), true);
  for (const [number, expected] of [
    [0, "0%"],
    [0.001, "<0.1%"],
    [99.999, ">99.9%"],
    [100, "100%"],
    [null, "No data"],
  ]) {
    assert.equal(landShareLabel(number), expected);
  }
});

test("landscape searches lead to the appropriate county measure", () => {
  for (const [query, key] of [
    ["farms", "farmCover"],
    ["buildings", "developedCover"],
    ["prairie", "grassCover"],
  ]) {
    const hits = catalogMatches(new Set(), query).flatMap((g) => g.entries);
    assert.ok(
      hits.some((hit) => hit.key === key),
      query,
    );
    assert.deepEqual(layers[key].domain, [0, 100]);
  }
});

test("a county can match a substantial mix of farms and woods with little development", () => {
  const cover = read("land-cover");
  const values = landscapeValues(cover, "55123"); // Vernon County, WI
  assert.deepEqual(
    [values.farmCover, values.forestCover, values.developedCover],
    [46.1, 44.3, 7],
  );
  assert.equal(
    outcome(
      { values },
      [
        range("farmCover", 40, 60),
        range("forestCover", 40, 60),
        range("developedCover", 0, 10),
      ],
      "all",
    ),
    true,
  );
  assert.equal(countyReading({ values }, "mossLichenCover"), "No data");
});
