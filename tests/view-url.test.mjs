import test from "node:test";
import assert from "node:assert/strict";
import { readViewUrl, writeViewUrl } from "../view-url.js";
import {
  defaults,
  monthKeys,
  usesRetiredMeasure,
  freshFilter,
  parseView,
  layers,
  cutoffFor,
  outcome,
} from "../model.js";

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

test("cold day thresholds restore independently of hot days and reject invalid values", () => {
  const example = read("?coldDays=0..14&layer=coldDays");
  assert.deepEqual(example.county, [f("coldDays", 0, 14)]);
  assert.equal(example.county[0].cutoff, -30);
  for (const cutoff of [-60, 0, 60]) {
    const displayed = read(
      `?layer=coldDays&coldDays.cutoff=${cutoff}&mapCutoff=100`,
    );
    const cold = displayed.county.find((filter) => filter.key === "coldDays");
    assert.equal(cold.on, false);
    assert.equal(cold.cutoff, cutoff);
    assert.equal(Object.hasOwn(displayed, "cutoff"), false);
  }
  for (const invalid of ["", "-61", "61", "-30.5", "NaN"]) {
    const warnings = [];
    const state = read(
      `?coldDays=0..14&coldDays.cutoff=${invalid}`,
      (warning) => warnings.push(warning),
    );
    assert.equal(state.county[0].cutoff, -30);
    assert.match(warnings.join(" "), /Cold Days uses -30°F/);
  }
  const updated = writeViewUrl(
    new URL("?coldDays=5..7&coldDays.cutoff=12", base),
    example,
    [1, 0, 0],
  );
  assert.equal(updated.searchParams.has("coldDays.cutoff"), false);
  assert.deepEqual(read(updated), example);
});
test("a former map-only cutoff never overrides the saved filter threshold", () => {
  const old = new URL(
    "?heatDays=0..14&heatDays.cutoff=95&mapCutoff=85&layer=heatDays",
    base,
  );
  const state = read(old);
  assert.equal(state.county[0].cutoff, 95);
  assert.equal(
    writeViewUrl(old, state, [1, 0, 0]).searchParams.has("mapCutoff"),
    false,
  );
});

test("repeated thresholds vote separately and restore the displayed card, with or without the original", () => {
  const county = [
    f("coldDays", 0, 14, { cutoff: 0 }),
    f("coldDays", 0, 30, { id: "coldDays~2", cutoff: 10 }),
    f("heatDays", 0, 20),
    f("heatDays", 0, 7, { id: "heatDays~2", cutoff: 100, on: false }),
    f("janLow", 0, 20),
    f("janHigh", 0, 32),
  ];
  const state = {
    county,
    layer: "coldDays",
    layerId: "coldDays~2",
    mode: "all",
  };
  const url = writeViewUrl(base, state, [1, 0, 0]);
  assert.deepEqual(read(url), state);
  assert.equal(cutoffFor(read(url), "coldDays"), 10);
  const values = {
    coldDays: Array(121).fill(null),
    heatDays: Array(61).fill(0),
    janLow: 10,
    janHigh: 28,
  };
  values.coldDays[60] = 14;
  values.coldDays[70] = 31;
  assert.equal(outcome({ values }, county, "all"), false);
  assert.equal(outcome({ values }, county, "any"), true);
  values.coldDays[70] = 30;
  assert.equal(outcome({ values }, county, "all"), true);
  const remaining = { ...state, county: county.slice(1) };
  const next = writeViewUrl(url, remaining, [1, 0, 0]);
  assert.deepEqual(read(next), remaining);
  assert.equal(next.searchParams.has("coldDays"), false);
});

test("repeated city populations and private custom point lists are independently shareable and removable", () => {
  const county = [
    f("cities", 0, 5, { citySize: { min: 10, max: 50000 } }),
    f("cities", 0, 25, {
      id: "cities~2",
      citySize: { min: 150000, max: 10000000 },
    }),
    f("custom", 0, 5, { points: [["Grandma & Grandpa", -89, 42]] }),
    f("custom", 0, 12, {
      id: "custom~2",
      points: [["Work", -87, 43]],
      on: false,
    }),
  ];
  const state = { county, layer: "custom", layerId: "custom~2", mode: "all" };
  const url = writeViewUrl(base + "#keep", state, [1, 0, 0]);
  assert.deepEqual(read(url), state);
  assert.doesNotMatch(url.search, /Grandma|Work|-87|-89/);
  assert.match(url.hash, /Work/);
  const changed = {
    county: [county[1], county[2]],
    layer: "cities",
    layerId: "cities~2",
    mode: "all",
  };
  const next = writeViewUrl(url, changed, [1, 0, 0]);
  assert.doesNotMatch(next.href, /Work/);
  assert.match(next.hash, /keep/);
  assert.deepEqual(read(next), changed);
});

