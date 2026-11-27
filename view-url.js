// The query describes the map. Saved custom locations stay in the fragment,
// which a browser keeps out of requests to the static host.
import { layers, defaults, freshFilter, retiredMeasure } from "./model.js";
import { validPoint } from "./facility-model.js";

const settings = new Set([
  "match",
  "layer",
  "paused",
  "filters",
  "extent",
  "mapCutoff",
  "heatDays.cutoff",
  "coldDays.cutoff",
  "cities.population",
]);
const retiredRegions = ["prairieRegion", "plainsRegion", "desertClimate"];
const isLayer = (key) => Object.hasOwn(layers, key);
// Retired measure keys must reach the model’s unit migration.
const readableLayer = (key) => retiredMeasure(key) || isLayer(key);
const isSetting = (key) =>
  settings.has(key) ||
  retiredRegions.includes(key) ||
  readableLayer(key) ||
  (key.endsWith(".unit") &&
    isLayer(key.slice(0, -5)) &&
    layers[key.slice(0, -5)].facility);
const numeric = (part) => (part?.trim() ? Number(part) : NaN);

function readRange(text) {
  const ends = text.split("..");
  return ends.length === 2
    ? { min: numeric(ends[0]), max: numeric(ends[1]) }
    : { min: NaN, max: NaN };
}
const rangeText = ({ min, max }) => min + ".." + max;

export function readViewUrl(url, warn) {
  const q = url.searchParams;
  if (![...q.keys()].some(isSetting)) {
    if (!url.hash.startsWith("#view=")) return null;
    try {
      return JSON.parse(decodeURIComponent(url.hash.slice(6)));
    } catch {
      warn("The shared view could not be read. Showing the default map.");
      return null;
    }
  }
  const raw = { mode: q.get("match"), layer: q.get("layer") };
  if (q.has("mapCutoff")) raw.cutoff = numeric(q.get("mapCutoff"));
  if (q.has("extent")) raw.extent = q.get("extent").split(",").map(numeric);

  const paused = new Set(q.getAll("paused"));
  function restoreOptions(f) {
    const key = f.key;
    // Legacy shares expressed travel-time ranges with a unit query parameter.
    // Pass only the old minute marker to parseView for explicit migration.
    if (layers[key]?.facility && q.get(key + ".unit") === "min")
      f.units = "min";
    if (layers[key]?.threshold && q.has(key + ".cutoff"))
      f.cutoff = numeric(q.get(key + ".cutoff"));
    if (key === "cities" && q.has("cities.population"))
      f.citySize = readRange(q.get("cities.population"));
    if (key === "custom") {
      f.points = [];
      const fragment = new URLSearchParams(url.hash.slice(1));
      for (const encoded of fragment.getAll("place")) {
        try {
          const point = JSON.parse(encoded);
          if (!validPoint(point)) throw new Error();
          f.points.push(point);
        } catch {
          warn("An invalid custom location was skipped.");
        }
      }
    }
    return f;
  }
  const county = [];
  for (const [key, text] of q) {
    if (!readableLayer(key)) continue;
    county.push(
      restoreOptions({ key, ...readRange(text), on: !paused.has(key) }),
    );
  }
  if (
    county.length ||
    q.get("filters") === "none" ||
    retiredRegions.some((key) => q.has(key)) ||
    retiredRegions.includes(raw.layer)
  )
    raw.county = county;
  if (readableLayer(raw.layer) && q.get("filters") !== "none") {
    raw.county ??= defaults().county;
    if (!raw.county.some((f) => f.key === raw.layer))
      raw.county.push(
        isLayer(raw.layer)
          ? restoreOptions(freshFilter(raw.layer))
          : { key: raw.layer, on: false },
      );
  }
  return raw;
}

export function writeViewUrl(base, state, extent) {
  const url = new URL(base);
  const q = url.searchParams;
  for (const key of new Set(q.keys())) {
    if (isSetting(key)) q.delete(key);
  }
  const fragment = url.hash.startsWith("#view=")
    ? []
    : url.hash
        .slice(1)
        .split("&")
        .filter((part) => part && !new URLSearchParams(part).has("place"));
  for (const f of state.county) {
    q.append(f.key, rangeText(f));
    if (!f.on) q.append("paused", f.key);
    const threshold = layers[f.key]?.threshold;
    if (threshold && f.cutoff !== threshold.initial)
      q.set(f.key + ".cutoff", f.cutoff);
    if (f.key === "cities") q.set("cities.population", rangeText(f.citySize));
    if (f.key === "custom")
      for (const point of f.points)
        fragment.push(
          new URLSearchParams({ place: JSON.stringify(point) }).toString(),
        );
  }
  if (!state.county.length) q.set("filters", "none");
  if (state.layer) q.set("layer", state.layer);
  q.set("match", state.mode);
  if (state.cutoff !== 90) q.set("mapCutoff", state.cutoff);
  if (extent[0] !== 1) q.set("extent", extent.join(","));
  url.hash = fragment.join("&");
  return url;
}
