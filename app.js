import { combine, projection } from "./spatial.js";
import { FacilityMap } from "./facility-map.js";
import { ReferenceMap } from "./map-reference.js";
import { citySize } from "./facility-model.js";
import {
  catalogMatches,
  entryFor,
  optionName,
  newCard,
  changeSubtype,
} from "./filter-catalog.js";
import { readViewUrl, writeViewUrl } from "./view-url.js";
import { editPlaces } from "./custom-places.js";
import { countyHazards, hazardLayers } from "./hazards.js";
import { icon } from "./icons.js";
import {
  layers,
  poles,
  value,
  outcome,
  countyReading,
  matchRange,
  color,
  defaults,
  parseView,
  fmt,
  sliderPosition,
  metricName,
} from "./model.js";
const $ = (id) => document.getElementById(id),
  esc = (x) =>
    String(x).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
document
  .querySelectorAll("[data-icon]")
  .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
const svg = $("map"),
  mapFit = $("map-fit"),
  ns = svg.namespaceURI,
  dialog = $("dialog");
const svgNode = (tag, attrs, parent) => {
  const el = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent.append(el);
  return el;
};
const number = (n) => n.toLocaleString("en-US");
const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact" });
let state = defaults(),
  places = [],
  byID = new Map(),
  selected = null,
  tick = 0;
let zoom = 1,
  tx = 0,
  ty = 0,
  drag = null,
  ignoreClick = false;

let lastViewUrl;
let writeTimer;
let restoringView = false;

function shareUrl() {
  return writeViewUrl(location.href, state, [zoom, tx, ty]).href;
}
function syncAddress() {
  clearTimeout(writeTimer);
  writeTimer = undefined;
  if (restoringView || location.href !== lastViewUrl) return;
  const href = shareUrl();
  if (href !== lastViewUrl) {
    try {
      history.replaceState(history.state, "", href);
      lastViewUrl = href;
    } catch (error) {
      // Some browser contexts restrict address changes. Share still formats a fresh link.
      if (error.name !== "SecurityError") throw error;
    }
  }
}
// Coalesce continuous pointer and wheel updates without filling browser history.
function scheduleAddress() {
  if (!restoringView && writeTimer === undefined)
    writeTimer = setTimeout(syncAddress, 350);
}
function restoreAddress() {
  if (lastViewUrl === location.href) return;
  lastViewUrl = location.href;
  clearTimeout(writeTimer);
  writeTimer = undefined;
  cancelAnimationFrame(tick);
  restoringView = true;
  const warnings = new Set();
  const warn = (message) => warnings.add(message);
  const raw = readViewUrl(new URL(location.href), warn);
  state = parseView(raw, warn);
  [zoom, tx, ty] =
    Array.isArray(raw?.extent) &&
    raw.extent.length === 3 &&
    raw.extent.every(Number.isFinite)
      ? raw.extent
      : [1, 0, 0];
  zoom = Math.max(1, Math.min(120, zoom));
  constrain();
  if (dialog.open) dialog.close();
  selected = null;
  highlight();
  $("hover").hidden = true;
  renderControls();
  viewTransform();
  refresh();
  restoringView = false;
  if (
    (Array.isArray(raw?.station) && raw.station.some((f) => f?.on)) ||
    ["clear", "partlyCloudy", "cloudy", "dryDays"].includes(raw?.layer) ||
    (Array.isArray(raw?.county) &&
      raw.county.some((f) => f?.key === "dryDays" && f.on))
  )
    notify(
      "Loaded county filters. Retired station and dry-day settings were skipped.",
    );
  if (warnings.size)
    showDialog(
      "Review This Shared View",
      [...warnings].map((w) => "<p>" + esc(w) + "</p>").join(""),
    );
}
const notApplicableLayers = new Set();
let access;
let referenceMap;
const filters = () => state.county;
const metric = () => layers[state.layer];
const cityMetric = {
  ...citySize,
  sliderStops: layers.population.sliderStops,
  sliderTicks: layers.population.sliderTicks,
};

const refreshOnFrame = () => {
  cancelAnimationFrame(tick);
  tick = requestAnimationFrame(() => refresh(true));
};
const fill = (el, c) => {
  if (el.getAttribute("fill") !== c) el.setAttribute("fill", c);
};

function showDialog(title, html) {
  $("dialog-title").textContent = title;
  $("dialog-body").innerHTML = html;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}
