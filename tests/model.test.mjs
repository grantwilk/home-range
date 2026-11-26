import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  outcome,
  value,
  layers,
  freshFilter,
  parseView,
  defaults,
  color,
  sliderPosition,
} from "../model.js";
const f = (key, min, max) => ({ ...freshFilter(key, true), min, max });
const legacy = (key, limit, op = "min", cutoff = 90, on = true) => ({
  key,
  limit,
  op,
  cutoff,
  on,
});
test("population slider covers rural and urban counts while share links retain exact whole-person limits", () => {
  const m = layers.population;
  assert.equal(m.sliderStops[0], 0);
  assert.equal(m.sliderStops.at(-1), 10_000_000);
  for (const [index, count] of m.sliderStops.entries()) {
    assert.equal(sliderPosition(m, count), index);
    if (index > 0) assert.ok(m.sliderStops[index - 1] < count);
  }
  assert.equal(m.sliderStops[sliderPosition(m, 52)], 50);
  assert.equal(m.sliderStops[sliderPosition(m, 1_234_567)], 1_200_000);
  assert.equal(sliderPosition(layers.coldHumidity, 47.7), 47.7);
  const shared = parseView({
    layer: "population",
    county: [f("population", 1_234_567, 1_765_432)],
  });
  assert.equal(shared.layer, "population");
  assert.equal(shared.county[0].min, 1_234_567);
  assert.equal(shared.county[0].max, 1_765_432);
});
test("both match modes respect missing values, exact endpoints and zero", () => {
  const place = { values: { janLow: 0, julHigh: 80 } };
  const knownPass = f("janLow", -10, 0),
    knownFail = f("julHigh", 40, 79),
    missing = f("wetDays", 10, 50);
  for (const mode of ["all", "any"]) {
    assert.equal(outcome(place, [], mode), true);
    assert.equal(outcome(place, [missing], mode), null);
    assert.equal(outcome(place, [knownPass], mode), true);
    assert.equal(outcome(place, [knownFail], mode), false);
  }
  assert.equal(outcome(place, [knownPass, missing], "any"), true);
  assert.equal(outcome(place, [knownFail, missing], "all"), false);
  assert.equal(outcome(place, [knownPass, missing], "all"), null);
  assert.equal(outcome(place, [knownFail, missing], "any"), null);
  assert.equal(value(place, "wetDays"), null);
  assert.equal(color(layers.janLow, 0), layers.janLow.colors[1]);
});
test("a range is one inclusive criterion in both modes", () => {
  const range = f("janLow", 24.6, 30.5);
  for (const mode of ["all", "any"]) {
    for (const [janLow, expected] of [
      [24.5, false],
      [24.6, true],
      [26, true],
      [30.5, true],
      [30.6, false],
    ]) {
      assert.equal(outcome({ values: { janLow } }, [range], mode), expected);
    }
    assert.equal(
      outcome({ values: { janLow: 24.6 } }, [f("janLow", 24.6, 24.6)], mode),
      true,
    );
  }
});
test("new layers and default cards start at the full supported domain", () => {
  for (const [key, m] of Object.entries(layers)) {
    if (m.facility) continue;
    assert.deepEqual(freshFilter(key), {
      key,
      on: false,
      min: m.domain[0],
      max: m.domain[1],
      cutoff: 90,
    });
    assert.equal(freshFilter(key, true).on, true);
  }
  assert.deepEqual(parseView(defaults()), defaults());
  assert.deepEqual(parseView(null), defaults());
  assert.deepEqual(parseView({ county: [], layer: "cloudyDays" }).county, []);
  assert.equal(parseView({ county: [], layer: "cloudyDays" }).layer, null);
});
test("representable old shared links preserve their results under all and any", () => {
  const samples = [
    [
      "all",
      [
        legacy("janLow", 2.52),
        legacy("janLow", 56.7, "max"),
        legacy("janLow", 8, "min", 90, false),
      ],
    ],
    ["any", [legacy("janLow", 25.4), legacy("janLow", 20)]],
    ["any", [legacy("janLow", 12.5, "max"), legacy("janLow", 12.6)]],
    ["all", [legacy("janLow", -10), legacy("janLow", 0, "max")]],
    ["any", [legacy("janLow", 10, "max"), legacy("janLow", 5)]],
  ];
  for (const [mode, county] of samples) {
    const s = parseView({ mode, county }, assert.fail);
    assert.equal(s.county.length, 1);
    for (let tick = -600; tick <= 750; tick++) {
      const janLow = tick / 10;
      const hits = county
        .filter((f) => f.on)
        .map((f) => (f.op === "min" ? janLow >= f.limit : janLow <= f.limit));
      const expected =
        mode === "all" ? hits.every(Boolean) : hits.some(Boolean);
      assert.equal(outcome({ values: { janLow } }, s.county, mode), expected);
    }
    assert.equal(outcome({ values: {} }, s.county, mode), null);
  }
  const state = parseView(
    {
      modes: { county: "any" },
      views: { county: "population" },
      county: [legacy("janLow", 25), legacy("population", 123.6)],
    },
    assert.fail,
  );
  assert.equal(state.layer, "population");
  assert.equal(state.county[1].min, 124);
});
test("unrepresentable links disable only the affected layer and report the reason", () => {
  for (const [key, mode, criteria, reason] of [
    [
      "janLow",
      "all",
      [legacy("janLow", 40), legacy("janLow", 20, "max")],
      "overlap",
    ],
    [
      "janLow",
      "any",
      [legacy("janLow", 30), legacy("janLow", 20, "max")],
      "gap",
    ],
    [
      "heatDays",
      "all",
      [legacy("heatDays", 20, "min", 88), legacy("heatDays", 60, "max", 95)],
      "cutoffs",
    ],
  ]) {
    const warnings = [];
    const s = parseView(
      { layer: key, mode, county: [...criteria, f("population", 0, 500_000)] },
      (msg) => warnings.push(msg),
    );
    assert.equal(s.layer, key);
    assert.deepEqual(
      s.county.map((f) => [f.key, f.on]),
      [
        [key, false],
        ["population", true],
      ],
    );
    assert.equal(s.county[0].min, criteria[0].limit);
    assert.ok(warnings[0].includes(reason));
    assert.ok(warnings[0].includes(layers[key].name));
  }
});
test("invalid link ranges, unknown layers and invalid heat cutoffs are handled", () => {
  const warnings = [];
  const state = parseView(
    {
      layer: "__proto__",
      mode: "invalid",
      cutoff: 500,
      county: [
        null,
        { key: "clear" },
        { key: ["janLow"] },
        f("janLow", 50, -10),
        f("julHigh", 40, 200),
        { ...f("heatDays", 0, 10), cutoff: 50 },
      ],
    },
    (msg) => warnings.push(msg),
  );
  assert.equal(state.layer, "janLow");
  assert.equal(state.mode, "all");
  assert.equal(state.cutoff, 90);
  assert.deepEqual(
    state.county.map((f) => f.key),
    ["janLow", "julHigh", "heatDays"],
  );
  assert.deepEqual(state.county[0], freshFilter("janLow"));
  assert.equal(state.county[1].max, 115);
  assert.equal(state.county[2].cutoff, 90);
  assert.equal(warnings.length, 1);
});
test("mapped coverage, heat cutoffs and independent overlap counts match published inputs", () => {
  const read = (name) =>
    JSON.parse(
      readFileSync(new URL("../data/" + name + ".json", import.meta.url)),
    );
  const g = read("geography"),
    cl = read("climate").counties,
    cloudyDays = read("cloudyDays").counties;
  const pc = g.counties.map(({ id }) => ({
    values: { ...cl[id], cloudyDays: cloudyDays[id] },
  }));
  assert.equal(new Set(g.counties.map((p) => p.id)).size, 3142);
  for (const [k, n] of [
    ["janLow", 3140],
    ["wetDays", 3107],
    ["heatDays", 3107],
    ["cloudyDays", 3142],
  ])
    assert.equal(pc.filter((p) => value(p, k) !== null).length, n);
  const criteria = [f("janLow", 40, 75), f("julHigh", 40, 80)];
  assert.equal(
    pc.filter((p) => outcome(p, criteria, "all") === true).length,
    6,
  );
  assert.equal(
    pc.filter((p) => outcome(p, criteria, "any") === true).length,
    486,
  );
  const phoenix = { values: cl["04013"] };
  assert.equal(value(phoenix, "heatDays", 90), 159);
  assert.ok(value(phoenix, "heatDays", 87) > 159);
  assert.equal(cloudyDays["04013"], 16.7);
  assert.equal(cloudyDays["15003"], 96.8);
  assert.equal(cloudyDays["11001"], 54.3);
});