test("every layer and its settings survive a share, including custom labels in the fragment", () => {
  const county = Object.keys(layers).map((key) => freshFilter(key));
  const byKey = Object.fromEntries(county.map((f) => [f.key, f]));
  Object.assign(byKey.coldDays, { min: 0, max: 14, cutoff: -32, on: true });
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
  const state = { county, layer: "heatDays", mode: "any" };
  const extent = [2.75, -612.500011, -350];
  const source = base + "?tag=a&janLow=1..2&tag=b#map";
  const url = writeViewUrl(source, state, extent);
  assert.deepEqual(read(url), state);
  assert.deepEqual(readViewUrl(url, assert.fail).extent, extent);
  assert.deepEqual(url.searchParams.getAll("tag"), ["a", "b"]);
  assert.equal(url.searchParams.get("heatDays.cutoff"), "83");
  assert.equal(url.searchParams.get("coldDays.cutoff"), "-32");
  assert.equal(url.searchParams.has("mapCutoff"), false);
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
  const current = read("?populationDensity=10..20" + hash);
  assert.deepEqual(current.county, [f("populationDensity", 10, 20)]);
  const url = writeViewUrl(base + hash, original, [1, 0, 0]);
  assert.equal(url.hash, "");
  const warnings = [];
  const partial = read("?populationDensity=100..&janLow=-1..0", (m) =>
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

test("retired cloud percentages migrate to one paused days card without changing other filters", () => {
  const unrelated = f("janLow", -8, 14);
  const historical = {
    views: { county: "janLow" },
    modes: { county: "any" },
    county: [
      { key: "cloud", op: "min", limit: 80, on: true },
      unrelated,
      { key: "cloud", op: "max", limit: 90, on: true },
    ],
  };
  for (const link of [
    "?cloud=80..90&janLow=-8..14&layer=janLow&match=any&tag=mail",
    "#view=" + encodeURIComponent(JSON.stringify(historical)),
  ]) {
    const warnings = [];
    const restored = read(link, (m) => warnings.push(m));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /cloud frequency \(%\).*paused/);
    assert.deepEqual(restored.county, [freshFilter("cloudyDays"), unrelated]);
    assert.equal(restored.layer, "janLow");
    assert.equal(restored.mode, "any");
    const url = writeViewUrl(new URL(link, base), restored, [1, 0, 0]);
    assert.equal(url.searchParams.has("cloud"), false);
    assert.equal(url.searchParams.get("paused"), "cloudyDays");
    assert.deepEqual(read(url), restored);
    if (link.startsWith("?")) assert.equal(url.searchParams.get("tag"), "mail");
  }
});
test("a displayed legacy cloud map restores the cloudy-day map, keeping its eye independent", () => {
  for (const link of [
    "?layer=cloud",
    "?janLow=-2..1&layer=cloud",
    "?cloud=191..201&layer=cloud",
    "#view=" +
      encodeURIComponent(
        JSON.stringify({
          county: [f("janLow", -2, 1)],
          views: { county: "cloud" },
        }),
      ),
  ]) {
    const warnings = [];
    const s = read(link, (m) => warnings.push(m));
    assert.equal(s.layer, "cloudyDays");
    assert.deepEqual(
      s.county.find((f) => f.key === "cloudyDays"),
      freshFilter("cloudyDays"),
    );
    assert.equal(warnings.length, 1);
  }
  assert.deepEqual(read("?filters=none&layer=cloud").county, []);
});
test("an explicit days range wins over any legacy percentage, whether active or paused", () => {
  for (const paused of [false, true]) {
    const native = f("cloudyDays", 12, 20, { on: !paused });
    const status = paused ? "&paused=cloudyDays" : "";
    for (const link of [
      "?cloud=63..70&cloudyDays=12..20&layer=cloud" + status,
      "?cloudyDays=12..20&cloud=63..70&layer=cloud" + status,
      "#view=" +
        encodeURIComponent(
          JSON.stringify({
            layer: "cloud",
            county: [native, { key: "cloud", min: 63, max: 70, on: true }],
          }),
        ),
    ]) {
      const warnings = [];
      const s = read(link, (m) => warnings.push(m));
      assert.deepEqual(s.county, [native]);
      assert.equal(s.layer, "cloudyDays");
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /saved Cloudy Days range/);
    }
  }
});

test("links drop removed regional criteria and preserve other filter ranges", () => {
  const old = new URL(
    "?plainsRegion=50..100&grassCover=60..100&desertClimate=0..0&layer=plainsRegion",
    base,
  );
  const state = read(old);
  assert.deepEqual(state.county, [f("grassCover", 60, 100)]);
  assert.equal(state.layer, "grassCover");
  const shared = writeViewUrl(old, state, [1, 0, 0]);
  assert.equal(shared.searchParams.has("plainsRegion"), false);
  assert.equal(shared.searchParams.has("desertClimate"), false);
  assert.deepEqual(read("?layer=prairieRegion").county, []);
});

test("population totals never become density bounds in a shared view", () => {
  for (const link of [
    "?population=10000..50000&layer=population",
    "?layer=population",
  ]) {
    const warnings = [];
    const state = read(link, (m) => warnings.push(m));
    assert.equal(state.layer, "populationDensity");
    assert.deepEqual(
      state.county.find((f) => f.key === state.layer),
      freshFilter("populationDensity"),
    );
    assert.match(warnings.join(" "), /paused/);
    const next = writeViewUrl(new URL(link, base), state, [1, 0, 0]);
    assert.equal(next.searchParams.has("population"), false);
  }
  const mixed = read(
    "?population=100..500&populationDensity=0.01..0.03&match=any&layer=population",
    () => {},
  );
  assert.deepEqual(mixed.county, [f("populationDensity", 0.01, 0.03)]);
  assert.equal(mixed.mode, "any");
});

test("relative humidity shares restore each chosen month as a paused absolute range", () => {
  for (const key of [
    ...monthKeys("coldAbsoluteHumidity"),
    "coldAbsoluteHumidity",
    "hotAbsoluteHumidity",
  ]) {
    const oldKey = key.replace("AbsoluteHumidity", "Humidity");
    const other = f("janLow", -8.2, 14);
    const links = [
      "?" + oldKey + "=26..45&janLow=-8.2..14&match=any&layer=" + oldKey,
      "#view=" +
        encodeURIComponent(
          JSON.stringify({
            layer: oldKey,
            mode: "any",
            county: [{ key: oldKey, min: 26, max: 45, on: true }, other],
          }),
        ),
    ];
    for (const link of links) {
      const warnings = [];
      const url = new URL(link, base);
      const raw = readViewUrl(url, assert.fail);
      assert.ok(usesRetiredMeasure(raw));
      const state = parseView(raw, (message) => warnings.push(message));
      assert.equal(state.layer, key);
      assert.equal(state.mode, "any");
      assert.deepEqual(state.county, [freshFilter(key), other]);
      assert.deepEqual(layers[key].domain, [0, 30]);
      assert.equal(layers[key].unit, "g/m³");
      assert.match(warnings.join(" "), /relative humidity.*g\/m³.*paused/i);
      const next = writeViewUrl(url, state, [1, 0, 0]);
      assert.equal(next.searchParams.has(oldKey), false);
      assert.deepEqual(read(next), state);
    }
  }
});

test("a current absolute humidity range wins over percentages in a mixed link", () => {
  const key = "novAbsoluteHumidity";
  for (const filters of [
    "novHumidity=0..85&novAbsoluteHumidity=4.2..8.6",
    "novAbsoluteHumidity=4.2..8.6&novHumidity=0..85",
  ]) {
    const warnings = [];
    const state = read("?" + filters + "&layer=novHumidity", (m) =>
      warnings.push(m),
    );
    assert.equal(state.layer, key);
    assert.deepEqual(state.county, [f(key, 4.2, 8.6)]);
    assert.match(warnings.join(" "), /settings have been kept/);
  }
});
