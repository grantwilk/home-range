import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { selectTownLabels } from "../map-labels.js";
import { projection } from "../spatial.js";

const { points } = JSON.parse(
  readFileSync(new URL("../data/facilities/cities.json", import.meta.url)),
);
const places = new Map(points.map((row) => [row[0], row]));
const page = { width: 720, height: 445 };
const nation = { x: -65, y: -18, width: 1060, height: 656 };
function around(lon, lat, width) {
  const [cx, cy] = projection([lon, lat]);
  const height = (width * page.height) / page.width;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}
function touches(a, b) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}
function assertPlacement(labels, bounds, reserved = []) {
  const occupied = [...reserved];
  for (const item of labels) {
    const row = places.get(item.sourceName);
    assert.ok(row);
    assert.equal(item.population, row[3]);
    const [x, y] = projection(row.slice(1, 3));
    assert.ok(
      Math.abs(item.dotX - ((x - bounds.x) / bounds.width) * page.width) < 1e-8,
    );
    assert.ok(
      Math.abs(item.dotY - ((y - bounds.y) / bounds.height) * page.height) <
        1e-8,
    );
    const dot = {
      x: item.dotX - 2.8,
      y: item.dotY - 2.8,
      width: 5.6,
      height: 5.6,
    };
    for (const box of [dot, item.box]) {
      assert.ok(
        box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= page.width &&
          box.y + box.height <= page.height,
      );
      for (const other of occupied)
        assert.ok(!touches(box, other), item.sourceName);
      occupied.push(box);
    }
    assert.ok(
      item.x > item.box.x &&
        item.y > item.box.y &&
        item.y < item.box.y + item.box.height,
    );
  }
}

test("national PDF labels include Alaska and Hawaii and keep glyph boxes clear of dots and state labels", () => {
  const reserved = [
    { x: 320, y: 205, width: 39, height: 9 },
    { x: 490, y: 135, width: 36, height: 12 },
  ];
  const labels = selectTownLabels(points, nation, page, { reserved });
  assert.ok(labels.length >= 20 && labels.length <= 64);
  for (const name of [
    "New York, NY",
    "Los Angeles, CA",
    "Anchorage, AK",
    "Urban Honolulu, HI",
  ])
    assert.ok(
      labels.some((p) => p.sourceName === name),
      name,
    );
  assertPlacement(labels, nation, reserved);
});
test("dense urban and sparsely populated rural crops both retain useful local names", () => {
  for (const [bounds, main, min] of [
    [around(-87.66, 41.83, 35), "Chicago, IL", 20],
    [around(-100.93, 42.27, 45), "Valentine, NE", 8],
  ]) {
    const labels = selectTownLabels(points, bounds, page);
    assert.ok(labels.length >= min && labels.length <= 64);
    assert.ok(labels.some((p) => p.sourceName === main));
    assertPlacement(labels, bounds);
  }
});
test("population decides among collocated candidates; text metrics and accented names survive", () => {
  const rows = [
    ["Peña Chica, NM", -106.2, 35.7, 900],
    ["Piñón, NM", -106.2, 35.7, 3500],
  ];
  const labels = selectTownLabels(rows, around(-106.2, 35.7, 5), page, {
    measureText: (name) => {
      assert.equal(name, "Piñón");
      return 43;
    },
  });
  assert.equal(labels.length, 1);
  assert.equal(labels[0].name, "Piñón");
  assert.equal(labels[0].sourceName, rows[1][0]);
  assert.ok(labels[0].box.width >= 43);
  const disabled = selectTownLabels(rows, around(-106.2, 35.7, 5), page, {
    reserved: [{ x: 0, y: 0, ...page }],
  });
  assert.deepEqual(disabled, []);
});
test("Census disambiguation codes stay in source identities and do not consume printable map space", () => {
  const source = points.find((p) => p[0] === "Kailua CDP (1523150), HI");
  const [item] = selectTownLabels(
    [source],
    around(source[1], source[2], 5),
    page,
  );
  assert.equal(item.name, "Kailua");
  assert.equal(item.sourceName, source[0]);
});
test("labels retain place names while removing Census administrative qualifiers", () => {
  for (const [sourceName, expected] of [
    ["Juneau, AK", "Juneau"],
    ["Sitka, AK", "Sitka"],
    ["Wrangell, AK", "Wrangell"],
    [
      "Nashville-Davidson metropolitan government (balance), TN",
      "Nashville-Davidson",
    ],
    [
      "Louisville/Jefferson County metro government (balance), KY",
      "Louisville/Jefferson County",
    ],
    ["Indianapolis city (balance), IN", "Indianapolis"],
    ["Lexington-Fayette urban county, KY", "Lexington-Fayette"],
    ["Butte-Silver Bow (balance), MT", "Butte-Silver Bow"],
    ["Marlborough, MA", "Marlborough"],
    ["Green Bay city, WI", "Green Bay"],
  ]) {
    const row = places.get(sourceName);
    assert.ok(row, sourceName);
    const [label] = selectTownLabels([row], around(row[1], row[2], 5), page);
    assert.equal(label.name, expected);
  }
});
test("a facility can replace a town dot without hiding its name or touching its text", () => {
  const row = places.get("Madison, WI"),
    bounds = around(row[1], row[2], 30);
  const [center] = selectTownLabels([row], bounds, page);
  const marker = {
    x: center.dotX - 11,
    y: center.dotY - 9,
    width: 22,
    height: 18,
  };
  const [shared] = selectTownLabels([row], bounds, page, { symbols: [marker] });
  assert.equal(shared.name, "Madison");
  assert.equal(shared.coveredDot, true);
  assert.ok(!touches(shared.box, marker));
  assert.equal(shared.dotX, center.dotX);
  assert.equal(shared.dotY, center.dotY);
  assert.deepEqual(
    selectTownLabels([row], bounds, page, { reserved: [marker] }),
    [],
  );
});
