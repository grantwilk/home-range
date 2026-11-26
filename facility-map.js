import { combine, projection } from "./spatial.js";
import { accessColors, facilityLayers } from "./facility-model.js";

function svgElement(tag, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes))
    node.setAttribute(key, value);
  return node;
}

function coverageFill(result, band) {
  if (result === 0) return "#d8ded4";
  if (result === -1) return "url(#access-uncertain)";
  if (band === -1) return "url(#access-missing)";
  return band === null ? null : accessColors[band];
}

export class FacilityMap {
  constructor(places, onUpdate) {
    this.geometry = () =>
      places.map((p) => {
        const b = p.el.getBBox();
        return [
          p.el.getAttribute("d"),
          b.x,
          b.y,
          b.x + b.width,
          b.y + b.height,
        ];
      });
    this.places = places;
    this.onUpdate = onUpdate;
    this.serial = 0;
    this.inspections = new Map();
    this.probeId = 0;
    this.svg = document.getElementById("map");
    this.viewport = document.getElementById("viewport");
    this.overlay = document.getElementById("access-overlay");
    this.shapes = document.getElementById("access-shapes");
    this.clips = document.getElementById("access-clips");
    this.pinGroup = document.getElementById("access-pins");
    this.natureOutline = document.getElementById("nature-outline");
    this.status = document.getElementById("access-status");
    this.metadata = {};
    this.pins = [];
    this.active = false;
    new ResizeObserver(() => this.redraw()).observe(this.svg);
  }
  start() {
    if (this.worker) return;
    this.worker = new Worker(
      new URL(
        import.meta.accessWorker ?? "./access-worker.js",
        import.meta.url,
      ),
      {
        type: "module",
      },
    );
    this.worker.postMessage({ type: "init", counties: this.geometry() });
    this.worker.onmessage = ({ data }) => {
      if (data.type === "source") {
        this.metadata[data.key] = { ...data.meta, count: data.count };
        this.onUpdate();
        return;
      }
      if (data.type === "inspect") {
        const done = this.inspections.get(data.id);
        this.inspections.delete(data.id);
        done?.(data);
        return;
      }
      if (data.id !== this.serial) return;
      if (data.type === "error") {
        this.failure(data.message);
        return;
      }
      this.drawCoverage(data);
      this.count = data.count;
      this.shown = this.request.layer;
      this.onUpdate();
    };
    this.worker.onerror = () => {
      this.worker.terminate();
      this.worker = null;
      clearTimeout(this.timer);
      this.request = null;
      this.failure("The access map could not load. Change a filter to retry.");
    };
  }
  // Only county membership depends on these clips. Reuse them through pans,
  // zooms and facility edits. A uniform county vote needs only the land clip.
  countyClips(flags) {
    if (this.lastFlags && flags.every((vote, i) => vote === this.lastFlags[i]))
      return this.votes;
    this.lastFlags = flags;
    this.votes = [...new Set(flags)];
    const clips = document.createDocumentFragment();
    if (this.votes.length > 1) {
      const paths = new Map(this.votes.map((vote) => [vote, []]));
      for (const [i, place] of this.places.entries())
        paths.get(flags[i]).push(place.el.getAttribute("d"));
      for (const [vote, parts] of paths) {
        const clip = svgElement("clipPath", { id: "county-vote-" + vote });
        clip.append(svgElement("path", { d: parts.join("") }));
        clips.append(clip);
      }
    }
    this.clips.replaceChildren(clips);
    return this.votes;
  }
  drawCoverage({ frame, contours, pins, outline }) {
    const { countyFlags, mode } = this.request;
    const votes = this.countyClips(countyFlags);
    const dx = frame.w / frame.width,
      dy = frame.h / frame.height;
    const transform = `translate(${frame.x} ${frame.y}) scale(${dx} ${dy})`;
    const shapes = document.createDocumentFragment();
    for (const [i, region] of contours.entries()) {
      shapes.append(
        svgElement("path", {
          id: "local-shape-" + i,
          d: region.d,
          "fill-rule": "evenodd",
          "vector-effect": "non-scaling-stroke",
          "stroke-linejoin": "round",
        }),
      );
    }
    const coverage = document.createDocumentFragment();
    for (const vote of votes) {
      const group = svgElement(
        "g",
        votes.length > 1
          ? { "clip-path": "url(#county-vote-" + vote + ")" }
          : {},
      );
      if (vote === 0 && mode === "all") {
        // One county clip can exclude every facility band, including on thin islands.
        group.append(
          svgElement("rect", {
            x: frame.x,
            y: frame.y,
            width: frame.w,
            height: frame.h,
            fill: "#d8ded4",
          }),
        );
        coverage.append(group);
        continue;
      }
      const bands = svgElement("g", { transform });
      for (const [i, region] of contours.entries()) {
        const fill = coverageFill(
          combine(vote, region.vote, mode),
          region.band,
        );
        if (fill === null) continue; // Reveal the displayed county measure.
        const attrs = { href: "#local-shape-" + i, fill };
        // A subpixel overlap prevents light seams between neighboring fills.
        if (fill.startsWith("#"))
          Object.assign(attrs, { stroke: fill, "stroke-width": 0.4 });
        bands.append(svgElement("use", attrs));
      }
      group.append(bands);
      coverage.append(group);
    }
    const markers = document.createDocumentFragment();
    for (const p of pins) {
      markers.append(
        svgElement("circle", {
          cx: frame.x + p[0] * dx,
          cy: frame.y + p[1] * dy,
          class: "site",
        }),
      );
    }
    this.shapes.replaceChildren(shapes);
    this.overlay.replaceChildren(coverage);
    this.pinGroup.replaceChildren(markers);
    if (outline !== this.lastOutline) {
      this.natureOutline.setAttribute("d", outline);
      this.lastOutline = outline;
    }
    this.overlay.style.display = "";
    this.status.hidden = true;
    this.pins = pins;
    this.frame = frame;
    this.stylePatterns(this.viewport.getScreenCTM().a);
  }
  stylePatterns(scale) {
    if (!this.frame) return;
    const { w, h, width, height } = this.frame;
    const transform = `scale(${width / (w * scale)} ${height / (h * scale)})`;
    for (const id of ["access-missing", "access-uncertain"])
      document.getElementById(id).setAttribute("patternTransform", transform);
  }
  hideCoverage() {
    this.overlay.style.display = "none";
    this.natureOutline.removeAttribute("d");
    this.lastOutline = "";
    if (this.frame) {
      this.overlay.replaceChildren();
      this.shapes.replaceChildren();
      this.pinGroup.replaceChildren();
      this.clips.replaceChildren();
      this.lastFlags = null;
    }
    this.pins = [];
    this.frame = null;
  }
  failure(message) {
    this.hideCoverage();
    this.status.hidden = false;
    this.status.textContent = message;
    this.status.dataset.state = "error";
    for (const done of this.inspections.values()) done({ error: message });
    this.inspections.clear();
  }
  update(filters, layer, mode, countyFlags) {
    this.active = !!filters.find((f) => f.on || f.key === layer);
    if (!this.active) {
      clearTimeout(this.timer);
      this.worker?.postMessage({ type: "cancel", id: ++this.serial });
      this.hideCoverage();
      this.status.hidden = true;
      this.request = null;
      this.viewKey = null;
      this.shown = null;
      return;
    }
    this.start();
    const shown = filters.find((f) => f.key === layer);
    const viewKey = JSON.stringify([layer, shown?.citySize, shown?.points]);
    if (viewKey !== this.viewKey) {
      this.hideCoverage();
      this.shown = null;
      this.viewKey = viewKey;
    }
    this.request = { filters, layer, mode, countyFlags };
    this.redraw();
  }
  redraw() {
    if (!this.request) return;
    const id = ++this.serial;
    clearTimeout(this.timer);
    this.status.textContent = "Updating local access…";
    this.status.dataset.state = "loading";
    this.status.hidden = false;
    this.timer = setTimeout(() => {
      const matrix = this.viewport.getScreenCTM();
      if (!matrix || !matrix.a) return;
      const rect = this.svg.getBoundingClientRect(),
        inv = matrix.inverse();
      const tl = new DOMPoint(rect.left, rect.top).matrixTransform(inv),
        br = new DOMPoint(rect.right, rect.bottom).matrixTransform(inv);
      const x = Math.max(-65, tl.x),
        y = Math.max(-18, tl.y),
        w = Math.min(995, br.x) - x,
        h = Math.min(638, br.y) - y;
      if (w <= 0 || h <= 0) {
        this.hideCoverage();
        this.status.hidden = true;
        return;
      }
      const nature = this.request.filters.some(
        (f) =>
          (f.on || f.key === this.request.layer) &&
          facilityLayers[f.key].nature,
      );
      const density = Math.min(
        matrix.a,
        Math.sqrt((nature ? 140000 : 300000) / (w * h)),
      );
      const frame = {
        x,
        y,
        w,
        h,
        width: Math.max(1, Math.ceil(w * density)),
        height: Math.max(1, Math.ceil(h * density)),
        spacing: Math.max(
          5,
          Math.round(((w >= 450 ? 15 : 8) * density) / matrix.a),
        ),
      };
      this.worker.postMessage({ type: "render", id, frame, ...this.request });
    }, 50);
  }
  point(e) {
    const pos = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      this.viewport.getScreenCTM().inverse(),
    );
    const loc = projection.invert([pos.x, pos.y]);
    let pin = null;
    if (this.frame && this.pins.length) {
      const f = this.frame,
        x = ((pos.x - f.x) * f.width) / f.w,
        y = ((pos.y - f.y) * f.height) / f.h;
      const sx = (f.w / f.width) * this.viewport.getScreenCTM().a,
        sy = (f.h / f.height) * this.viewport.getScreenCTM().d;
      let best = 6 ** 2;
      for (const p of this.pins) {
        const d = ((p[0] - x) * sx) ** 2 + ((p[1] - y) * sy) ** 2;
        if (d < best) {
          best = d;
          pin = p;
        }
      }
    }
    return pin
      ? { name: pin[2], lon: pin[3], lat: pin[4], population: pin[5] }
      : { lon: loc[0], lat: loc[1] };
  }
  inspect(lon, lat) {
    if (
      !this.request ||
      !this.worker ||
      (!this.status.hidden && this.status.dataset.state === "error")
    )
      return Promise.resolve({ error: this.status.textContent });
    const id = ++this.probeId;
    const filters = this.request.filters.filter(
      (f) => f.on || f.key === this.request.layer,
    );
    return new Promise((resolve) => {
      this.inspections.set(id, resolve);
      this.worker.postMessage({ type: "inspect", id, lon, lat, filters });
    });
  }
}
