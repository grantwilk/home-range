import test from "node:test";
import assert from "node:assert/strict";
import { classifyAccess, traceContours } from "../access-contours.js";

// Flatten returned SVG paths to independent line segments for geometric checks.
function rings(path) {
  const tokens = path.match(/[a-z]|-?(?:\d+\.?\d*|\.\d+)/gi);
  const rings = [];
  let ring,
    here = [0, 0],
    i = 0;
  const number = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const cmd = tokens[i++],
      relative = cmd.toLowerCase() === cmd;
    const point = () =>
      [number(), number()].map((v, k) => v + (relative ? here[k] : 0));
    switch (cmd.toUpperCase()) {
      case "M":
        here = point();
        ring = [here];
        rings.push(ring);
        break;
      case "L":
        here = point();
        ring.push(here);
        break;
      case "H":
        here = [number() + (relative ? here[0] : 0), here[1]];
        ring.push(here);
        break;
      case "V":
        here = [here[0], number() + (relative ? here[1] : 0)];
        ring.push(here);
        break;
      case "Q": {
        const a = here,
          b = point(),
          c = point();
        for (let j = 1; j <= 12; j++) {
          const t = j / 12,
            s = 1 - t;
          ring.push(
            [0, 1].map((k) => s * s * a[k] + 2 * s * t * b[k] + t * t * c[k]),
          );
        }
        here = c;
        break;
      }
      default:
        assert.equal(cmd, "Z");
    }
  }
  return rings;
}
function contains(rings, x, y) {
  let inside = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [a, b] = ring[j],
        [c, d] = ring[i];
      if (b > y !== d > y && x < a + ((y - b) * (c - a)) / (d - b))
        inside = !inside;
    }
  return inside;
}
test("a uniform field reaches all four exact frame corners with one four-sided ring", () => {
  const [path] = traceContours(new Int16Array(120).fill(3), 12, 10);
  const [outline] = rings(path.d);
  assert.equal(path.key, 3);
  assert.deepEqual(
    new Set(outline.map((p) => p.join(","))),
    new Set(["0,0", "0,10", "12,10", "12,0"]),
  );
});
test("holes, islands, unknown cells, diagonal contacts, and junctions keep the sample classes", () => {
  const width = 12,
    height = 10;
  const a = new Int16Array(width * height);
  for (let i = 0; i < a.length; i++) {
    const x = i % width,
      y = Math.floor(i / width);
    a[i] =
      y < 2
        ? (x + y) % 3
        : y > 6
          ? ((i * 17 + x * y * 3) % 5) - 1
          : x > 2 && x < 9 && y > 2 && y < 6
            ? 2
            : 1;
  }
  const shapes = traceContours(a, width, height).map((p) => ({
    ...p,
    rings: rings(p.d),
  }));
  for (let i = 0; i < a.length; i++)
    assert.deepEqual(
      shapes
        .filter((p) =>
          contains(p.rings, (i % width) + 0.5, Math.floor(i / width) + 0.5),
        )
        .map((p) => p.key),
      a[i] === -1 ? [] : [a[i]],
    );
});
test("local votes preserve three-valued all/any decisions, inclusive endpoints, empty directories, and an independent view", () => {
  const filters = Array.from({ length: 2 }, () => ({
    on: true,
    min: 0,
    max: 10,
  }));
  const fields = [
    [NaN, NaN, 0, 10, Infinity],
    [11, 5, 0, Infinity, NaN],
  ];
  const probe = (mode, present, shown) => {
    const c = classifyAccess(
      filters,
      fields,
      present,
      shown,
      [2, 5, 15, 30, 60],
      mode,
    );
    return fields[0].map((_, i) => c.decode(c.label(i)));
  };
  assert.deepEqual(
    probe("all", [true, true], 0).map((p) => p.vote),
    [0, -1, 1, 0, 0],
  );
  assert.deepEqual(
    probe("any", [true, true], 0).map((p) => p.vote),
    [-1, 1, 1, 1, -1],
  );
  assert.deepEqual(
    probe("all", [true, true], 0).map((p) => p.band),
    [-1, -1, 0, 2, 5],
  );
  assert.deepEqual(
    probe("any", [false, true], -1).map((p) => p.vote),
    [0, 1, 1, 0, -1],
  );
  filters.forEach((f) => (f.on = false));
  assert.deepEqual(
    probe("all", [true, true], -1),
    fields[0].map(() => ({ vote: 2, band: null })),
  );
});
test("straight-line crossings interpolate the actual threshold, and keep unknown edges centered", () => {
  function crossing(values, limit, shown) {
    const c = classifyAccess(
      [{ on: shown < 0, min: 0, max: limit }],
      [values],
      [true],
      shown,
      [2],
      "all",
    );
    return c.crossing(0, 1, c.label(0), c.label(1));
  }
  for (const shown of [-1, 0]) {
    assert.equal(crossing([0, 10], 2, shown), 0.2);
    assert.equal(crossing([10, 0], 2, shown), 0.8);
    assert.equal(crossing([NaN, 10], 2, shown), 0.5);
  }
  for (const [mode, expected] of [
    ["any", 0.8],
    ["all", 0.2],
  ]) {
    const c = classifyAccess(
      [2, 8].map((max) => ({ on: true, min: 0, max })),
      [
        [0, 10],
        [0, 10],
      ],
      [true, true],
      -1,
      [],
      mode,
    );
    assert.equal(c.crossing(0, 1, c.label(0), c.label(1)), expected);
  }
});
test("a 10-mile circular limit is smooth, compact and within a fraction of one sample of the analytic radius", () => {
  const width = 31,
    height = 31,
    cx = 15.35,
    cy = 14.78;
  const distances = Array.from({ length: width * height }, (_, i) =>
    Math.hypot((i % width) + 0.5 - cx, Math.floor(i / width) + 0.5 - cy),
  );
  const c = classifyAccess(
    [{ on: true, min: 0, max: 10 }],
    [distances],
    [true],
    -1,
    [],
    "all",
  );
  const contours = traceContours(
    distances.map((_, i) => c.label(i)),
    width,
    height,
    c.crossing,
  );
  const pass = contours.find((p) => c.decode(p.key).vote === 1);
  assert.ok(/q/i.test(pass.d));
  assert.ok(pass.d.length < 1600);
  let maxError = 0;
  const [ring] = rings(pass.d);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length];
    for (let j = 0; j <= 5; j++) {
      const t = j / 5;
      maxError = Math.max(
        maxError,
        Math.abs(
          10 -
            Math.hypot(
              a[0] + t * (b[0] - a[0]) - cx,
              a[1] + t * (b[1] - a[1]) - cy,
            ),
        ),
      );
    }
  }
  assert.ok(maxError < 0.3, `largest radius error: ${maxError}`);
});
test("neighboring class fills tile the entire frame at shared curves and junctions", () => {
  const width = 9,
    height = 9;
  const labels = Array.from(
    { length: 81 },
    (_, i) => ((i * i * 67 + i * 7 + 19 * Math.floor(i / 9)) % 53) % 3,
  );
  const shapes = traceContours(labels, width, height).map((p) => rings(p.d));
  for (let y = 0.031; y < height; y += 0.173)
    for (let x = 0.017; x < width; x += 0.137) {
      assert.equal(
        shapes.filter((path) => contains(path, x, y)).length,
        1,
        `gap or overlap at ${x}, ${y}`,
      );
    }
});
