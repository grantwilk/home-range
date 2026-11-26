// A bounding-volume tree on the unit sphere works across states and the dateline.
import { projection, unitVector } from "./spatial.js";
import { quickselect } from "./assets/projection.js";

const earthMiles = 3958.7613;
const chunkLength = 12;

function subdivisions(c, i) {
  return Math.max(
    1,
    Math.ceil(
      Math.max(Math.abs(c[i + 2] - c[i]), Math.abs(c[i + 3] - c[i + 1])) / 0.08,
    ),
  );
}

function decode(path, scale) {
  let length = 0;
  for (let i = 0; i < path.length; i++) if (path.charCodeAt(i) < 95) length++;
  const raw = new Float64Array(length);
  let extra = 0;
  const last = [0, 0];
  let pos = 0;
  for (let i = 0; i < length; i++) {
    let value = 0,
      shift = 0,
      bits;
    do {
      bits = path.charCodeAt(pos++) - 63;
      value |= (bits & 31) << shift;
      shift += 5;
    } while (bits >= 32);
    const axis = i % 2;
    last[axis] += value & 1 ? -(value >>> 1) - 1 : value >>> 1;
    let n = last[axis] / scale;
    if (axis === 0 && i >= 2) n += 360 * Math.round((raw[i - 2] - n) / 360);
    raw[i] = n;
    if (axis === 1 && i >= 3) extra += subdivisions(raw, i - 3) - 1;
  }
  // Source polygons use straight lon/lat edges. Subdivide long edges before
  // spherical measurement so a long park boundary follows the mapped parallel.
  const coords = extra ? new Float64Array(length + 2 * extra) : raw;
  if (extra) {
    coords[0] = raw[0];
    coords[1] = raw[1];
    let target = 2;
    for (let i = 0; i + 3 < length; i += 2) {
      const steps = subdivisions(raw, i);
      for (let j = 1; j <= steps; j++) {
        coords[target++] = raw[i] + ((raw[i + 2] - raw[i]) * j) / steps;
        coords[target++] = raw[i + 1] + ((raw[i + 3] - raw[i + 1]) * j) / steps;
      }
    }
  }
  const xyz = new Float64Array((coords.length / 2) * 3);
  for (let i = 0; i < coords.length; i += 2)
    xyz.set(unitVector(coords[i], coords[i + 1]), (i / 2) * 3);
  return { coords, xyz };
}

function boundaryChunk(ring, first, end, id) {
  const { xyz } = ring;
  const bounds = [1, 1, 1, -1, -1, -1];
  let longest = 0;
  for (let i = first; i <= end; i++) {
    let squared = 0;
    for (let d = 0; d < 3; d++) {
      const v = xyz[i * 3 + d];
      bounds[d] = Math.min(bounds[d], v);
      bounds[d + 3] = Math.max(bounds[d + 3], v);
      if (i > first) squared += (v - xyz[(i - 1) * 3 + d]) ** 2;
    }
    longest = Math.max(longest, squared);
  }
  // Expand from the chord bounds to include the spherical arc.
  const sagitta = 1 - Math.sqrt(Math.max(0, 1 - longest / 4)) + 1e-12;
  for (let d = 0; d < 3; d++) {
    bounds[d] -= sagitta;
    bounds[d + 3] += sagitta;
  }
  return { ring, first, end, id, bounds };
}

function buildTree(chunks, lo, hi) {
  const bounds = [...chunks[lo].bounds];
  for (let i = lo + 1; i < hi; i++) {
    for (let d = 0; d < 3; d++) {
      bounds[d] = Math.min(bounds[d], chunks[i].bounds[d]);
      bounds[d + 3] = Math.max(bounds[d + 3], chunks[i].bounds[d + 3]);
    }
  }
  if (hi - lo <= 4) return { bounds, lo, hi };
  let axis = 0;
  for (let d = 1; d < 3; d++)
    if (bounds[d + 3] - bounds[d] > bounds[axis + 3] - bounds[axis]) axis = d;
  const mid = (lo + hi) >>> 1;
  const center = (item) => item.bounds[axis] + item.bounds[axis + 3];
  quickselect(chunks, mid, lo, hi - 1, (a, b) => center(a) - center(b));
  return {
    bounds,
    left: buildTree(chunks, lo, mid),
    right: buildTree(chunks, mid, hi),
  };
}

