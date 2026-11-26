import { projection } from "./spatial.js";
import { selectTownLabels } from "./map-labels.js";

// Shapes are centered at zero in CSS pixels. The same vector paths appear in
// the map, the map key, and the downloadable PDF.
export const referenceSymbols = {
  custom: {
    label: "Custom places",
    color: "#a84223",
    d: "M0-5.2 1.5-1.7 5.3-1.5 2.4.9 3.2 4.8 0 2.7-3.2 4.8-2.4.9-5.3-1.5-1.5-1.7Z",
  },
  hospitals: {
    label: "Major hospitals",
    color: "#aa3245",
    d: "M-1.6-4.8H1.6V-1.6H4.8V1.6H1.6V4.8H-1.6V1.6H-4.8V-1.6H-1.6Z",
  },
  airports: {
    label: "Commercial airports",
    color: "#374f79",
    d: "M-.8-4.6Q0-6 .8-4.6L1.2-1.1 4.8 1.8V3L1.2 2.1.9 4.1 2.0 4.8V5.4L0 5-2 5.4V4.8L-.9 4.1-1.2 2.1-4.8 3V1.8L-1.2-1.1Z",
  },
  cities: { label: "Major cities", color: "#65478b", d: "M0-5 5 0 0 5-5 0Z" },
  grocery: {
    label: "Grocery stores",
    color: "#35734f",
    d: "M-4.8-2H4.8L3.4 4H-3.4ZM-3.2-2-.8-5H.3L-2-2ZM3.2-2 .8-5H-.3L2-2Z",
  },
  schools: {
    label: "K–12 schools",
    color: "#17697a",
    d: "M0-5 5-1.5H4.1V4.5H1V1H-1V4.5H-4.1V-1.5H-5Z",
  },
  towns: {
    label: "Cities & towns",
    color: "#384839",
    d: "M2 0A2 2 0 1 0-2 0A2 2 0 1 0 2 0Z",
  },
};
const cache = new Map();
const mapped = new WeakMap();
const empty = [];
const ns = "http://www.w3.org/2000/svg";
const pt = 0.75;
function svg(tag, attrs = {}) {
  const el = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
function symbol(key) {
  const { d, color } = referenceSymbols[key];
  return svg("path", {
    d,
    fill: color,
    stroke: "#fffdf7",
    "stroke-width": 1.2,
    "paint-order": "stroke fill",
    "stroke-linejoin": "round",
  });
}
function loadPoints(key) {
  let request = cache.get(key);
  if (!request) {
    request = fetch(
      new URL("./data/facilities/" + key + ".json", import.meta.url),
    )
      .then(async (response) => {
        if (!response.ok)
          throw Error(referenceSymbols[key].label + " unavailable");
        return (await response.json()).points;
      })
      .catch((error) => {
        cache.delete(key);
        throw error;
      });
    cache.set(key, request);
  }
  return request;
}
export const loadCityPoints = () => loadPoints("cities");
function xyFor(rows) {
  let xy = mapped.get(rows);
  if (!xy) {
    xy = new Float32Array(rows.length * 2);
    for (let i = 0; i < rows.length; i++) {
      const coords = projection([rows[i][1], rows[i][2]]);
      xy[2 * i] = coords?.[0] ?? NaN;
      xy[2 * i + 1] = coords?.[1] ?? NaN;
    }
    mapped.set(rows, xy);
  }
  return xy;
}
const overlap = (a, b) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;
function centered(x, y, r) {
  return { x: x - r, y: y - r, width: 2 * r, height: 2 * r };
}

// Each screen cell nominates a real visible site. For cities prefer the more
// populous point, for other directories prefer the point nearer the cell center.
function markerCandidates(filter, rows, bounds, scale, size, spacing) {
  const cells = new Map(),
    cols = Math.ceil(size.width / spacing) + 1,
    xy = xyFor(rows);
  const category = Object.keys(referenceSymbols).indexOf(filter.key);
  const offsetX = ((category % 3) * spacing) / 3,
    offsetY = (((category * 2) % 5) * spacing) / 5;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (
      filter.key === "cities" &&
      (!Number.isFinite(row[3]) ||
        row[3] < filter.citySize.min ||
        row[3] > filter.citySize.max)
    )
      continue;
    const x = (xy[2 * i] - bounds.x) * scale,
      y = (xy[2 * i + 1] - bounds.y) * scale;
    if (!(x >= 4 && y >= 4 && x <= size.width - 4 && y <= size.height - 4))
      continue;
    const cx = Math.floor((x + offsetX) / spacing),
      cy = Math.floor((y + offsetY) / spacing),
      id = cy * cols + cx;
    const score =
      filter.key === "cities"
        ? -row[3]
        : (x + offsetX - (cx + 0.5) * spacing) ** 2 +
          (y + offsetY - (cy + 0.5) * spacing) ** 2;
    if (!cells.has(id) || score < cells.get(id).score)
      cells.set(id, { x, y, row, score });
  }
  return cells.values();
}

