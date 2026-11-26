import {
  SiteIndex,
  projection,
  unitVector,
  countyGrid,
  countyEdges,
} from "./spatial.js";
import { facilityLayers } from "./facility-model.js";
import { NatureIndex } from "./nature-spatial.js";
import { classifyAccess, traceContours } from "./access-contours.js";

const sources = new Map(),
  indices = new Map();
let counties = [],
  grid,
  latest,
  busy = false,
  generation = 0;
async function source(key) {
  const nature = facilityLayers[key].nature;
  if (!sources.has(key))
    sources.set(
      key,
      fetch(
        new URL(
          nature
            ? "./data/nature/" + key + ".json.gz"
            : "./data/facilities/" + key + ".json",
          import.meta.url,
        ),
      )
        .then(async (r) => {
          if (!r.ok)
            throw Error(
              facilityLayers[key].name + " directory could not load.",
            );
          if (nature) {
            // Static hosts may serve .gz as a file or decode its HTTP content encoding.
            const blob = await r.blob();
            const bytes = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
            const stream =
              bytes[0] === 31 && bytes[1] === 139
                ? blob.stream().pipeThrough(new DecompressionStream("gzip"))
                : blob.stream();
            const payload = await new Response(stream).json();
            const { source, url, period, definition } = payload;
            const count = payload.parts.length;
            const index = new NatureIndex(payload);
            self.postMessage({
              type: "source",
              key,
              meta: { source, url, period, definition },
              count,
            });
            return { token: key, index, count };
          }
          const { points, ...meta } = await r.json();
          self.postMessage({ type: "source", key, meta, count: points.length });
          return points;
        })
        .catch((error) => {
          sources.delete(key);
          throw error;
        }),
    );
  return sources.get(key);
}
async function prepare(f) {
  if (facilityLayers[f.key].members) {
    const members = await Promise.all(
      facilityLayers[f.key].members.map(source),
    );
    return {
      token: f.key,
      members,
      count: members.reduce((sum, record) => sum + record.count, 0),
    };
  }
  if (facilityLayers[f.key].nature) return source(f.key);
  const token = JSON.stringify([f.key, f.citySize, f.points]);
  let record = indices.get(f.key);
  if (record?.token !== token) {
    const rows = f.key === "custom" ? f.points : await source(f.key);
    const points =
      f.key === "cities"
        ? rows.filter(
            (p) =>
              Number.isFinite(p[3]) &&
              p[3] >= f.citySize.min &&
              p[3] <= f.citySize.max,
          )
        : rows;
    const xy = new Float32Array(points.length * 2);
    points.forEach((p, i) =>
      xy.set(projection([p[1], p[2]]) ?? [NaN, NaN], 2 * i),
    );
    record = {
      token,
      points,
      xy,
      count: points.length,
      index: new SiteIndex(points),
    };
    indices.set(f.key, record);
  }
  return record;
}
// Evaluate a two-sample halo around each county's full bounds. Tiny islands
// can lie between sample centers. SVG county paths perform the actual land clip.
function sampleMask({ x, y, w, h, width, height }) {
  const stride = width + 1,
    delta = new Int16Array(stride * (height + 1));
  for (const {
    bounds: [xmin, ymin, xmax, ymax],
  } of counties) {
    const left = Math.max(0, Math.floor(((xmin - x) * width) / w) - 2);
    const right = Math.min(width, Math.ceil(((xmax - x) * width) / w) + 2);
    const top = Math.max(0, Math.floor(((ymin - y) * height) / h) - 2);
    const bottom = Math.min(height, Math.ceil(((ymax - y) * height) / h) + 2);
    if (left >= right || top >= bottom) continue;
    delta[top * stride + left]++;
    delta[top * stride + right]--;
    delta[bottom * stride + left]--;
    delta[bottom * stride + right]++;
  }
  const mask = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    let running = 0;
    for (let col = 0; col < width; col++) {
      const i = row * stride + col;
      if (row) delta[i] += delta[i - stride];
      running += delta[i];
      mask[row * width + col] = +(running > 0);
    }
  }
  return mask;
}
function sampleGrid(frame) {
  const key = JSON.stringify(frame);
  if (grid?.key === key) return grid;
  const { x, y, w, h, width, height } = frame;
  const mask = sampleMask(frame);
  const vectors = new Float64Array(mask.length * 3);
  const lonLat = new Float64Array(mask.length * 2);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const pos = projection.invert([
      x + (((i % width) + 0.5) * w) / width,
      y + ((Math.floor(i / width) + 0.5) * h) / height,
    ]);
    if (!pos || !pos.every(Number.isFinite)) {
      mask[i] = 0;
      continue;
    }
    vectors.set(unitVector(...pos), i * 3);
    lonLat.set(pos, i * 2);
  }
  grid = { key, mask, vectors, lonLat, fields: new Map() };
  return grid;
}
function values(g, key, record) {
  const old = g.fields.get(key);
  if (old?.token === record.token) return old.values;
  if (record.members) {
    const [rivers, lakes] = record.members.map((part) =>
      values(g, part.token, part),
    );
    const data = rivers.map((distance, i) => Math.min(distance, lakes[i]));
    g.fields.set(key, { token: record.token, values: data });
    return data;
  }
  const data = new Float32Array(g.mask.length);
  for (let i = 0; i < data.length; i++) {
    if (!g.mask[i] || !record.count) {
      data[i] = NaN;
      continue;
    }
    const k = i * 3;
    data[i] = record.index.nearest(
      g.vectors[k],
      g.vectors[k + 1],
      g.vectors[k + 2],
      g.lonLat[2 * i],
      g.lonLat[2 * i + 1],
    ).miles;
  }
  g.fields.set(key, { token: record.token, values: data });
  return data;
}
function pinsFor(record, frame) {
  const { x, y, w, h, width, height } = frame,
    bins = new Set(),
    pins = [];
  // At small scales keep one real site per screen bin; zooming reveals nearby sites.
  for (let i = 0; i < record.points.length; i++) {
    const px = ((record.xy[2 * i] - x) * width) / w,
      py = ((record.xy[2 * i + 1] - y) * height) / h;
    if (!Number.isFinite(px) || px < 0 || py < 0 || px >= width || py >= height)
      continue;
    const spacing = frame.spacing;
    const cell =
      Math.floor(py / spacing) * Math.ceil(width / spacing) +
      Math.floor(px / spacing);
    if (bins.has(cell)) continue;
    bins.add(cell);
    pins.push([
      px,
      py,
      record.points[i][0],
      record.points[i][1],
      record.points[i][2],
      record.points[i][3],
    ]);
  }
  return pins;
}
async function render(req) {
  const { filters, layer, frame, mode } = req;
  const needed = filters.filter((f) => f.on || f.key === layer);
  const keep = new Set(
    needed.flatMap((f) => facilityLayers[f.key].members ?? [f.key]),
  );
  for (const key of sources.keys()) {
    if (facilityLayers[key].nature && !keep.has(key)) sources.delete(key);
  }
  const records = await Promise.all(needed.map(prepare));
  if (req.id !== generation) return;
  const g = sampleGrid(frame),
    fields = needed.map((f, i) => values(g, f.key, records[i]));
  const shown = needed.findIndex((f) => f.key === layer);
  const classes = classifyAccess(
    needed,
    fields,
    records.map((r) => r.count > 0),
    shown,
    facilityLayers[layer]?.bins ?? [],
    mode,
  );
  const labels = new Int16Array(g.mask.length).fill(-1);
  for (let i = 0; i < labels.length; i++) {
    if (g.mask[i]) labels[i] = classes.label(i);
  }
  const contours = traceContours(
    labels,
    frame.width,
    frame.height,
    classes.crossing,
  ).map(({ key, d }) => ({ ...classes.decode(key), d }));
  const displayed = records[shown];
  const pins = displayed?.points ? pinsFor(displayed, frame) : [];
  self.postMessage({
    type: "render",
    id: req.id,
    frame,
    contours,
    pins,
    outline: displayed?.members
      ? displayed.members.map((r) => r.index.outline(frame)).join("")
      : (displayed?.index.outline?.(frame) ?? ""),
    count: displayed?.count ?? 0,
  });
}
async function drain() {
  if (busy) return;
  busy = true;
  while (latest) {
    const req = latest;
    latest = null;
    try {
      await render(req);
    } catch (e) {
      if (req.id === generation)
        self.postMessage({
          type: "error",
          id: req.id,
          message: String(e.message || e),
        });
    }
  }
  busy = false;
}
self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    counties = data.counties.map(([d, ...bounds]) => ({
      edges: countyEdges(d),
      bounds,
    }));
    return;
  }
  if (data.type === "render") {
    generation = data.id;
    latest = data;
    void drain();
    return;
  }
  if (data.type === "cancel") {
    generation = data.id;
    latest = null;
    grid = null;
    for (const key of sources.keys())
      if (facilityLayers[key].nature) sources.delete(key);
    return;
  }
  if (data.type === "inspect") {
    const { lon, lat, filters, id } = data;
    try {
      const rows = await Promise.all(
        filters.map(async (f) => {
          const record = await prepare(f);
          const candidates = (record.members ?? [record]).map((rec) => {
            const n = rec.index.nearest(...unitVector(lon, lat), lon, lat);
            return {
              key: f.key,
              name: rec.points ? rec.points[n.id]?.[0] : rec.index.names[n.id],
              miles: n.miles,
            };
          });
          return candidates.reduce((best, hit) =>
            hit.miles < best.miles ? hit : best,
          );
        }),
      );
      const xy = projection([lon, lat]);
      const countyIndex = xy
        ? countyGrid(counties, {
            x: xy[0] - 0.5,
            y: xy[1] - 0.5,
            w: 1,
            h: 1,
            width: 1,
            height: 1,
          })[0]
        : -1;
      self.postMessage({ type: "inspect", id, rows, countyIndex });
    } catch (e) {
      self.postMessage({ type: "inspect", id, error: e.message });
    }
  }
};