function boxDistance(x, y, z, b) {
  const dx = Math.max(0, b[0] - x, x - b[3]);
  const dy = Math.max(0, b[1] - y, y - b[4]);
  const dz = Math.max(0, b[2] - z, z - b[5]);
  return dx * dx + dy * dy + dz * dz;
}

function segmentDistance(x, y, z, coords, i) {
  const ax = coords[i],
    ay = coords[i + 1],
    az = coords[i + 2];
  const bx = coords[i + 3],
    by = coords[i + 4],
    bz = coords[i + 5];
  const dx = bx - ax,
    dy = by - ay,
    dz = bz - az;
  const along = x * dx + y * dy + z * dz;
  const sum = x * (ax + bx) + y * (ay + by) + z * (az + bz);
  const length2 = dx * dx + dy * dy + dz * dz;
  // In the orthogonal sum/difference basis the great-circle foot lies on
  // the minor arc iff its difference coefficient is within ± its sum coefficient.
  if (
    sum > 0 &&
    length2 > 0 &&
    Math.abs(along) * (4 - length2) < sum * length2
  ) {
    const nx = ay * dz - az * dy,
      ny = az * dx - ax * dz,
      nz = ax * dy - ay * dx;
    const cross = x * nx + y * ny + z * nz;
    const sin2 = Math.min(1, (cross * cross) / (nx * nx + ny * ny + nz * nz));
    return (2 * sin2) / (1 + Math.sqrt(1 - sin2));
  }
  return along <= 0
    ? (x - ax) ** 2 + (y - ay) ** 2 + (z - az) ** 2
    : (x - bx) ** 2 + (y - by) ** 2 + (z - bz) ** 2;
}

function ringBounds(coords) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < coords.length; i += 2) {
    if (!Number.isFinite(coords[i])) continue;
    bounds[0] = Math.min(bounds[0], coords[i]);
    bounds[1] = Math.min(bounds[1], coords[i + 1]);
    bounds[2] = Math.max(bounds[2], coords[i]);
    bounds[3] = Math.max(bounds[3], coords[i + 1]);
  }
  return bounds;
}

function prepareRing(ring) {
  const c = ring.coords,
    b = ringBounds(c);
  const count = Math.max(1, Math.min(512, Math.ceil(c.length / 80)));
  ring.bounds = b;
  if (count <= 1) return;
  const buckets = Array.from({ length: count }, () => []);
  for (let i = 0; i + 3 < c.length; i += 2) {
    if (c[i + 1] === c[i + 3]) continue;
    const a = latitudeBucket(b, count, c[i + 1]),
      end = latitudeBucket(b, count, c[i + 3]);
    for (let j = Math.min(a, end); j <= Math.max(a, end); j++)
      buckets[j].push(i);
  }
  ring.buckets = buckets;
}
function latitudeBucket(b, count, y) {
  return Math.min(
    count - 1,
    Math.max(0, Math.floor(((y - b[1]) / (b[3] - b[1] || 1)) * count)),
  );
}
function contains(ring, lon, lat) {
  const b = ring.bounds,
    c = ring.coords;
  if (lat < b[1] || lat > b[3]) return false;
  const x = lon + 360 * Math.round(((b[0] + b[2]) / 2 - lon) / 360);
  if (x < b[0] || x > b[2]) return false;
  const indices = ring.buckets?.[latitudeBucket(b, ring.buckets.length, lat)];
  const length = indices ? indices.length : c.length / 2 - 1;
  let inside = false;
  for (let j = 0; j < length; j++) {
    const i = indices ? indices[j] : 2 * j;
    const y1 = c[i + 1],
      y2 = c[i + 3];
    if (
      y1 > lat !== y2 > lat &&
      x < c[i] + ((lat - y1) * (c[i + 2] - c[i])) / (y2 - y1)
    )
      inside = !inside;
  }
  return inside;
}

const cellKey = (x, y) => (y + 90) * 360 + ((((x + 180) % 360) + 360) % 360);

