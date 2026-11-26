import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { findPlaces, townDescription } from "../place-search.js";
const { points } = JSON.parse(
  fs.readFileSync(new URL("../data/facilities/cities.json", import.meta.url)),
);
const g = JSON.parse(
  fs.readFileSync(new URL("../data/geography.json", import.meta.url)),
);
const states = new Map(g.states.map((s) => [s.id, s]));
const counties = g.counties.map((c) => {
  const s = states.get(c.id.slice(0, 2));
  return { id: c.id, name: c.name, state: s.abbr, stateName: s.name };
});
const find = (q) => findPlaces(q, counties, points);
test("towns rank by exact place name and population with optional abbreviation or full state", () => {
  for (const q of ["Madison, WI", "Madison WI", "Madison Wisconsin"]) {
    const first = find(q).results[0];
    assert.equal(first.kind, "town");
    assert.equal(first.row[0], "Madison, WI");
    assert.ok(Number.isFinite(first.row[1]) && Number.isFinite(first.row[2]));
  }
  assert.equal(find("Portland").results[0].row[0], "Portland, OR");
  assert.equal(find("Portland, Maine").results[0].row[0], "Portland, ME");
  assert.equal(find("Los Ángeles, CA").results[0].row[0], "Los Angeles, CA");
  assert.equal(find("West New York").results[0].row[0], "West New York, NJ");
  assert.ok(find("West, New York").results.every((x) => x.state === "NY"));
});
test("state searches offer city and county rows; county identifiers retain leading zeroes", () => {
  const wi = find("WI");
  assert.ok(wi.total > 25);
  assert.equal(wi.results.length, 25);
  assert.deepEqual(
    new Set(wi.results.map((p) => p.kind)),
    new Set(["town", "county"]),
  );
  assert.ok(wi.results.every((p) => p.state === "WI"));
  for (const [q, id] of [
    ["04013", "04013"],
    ["Dane County, Wisconsin", "55025"],
    ["55025", "55025"],
  ]) {
    const first = find(q).results[0];
    assert.equal(first.kind, "county");
    assert.equal(first.id, id);
  }
  assert.equal(findPlaces("55025", counties).results[0].id, "55025");
  assert.deepEqual(find("no-such-place-yqz").results, []);
});

test("same-name same-state Census places remain distinguishable without displaying administrative IDs", () => {
  const matches = find("Kailua HI").results.filter(
    (r) => r.kind === "town" && /^Kailua CDP/.test(r.name),
  );
  assert.equal(matches.length, 2);
  const rows = matches.map(townDescription);
  assert.deepEqual(
    rows.map((r) => r.label),
    ["Kailua, HI", "Kailua, HI"],
  );
  assert.ok(rows.every((r) => r.detail.startsWith("Census-designated place")));
  assert.notEqual(rows[0].detail, rows[1].detail);
});