function notify(msg) {
  $("toast").textContent = msg;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => ($("toast").textContent = ""), 2600);
}
// Choosing the displayed measure is independent of enabling its range.
function selectLayer(key) {
  state.layer = key;
  renderControls();
  refresh();
}
const pressed = (id, yes) => $(id).setAttribute("aria-pressed", String(yes));
function rangeEditor(filter, city = false) {
  const f = city ? filter.citySize : filter;
  const m = city ? cityMetric : layers[filter.key],
    [min, max] = m.domain;
  const [start, end] = m.sliderStops ? [0, m.sliderStops.length - 1] : m.domain;
  const bounds = ["min", "max"];
  const inputs = bounds
    .map((bound) => {
      const name = bound === "min" ? "Minimum" : "Maximum";
      return `<label><span>${name} <small>${m.unit}</small></span><input class="num" data-bound="${bound}" type="number" step="${m.step ?? 0.1}" aria-label="${m.name} ${name.toLowerCase()}"></label>`;
    })
    .join("");
  const handles = bounds
    .map(
      (bound) =>
        `<input class="range" type="range" data-bound="${bound}" min="${start}" max="${end}" step="${m.sliderStops ? 1 : (m.step ?? 0.1)}" aria-label="${m.name} ${bound === "min" ? "minimum" : "maximum"} slider"><span class="range-grip" data-grip="${bound}" aria-hidden="true"></span>`,
    )
    .join("");
  const endpoints = m.sliderTicks
    ? '<div class="slider-ticks" aria-hidden="true">' +
      m.sliderTicks
        .map(
          (n) =>
            `<span style="left:${(100 * sliderPosition(m, n)) / end}%">${compactNumber.format(n)}</span>`,
        )
        .join("") +
      "</div>"
    : `<div class="endpoints"><span>${[poles[f.key]?.[0], fmt(min, m.unit)].filter(Boolean).join(" · ")}</span><span>${[poles[f.key]?.[1], fmt(max, m.unit)].filter(Boolean).join(" · ")}</span></div>`;
  return `<div class="editor" data-setting="${city ? "citySize" : "range"}" role="group" aria-label="${m.name} range">
    ${f.key === "heatDays" ? `<label class="cutoff-label">Count days at or above <input class="cutoff" type="number" min="60" max="110" value="${f.cutoff}"> °F</label>` : ""}
    <div class="bound-fields">${inputs}</div>
    <div class="range-track"><div class="range-line">${handles}</div></div>
    ${endpoints}</div>`;
}
function binding(editor) {
  const filter = filterFor(editor);
  return editor.dataset.setting === "citySize"
    ? { f: filter.citySize, m: cityMetric }
    : { f: filter, m: layers[filter.key] };
}
function syncRange(editor) {
  const { f, m } = binding(editor);
  for (const handle of editor.querySelectorAll(".range")) {
    const bound = handle.dataset.bound;
    const lower = bound === "min" ? m.domain[0] : f.min;
    const upper = bound === "max" ? m.domain[1] : f.max;
    const num = editor.querySelector(`.num[data-bound="${bound}"]`);
    num.min = lower;
    num.max = upper;
    num.value = f[bound];
    handle.value = sliderPosition(m, f[bound]);
    handle.setAttribute("aria-valuemin", lower);
    handle.setAttribute("aria-valuemax", upper);
    handle.setAttribute("aria-valuenow", f[bound]);
    handle.setAttribute("aria-valuetext", fmt(f[bound], m.unit));
    const fraction =
      (handle.valueAsNumber - Number(handle.min)) /
      (Number(handle.max) - Number(handle.min));
    editor.style.setProperty("--" + bound, 100 * fraction + "%");
  }
}
function subtypePicker(f, entry) {
  if (!entry.label) return "";
  const used = new Set(filters().map((card) => card.key));
  const options = entry.keys
    .map((key) => {
      const selected = key === f.key;
      const disabled = !selected && used.has(key);
      return `<option value="${key}" ${selected ? "selected" : disabled ? "disabled" : ""}>${esc(optionName(key))}${disabled ? " (already added)" : ""}</option>`;
    })
    .join("");
  return `<label class="subtype-field"><span>${entry.label}</span><select data-subtype aria-label="${entry.label} for ${esc(layers[f.key].name)}">${options}</select></label>`;
}
function layerRow(f, index) {
  const key = f.key,
    m = layers[key],
    entry = entryFor(key),
    viewing = state.layer === key;
  return `<section class="filter-row ${viewing ? "viewing" : ""}" data-key="${key}" data-index="${index}" aria-label="${esc(m.name)}">
    <div class="filter-top"><button class="layer-choice" data-view="${key}" aria-label="View ${esc(m.name)}" title="View ${esc(m.name)}"><span class="tile-icon ${m.icon}">${icon(m.icon, 18)}</span><span class="row-name"><strong>${esc(entry.name)}</strong>${m.facility ? "<small>Straight-line miles</small>" : !entry.label && poles[key] ? `<small>${poles[key].join(" → ")}</small>` : ""}</span></button>
    <button class="eye" data-eye="${key}" title="View ${m.name} on Map" aria-label="View ${m.name} on map" aria-pressed="${viewing}">${icon("eye", 18)}</button>
    <button class="switch" type="button" role="switch" data-toggle="${index}" aria-checked="${f.on}" aria-label="Enable ${m.name} filter"><span></span></button>
    <button class="drop-filter" data-drop="${key}" aria-label="Remove ${m.name} filter" title="Remove Filter">${icon("cross", 15)}</button></div>
    <div class="row-body">${subtypePicker(f, entry)}<p class="row-description">${m.description}</p>
    ${viewing && key === "heatDays" ? `<label class="cutoff-label">Map days at or above <input class="cutoff" id="display-cutoff" type="number" min="60" max="110" value="${state.cutoff}"> °F</label>` : ""}
    ${rangeEditor(f)}
    ${notApplicableLayers.has(key) ? '<p class="method-note">A minimum of 0 includes counties FEMA marks “Not applicable.”</p>' : ""}
    ${key === "cities" ? '<h3 class="field-heading">City Population Range</h3>' + rangeEditor(f, true) : ""}
    ${key === "custom" ? `<button class="secondary edit-places" data-custom="true">Edit Places (${f.points.length})</button>` : ""}
    </div>
  </section>`;
}
function renderControls() {
  const list = $("filters"),
    scroll = list.scrollTop;
  const focus = list.contains(document.activeElement)
    ? document.activeElement
    : null;
  const focusName = focus?.getAttribute("aria-label");
  const focusKey = focus?.closest("[data-view]")?.dataset.view;
  for (const mode of ["all", "any"]) pressed(mode, state.mode === mode);
  list.innerHTML = filters().length
    ? filters().map(layerRow).join("")
    : '<p class="empty-filters">Add a filter to explore the map.</p>';
  for (const editor of list.querySelectorAll(".editor")) syncRange(editor);
  $("add-filter").disabled = filters().length === Object.keys(layers).length;
  list.scrollTop = scroll;
  if (focusName)
    list
      .querySelector('[aria-label="' + CSS.escape(focusName) + '"]')
      ?.focus({ preventScroll: true });
  else if (focusKey)
    list
      .querySelector('[data-view="' + focusKey + '"]')
      ?.focus({ preventScroll: true });
}
function bindFilters() {
  const list = $("filters");
  list.addEventListener("click", (event) => {
    const btn = event.target.closest("button");
    if (!btn) return;
    const { view, eye, toggle, drop } = btn.dataset;
    if (btn.hasAttribute("data-custom")) {
      openPlaces(filterFor(btn));
      return;
    }
    if (view || eye) {
      selectLayer(view || eye);
      return;
    }
    const all = filters();
    if (drop) {
      state.county = all.filter((f) => f.key !== drop);
      if (state.layer === drop) state.layer = state.county[0]?.key ?? null;
      renderControls();
      refresh();
      $("add-filter").focus({ preventScroll: true });
      return;
    }
    if (toggle !== undefined) {
      all[toggle].on = !all[toggle].on;
      renderControls();
      refresh();
    }
  });
  bindRangePointers(list);
  function change(control) {
    if (control.matches("[data-subtype]")) {
      const old = filterFor(control);
      const key = control.value;
      if (filters().some((card) => card.key === key)) return;
      const replacement = changeSubtype(old, key);
      filters()[filters().indexOf(old)] = replacement;
      if (state.layer === old.key) state.layer = replacement.key;
      renderControls();
      refresh();
      list
        .querySelector(`[data-key="${replacement.key}"] [data-subtype]`)
        .focus({ preventScroll: true });
      if (key === "custom" && !replacement.points.length)
        openPlaces(replacement);
      return;
    }
    if (control.id === "display-cutoff") {
      state.cutoff = clampNum(control.value, 60, 110, state.cutoff, 1);
      control.value = state.cutoff;
      refresh();
      return;
    }
    const editor = control.closest(".editor");
    if (!editor) return;
    const f = filterFor(editor);
    if (control.matches(".range,.num")) {
      const { f, m } = binding(editor);
      const count =
        control.matches(".range") && m.sliderStops
          ? m.sliderStops[control.valueAsNumber]
          : clampNum(
              control.value,
              ...m.domain,
              f[control.dataset.bound],
              m.step,
            );
      updateBound(editor, control.dataset.bound, count);
      return;
    }
    if (!control.matches(".cutoff")) return;
    const cutoff = clampNum(control.value, 60, 110, f.cutoff, 1);
    if (cutoff !== f.cutoff) enableEditedFilter(editor, f);
    f.cutoff = cutoff;
    control.value = f.cutoff;
    refreshOnFrame();
  }
  list.addEventListener("change", (e) => {
    if (!e.target.matches(".range")) change(e.target);
    syncAddress();
  });
  list.addEventListener("input", (e) => {
    if (e.target.matches(".range")) change(e.target);
  });
}

