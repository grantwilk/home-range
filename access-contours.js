// A semantic class combines the local matching decision with the displayed band.
// Band -1 is unknown, and null leaves the underlying county color visible.
export function classifyAccess(needed, fields, hasPoints, shown, bins, mode) {
  const active = needed.map((f, j) => (f.on ? j : -1)).filter((j) => j >= 0);
  function test(j, v) {
    if (!hasPoints[j]) return 0;
    if (Number.isNaN(v)) return -1;
    return +(v >= needed[j].min && v <= needed[j].max);
  }
  function vote(i) {
    let unknown = false;
    for (const j of active) {
      const v = test(j, fields[j][i]);
      if (mode === "all" && v === 0) return 0;
      if (mode === "any" && v === 1) return 1;
      if (v === -1) unknown = true;
    }
    if (!active.length) return 2;
    return unknown ? -1 : +(mode === "all");
  }
  function bandAt(i) {
    if (shown < 0) return null;
    const v = fields[shown][i];
    if (Number.isNaN(v)) return -1;
    let band = 0;
    while (band < bins.length && v >= bins[band]) band++;
    return band;
  }
  const stride = bins.length + 3;
  const decode = (key) => ({
    vote: Math.floor(key / stride) - 1,
    band: key % stride === 0 ? null : (key % stride) - 2,
  });
  const label = (i) => (vote(i) + 1) * stride + (shown < 0 ? 0 : bandAt(i) + 2);
  function fraction(j, a, b, threshold) {
    const v = fields[j][a],
      w = fields[j][b];
    if (!Number.isFinite(v) || !Number.isFinite(w) || v === w) return 0.5;
    return Math.max(0, Math.min(1, (threshold - v) / (w - v)));
  }
  function crossing(a, b, ka, kb) {
    const first = decode(ka),
      last = decode(kb);
    let voteAt = null,
      band = null;
    if (first.vote !== last.vote) {
      voteAt = 0.5;
      if (first.vote >= 0 && last.vote >= 0) {
        // An intersection appears when the last previously failed filter passes.
        // A union appears as soon as the first one passes. Reverse for exits.
        const useLast = (last.vote === 1) === (mode === "all");
        let boundary = useLast ? -Infinity : Infinity;
        for (const j of active) {
          const v = fields[j][a],
            w = fields[j][b],
            left = test(j, v),
            right = test(j, w);
          if (left === right) continue;
          const outside = left === 0 ? v : w;
          const t =
            left < 0 || right < 0
              ? 0.5
              : fraction(
                  j,
                  a,
                  b,
                  outside < needed[j].min ? needed[j].min : needed[j].max,
                );
          boundary = useLast ? Math.max(boundary, t) : Math.min(boundary, t);
        }
        if (Number.isFinite(boundary)) voteAt = boundary;
      }
    }
    if (first.band !== last.band) {
      if (first.band < 0 || last.band < 0) band = 0.5;
      else {
        const lo = Math.min(first.band, last.band),
          hi = Math.max(first.band, last.band);
        // More than one bin can fit between two samples. Keep the sampled
        // categories and put their dividing line between the crossed limits.
        band =
          (fraction(shown, a, b, bins[lo]) +
            fraction(shown, a, b, bins[hi - 1])) /
          2;
      }
    }
    const t =
      voteAt === null ? band : band === null ? voteAt : (band + voteAt) / 2;
    return Math.min(0.99, Math.max(0.01, t ?? 0.5));
  }
  return { label, decode, crossing };
}

// Most edges in dense national layers span only a few samples. Encode those
// as short relative coordinates; long closure segments can be shorter absolute.
const numbers = new Map();
function decimal(tenths) {
  if (numbers.has(tenths)) return numbers.get(tenths);
  const value = String(tenths / 10).replace(/^(-?)0\./, "$1.");
  numbers.set(tenths, value);
  return value;
}
function pair(x, y) {
  return decimal(x) + (y < 0 ? "" : " ") + decimal(y);
}

