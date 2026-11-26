import test from "node:test";
import assert from "node:assert/strict";
import { SiteIndex, unitVector, combine } from "../spatial.js";
import { facilityLayers } from "../facility-model.js";
import { freshFilter, parseView } from "../model.js";

test("school campuses share one independent facility range", () => {
  assert.deepEqual(
    Object.keys(facilityLayers).filter((key) => !facilityLayers[key].nature),
    ["schools", "hospitals", "grocery", "airports", "cities", "custom"],
  );
  const city = {
    ...freshFilter("cities", true),
    min: 2.5,
    max: 25,
    citySize: { min: 179898, max: 2711226 },
  };
  const custom = {
    ...freshFilter("custom", true),
    points: [["Near Madison", -89.4, 43.07]],
  };
  assert.deepEqual(
    parseView({ county: [city, custom], layer: "cities" }).county,
    [city, custom],
  );
  assert.deepEqual(
    parseView({
      county: [{ ...custom, points: [["x", 0, 99], [], ...custom.points] }],
    }).county[0].points,
    custom.points,
  );
});
test("spherical nearest-neighbor index agrees with exhaustive search, including Alaska and cross-state sites", () => {
  const rows = Array.from({ length: 281 }, (_, i) => [
    "p" + i,
    ((i * 119.83) % 360) - 180,
    ((i * 41.3) % 160) - 80,
  ]);
  rows.push(["Aleutian", 179.85, 52], ["Honolulu", -157.857, 21.31]);
  const index = new SiteIndex(rows);
  for (const [lon, lat] of [
    [-179.95, 52],
    [-157.857, 21.31],
    [-89.41, 43.075],
    [0, 85],
    [96.7, -52],
    ...rows.slice(0, 40).map((p) => p.slice(1)),
  ]) {
    const q = unitVector(lon, lat);
    const sorted = rows
      .map(([, x, y], id) => {
        const v = unitVector(x, y);
        return { id, d: Math.hypot(...v.map((n, i) => n - q[i])) };
      })
      .sort((a, b) => a.d - b.d);
    const hit = index.nearest(...q);
    assert.equal(hit.id, sorted[0].id);
    assert.ok(
      Math.abs(hit.miles - 7917.5226 * Math.asin(sorted[0].d / 2)) < 1e-7,
    );
  }
  assert.equal(new SiteIndex([]).nearest(...unitVector(0, 0)).miles, null);
});
test("subcounty votes preserve unknown, independent view and inclusive filter semantics", () => {
  for (const x of [-1, 0, 1])
    for (const y of [-1, 0, 1]) {
      const votes = [x, y];
      assert.equal(
        combine(x, y, "all"),
        votes.includes(0) ? 0 : votes.includes(-1) ? -1 : 1,
      );
      assert.equal(
        combine(x, y, "any"),
        votes.includes(1) ? 1 : votes.includes(-1) ? -1 : 0,
      );
    }
  for (const mode of ["all", "any"])
    for (const x of [-1, 0, 1, 2]) assert.equal(combine(2, x, mode), x);
});
test("pixel centers follow the exact county, including shared edges, holes and islands", async () => {
  const { countyGrid, countyEdges } = await import("../spatial.js");
  const counties = [
    {
      bounds: [0, 0, 5, 3],
      edges: countyEdges("M0,0L3,0L3,3L0,3ZM1,1L2,1L2,2L1,2ZM4,0L5,0L5,1L4,1Z"),
    },
    { bounds: [3, 1, 4, 3], edges: countyEdges("M3,1L4,1L4,3L3,3Z") },
  ];
  assert.deepEqual(
    [...countyGrid(counties, { x: 0, y: 0, w: 5, h: 3, width: 5, height: 3 })],
    [0, 0, 0, -1, 0, 0, -1, 0, 1, -1, 0, 0, 0, 1, -1],
  );
});