function filterFor(control) {
  return filters()[control.closest(".filter-row").dataset.index];
}
function enableEditedFilter(editor, f) {
  if (f.on) return;
  f.on = true;
  editor
    .closest(".filter-row")
    .querySelector(".switch")
    .setAttribute("aria-checked", "true");
}
function updateBound(editor, bound, next) {
  const { f } = binding(editor);
  const value = bound === "min" ? Math.min(next, f.max) : Math.max(next, f.min);
  if (value !== f[bound]) enableEditedFilter(editor, filterFor(editor));
  f[bound] = value;
  syncRange(editor);
  refreshOnFrame();
}

// Both native sliders retain keyboard controls. The shared track chooses the
// nearer handle for a pointer, and the drag direction separates touching handles.
function bindRangePointers(list) {
  let gesture;
  list.addEventListener("pointerdown", (event) => {
    const track = event.target.closest(".range-track");
    if (!track || !event.isPrimary || event.button !== 0) return;
    const editor = track.closest(".editor");
    const { f, m } = binding(editor);
    const line = track.querySelector(".range-line").getBoundingClientRect();
    const [start, end] = m.sliderStops
      ? [0, m.sliderStops.length - 1]
      : m.domain;
    const at = (v) =>
      line.left + (line.width * (sliderPosition(m, v) - start)) / (end - start);
    const low = at(f.min),
      high = at(f.max),
      x = event.clientX;
    const grip = event.target.closest(".range-grip")?.dataset.grip;
    const nearest = grip ?? (x < (low + high) / 2 ? "min" : "max");
    const betweenGrips = !grip && low === high && Math.abs(x - low) <= 1;
    const onThumb = Boolean(grip) || betweenGrips;
    gesture = {
      id: event.pointerId,
      track,
      editor,
      m,
      line,
      start,
      end,
      x,
      y: event.clientY,
      bound: betweenGrips ? null : nearest,
      offset: onThumb ? x - (nearest === "min" ? low : high) : 0,
      onThumb,
      moved: false,
    };
    track.setPointerCapture(event.pointerId);
  });
  function move(event, finish) {
    const g = gesture;
    if (!g || event.pointerId !== g.id) return;
    const dx = event.clientX - g.x,
      dy = event.clientY - g.y;
    if (
      !g.moved &&
      event.pointerType === "touch" &&
      Math.abs(dy) > Math.abs(dx) &&
      Math.abs(dy) > 4
    ) {
      gesture = null;
      return;
    }
    if (!g.moved && Math.abs(dx) < 2 && !finish) return;
    g.bound ??= dx < 0 ? "min" : "max";
    g.track
      .querySelector(`[data-bound="${g.bound}"]`)
      .focus({ preventScroll: true });
    if (g.moved || !g.onThumb || Math.abs(dx) >= 2) {
      const fraction = Math.max(
        0,
        Math.min(1, (event.clientX - g.offset - g.line.left) / g.line.width),
      );
      const position = g.start + fraction * (g.end - g.start);
      const precision = 1 / (g.m.step ?? 0.1);
      const count = g.m.sliderStops
        ? g.m.sliderStops[Math.round(position)]
        : Math.round(position * precision) / precision;
      updateBound(g.editor, g.bound, count);
      g.moved = true;
    }
    if (finish) {
      gesture = null;
      syncAddress();
    }
  }
  list.addEventListener("pointermove", (event) => move(event, false));
  list.addEventListener("pointerup", (event) => move(event, true));
  list.addEventListener("lostpointercapture", (event) => {
    if (gesture?.id === event.pointerId) gesture = null;
  });
}

function clampNum(raw, min, max, fallback, step = 0.1) {
  if (raw.trim() === "" || !Number.isFinite(+raw)) return fallback;
  const scale = 1 / step;
  return Math.max(min, Math.min(max, Math.round(Number(raw) * scale) / scale));
}
function openPlaces(f) {
  editPlaces(f, {
    dialog,
    showDialog,
    esc,
    onSave: () => {
      f.on = true;
      renderControls();
      refresh();
    },
  });
}
const cloudCredit =
  '<a href="https://www.earthenv.org/cloud.html">Wilson &amp; Jetz · EarthEnv</a> · county area means · <a href="https://creativecommons.org/licenses/by-nc/4.0/">CC BY-NC 4.0</a>';
const humidityCredit =
  '<a href="https://www.chelsa-climate.org/datasets/chelsa_climatologies">CHELSA v2.1 humidity</a>';
const temperatureCredit =
  '<a href="https://arc.ncics.org/nclimgrid-overview/">NOAA nClimGrid</a> · <a href="https://www.ncei.noaa.gov/monitoring-content/data/us/climdiv/monthly/current/county-readme.txt">nClimDiv</a>';
