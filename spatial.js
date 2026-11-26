import { geoAlbersUsa, quickselect } from "./assets/projection.js";
export const projection = geoAlbersUsa().scale(1300).translate([487.5, 305]);
const radians = Math.PI / 180;
const earthMiles = 3958.7613;
export function unitVector(lon, lat) {
  const c = Math.cos(lat * radians);
  return [
    c * Math.cos(lon * radians),
    c * Math.sin(lon * radians),
    Math.sin(lat * radians),
  ];
}
// Euclidean chord distance on the unit sphere orders neighbors exactly like arc distance.
export class SiteIndex {
  constructor(points) {
    this.points = points;
    this.xyz = new Float64Array(points.length * 3);
    this.ids = Int32Array.from(points, (_, i) => i);
    points.forEach(([, lon, lat], i) =>
      this.xyz.set(unitVector(lon, lat), i * 3),
    );
    const split = (lo, hi, axis) => {
      if (hi - lo <= 12) return;
      const mid = (lo + hi) >> 1;
      quickselect(
        this.ids,
        mid,
        lo,
        hi - 1,
        (a, b) => this.xyz[a * 3 + axis] - this.xyz[b * 3 + axis],
      );
      const next = (axis + 1) % 3;
      split(lo, mid, next);
      split(mid + 1, hi, next);
    };
    split(0, points.length, 0);
  }
  nearest(x, y, z) {
    const q = [x, y, z],
      { xyz, ids } = this;
    let best = Infinity,
      id = -1;
    function visit(i) {
      const k = i * 3,
        a = x - xyz[k],
        b = y - xyz[k + 1],
        c = z - xyz[k + 2],
        d = a * a + b * b + c * c;
      if (d < best) {
        best = d;
        id = i;
      }
    }
    function search(lo, hi, axis) {
      if (hi - lo <= 12) {
        for (let i = lo; i < hi; i++) visit(ids[i]);
        return;
      }
      const mid = (lo + hi) >> 1,
        index = ids[mid],
        delta = q[axis] - xyz[index * 3 + axis],
        next = (axis + 1) % 3;
      visit(index);
      if (delta < 0) {
        search(lo, mid, next);
        if (delta * delta <= best) search(mid + 1, hi, next);
      } else {
        search(mid + 1, hi, next);
        if (delta * delta <= best) search(lo, mid, next);
      }
    }
    search(0, ids.length, 0);
    return {
      id,
      miles:
        id < 0
          ? null
          : 2 * earthMiles * Math.asin(Math.min(1, Math.sqrt(best) / 2)),
    };
  }
}
export function combine(a, b, mode) {
  // 1 match, 0 outside, -1 unknown, 2 no criterion.
  if (a === 2) return b;
  if (b === 2) return a;
  if (mode === "any") return a === 1 || b === 1 ? 1 : Math.min(a, b);
  return a === 0 || b === 0 ? 0 : Math.min(a, b);
}

// The packaged county paths contain closed, straight-edged rings (M/L/Z).
// Scan pixel centers directly so neighboring counties never blend identifiers.
export function countyEdges(path) {
  const edges = [];
  for (const ring of path.split("Z")) {
    if (!ring) continue;
    const coordinates = ring
      .slice(1)
      .split("L")
      .map((pair) => pair.split(",").map(Number));
    let [x0, y0] = coordinates.at(-1);
    for (const [x1, y1] of coordinates) {
      if (y1 !== y0)
        edges.push(
          y0 < y1
            ? [x0, y0, y1, (x1 - x0) / (y1 - y0)]
            : [x1, y1, y0, (x0 - x1) / (y0 - y1)],
        );
      x0 = x1;
      y0 = y1;
    }
  }
  return edges;
}
export function countyGrid(counties, { x, y, w, h, width, height }) {
  const ids = new Int16Array(width * height).fill(-1);
  const dx = w / width,
    dy = h / height;
  for (const [i, { bounds, edges }] of counties.entries()) {
    if (
      bounds[2] < x ||
      bounds[0] > x + w ||
      bounds[3] < y ||
      bounds[1] > y + h
    )
      continue;
    const first = Math.max(0, Math.ceil((bounds[1] - y) / dy - 0.5));
    const end = Math.min(height, Math.ceil((bounds[3] - y) / dy - 0.5));
    if (end <= first) continue;
    const cuts = Array.from({ length: end - first }, () => []);
    for (const [ax, ay, by, slope] of edges) {
      const from = Math.max(first, Math.ceil((ay - y) / dy - 0.5)),
        to = Math.min(end, Math.ceil((by - y) / dy - 0.5));
      for (let row = from; row < to; row++)
        cuts[row - first].push(ax + (y + (row + 0.5) * dy - ay) * slope);
    }
    for (let row = first; row < end; row++) {
      const xs = cuts[row - first].sort((a, b) => a - b);
      for (let j = 1; j < xs.length; j += 2) {
        const left = Math.max(0, Math.ceil((xs[j - 1] - x) / dx - 0.5)),
          right = Math.min(width, Math.ceil((xs[j] - x) / dx - 0.5));
        if (right > left) ids.fill(i, row * width + left, row * width + right);
      }
    }
  }
  return ids;
}