function simplifyChain(chain, points, tolerance) {
  if (chain.length < 3) return chain;
  const keep = new Uint8Array(chain.length);
  keep[0] = keep[chain.length - 1] = 1;
  const stack = [[0, chain.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop(),
      a = points.get(chain[lo]),
      b = points.get(chain[hi]);
    const dx = b.x - a.x,
      dy = b.y - a.y,
      squared = dx * dx + dy * dy;
    let far = -1,
      max = tolerance * tolerance;
    for (let i = lo + 1; i < hi; i++) {
      const p = points.get(chain[i]);
      const t = squared
        ? Math.max(
            0,
            Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / squared),
          )
        : 0;
      const ox = p.x - a.x - t * dx,
        oy = p.y - a.y - t * dy,
        d = ox * ox + oy * oy;
      if (d > max) {
        max = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([lo, far], [far, hi]);
    }
  }
  return chain.filter((_, i) => keep[i]);
}

// A closed arc can touch another region at exactly one junction. Both sides
// must split that loop at the same vertex even when one side is part of a
// longer ring. Stable ties also keep reversed contours identical.
function simplifyArc(chain, points) {
  if (chain[0] === chain.at(-1)) {
    const start = points.get(chain[0]);
    let far = 1,
      max = -1;
    for (let i = 1; i < chain.length - 1; i++) {
      const p = points.get(chain[i]),
        d = (p.x - start.x) ** 2 + (p.y - start.y) ** 2;
      if (d > max || (d === max && chain[i] < chain[far])) {
        max = d;
        far = i;
      }
    }
    const first = simplifyArc(chain.slice(0, far + 1), points);
    first.pop();
    return first.concat(simplifyArc(chain.slice(far), points));
  }
  const reverse = chain[0] > chain.at(-1);
  if (reverse) chain.reverse();
  const result = simplifyChain(chain, points, 0.17);
  return reverse ? result.reverse() : result;
}

function simplifyRing(ids, points, locked) {
  const anchors = [];
  for (let i = 0; i < ids.length; i++) if (locked.has(ids[i])) anchors.push(i);
  if (!anchors.length) {
    let start = 0;
    for (let i = 1; i < ids.length; i++) if (ids[i] < ids[start]) start = i;
    anchors.push(start);
  }
  const kept = [];
  for (let j = 0; j < anchors.length; j++) {
    const a = anchors[j],
      b = anchors[(j + 1) % anchors.length];
    const chain =
      a < b ? ids.slice(a, b + 1) : ids.slice(a).concat(ids.slice(0, b + 1));
    // Simplify canonical shared arcs in a fixed direction so adjacent colors
    // receive exactly the same vertices, including in distance ties.
    const simplified = simplifyArc(chain, points);
    for (let k = 0; k < simplified.length - 1; k++) kept.push(simplified[k]);
  }
  return kept.length >= 3 ? kept : ids;
}

function ringPath(ids, points, locked) {
  const ring = simplifyRing(ids, points, locked);
  const commands = [];
  for (let i = 0; i < ring.length; i++) {
    const id = ring[i],
      p = points.get(id);
    const a = points.get(ring[(i + ring.length - 1) % ring.length]),
      b = points.get(ring[(i + 1) % ring.length]);
    if (locked.has(id)) {
      commands.push({ before: p, after: p });
      continue;
    }
    const dx = a.x - p.x,
      dy = a.y - p.y,
      ex = b.x - p.x,
      ey = b.y - p.y;
    const al = Math.hypot(dx, dy),
      bl = Math.hypot(ex, ey);
    // Round a bend by at most 0.28 sample units; preserve every junction.
    if (!al || !bl || Math.abs(dx * ey - dy * ex) < 0.18 * al * bl) {
      commands.push({ before: p, after: p });
      continue;
    }
    const da = Math.min(0.5, 0.28 / al),
      db = Math.min(0.5, 0.28 / bl);
    commands.push({
      before: { x: p.x + dx * da, y: p.y + dy * da },
      control: p,
      after: { x: p.x + ex * db, y: p.y + ey * db },
    });
  }
  const last = commands.at(-1).after;
  let x = Math.round(last.x * 10),
    y = Math.round(last.y * 10);
  let d = "M" + pair(x, y);
  for (const { before, control, after } of commands) {
    const bx = Math.round(before.x * 10),
      by = Math.round(before.y * 10);
    if (x !== bx || y !== by) {
      let relative, absolute;
      if (y === by) {
        relative = "h" + decimal(bx - x);
        absolute = "H" + decimal(bx);
      } else if (x === bx) {
        relative = "v" + decimal(by - y);
        absolute = "V" + decimal(by);
      } else {
        relative = "l" + pair(bx - x, by - y);
        absolute = "L" + pair(bx, by);
      }
      d += relative.length <= absolute.length ? relative : absolute;
      x = bx;
      y = by;
    }
    if (control) {
      const cx = Math.round(control.x * 10),
        cy = Math.round(control.y * 10);
      const ax = Math.round(after.x * 10),
        ay = Math.round(after.y * 10);
      const relative =
        "q" + pair(cx - x, cy - y) + (ax < x ? "" : " ") + pair(ax - x, ay - y);
      // Rounded endpoints occasionally coincide at a very short bend.
      if (ax !== x || ay !== y) d += relative;
      x = ax;
      y = ay;
    }
  }
  return d + "Z";
}

// Categorical marching squares. A shared interface is constructed once and
// traversed in opposite directions by its neighboring classes. Three-/four-way
// meetings use one fixed vertex. Fill each returned path with evenodd winding.
export function traceContours(labels, width, height, crossing = () => 0.5) {
  const stride = 2 * width + 1,
    points = new Map(),
    locked = new Set(),
    graphs = new Map();
  const ids = [0, 0, 0, 0],
    sides = [0, 0, 0, 0],
    changes = [];
  function segment(a, b, key) {
    if (key < 0) return;
    let graph = graphs.get(key);
    if (!graph) {
      graph = new Map();
      graphs.set(key, graph);
    }
    const old = graph.get(a);
    if (old === undefined) graph.set(a, b);
    else if (Array.isArray(old)) old.push(b);
    else graph.set(a, [old, b]);
  }
  const cell = (x, y) =>
    x < 0 || y < 0 || x >= width || y >= height ? -1 : y * width + x;
  const value = (i) => (i < 0 ? -1 : labels[i]);
  for (let y = 0; y <= height; y++) {
    for (let x = 0; x <= width; x++) {
      ids[0] = cell(x - 1, y - 1);
      ids[1] = cell(x, y - 1);
      ids[2] = cell(x, y);
      ids[3] = cell(x - 1, y);
      const first = value(ids[0]);
      if (
        first === value(ids[1]) &&
        first === value(ids[2]) &&
        first === value(ids[3])
      )
        continue;
      const center = 2 * y * stride + 2 * x;
      sides[0] = center - stride;
      sides[1] = center + 1;
      sides[2] = center + stride;
      sides[3] = center - 1;
      changes.length = 0;
      for (let s = 0; s < 4; s++) {
        const a = ids[s],
          b = ids[(s + 1) % 4],
          va = value(a),
          vb = value(b);
        if (va === vb) continue;
        changes.push(s);
        const id = sides[s];
        if (points.has(id)) continue;
        const t = va < 0 || vb < 0 ? 0.5 : crossing(a, b, va, vb);
        const offset = t - 0.5;
        points.set(id, {
          x: (id % stride) / 2 + (s === 0 ? offset : s === 2 ? -offset : 0),
          y:
            Math.floor(id / stride) / 2 +
            (s === 1 ? offset : s === 3 ? -offset : 0),
        });
      }
      if (changes.length === 2 && x > 0 && y > 0 && x < width && y < height) {
        const [s, t] = changes;
        segment(sides[s], sides[t], value(ids[s]));
        segment(sides[t], sides[s], value(ids[(s + 1) % 4]));
      } else {
        points.set(center, { x, y });
        if (
          changes.length > 2 ||
          ((x === 0 || x === width) && (y === 0 || y === height))
        )
          locked.add(center);
        for (const s of changes) {
          segment(sides[s], center, value(ids[s]));
          segment(center, sides[s], value(ids[(s + 1) % 4]));
        }
      }
    }
  }
  const paths = [];
  for (const [key, graph] of graphs) {
    const parts = [];
    for (const start of graph.keys()) {
      while (graph.has(start)) {
        const ids = [start];
        let here = start;
        do {
          const options = graph.get(here);
          if (options === undefined) throw Error("Open access contour");
          let next;
          if (Array.isArray(options)) {
            next = options.pop();
            if (options.length === 1) graph.set(here, options[0]);
          } else {
            next = options;
            graph.delete(here);
          }
          here = next;
          if (here !== start) ids.push(here);
        } while (here !== start);
        if (ids.length >= 3) parts.push(ringPath(ids, points, locked));
      }
    }
    if (parts.length) paths.push({ key, d: parts.join("") });
  }
  return paths;
}