const hazardCredit =
  '<a href="https://www.fema.gov/sites/default/files/documents/fema_national-risk-index_technical-documentation.pdf">FEMA National Risk Index</a>';
const elevationCredit =
  '<a href="https://pubs.usgs.gov/of/2011/1073/">USGS &amp; NGA · GMTED2010 terrain</a>';
const populationCredit =
  '<a href="https://www.census.gov/data/datasets/time-series/demo/popest/2020s-counties-total.html">U.S. Census Bureau · Vintage 2025</a>';
const seasonalMonths = {
  coldLow: "coldMonth",
  coldHumidity: "coldMonth",
  hotHigh: "hotMonth",
  hotHumidity: "hotMonth",
};
const isHumidity = (key) => key === "coldHumidity" || key === "hotHumidity";
function addFilter() {
  const used = new Set(filters().map((f) => f.key));
  showDialog(
    "Add a Filter",
    '<input class="searchinput" id="catalog-search" type="search" aria-label="Search filters" placeholder="Search filters" autocomplete="off"><div id="catalog-options"></div>',
  );
  const search = $("catalog-search"),
    options = $("catalog-options");
  function showMatches() {
    const groups = catalogMatches(used, search.value);
    options.innerHTML =
      groups
        .map((group) => {
          const buttons = group.entries
            .map(({ entry, key, detail }) => {
              const symbol = layers[entry.keys[0]].icon;
              return `<button class="catalog-option" data-pick="${entry.id}" data-measure="${key}"><span class="tile-icon ${symbol}">${icon(symbol, 18)}</span><span><strong>${esc(entry.name)}</strong><small>${esc(detail)}</small></span>${icon("plus", 16)}</button>`;
            })
            .join("");
          return `<section data-group="${esc(group.name)}"><h3 class="catalog-heading">${esc(group.name)}</h3>${buttons}</section>`;
        })
        .join("") ||
      '<p id="catalog-empty" role="status">No available filters match your search.</p>';
  }
  showMatches();
  if (matchMedia("(pointer: fine)").matches) search.focus();
  search.oninput = showMatches;
  search.onkeydown = (event) => {
    if (event.key === "Enter") options.querySelector("[data-pick]")?.click();
  };
  options.onclick = (event) => {
    const button = event.target.closest("[data-pick]");
    if (!button) return;
    const key = button.dataset.measure;
    const filter = newCard(key);
    filters().push(filter);
    if (!state.layer || layers[key].facility || layers[key].hazard)
      state.layer = key;
    dialog.close();
    renderControls();
    refresh();
    const row = $("filters").querySelector(`[data-key="${key}"]`);
    (
      row.querySelector("[data-subtype]") || row.querySelector("[data-view]")
    ).focus();
    if (key === "custom") openPlaces(filter);
  };
}
function paintLegend() {
  const m = metric();
  $("legend-scale").hidden = !m;
  if (!m) {
    $("legend-name").textContent = "County Boundaries";
    $("legend-sub").textContent = "United States · 2017";
    $("legend-icon").innerHTML = icon("location");
    $("legend-unit").textContent = "";
    $("credits").innerHTML =
      '<a href="https://www2.census.gov/geo/tiger/GENZ2017/shp/cb_2017_us_county_500k.zip">U.S. Census Bureau · 2017 county boundaries</a>';
    return;
  }
  $("legend-name").textContent = metricName(state.layer, state.cutoff);
  $("legend-icon").innerHTML = icon(m.icon);
  $("legend-sub").textContent =
    (m.hazard
      ? "National risk percentile"
      : state.layer === "population"
        ? "Resident estimate"
        : (poles[state.layer]?.join(" → ") ?? "County average")) +
    " · " +
    m.period;
  if (m.facility) {
    const count = access?.shown === state.layer ? access.count : undefined;
    const countLabel =
      count === undefined || m.nature
        ? ""
        : number(count) + (count === 1 ? " location" : " locations");
    $("legend-sub").textContent = [
      m.period,
      countLabel,
      count === 0 && state.layer === "custom"
        ? "Add a place"
        : count === 0 && state.layer === "cities"
          ? "Widen the population range"
          : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  $("legend-unit").textContent = m.unit;
  const keys = [
    state.layer,
    ...filters()
      .filter((f) => f.on)
      .map((f) => f.key),
  ];
  const credits = new Set();
  const localKeys = [
    ...new Set(
      keys
        .filter((k) => layers[k].facility)
        .flatMap((k) => layers[k].members ?? [k]),
    ),
  ];
  if (localKeys.length)
    credits.add(
      '<button class="credit-button" id="facility-sources">Location Sources &amp; Downloads</button>',
    );
  for (const key of keys) {
    if (layers[key].facility) continue;
    if (layers[key].hazard) credits.add(hazardCredit);
    else if (key === "cloud") credits.add(cloudCredit);
    else if (key === "population") credits.add(populationCredit);
    else if (key === "elevation") credits.add(elevationCredit);
    else {
      if (isHumidity(key)) credits.add(humidityCredit);
      credits.add(temperatureCredit);
    }
  }
  $("credits").innerHTML = [...credits].join(" · ");
  if (localKeys.length)
    $("facility-sources").onclick = () => {
      const entries = localKeys.map((key) => {
        const meta = access.metadata[key];
        if (key === "custom")
          return "<h3>Custom Places</h3><p>Selected coordinates, Census places, and results from Photon and OpenStreetMap. Shared links include each saved location.</p>";
        if (!meta)
          return `<h3>${esc(layers[key].name)}</h3><p>Loading the location directory…</p>`;
        const download = layers[key].nature
          ? `<a download href="./data/nature/${key}.json.gz">Download mapped geometry</a>`
          : `<a download href="./data/facilities/${key}.json">Download ${number(meta.count)} locations</a>`;
        return `<h3>${esc(layers[key].name)}</h3><p>${esc(meta.definition)}</p><p class="micro">${esc(meta.period)} · <a href="${esc(meta.url)}">${esc(meta.source)}</a>${key === "mountains" ? ' · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>' : ""} · ${download}</p>`;
      });
      showDialog("Location Sources & Downloads", entries.join(""));
    };
  const bounds =
    state.layer === "population" || state.layer === "elevation"
      ? m.bins.map((n) => compactNumber.format(n))
      : m.bins;
  $("colors").innerHTML = m.colors
    .map((c, i) => {
      const label =
        i === 0
          ? "&lt;" + bounds[0]
          : i === bounds.length
            ? "≥" + bounds[i - 1]
            : bounds[i - 1] + "–&lt;" + bounds[i];
      return '<div><b style="background:' + c + '"></b>' + label + "</div>";
    })
    .join("");
  const active = filters().some((f) => f.on);
  $("legend-keys").innerHTML =
    (m.nature
      ? `<span><b class="nature-line"></b>${esc(m.nature)}</span>`
      : "") +
    (notApplicableLayers.has(state.layer)
      ? '<span><b class="swatch inapplicable"></b>Not applicable</span>'
      : "") +
    (active ? '<span><b class="swatch"></b>Outside filters</span>' : "") +
    '<span><b class="swatch na"></b>No layer data</span>' +
    (active
      ? '<span><b class="swatch uncertain"></b>Uncertain match</span>'
      : "");
}
function refresh(continuous = false) {
  if (continuous) scheduleAddress();
  else syncAddress();
  const m = metric(),
    active = filters().filter((f) => f.on);
  const local = filters().filter((f) => layers[f.key].facility);
  const hasAccess = local.some((f) => f.on || f.key === state.layer);
  const county = active.filter((f) => !layers[f.key].facility),
    votes = new Int8Array(places.length);
  for (const [i, p] of places.entries()) {
    const v = value(p, state.layer, state.cutoff),
      countyPass = outcome(p, county, state.mode),
      pass = hasAccess || countyPass;
    votes[i] = county.length
      ? countyPass === null
        ? -1
        : Number(countyPass)
      : 2;
    const c =
      !m || m.facility
        ? "#cfdbcc"
        : pass === false
          ? "#d8ded4"
          : pass === null
            ? "url(#uncertain)"
            : p.hazardRatings[state.layer] === "Not Applicable"
              ? "var(--inapplicable)"
              : v === null
                ? "url(#missing)"
                : color(m, v);
    fill(p.el, c);
  }
  access?.update(local, state.layer, state.mode, votes);
  referenceMap?.update(local);
  $("grain").textContent = hasAccess ? "U.S. Proximity Map" : "U.S. County Map";
  $("filter-count").textContent = active.length + " active";
  $("reset").disabled = !active.length;

  paintLegend();
}

function clearFilters() {
  filters().forEach((f) => (f.on = false));
  renderControls();
  refresh();
}
function highlight() {
  const h = $("highlight");
  h.replaceChildren();
  const p = byID.get(selected);
  if (!p) return;
  svgNode(
    "path",
    {
      d: p.el.getAttribute("d"),
      class: "selected-outline",
    },
    h,
  );
}
function search() {
  showDialog(
    "Find a Place",
    '<label class="field" for="query">Search ' +
      (access?.active
        ? "counties by name, state or identifier, or enter latitude, longitude"
        : "counties by name, state or identifier") +
      '</label><input class="searchinput" id="query" type="search" autocomplete="off" placeholder="Name or state"><div id="suggest"></div>',
  );
  const input = $("query"),
    list = [...places].sort((a, b) => a.name.localeCompare(b.name));
  const run = () => {
    const coords =
      access?.active &&
      input.value.match(
        /^\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*$/,
      );
    if (coords && Math.abs(+coords[1]) <= 90 && Math.abs(+coords[2]) <= 180) {
      const point = { lat: +coords[1], lon: +coords[2] };
      $("suggest").innerHTML =
        '<button class="optionrow" id="inspect-coordinate">Check Nearby Places Here</button>';
      $("inspect-coordinate").onclick = () => pointDetails(null, point);
      return;
    }
    const q = input.value
      .trim()
      .toLowerCase()
      .replace(/,/g, "")
      .split(/\s+/)
      .filter(Boolean);
    const matches = list.filter((p) => {
      const txt = [p.name, p.state, p.stateName, p.id].join(" ").toLowerCase();
      return q.every((t) => txt.includes(t));
    });
    $("suggest").innerHTML =
      '<p class="micro">' +
      number(matches.length) +
      " results" +
      (matches.length > 25 ? " · Showing first 25" : "") +
      "</p>" +
      matches
        .slice(0, 25)
        .map(
          (p) =>
            '<button class="optionrow" data-place="' +
            p.uid +
            '"><span>' +
            esc(p.name) +
            " <small>" +
            p.state +
            "</small></span><small>" +
            (metric() && !metric().facility
              ? countyReading(p, state.layer, state.cutoff)
              : "") +
            "</small></button>",
        )
        .join("");
  };
  run();
  input.oninput = run;
  input.onkeydown = (e) => {
    if (e.key === "Enter") $("suggest").querySelector("button")?.click();
  };
  input.focus();
}
function monthlyChart(values) {
  if (!Array.isArray(values.monthlyLow) || !Array.isArray(values.monthlyHigh))
    return "";
  const low = values.monthlyLow,
    high = values.monthlyHigh;
  const left = 34,
    dx = 30,
    y = (t) => 104 - (t + 25) * 0.68;
  const x = (i) => left + i * dx;
  const line = (series) => series.map((v, i) => x(i) + "," + y(v)).join(" ");
  const ribbon =
    line(high) +
    " " +
    low
      .map((_, i) => {
        const j = 11 - i;
        return x(j) + "," + y(low[j]);
      })
      .join(" ");
  const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
  return (
    '<h3>Monthly Temperatures</h3><p class="micro">Average daily high and low · °F · 1991–2020</p><svg class="monthly" role="img" aria-label="Monthly average high and low temperatures. Exact values follow." viewBox="0 0 380 130">' +
    [0, 32, 65, 100]
      .map(
        (t) =>
          '<path d="M29 ' +
          y(t) +
          'H371" stroke="#d7dfd4"/><text x="22" y="' +
          (y(t) + 3) +
          '" text-anchor="end">' +
          t +
          "°</text>",
      )
      .join("") +
    '<polygon points="' +
    ribbon +
    '" fill="#d4ddbe" opacity=".7"/><polyline fill="none" stroke="#b06e3e" stroke-width="2.6" points="' +
    line(high) +
    '"/><polyline fill="none" stroke="#477c87" stroke-width="2.6" points="' +
    line(low) +
    '"/>' +
    months
      .map(
        (m, i) =>
          '<text x="' +
          x(i) +
          '" y="121" text-anchor="middle">' +
          m +
          "</text>",
      )
      .join("") +
    '</svg><details class="month-table"><summary>Monthly Values</summary><table><thead><tr><th>Month</th><th>Low</th><th>High</th></tr></thead><tbody>' +
    months
      .map(
        (m, i) =>
          "<tr><td>" +
          m +
          "</td><td>" +
          fmt(low[i], "°F") +
          "</td><td>" +
          fmt(high[i], "°F") +
          "</td></tr>",
      )
      .join("") +
    "</tbody></table></details>"
  );
}
function placeDetails(uid) {
  const p = byID.get(uid);
  if (!p) return;
  selected = uid;
  highlight();
  const m = metric(),
    v = p.values,
    months =
      "January February March April May June July August September October November December".split(
        " ",
      );
  const monthName = (key) => months[v[seasonalMonths[key]] - 1] ?? "";
  const fields = Object.keys(layers).filter(
    (k) => !layers[k].facility && !layers[k].hazard,
  );
  const active = filters().filter((f) => f.on && !layers[f.key].facility);
  showDialog(
    p.name,
    "<p>" +
      esc(p.stateName) +
      " · " +
      "FIPS " +
      p.id +
      "</p>" +
      (m && !m.facility
        ? `<div class="detailval${m.hazard ? " hazard-reading" : ""}">${countyReading(p, state.layer, state.cutoff)}</div><p>${[esc(metricName(state.layer, state.cutoff)), monthName(state.layer), m.period].filter(Boolean).join(" · ")}</p>`
        : "") +
      '<div class="actions"><button class="secondary" id="locate-detail">' +
      icon("location", 16) +
      'Locate on Map</button></div><h3>County Profile</h3><div class="detailgrid">' +
      fields
        .map(
          (k) =>
            "<div>" +
            esc(metricName(k, state.cutoff)) +
            "<b>" +
            fmt(value(p, k, state.cutoff), layers[k].unit) +
            "</b>" +
            (k === "population" ? layers.population.period : monthName(k)) +
            (k === "population" && p.populationNote
              ? "<br>" + esc(p.populationNote)
              : "") +
            "</div>",
        )
        .join("") +
      "</div>" +
      monthlyChart(v) +
      `<details class="month-table" ${m?.hazard ? "open" : ""}><summary>Natural Hazard Risks</summary><p class="micro">National risk percentiles · December 2025. Higher scores indicate greater risk relative to other counties assessed by FEMA. They describe countywide risk. An address can have different exposure.</p>
      <div class="detailgrid">${Object.entries(hazardLayers)
        .map(
          ([key, layer]) =>
            `<div>${layer.name}<b>${countyReading(p, key)}</b></div>`,
        )
        .join("")}</div>
      <p class="micro">${hazardCredit}</p></details>` +
      (active.length
        ? "<h3>Filter Results</h3>" +
          active
            .map((f) => {
              const ok = outcome(p, [f], "all");
              return (
                '<div class="minirow"><span>' +
                esc(metricName(f.key, f.cutoff)) +
                " " +
                fmt(f.min, layers[f.key].unit) +
                " – " +
                fmt(f.max, layers[f.key].unit) +
                "</span><b>" +
                (ok === null ? "Unknown" : ok ? "Match" : "Outside") +
                "</b></div>"
              );
            })
            .join("")
        : "") +
      '<p class="micro">' +
      "Temperatures and day counts use 1991–2020 NOAA records. Each county’s mean temperatures identify its coldest and hottest months. " +
      humidityCredit +
      " gives the 1981–2010 mean relative humidity in those months. Cloud frequency uses 2000–2014. " +
      cloudCredit +
      ". Resident population estimates come from the " +
      populationCredit +
      ". Average county elevation comes from " +
      elevationCredit +
      "</p>",
  );

  $("locate-detail").onclick = () => {
    dialog.close();
    locate(p);
  };
}

let probeVersion = 0;
async function pointDetails(county, point) {
  const generation = ++probeVersion;
  const heading = point.name || "Nearby Places at This Point";
  const place = [
    Number.isFinite(point.population)
      ? number(point.population) + " residents"
      : "",
    point.lat.toFixed(4) + ", " + point.lon.toFixed(4),
  ]
    .filter(Boolean)
    .join(" · ");
  showDialog(
    heading,
    `<p id="point-caption">${esc(place)}</p><div id="local-measures" role="status">Measuring local access…</div>`,
  );
  const target = $("local-measures");
  const result = await access.inspect(point.lon, point.lat);
  if (!dialog.open || !target.isConnected || generation !== probeVersion)
    return;
  if (result.error) {
    target.textContent = result.error;
    return;
  }
  county = places[result.countyIndex] ?? county;
  $("point-caption").textContent = [
    county
      ? county.name + ", " + county.state
      : "Outside mapped county boundaries",
    place,
  ].join(" · ");
  let combined = 2;
  function vote(hit) {
    combined = combine(combined, hit === null ? -1 : Number(hit), state.mode);
  }
  const countyRows = filters()
    .filter((f) => f.on && !layers[f.key].facility)
    .map((f) => {
      const hit = county ? matchRange(county, f) : null;
      vote(hit);
      return `<div class="minirow"><span>${esc(metricName(f.key, f.cutoff))}</span><b>${countyReading(county, f.key, f.cutoff)}${hit === null ? " · Unknown" : hit ? " · Match" : " · Outside"}</b></div>`;
    });
  const rows = result.rows.map((row) => {
    const f = filters().find((card) => card.key === row.key);
    const distance = row.miles;
    const reading = !row.name ? "No eligible locations" : fmt(distance, "mi");
    const hit = !row.name
      ? false
      : distance === null
        ? null
        : distance >= f.min && distance <= f.max;
    if (f.on) vote(hit);
    const verdict =
      !f.on || hit === null ? "" : hit ? " · Match" : " · Outside";
    return `<div class="local-reading"><div class="minirow"><strong>${esc(layers[f.key].name)}</strong><b>${reading}${verdict}</b></div>${row.name ? `<small>${layers[f.key].nature ? "Mapped feature" : "Nearest location"} · ${esc(row.name)}</small>` : ""}</div>`;
  });
  target.innerHTML =
    (combined === 2
      ? ""
      : `<div class="point-verdict"><strong>${combined === 1 ? "Matches Your Filters" : combined === 0 ? "Outside Your Filters" : "Uncertain Match"}</strong><small>${state.mode === "all" ? "Match All" : "Match Any"}</small></div>`) +
    rows.join("") +
    countyRows.join("") +
    (projection([point.lon, point.lat])
      ? '<button class="secondary" id="zoom-point">Zoom Here</button>'
      : "") +
    (county
      ? `<button class="secondary" data-place="${county.uid}">County Profile</button>`
      : "");
  const targetZoom = $("zoom-point");
  if (targetZoom)
    targetZoom.onclick = () => {
      dialog.close();
      const [x, y] = projection([point.lon, point.lat]);
      centerMap(x, y, Math.min(120, Math.max(10, zoom * 3)));
    };
}
// Convert screen-sized map symbols to projection units after zoom or resize.
let symbolScale, symbolZoom;
function styleMapScale() {
  referenceMap?.redraw();
  const scale = $("viewport").getScreenCTM()?.a;
  if (!scale || (scale === symbolScale && zoom === symbolZoom)) return;
  symbolScale = scale;
  symbolZoom = zoom;
  const baseScale = scale / zoom;
  svg.style.setProperty(
    "--state-size",
    Math.min(12, Math.max(6.5, baseScale * 9 + Math.log2(zoom) * 1.5)) / scale +
      "px",
  );
  svg.style.setProperty(
    "--ocean-size",
    Math.min(17, Math.max(7, baseScale * 15)) / scale + "px",
  );
  svg.classList.toggle("local-view", zoom >= 12);
  for (const id of ["uncertain", "missing"])
    $(id).setAttribute("patternTransform", "scale(" + 1 / scale + ")");
  access?.stylePatterns(scale);
}
function viewTransform(continuous = false) {
  if (continuous) scheduleAddress();
  else syncAddress();
  $("viewport").setAttribute(
    "transform",
    "translate(" + tx + " " + ty + ") scale(" + zoom + ")",
  );
  styleMapScale();
  access?.redraw();
  svg.classList.toggle("zoomed", zoom > 1);
  $("zoomin").disabled = zoom >= 120;
  $("zoomout").disabled = zoom <= 1;
}
function constrain() {
  tx = Math.max(975 * (1 - zoom) - 38, Math.min(35, tx));
  ty = Math.max(615 * (1 - zoom) - 18, Math.min(20, ty));
  if (zoom === 1) {
    tx = ty = 0;
  }
}
function changeZoom(factor, cx = 480, cy = 302, continuous = false) {
  const z = Math.max(1, Math.min(120, zoom * factor));
  tx = cx - ((cx - tx) * z) / zoom;
  ty = cy - ((cy - ty) * z) / zoom;
  zoom = z;
  constrain();
  viewTransform(continuous);
}
function locate(p) {
  const b = p.el.getBBox();
  const x = b.x + b.width / 2,
    y = b.y + b.height / 2;
  centerMap(x, y, 5);
}
function centerMap(x, y, level) {
  zoom = level;
  tx = 480 - x * zoom;
  ty = 302 - y * zoom;
  constrain();
  viewTransform();
  $("mapfield").scrollIntoView({ block: "center", behavior: "smooth" });
}
function coords(event) {
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(
    mapFit.getScreenCTM().inverse(),
  );
}
function bind() {
  $("add-filter").onclick = addFilter;
  $("fold").onclick = () => {
    const folded = document
      .querySelector(".workspace")
      .classList.toggle("folded");
    $("fold").setAttribute(
      "aria-label",
      folded ? "Expand filters" : "Collapse filters",
    );
    $("fold").setAttribute("aria-expanded", String(!folded));
  };
  for (const mode of ["all", "any"])
    $(mode).onclick = () => {
      state.mode = mode;
      renderControls();
      refresh();
    };

  $("reset").onclick = clearFilters;
  $("search").onclick = search;

  $("close").onclick = () => dialog.close();
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      const b = dialog.getBoundingClientRect();
      if (
        e.clientX < b.left ||
        e.clientX > b.right ||
        e.clientY < b.top ||
        e.clientY > b.bottom
      )
        dialog.close();
    }
  });

  const exportButton = $("export-pdf");
  exportButton.disabled = false;
  exportButton.onclick = async () => {
    exportButton.disabled = true;
    exportButton.setAttribute("aria-busy", "true");
    exportButton.querySelector("span").textContent = "Exporting…";
    try {
      const { downloadMap } = await import(
        new URL(import.meta.mapPdf ?? "./map-pdf.js", import.meta.url).href
      );
      await downloadMap({
        getState: () => state,
        getSelected: () => byID.get(selected),
        referenceMap,
        access,
      });
      notify("Map PDF downloaded");
    } catch (error) {
      console.error("Map PDF export failed", error);
      showDialog(
        "Map Couldn’t Be Exported",
        "<p>" +
          esc(error.message) +
          "</p><p>Close this message and select Export PDF to try again.</p>",
      );
    } finally {
      exportButton.disabled = false;
      exportButton.removeAttribute("aria-busy");
      exportButton.querySelector("span").textContent = "Export PDF";
    }
  };
  $("share").onclick = async () => {
    syncAddress();
    const href = shareUrl();
    try {
      await navigator.clipboard.writeText(href);
      notify("Link copied with your layer and filters");
    } catch {
      showDialog(
        "Share This View",
        '<label for="copy-link" class="field">Copy this link with your layer and filters</label><input id="copy-link" class="searchinput" readonly>',
      );
      $("copy-link").value = href;
      $("copy-link").select();
    }
  };
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-place]");
    if (!el) return;
    placeDetails(el.dataset.place);
  });
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "/" &&
      !dialog.open &&
      !["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)
    ) {
      e.preventDefault();
      search();
    }
  });
  $("zoomin").onclick = () => changeZoom(1.65);
  $("zoomout").onclick = () => changeZoom(1 / 1.65);
  $("fit").onclick = () => {
    zoom = 1;
    tx = ty = 0;
    viewTransform();
  };
  svg.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    ignoreClick = false;
    const pt = coords(e);
    drag = { id: e.pointerId, x: pt.x, y: pt.y, tx, ty };
  });
  svg.addEventListener("pointermove", (e) => {
    if (drag && e.pointerId === drag.id && zoom > 1) {
      const p = coords(e);
      if (Math.hypot(p.x - drag.x, p.y - drag.y) > 3 || ignoreClick) {
        if (!ignoreClick) svg.setPointerCapture(e.pointerId);
        ignoreClick = true;
        svg.classList.add("dragging");
        tx = drag.tx + p.x - drag.x;
        ty = drag.ty + p.y - drag.y;
        constrain();
        viewTransform(true);
        $("hover").hidden = true;
        return;
      }
    }
    if (e.pointerType === "touch") return;
    const p = byID.get(e.target.dataset.uid);
    const pin = referenceMap?.point(e)?.name;
    if (!p && !pin) {
      $("hover").hidden = true;
      return;
    }
    const tip = $("hover"),
      b = $("mapfield").getBoundingClientRect();
    tip.textContent =
      pin ||
      [
        p.name + ", " + p.state,
        access?.active
          ? "Select for local access"
          : metric()
            ? countyReading(p, state.layer, state.cutoff)
            : "",
      ]
        .filter(Boolean)
        .join(" · ");
    tip.hidden = false;
    tip.style.left =
      Math.max(
        3,
        Math.min(b.width - tip.offsetWidth - 4, e.clientX - b.left + 12),
      ) + "px";
    tip.style.top =
      Math.max(4, e.clientY - b.top - tip.offsetHeight - 8) + "px";
  });
  const release = () => {
    if (drag && ignoreClick) syncAddress();
    drag = null;
    svg.classList.remove("dragging");
  };
  svg.addEventListener("pointerup", release);
  svg.addEventListener("pointercancel", release);
  svg.addEventListener("pointerleave", () => {
    $("hover").hidden = true;
  });
  svg.addEventListener("click", (e) => {
    if (ignoreClick) {
      ignoreClick = false;
      return;
    }
    const p = byID.get(e.target.dataset.uid);
    if (access?.active) {
      const point = referenceMap?.point(e) ?? access.point(e);
      if (p || point.name) {
        $("hover").hidden = true;
        pointDetails(p, point);
        return;
      }
    }
    if (p) {
      $("hover").hidden = true;
      placeDetails(p.uid);
    }
  });
  svg.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const p = coords(e);
      changeZoom(Math.exp(-e.deltaY * 0.009), p.x, p.y, true);
    },
    { passive: false },
  );
}