export class ReferenceMap {
  constructor() {
    this.cityPoints = empty;
    this.directories = new Map();
    this.errors = new Map();
    this.filters = [];
    this.markers = [];
    this.canvas = document.createElement("canvas").getContext("2d");
    this.viewport = document.getElementById("viewport");
    this.pinGroup = document.getElementById("reference-pins");
    this.townGroup = document.getElementById("reference-towns");
    this.key = document.getElementById("reference-key");
  }
  update(filters) {
    const enabled = filters.filter(
      (f) => f.on && Object.hasOwn(referenceSymbols, f.key),
    );
    const token = JSON.stringify(
      enabled.map((f) => [f.key, f.citySize, f.points]),
    );
    if (token === this.token) return;
    this.token = token;
    this.filters = enabled;
    this.errors.clear();
    const keys = [
      ...new Set([
        "cities",
        ...enabled.map((f) => f.key).filter((k) => k !== "custom"),
      ]),
    ];
    this.loading = new Set(keys.filter((k) => !this.directories.has(k)));
    this.legend();
    this.redraw();
    this.pending = Promise.all(
      keys.map(async (key) => {
        if (this.directories.has(key)) return;
        try {
          const rows = await loadPoints(key);
          this.directories.set(key, rows);
          if (key === "cities") this.cityPoints = rows;
        } catch {
          if (this.token === token)
            this.errors.set(
              key,
              key === "cities"
                ? "City and town directory unavailable"
                : referenceSymbols[key].label + " unavailable",
            );
        }
        if (this.token === token) {
          this.loading.delete(key);
          this.legend();
          this.redraw();
        }
      }),
    );
  }
  legend() {
    const frag = document.createDocumentFragment();
    const heading = document.createElement("strong");
    heading.className = "reference-heading";
    heading.textContent = "Map Key";
    frag.append(heading);
    for (const key of ["towns", ...this.filters.map((f) => f.key)]) {
      const entry = document.createElement("span");
      entry.dataset.key = key;
      entry.className = "reference-entry";
      const swatch = svg("svg", {
        viewBox: "0 0 16 16",
        width: 16,
        height: 16,
        "aria-hidden": "true",
      });
      const g = svg("g", { transform: "translate(8 8)" });
      g.append(symbol(key));
      swatch.append(g);
      const label = document.createElement("span");
      label.textContent = referenceSymbols[key].label;
      entry.append(swatch, label);
      frag.append(entry);
    }
    const messages = [
      ...(this.loading.size ? ["Loading map locations…"] : []),
      ...this.errors.values(),
    ];
    if (messages.length) {
      const msg = document.createElement("span");
      msg.className = "reference-status";
      msg.setAttribute("role", "status");
      msg.textContent = messages.join(" · ");
      frag.append(msg);
    }
    this.key.replaceChildren(frag);
  }
  redraw() {
    if (this.frame || !this.loading) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }
  draw() {
    const rect = document
      .getElementById("map-controls")
      .getBoundingClientRect();
    const m = this.viewport.getScreenCTM();
    if (!m?.a || !rect.width || !rect.height) return;
    const origin = new DOMPoint(rect.left, rect.top).matrixTransform(
      m.inverse(),
    );
    const scale = m.a;
    const bounds = {
      x: origin.x,
      y: origin.y,
      width: rect.width / scale,
      height: rect.height / scale,
    };
    const size = { width: rect.width, height: rect.height };
    const reserved = [];
    const symbols = [];
    for (const label of document.querySelectorAll(
      "#statelabels text,.map-scope,#map-controls button,#map-controls .compass",
    )) {
      const r = label.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(label).opacity === "0")
        continue;
      reserved.push({
        state: label.matches("#statelabels text"),
        x: r.left - rect.left - 1,
        y: r.top - rect.top - 1,
        width: r.width + 2,
        height: r.height + 2,
      });
    }
    const pins = document.createDocumentFragment(),
      towns = document.createDocumentFragment();
    const hits = [];
    const area = size.width * size.height;
    const spacing =
      Math.max(17, Math.sqrt(area / Math.min(350, Math.max(35, area / 950)))) *
      Math.sqrt(Math.max(1, this.filters.length) * 0.65 + 0.35);
    // Reserve space for personal pins and sparse categories before placing dense
    // school/store directories. Eligibility for cities can vary from one to thousands.
    const groups = this.filters.map((f) => {
      const rows = f.key === "custom" ? f.points : this.directories.get(f.key);
      const candidates = markerCandidates(
        f,
        rows ?? empty,
        bounds,
        scale,
        size,
        f.key === "custom" ? 11 : spacing,
      );
      return { key: f.key, sites: [...candidates] };
    });
    groups.sort(
      (a, b) =>
        Number(b.key === "custom") - Number(a.key === "custom") ||
        a.sites.length - b.sites.length,
    );
    for (const { key, sites } of groups) {
      const group = svg("g", { "data-key": key });
      for (const site of sites) {
        const box = centered(site.x, site.y, 5.6);
        if (
          symbols.some((b) => overlap(b, box)) ||
          reserved.some(
            (b) => !(key === "custom" && b.state) && overlap(b, box),
          )
        )
          continue;
        const px = bounds.x + site.x / scale,
          py = bounds.y + site.y / scale;
        const mark = svg("g", {
          transform: `translate(${px} ${py}) scale(${1 / scale})`,
        });
        mark.append(symbol(key));
        group.append(mark);
        hits.push({
          key,
          row: site.row,
          px,
          py,
        });
        symbols.push(box);
      }
      if (group.childElementCount) pins.append(group);
    }
    const toPoints = (r) => ({
      x: r.x * pt,
      y: r.y * pt,
      width: r.width * pt,
      height: r.height * pt,
    });
    const labels = selectTownLabels(
      this.cityPoints,
      bounds,
      { width: size.width * pt, height: size.height * pt },
      {
        reserved: reserved.map(toPoints),
        symbols: symbols.map(toPoints),
        measureText: (name, fontSize) => {
          this.canvas.font = `550 ${fontSize}px "DM Sans", sans-serif`;
          return this.canvas.measureText(name).width;
        },
      },
    );
    for (const p of labels) {
      const u = 1 / (pt * scale);
      const dot = svg("circle", {
        cx: bounds.x + p.dotX * u,
        cy: bounds.y + p.dotY * u,
        r: 1.5 / scale,
        fill: "#394c3e",
        stroke: "#fffdf6",
        "stroke-width": 0.85 / scale,
      });
      const label = svg("text", {
        x: bounds.x + p.x * u,
        y: bounds.y + p.y * u,
        "font-size": p.fontSize * u,
        "font-weight": "550",
        "font-family": "DM Sans, sans-serif",
        fill: "#293e32",
        stroke: "#fffef7",
        "stroke-width": 2.2 / scale,
        "paint-order": "stroke fill",
        "stroke-linejoin": "round",
      });
      label.textContent = p.name;
      if (!p.coveredDot) towns.append(dot);
      towns.append(label);
    }
    this.markers = hits;
    this.townGroup.replaceChildren(towns);
    this.pinGroup.replaceChildren(pins);
  }
  point(event) {
    const matrix = this.viewport.getScreenCTM();
    if (!matrix) return null;
    const loc = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    let best = (6 / matrix.a) ** 2,
      result = null;
    for (const { px, py, row } of this.markers) {
      const delta = (loc.x - px) ** 2 + (loc.y - py) ** 2;
      if (delta <= best) {
        best = delta;
        result = { name: row[0], lon: row[1], lat: row[2], population: row[3] };
      }
    }
    return result;
  }
  async ready() {
    // A new export is an explicit retry after a previous source failure.
    if (this.errors.size) {
      this.token = null;
      this.update(this.filters);
    }
    let pending;
    do {
      pending = this.pending;
      await pending;
    } while (pending !== this.pending);
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.draw();
    return { errors: [...this.errors.values()] };
  }
}
