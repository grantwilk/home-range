import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  outcome,
  metricName,
  cutoffFor,
  value,
  layers,
  freshFilter,
  parseView,
  defaults,
  color,
  sliderPosition,
  residentsPerSquareMile,
} from "../model.js";
const f = (key, min, max) => ({ ...freshFilter(key, true), min, max });
const legacy = (key, limit, op = "min", cutoff = 90, on = true) => ({
  key,
  limit,
  op,
  cutoff,
  on,
});
test("density covers every county and retains sparse fractional limits", () => {
  const data = JSON.parse(
    readFileSync(new URL("../data/population.json", import.meta.url)),
  );
  const density = (id) =>
    residentsPerSquareMile(data.counties[id], data.landAreaM2[id]);
  const m = layers.populationDensity;
  assert.equal(density("55025"), 493.44);
  assert.equal(density("48301"), 0.08);
  assert.equal(density("02290"), 0.03);
  assert.equal(density("36061"), 73481.17);
  assert.equal(residentsPerSquareMile(0, 100), 0);
  assert.equal(residentsPerSquareMile(20, 0), null);
  assert.equal(residentsPerSquareMile(undefined, 100), null);
  for (const id of Object.keys(data.counties))
    assert.ok(
      Number.isFinite(density(id)) &&
        density(id) >= m.domain[0] &&
        density(id) <= m.domain[1],
      id,
    );
  for (const [i, n] of m.sliderStops.entries())
    assert.equal(sliderPosition(m, n), i);
  assert.equal(sliderPosition(layers.coldHumidity, 47.7), 47.7);
  const bounds = f("populationDensity", 0.03, 0.08);
  const shared = parseView(
    { layer: bounds.key, county: [bounds] },
    assert.fail,
  );
  assert.deepEqual(shared.county, [bounds]);
});
test("monthly temperature ranges read each NOAA series and combine independently", () => {
  const counties = JSON.parse(
    readFileSync(new URL("../data/climate.json", import.meta.url)),
  ).counties;
  const dane = { values: counties["55025"] };
  const january = f("janLow", 10.8, 10.8);
  const november = f("novHigh", 45, 45);
  assert.equal(outcome(dane, [january, november], "all"), true);
  assert.equal(value(dane, "janHigh"), 27.2);
  assert.equal(value(dane, "novLow"), 28);
  november.min = 45.1;
  november.max = 55;
  assert.equal(outcome(dane, [january, november], "all"), false);
  assert.equal(outcome(dane, [january, november], "any"), true);
  assert.equal(value({ values: {} }, "novHigh"), null);
  assert.equal(value(dane, null), null);
  const metrics = Object.entries(layers).filter(([, m]) => m.temperatureStat);
  assert.equal(metrics.length, 24);
  for (const [key, metric] of metrics) {
    for (const values of Object.values(counties)) {
      const actual = value({ values }, key);
      assert.equal(
        actual,
        values["monthly" + metric.temperatureStat][metric.month],
      );
      assert.ok(actual >= metric.domain[0] && actual <= metric.domain[1], key);
    }
  }
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
test("cold days use the selected daily-low threshold and include the annual range endpoints", () => {
  const filter = f("coldDays", 0, 14);
  const counts = Array(121).fill(null);
  counts[0] = 0;
  counts[30] = 14;
  counts[31] = 14.1;
  counts[120] = 310.3;
  const place = { values: { coldDays: counts } };
  assert.equal(value(place, "coldDays"), 14);
  assert.equal(value(place, "coldDays", -60), 0);
  assert.equal(value(place, "coldDays", 60), 310.3);
  assert.equal(value(place, "coldDays", 61), null);
  assert.equal(value(place, "coldDays", -29.5), null);
  assert.equal(metricName("coldDays"), "Days Below -30°F");
  assert.equal(outcome(place, [filter], "all"), true);
  filter.cutoff = -29;
  assert.equal(outcome(place, [filter], "all"), false);
  assert.equal(outcome({ values: {} }, [filter], "all"), null);
  const state = { county: [filter, { ...f("heatDays", 0, 20), cutoff: 105 }] };
  assert.equal(cutoffFor(state, "coldDays"), -29);
  assert.equal(cutoffFor(state, "heatDays"), 105);
  assert.equal(cutoffFor(defaults(), "coldDays"), -30);
});
test("new layers and default cards start at the full supported domain", () => {
  for (const [key, m] of Object.entries(layers)) {
    if (m.facility) continue;
    assert.deepEqual(freshFilter(key), {
      key,
      on: false,
      min: m.domain[0],
      max: m.domain[1],
      cutoff: m.threshold?.initial ?? 90,
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
    (message) => assert.match(message, /total residents/),
  );
  assert.equal(state.layer, "populationDensity");
  assert.deepEqual(state.county[1], freshFilter("populationDensity"));
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
      "coldDays",
      "all",
      [legacy("coldDays", 0, "min", -30), legacy("coldDays", 14, "max", -20)],
      "cutoffs",
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
      {
        layer: key,
        mode,
        county: [...criteria, f("populationDensity", 0, 500)],
      },
      (msg) => warnings.push(msg),
    );
    assert.equal(s.layer, key);
    assert.deepEqual(
      s.county.map((f) => [f.key, f.on]),
      [
        [key, false],
        ["populationDensity", true],
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
  assert.equal(cutoffFor(state, "heatDays"), 90);
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

test("calendar climate ranges keep month, units, missing readings, and temperature cutoffs distinct", () => {
  const values = {
    monthlyHumidity: Array(12).fill(44),
    monthlyColdDays: [],
    monthlyWetDays: Array(12).fill(5.7),
  };
  values.monthlyHumidity[10] = 40;
  values.monthlyColdDays[10] = Array(121).fill(0);
  values.monthlyColdDays[10][70] = 1.7;
  const place = { values };
  assert.equal(value(place, "novHumidity"), 40);
  assert.equal(value(place, "decHumidity"), 44);
  assert.equal(value(place, "janCloudyDays"), null);
  assert.equal(value(place, "janColdDays", 10), null);
  assert.equal(value(place, "novColdDays", 10), 1.7);
  const rule = { ...f("novColdDays", 0, 1.7), cutoff: 10 };
  assert.equal(
    outcome(
      place,
      [rule, f("novHumidity", 0, 40), f("novWetDays", 5.7, 5.7)],
      "all",
    ),
    true,
  );
  assert.equal(outcome(place, [{ ...rule, max: 1.6 }], "all"), false);
  assert.equal(metricName("novColdDays", 10), "November Days Below 10°F");
  assert.equal(layers.febWetDays.domain[1], 29);
});
