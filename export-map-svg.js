// Capture the live map in its Albers projection. The PDF draws state names as
// selectable text alongside its own town labels.
const ns = "http://www.w3.org/2000/svg";
const byId = (id) => document.getElementById(id);
const pointsPerCssPixel = 72 / 96;
// The print key fits a 16-unit symbol viewBox into a 13-point square.
const pointsPerMarkerUnit = 13 / 16;

function append(parent, name, attrs) {
  const el = document.createElementNS(ns, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  parent.append(el);
  return el;
}

function overlaps(a, b) {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

// The shared geography meshes use absolute M/L coordinates. Omit runs outside
// a local frame while retaining both endpoints of each crossing segment.
function visibleLines(d, bounds) {
  const { x, y, width, height } = bounds;
  const right = x + width,
    bottom = y + height;
  const runs = [];
  let last = "",
    lastX = 0,
    lastY = 0,
    drawing = false;
  for (const m of d.matchAll(/([ML])(-?[\d.]+),(-?[\d.]+)/g)) {
    const px = +m[2],
      py = +m[3];
    if (m[1] === "M") drawing = false;
    else if (
      Math.min(px, lastX) <= right &&
      Math.max(px, lastX) >= x &&
      Math.min(py, lastY) <= bottom &&
      Math.max(py, lastY) >= y
    ) {
      if (!drawing) runs.push("M", last);
      runs.push(m[0]);
      drawing = true;
    } else drawing = false;
    last = m[2] + "," + m[3];
    lastX = px;
    lastY = py;
  }
  return runs.join("");
}

function strokePath(parent, live, path, scale, casing, nationalPrint = false) {
  if (!path) return;
  const style = getComputedStyle(live);
  // At national extent the phone stylesheet uses lighter boundaries. Use the
  // desktop line weights for print independent of the screen that initiated it.
  const width = nationalPrint
    ? ({ "county-borders": 0.48, "state-borders": 1.45 }[live.id] ??
      style.strokeWidth)
    : style.strokeWidth;
  const variable = (key, fallback) =>
    casing?.getPropertyValue(key).trim() || fallback;
  append(parent, "path", {
    d: path,
    fill: "none",
    stroke: variable("--line-ink", style.stroke),
    "stroke-opacity": variable(
      "--line-opacity",
      nationalPrint && live.id === "county-borders"
        ? 0.64
        : style.strokeOpacity,
    ),
    "stroke-width": parseFloat(variable("--line-width", width)) / scale,
    "stroke-linecap": style.strokeLinecap,
    "stroke-linejoin": style.strokeLinejoin,
  });
}

export function mapBounds() {
  const svg = byId("map"),
    viewport = byId("viewport");
  if (!viewport?.getScreenCTM()?.a || !byId("areas")?.childElementCount)
    throw new Error(
      "The map is still loading. Try exporting again once it appears.",
    );
  // The national map is letterboxed into the space above the web legend.
  // Export its original viewBox, including the Alaska and Hawaii insets.
  if (!svg.classList.contains("zoomed")) {
    const { x, y, width, height } = byId("map-fit").viewBox.baseVal;
    return { x, y, width, height };
  }
  // Towns and active facility markers occupy the unobstructed area above the legend.
  const rect = byId("map-controls").getBoundingClientRect(),
    invert = viewport.getScreenCTM().inverse();
  const first = new DOMPoint(rect.left, rect.top).matrixTransform(invert);
  const last = new DOMPoint(rect.right, rect.bottom).matrixTransform(invert);
  return {
    x: first.x,
    y: first.y,
    width: last.x - first.x,
    height: last.y - first.y,
  };
}

function addOverlay(root, defs, visible, local, screenScale, printAdjustment) {
  const live = byId("access-overlay");
  if (getComputedStyle(live).display === "none" || !live.childElementCount)
    return;
  const overlay = append(root, "g", {});
  const countyRings = local
    ? new Set(visible.flatMap((d) => d.split("Z").filter(Boolean)))
    : null;
  const usedShapes = new Set();
  for (const group of live.children) {
    const voteClip = group.getAttribute("clip-path");
    // Each vote clip already consists entirely of county land. One clipping
    // mask per group suffices even in PDF renderers that replace nested masks.
    const clipId = voteClip?.match(/#([\w-]+)/)?.[1] ?? "land-clip";
    if (!defs.querySelector("#" + clipId)) {
      let d = byId(clipId).firstElementChild.getAttribute("d");
      if (local) {
        d = voteClip
          ? d
              .split("Z")
              .filter((ring) => countyRings.has(ring))
              .map((ring) => ring + "Z")
              .join("")
          : visible.join("");
      }
      if (!d) continue;
      const clip = append(defs, "clipPath", {
        id: clipId,
        clipPathUnits: "userSpaceOnUse",
      });
      append(clip, "path", { d });
    }
    const copy = group.cloneNode(true);
    copy.setAttribute("clip-path", "url(#" + clipId + ")");
    for (const use of copy.querySelectorAll("use")) {
      const id = use.getAttribute("href").slice(1);
      if (!usedShapes.has(id)) {
        const def = byId(id).cloneNode(false);
        def.removeAttribute("vector-effect");
        defs.append(def);
        usedShapes.add(id);
      }
      if (use.hasAttribute("stroke-width")) {
        const bands = group.querySelector("g");
        const unitsPerPixel =
          printAdjustment / (bands?.getScreenCTM()?.a || screenScale);
        use.setAttribute(
          "stroke-width",
          +use.getAttribute("stroke-width") * unitsPerPixel,
        );
      }
    }
    overlay.append(copy);
  }
}

// printScale is PDF points per projected unit. Omit it for screen-sized paint.
export function captureMap(printScale, bounds = mapBounds()) {
  const live = byId("map"),
    viewport = byId("viewport"),
    areas = byId("areas");
  const screenScale = viewport.getScreenCTM().a;
  if (
    printScale !== undefined &&
    (!Number.isFinite(printScale) || printScale <= 0)
  )
    throw new Error("The printed map needs a positive, finite scale.");
  const printing = printScale !== undefined;
  const scale = printing ? printScale / pointsPerCssPixel : screenScale;
  const printAdjustment = screenScale / scale;
  if (!(bounds.width > 0 && bounds.height > 0))
    throw new Error("The map needs a visible area to export.");
  const { x, y, width, height } = bounds;
  const root = document.createElementNS(ns, "svg");
  root.setAttribute("viewBox", [x, y, width, height].join(" "));
  root.setAttribute("width", "100%");
  root.setAttribute("height", "100%");
  root.setAttribute("overflow", "hidden");
  const defs = append(root, "defs", {});
  const local = live.classList.contains("zoomed");
  const pad = 3 / scale;
  const crop = {
    x: x - pad,
    y: y - pad,
    width: width + 2 * pad,
    height: height + 2 * pad,
  };
  for (const id of [
    "missing",
    "uncertain",
    "access-missing",
    "access-uncertain",
  ]) {
    const livePattern = byId(id);
    // Expand inherited tiles so the captured pattern works by itself.
    const pattern = (
      livePattern.hasAttribute("href")
        ? byId(livePattern.getAttribute("href").slice(1))
        : livePattern
    ).cloneNode(true);
    pattern.id = id;
    const transform = livePattern.getAttribute("patternTransform") || "";
    // Proximity patterns live inside a transformed contour grid. Keep its
    // coordinate conversion and adjust its physical repeat spacing for print.
    if (transform || printing)
      pattern.setAttribute(
        "patternTransform",
        (
          transform + (printing ? " scale(" + printAdjustment + ")" : "")
        ).trim(),
      );
    defs.append(pattern);
  }
  for (const path of byId("basemap").querySelectorAll("path")) {
    const d = path.getAttribute("d");
    strokePath(root, path, local ? visibleLines(d, crop) : d, scale);
  }
  const fills = new Map(),
    visible = [];
  for (const path of areas.children) {
    if (local && !overlaps(path.getBBox(), crop)) continue;
    const d = path.getAttribute("d");
    let fill = path.getAttribute("fill");
    if (fill?.includes("var(")) fill = getComputedStyle(path).fill;
    if (!fills.has(fill)) fills.set(fill, []);
    fills.get(fill).push(d);
    visible.push(d);
  }
  for (const [fill, paths] of fills)
    append(root, "path", { fill, d: paths.join("") });
  addOverlay(root, defs, visible, local, screenScale, printAdjustment);
  const nature = byId("nature-outline");
  strokePath(root, nature, nature.getAttribute("d"), scale);
  const mesh = new Map();
  for (const child of byId("borders").children) {
    if (getComputedStyle(child).display === "none") continue;
    const use = child.localName === "use";
    const path = use ? byId(child.getAttribute("href").slice(1)) : child;
    if (!mesh.has(path)) {
      const d = path.getAttribute("d");
      mesh.set(path, local ? visibleLines(d, crop) : d);
    }
    strokePath(
      root,
      path,
      mesh.get(path),
      scale,
      use ? getComputedStyle(child) : null,
      printing && !local,
    );
  }
  const pins = byId("reference-pins"),
    pinCenters = [];
  if (pins && getComputedStyle(pins).display !== "none") {
    const copiedPins = pins.cloneNode(true);
    root.append(copiedPins);
    const screenToMap = viewport.getScreenCTM().inverse();
    const selector = ":scope > g[data-key] > g";
    const copies = copiedPins.querySelectorAll(selector);
    for (const [i, marker] of pins.querySelectorAll(selector).entries()) {
      const m = marker.getScreenCTM();
      const { x, y } = new DOMPoint(m.e, m.f).matrixTransform(screenToMap);
      if (printing)
        copies[i].setAttribute(
          "transform",
          `translate(${x} ${y}) scale(${pointsPerMarkerUnit / printScale})`,
        );
      if (overlaps({ x, y, width: 0, height: 0 }, bounds))
        pinCenters.push({ x, y });
    }
  }
  for (const child of byId("highlight").querySelectorAll("path")) {
    if (overlaps(child.getBBox(), crop))
      strokePath(root, child, child.getAttribute("d"), scale);
  }
  const stateLabels = [...byId("statelabels").children]
    .filter((label) => getComputedStyle(label).display !== "none")
    .map((node) => ({
      x: +node.getAttribute("x"),
      y: +node.getAttribute("y"),
      label: node.textContent,
    }))
    .filter((point) => overlaps({ ...point, width: 0, height: 0 }, bounds));
  return {
    svg: new XMLSerializer().serializeToString(root),
    bounds,
    stateLabels,
    pinCenters,
  };
}