export class NatureIndex {
  constructor({ parts, names, scale, geometry }) {
    this.names = names;
    this.parts = [];
    this.chunks = [];
    this.areaCells = new Map();
    for (const [id, ...paths] of parts) {
      const rings = paths.map((p) => decode(p, scale));
      const part = { id, rings };
      this.parts.push(part);
      for (const ring of rings) {
        const last = ring.xyz.length / 3 - 1;
        for (let i = 0; i < last; i += chunkLength)
          this.chunks.push(
            boundaryChunk(ring, i, Math.min(i + chunkLength, last), id),
          );
      }
      if (geometry !== "area") continue;
      rings.forEach(prepareRing);
      const [w, s, e, n] = rings[0].bounds;
      for (let y = Math.floor(s); y <= Math.floor(n); y++)
        for (let x = Math.floor(w); x <= Math.floor(e); x++) {
          const key = cellKey(x, y);
          if (!this.areaCells.has(key)) this.areaCells.set(key, []);
          this.areaCells.get(key).push(part);
        }
    }
    this.tree = buildTree(this.chunks, 0, this.chunks.length);
  }
  nearest(x, y, z, lon, lat) {
    const areas = this.areaCells.get(cellKey(Math.floor(lon), Math.floor(lat)));
    if (areas)
      for (const { id, rings } of areas)
        if (
          contains(rings[0], lon, lat) &&
          !rings.some((r, i) => i > 0 && contains(r, lon, lat))
        )
          return { id, miles: 0 };
    let best = Infinity,
      id = -1;
    const visit = (node) => {
      if (node.left) {
        const a = boxDistance(x, y, z, node.left.bounds),
          b = boxDistance(x, y, z, node.right.bounds);
        if (a <= b) {
          if (a <= best) visit(node.left);
          if (b <= best) visit(node.right);
        } else {
          if (b <= best) visit(node.right);
          if (a <= best) visit(node.left);
        }
        return;
      }
      for (let k = node.lo; k < node.hi; k++) {
        const c = this.chunks[k];
        if (boxDistance(x, y, z, c.bounds) > best) continue;
        for (let i = c.first * 3; i < c.end * 3; i += 3) {
          const d = segmentDistance(x, y, z, c.ring.xyz, i);
          if (d < best) {
            best = d;
            id = c.id;
          }
        }
      }
    };
    visit(this.tree);
    return {
      id,
      miles: 2 * earthMiles * Math.asin(Math.min(1, Math.sqrt(best) / 2)),
    };
  }
  outline(frame) {
    const { x, y, w, h, width } = frame;
    const step = w / width;
    const key = [x, y, w, h, width].join(",");
    if (key === this.outlineKey) return this.outlinePath;
    const lines = [];
    for (const { rings } of this.parts)
      for (const ring of rings) {
        if (!ring.projected) {
          const c = ring.coords,
            xy = new Float32Array(c.length);
          for (let i = 0; i < c.length; i += 2) {
            const p = projection([c[i], c[i + 1]]);
            xy[i] = p?.[0] ?? NaN;
            xy[i + 1] = p?.[1] ?? NaN;
          }
          ring.projected = xy;
          ring.mapBounds = ringBounds(xy);
        }
        const [w0, s0, e0, n0] = ring.mapBounds;
        if (
          e0 < x ||
          w0 > x + w ||
          n0 < y ||
          s0 > y + h ||
          Math.max(e0 - w0, n0 - s0) < step * 0.75
        )
          continue;
        const c = ring.projected;
        let lastX = NaN,
          lastY = NaN;
        for (let i = 0; i < c.length; i += 2) {
          const px = c[i],
            py = c[i + 1];
          if (!Number.isFinite(px)) {
            lastX = NaN;
            continue;
          }
          const start = !Number.isFinite(lastX);
          if (
            !start &&
            i < c.length - 2 &&
            Math.max(Math.abs(px - lastX), Math.abs(py - lastY)) < step
          )
            continue;
          lines.push((start ? "M" : "L") + px.toFixed(2) + "," + py.toFixed(2));
          lastX = px;
          lastY = py;
        }
      }
    this.outlineKey = key;
    this.outlinePath = lines.join("");
    return this.outlinePath;
  }
}