async function init() {
  const [g, climate, cloud, humidity, population, elevation, hazards] =
    await Promise.all(
      [
        "geography",
        "climate",
        "cloud",
        "humidity",
        "population",
        "elevation",
        "hazards",
      ].map(async (name) => {
        const r = await fetch("./data/" + name + ".json");
        if (!r.ok) throw new Error(name + " HTTP " + r.status);
        return r.json();
      }),
    );
  const states = new Map(g.states.map((s) => [s.id, s]));
  const base = $("basemap");
  svgNode(
    "path",
    {
      d: g.grid,
      fill: "none",
      stroke: "#acc3b3",
      "stroke-width": 0.8,
      "stroke-opacity": 0.57,
    },
    base,
  );
  for (const [name, x, y, rotation] of [
    ["Pacific Ocean", 62, 422, -12],
    ["Atlantic Ocean", 901, 423, -34],
    ["Gulf of Mexico", 646, 567, 0],
  ]) {
    const text = svgNode(
      "text",
      {
        x,
        y,
        class: "ocean",
        transform: "rotate(" + rotation + " " + x + " " + y + ")",
      },
      base,
    );
    text.textContent = name;
  }
  const areas = document.createDocumentFragment();
  for (const c of g.counties) {
    const s = states.get(c.id.slice(0, 2)),
      uid = "c" + c.id,
      el = svgNode("path", { d: c.d, "data-uid": uid }, areas);
    const risk = countyHazards(hazards, c.id);
    for (const [key, rating] of Object.entries(risk.ratings)) {
      if (rating === "Not Applicable") notApplicableLayers.add(key);
    }
    places.push({
      hazardRatings: risk.ratings,
      id: c.id,
      uid,
      name: c.name,
      populationNote: population.aggregations[c.id],
      state: s.abbr,
      stateName: s.name,
      el,
      values: {
        ...risk.values,
        ...climate.counties[c.id],
        ...humidity.counties[c.id],
        cloud: cloud.counties[c.id],
        population: population.counties[c.id],
        elevation: elevation.counties[c.id],
      },
    });
  }
  $("areas").append(areas);
  $("land-shape").setAttribute("d", g.land);
  const borders = $("borders");
  svgNode("use", { href: "#county-borders", class: "border-casing" }, borders);
  const meshStyle = {
    fill: "none",
    "vector-effect": "non-scaling-stroke",
    "stroke-linejoin": "round",
    "stroke-linecap": "round",
  };
  svgNode(
    "path",
    { id: "county-borders", d: g.countyBorders, ...meshStyle },
    borders,
  );
  svgNode("use", { href: "#state-borders", class: "border-casing" }, borders);
  svgNode("path", { id: "state-borders", d: g.outline, ...meshStyle }, borders);

  const crowded = ["CT", "RI", "DE", "DC", "MD", "MA", "NJ", "NH", "VT"];
  for (const s of g.states) {
    if (crowded.includes(s.abbr)) continue;
    const text = svgNode(
      "text",
      { x: s.xy[0], y: s.xy[1], class: "state-name" },
      $("statelabels"),
    );
    text.textContent = s.abbr;
  }
  byID = new Map(places.map((p) => [p.uid, p]));

  // Fit the national view above the legend; zoomed geography can use the full canvas.
  const controls = $("map-controls");
  mapFit.setAttribute("height", controls.getBoundingClientRect().height);
  new ResizeObserver(([entry]) => {
    mapFit.setAttribute("height", entry.contentRect.height);
    styleMapScale();
    access?.redraw();
  }).observe(controls);

  access = new FacilityMap(places, paintLegend);
  referenceMap = new ReferenceMap();
  bind();
  bindFilters();
  window.addEventListener("popstate", restoreAddress);
  window.addEventListener("hashchange", restoreAddress);
  window.addEventListener("pagehide", () => {
    if (writeTimer !== undefined) syncAddress();
  });
  restoreAddress();
  $("loading").hidden = true;
}
init().catch((err) => {
  console.error(err);
  $("loading").replaceChildren(
    "Home Range could not load the map data. ",
    Object.assign(document.createElement("button"), {
      textContent: "Try Again",
      className: "secondary",
      onclick: () => location.reload(),
    }),
  );
});
