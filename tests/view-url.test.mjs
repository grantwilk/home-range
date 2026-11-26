import test from "node:test";
import assert from "node:assert/strict";
import { readViewUrl, writeViewUrl } from "../view-url.js";
import { defaults, freshFilter, parseView, layers } from "../model.js";

const base = "https://example.org/home-range/";
const read = (url, warn = assert.fail) =>
  parseView(readViewUrl(new URL(url, base), warn), warn);
const f = (key, min, max, extra) => ({
  ...freshFilter(key, true),
  min,
  max,
  ...extra,
});

test("readable query ranges are inclusive, active by default, ordered and independently viewable", () => {
  const state = read(
    "?janLow=-8.2..14&TRND_RISKS=0.01..8.99&match=any&layer=TRND_RISKS&paused=TRND_RISKS",
  );
  assert.equal(state.mode, "any");
  assert.equal(state.layer, "TRND_RISKS");
  assert.deepEqual(state.county, [
    f("janLow", -8.2, 14),
    f("TRND_RISKS", 0.01, 8.99, { on: false }),
  ]);
  assert.deepEqual(read("?utm_source=friend"), defaults());
  assert.deepEqual(read("?filters=none").county, []);
  const layerOnly = read("?layer=elevation");
  assert.equal(layerOnly.layer, "elevation");
  assert.equal(layerOnly.county.at(-1).on, false);
});

test("every layer and its settings survive a share, including custom labels in the fragment", () => {
  const county = Object.keys(layers).map((key) => freshFilter(key));
  const byKey = Object.fromEntries(county.map((f) => [f.key, f]));
  Object.assign(byKey.heatDays, { min: 2.5, max: 80, cutoff: 83, on: true });
  Object.assign(byKey.cities, {
    min: 1.2,
    max: 17.7,
    citySize: { min: 123456, max: 876543 },
  });
  const point = [
    "Apt + A&B, “São #1” %3A " + "a".repeat(245),
    -89.401234567,
    43.071234567,
  ];
  byKey.custom.points = [point, ["Second", 0, 0]];
  const state = { county, layer: "heatDays", mode: "any", cutoff: 101 };
  const extent = [2.75, -612.500011, -350];
  const source = base + "?tag=a&janLow=1..2&tag=b#map";
  const url = writeViewUrl(source, state, extent);
  assert.deepEqual(read(url), state);
  assert.deepEqual(readViewUrl(url, assert.fail).extent, extent);
  assert.deepEqual(url.searchParams.getAll("tag"), ["a", "b"]);
  assert.equal(url.searchParams.get("heatDays.cutoff"), "83");
  assert.equal(url.searchParams.get("mapCutoff"), "101");
  assert.ok(url.hash.startsWith("#map&place="));
  assert.ok(!url.search.includes("89.401") && !url.search.includes("Apt"));
  assert.equal(writeViewUrl(url, state, extent).href, url.href);
  const emptied = writeViewUrl(
    url,
    { ...state, county: [], layer: null },
    [1, 0, 0],
  );
  assert.equal(emptied.hash, "#map");
  assert.equal(emptied.searchParams.get("filters"), "none");
  assert.equal(emptied.searchParams.has("extent"), false);
});

test("existing hash links load, explicit query filters take precedence and bad ranges are identified", () => {
  const original = defaults();
  original.county[0].on = true;
  const hash = "#view=" + encodeURIComponent(JSON.stringify(original));
  assert.deepEqual(read("?tag=mail" + hash), original);
  const current = read("?population=10..20" + hash);
  assert.deepEqual(current.county, [f("population", 10, 20)]);
  const url = writeViewUrl(base + hash, original, [1, 0, 0]);
  assert.equal(url.hash, "");
  const warnings = [];
  const partial = read("?population=100..&janLow=-1..0", (m) =>
    warnings.push(m),
  );
  assert.equal(partial.county[0].on, false);
  assert.equal(partial.county[1].on, true);
  assert.match(warnings.join(" "), /invalid bounds/);
  const custom = read(
    "?custom=1..20#place=bad&place=%5B%22Good%22%2C0%2C0%5D",
    (m) => warnings.push(m),
  );
  assert.deepEqual(custom.county[0].points, [["Good", 0, 0]]);
  assert.match(warnings.join(" "), /invalid custom location/);
});

test("minute-based links pause only affected filters and retain city populations and custom places", () => {
  const point = ["Family", -88.125, 42.25];
  const legacy = [
    f("cities", 12, 24, {
      units: "min",
      citySize: { min: 50_001, max: 199_998 },
    }),
    f("custom", 2, 4, { units: "min", points: [point] }),
    f("grocery", 1.2, 7.8, { units: "mi" }),
    f("janLow", 12, 30),
  ];
  const hash =
    "#view=" +
    encodeURIComponent(JSON.stringify({ layer: "custom", county: legacy }));
  const query =
    "?cities=12..24&cities.unit=min&cities.population=50001..199998&custom=2..4&custom.unit=min&grocery=1.2..7.8&grocery.unit=mi&janLow=12..30&layer=custom#" +
    new URLSearchParams({ place: JSON.stringify(point) });
  for (const link of [query, hash]) {
    const warnings = [];
    const state = read(link, (message) => warnings.push(message));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /travel-time filters.*paused/i);
    assert.deepEqual(
      state.county.map((f) => [f.key, f.on, f.min, f.max]),
      [
        ["cities", false, 0, 50],
        ["custom", false, 0, 10],
        ["grocery", true, 1.2, 7.8],
        ["janLow", true, 12, 30],
      ],
    );
    assert.deepEqual(state.county[0].citySize, { min: 50_001, max: 199_998 });
    assert.deepEqual(state.county[1].points, [point]);
    assert.equal(state.layer, "custom");
    assert.ok(state.county.every((f) => !("units" in f)));
    const next = writeViewUrl(new URL(link, base), state, [1, 0, 0]);
    assert.ok(![...next.searchParams.keys()].some((k) => k.endsWith(".unit")));
    assert.deepEqual(read(next), state);
  }
});
