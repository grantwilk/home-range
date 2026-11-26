import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { NatureIndex } from "../nature-spatial.js";
import { unitVector } from "../spatial.js";

const nearest = (index, lon, lat) => {
  const hit = index.nearest(...unitVector(lon, lat), lon, lat);
  return { name: index.names[hit.id], miles: hit.miles };
};
test("Powers Lake, the Fox River, parks, ranges and the Great Lakes use mapped geometry", () => {
  for (const [key, anchors] of Object.entries({
    coast: [
      [-87.602, 41.89, /Great Lakes/i, 0, 0.25],
      [-87.9, 41.89, /Great Lakes/i, 13, 16],
    ],
    mountains: [[-105.615, 40.255, /Longs Peak/, 0, 0]],
    parks: [
      [-110.828, 44.46, /Yellowstone/, 0, 0],
      [-150.1764, 63.9973, /Denali/, 0, 0.001],
      [-150.1764, 64.00049, /Denali/, 0.2, 0.24],
    ],
    rivers: [
      [-88.315, 41.76, /Fox River/, 0, 0.15],
      [-88.38, 41.76, /Fox River/, 2, 4],
    ],
    lakes: [
      [-88.2981, 42.54637, /Powers Lake/, 0, 0],
      [-88.33, 42.54637, /Powers Lake/, 0.8, 1.1],
    ],
  })) {
    const path = new URL("../data/nature/" + key + ".json.gz", import.meta.url);
    const index = new NatureIndex(JSON.parse(gunzipSync(readFileSync(path))));
    for (const [lon, lat, name, min, max] of anchors) {
      const hit = nearest(index, lon, lat);
      assert.match(hit.name, name);
      assert.ok(
        hit.miles >= min && hit.miles <= max,
        key + " distance was " + hit.miles,
      );
    }
  }
});

test("a polygon crossing the date line preserves its hole and overlapping land", () => {
  const encode = (points) => {
    const prev = [0, 0];
    let path = "";
    for (const pair of points)
      for (const [i, n] of pair.entries()) {
        const delta = n - prev[i];
        prev[i] = n;
        let v = delta < 0 ? -2 * delta - 1 : delta * 2;
        while (v >= 32) {
          path += String.fromCharCode((v & 31) + 95);
          v >>>= 5;
        }
        path += String.fromCharCode(v + 63);
      }
    return path;
  };
  const rect = (west, east, south, north) =>
    encode([
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ]);
  const index = new NatureIndex({
    geometry: "area",
    names: ["Main area", "Island"],
    scale: 1,
    parts: [
      [0, rect(176, -176, 0, 8), rect(178, -178, 2, 6)],
      [1, rect(179, 180, 3, 5)],
    ],
  });
  assert.equal(nearest(index, -179.5, 1).miles, 0);
  assert.ok(nearest(index, -179.5, 4).miles > 30);
  assert.deepEqual(nearest(index, 179.5, 4), { name: "Island", miles: 0 });
  assert.ok(nearest(index, -174, 4).miles > 130);
});
