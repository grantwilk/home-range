import { PDFDocument } from "pdfkit";
import { create as readTypeface } from "fontkit";
import { toBlob } from "pdfkit/output";
import svgToPdf from "svg-to-pdfkit";
import mark from "./assets/mark.svg";
import { captureMap, mapBounds } from "./export-map-svg.js";
import { selectTownLabels } from "./map-labels.js";
import { fmt, layers, metricName } from "./model.js";

const ink = "#203d32",
  quiet = "#50665a";
const margin = 27;
const byId = (id) => document.getElementById(id);
let fontBytes, typeface;
async function printFont() {
  if (!fontBytes) {
    const response = await fetch(
      new URL("./assets/fonts/map-print.ttf", import.meta.url),
    );
    if (!response.ok) throw Error("The map font could not be loaded.");
    fontBytes = new Uint8Array(await response.arrayBuffer());
    typeface = readTypeface(fontBytes);
  }
  return fontBytes;
}

function mapDetails(state, access) {
  const active = state.county.filter((f) => f.on);
  const bins = state.layer
    ? [...byId("colors").children].map((el, i) => ({
        color: layers[state.layer].colors[i],
        label: el.textContent,
      }))
    : [];
  const keys = state.layer
    ? [...byId("legend-keys").children].map((el) => ({
        kind: el.firstElementChild.className,
        label: el.textContent,
      }))
    : [];
  for (const el of byId("reference-key").querySelectorAll("[data-key]")) {
    const symbol = el.querySelector("svg");
    if (symbol)
      keys.push({
        symbol: symbol.outerHTML,
        label: el.querySelector("span")?.textContent ?? el.textContent,
      });
  }
  const sources = new Set(
    [...byId("credits").querySelectorAll("a")].map((el) => el.textContent),
  );
  for (const key of new Set([state.layer, ...active.map((f) => f.key)])) {
    if (!layers[key]?.facility) continue;
    for (const k of layers[key].members ?? [key]) {
      const source = access.metadata[k]?.source;
      if (source) sources.add(source);
      if (k === "mountains")
        sources.add("GMBA mountain range boundaries adapted under CC BY 4.0");
      if (k === "custom") sources.add("User-selected places");
    }
  }
  sources.add("County boundaries: U.S. Census Bureau (2017)");
  sources.add("Town locations: U.S. Census Bureau (2024), USGS GNIS");
  return {
    title: byId("legend-name").textContent,
    sub: byId("legend-sub").textContent,
    unit: byId("legend-unit").textContent,
    bins,
    keys,
    sources: [...sources].join("  ·  "),
    mode: state.mode === "any" ? "Match Any" : "Match All",
    filters: active.map((f) => {
      const unit = layers[f.key].unit;
      const pop = f.citySize
        ? " (cities with " +
          f.citySize.min.toLocaleString("en-US") +
          " to " +
          fmt(f.citySize.max, "residents") +
          ")"
        : "";
      return (
        metricName(f.key, f.cutoff) +
        " " +
        fmt(f.min, unit) +
        " to " +
        fmt(f.max, unit) +
        pop
      );
    }),
  };
}

function drawSvg(doc, svg, x, y, width, height) {
  svgToPdf(doc, svg, x, y, {
    width,
    height,
    assumePt: true,
    fontCallback: () => "Map",
  });
}

function words(doc, str, x, y, size, color = ink, options = {}) {
  doc
    .font("Map")
    .fontSize(size)
    .fillColor(color)
    .text(str, x, y, { lineBreak: false, ...options });
}

function drawKeySymbol(doc, key, x, y) {
  if (key.symbol) return drawSvg(doc, key.symbol, x, y, 13, 13);
  if (key.kind === "nature-line") {
    doc
      .moveTo(x, y + 6)
      .lineTo(x + 13, y + 6)
      .lineWidth(1.6)
      .stroke("#284f65");
    return;
  }
  const missing = key.kind.includes(" na"),
    uncertain = key.kind.includes(" uncertain");
  const color = missing
    ? "#ebece5"
    : uncertain
      ? "#deddd1"
      : key.kind.includes("inapplicable")
        ? "#b5cdd9"
        : "#d8ded4";
  doc
    .save()
    .rect(x, y + 2, 13, 9)
    .fillAndStroke(color, "#aeb9ac");
  doc.rect(x, y + 2, 13, 9).clip();
  if (missing) {
    for (let offset = -8; offset < 15; offset += 4)
      doc.moveTo(x + offset, y + 11).lineTo(x + offset + 9, y + 2);
    doc.lineWidth(0.7).stroke("#a9b0a4");
  } else if (uncertain) {
    for (let i = 2; i < 13; i += 4)
      for (let j = 4; j < 12; j += 4)
        doc.circle(x + i, y + j, 0.7).fill("#827d6e");
  }
  doc.restore();
}

function keyLayout(doc, entries, width) {
  let x = 0,
    y = 0;
  return entries.map((key) => {
    const span = 19 + doc.font("Map").fontSize(9).widthOfString(key.label);
    if (x && x + span > width) {
      x = 0;
      y += 16;
    }
    const item = { key, x, y };
    x += span + 19;
    return item;
  });
}

function drawMap(doc, b, towns, frame) {
  const scale = Math.min(frame.width / b.width, frame.height / b.height);
  const snap = captureMap(scale, b);
  const size = { width: b.width * scale, height: b.height * scale };
  const x = frame.x + (frame.width - size.width) / 2,
    y = frame.y + (frame.height - size.height) / 2;
  const local = (p) => ({ x: (p.x - b.x) * scale, y: (p.y - b.y) * scale });
  doc.save().rect(x, y, size.width, size.height).fill("#edf2ea");
  doc.rect(x, y, size.width, size.height).clip();
  drawSvg(doc, snap.svg, x, y, size.width, size.height);
  const symbols = snap.pinCenters.map((p) => {
    const dot = local(p);
    return { x: dot.x - 4.6, y: dot.y - 4.6, width: 9.2, height: 9.2 };
  });
  const labels = selectTownLabels(towns, b, size, {
    symbols,
    measureText: (name, fs) => doc.font("Map").fontSize(fs).widthOfString(name),
  });
  const occupied = [
    ...symbols,
    ...labels.flatMap((p) => [
      p.box,
      { x: p.dotX - 2, y: p.dotY - 2, width: 4, height: 4 },
    ]),
  ];
  for (const place of snap.stateLabels) {
    const dot = local(place);
    const w = doc.font("Map").fontSize(9.2).widthOfString(place.label),
      h = 10;
    const r = {
      x: dot.x - w / 2 - 2,
      y: dot.y - h / 2 - 1,
      width: w + 4,
      height: h + 2,
    };
    if (
      r.x < 0 ||
      r.y < 0 ||
      r.x + r.width > size.width ||
      r.y + r.height > size.height ||
      occupied.some(
        (q) =>
          r.x < q.x + q.width &&
          r.x + r.width > q.x &&
          r.y < q.y + q.height &&
          r.y + r.height > q.y,
      )
    )
      continue;
    occupied.push(r);
    outlinedText(
      doc,
      place.label,
      x + dot.x - w / 2,
      y + dot.y + 3,
      9.2,
      "#42614f",
      1.6,
    );
  }
  for (const p of labels) {
    if (!p.coveredDot)
      doc
        .circle(x + p.dotX, y + p.dotY, 1.8)
        .lineWidth(0.95)
        .fillAndStroke("#394c3e", "#fffdf6");
    outlinedText(doc, p.name, x + p.x, y + p.y, p.fontSize, ink, 2.1);
  }
  doc.restore();
  doc.rect(x, y, size.width, size.height).lineWidth(0.65).stroke("#bccabd");
  return labels;
}

// A pale halo keeps lettering readable across both dark and light county fills.
function outlinedText(doc, label, x, baseline, size, color, halo) {
  const ratio = size / typeface.unitsPerEm;
  const { glyphs, positions } = typeface.layout(label);
  // Outline glyphs as paths. The single text pass below is the searchable label.
  doc
    .save()
    .translate(x, baseline)
    .scale(ratio, -ratio)
    .lineJoin("round")
    .lineWidth(halo / ratio)
    .strokeColor("#fffef6");
  for (const [i, glyph] of glyphs.entries()) {
    const pos = positions[i],
      path = glyph.path.toSVG();
    if (path)
      doc
        .save()
        .translate(pos.xOffset, pos.yOffset)
        .path(path)
        .stroke()
        .restore();
    doc.translate(pos.xAdvance, pos.yAdvance);
  }
  doc.restore();
  words(doc, label, x, baseline, size, color, { baseline: "alphabetic" });
}

async function makePdf(bounds, details, towns, font) {
  const portrait = bounds.width / bounds.height < 1.23;
  const width = portrait ? 792 : 1224,
    height = portrait ? 1224 : 792;
  const doc = new PDFDocument({
    size: [width, height],
    margin: 0,
    font: null,
    info: {
      Title: "Home Range – " + details.title,
      Author: "Home Range",
      Subject: "Filtered U.S. map with cities and towns",
    },
  });
  doc.registerFont("Map", font).font("Map");
  const inner = width - margin * 2,
    scaleWidth = inner * 0.43,
    keyX = margin + scaleWidth + 34;
  const keyItems = keyLayout(doc, details.keys, width - margin - keyX);
  const keyHeight = (keyItems.at(-1)?.y ?? 0) + 16;
  const filterText = details.filters.length
    ? details.mode + "  ·  " + details.filters.join("  ·  ")
    : "No active filters";
  const measuredHeight = (s, size) =>
    doc
      .font("Map")
      .fontSize(size)
      .heightOfString(s, { width: inner, lineGap: 1 });
  const filterHeight = measuredHeight(filterText, 9.5),
    sourceHeight = measuredHeight(details.sources, 8);
  const notesPage = filterHeight + sourceHeight > 67;
  const noteHeight = notesPage ? 16 : filterHeight + sourceHeight + 8;
  const footerH = 24 + Math.max(35, keyHeight) + 13 + noteHeight;
  const mapY = 74,
    mapBottom = height - margin - footerH;
  drawSvg(doc, mark, margin, 23, 32, 32);
  words(doc, "Home Range", margin + 42, 20, 12, quiet);
  words(doc, details.title, margin + 41, 32, 23);
  const caption = details.sub + (details.unit ? "  ·  " + details.unit : "");
  doc.font("Map").fontSize(10);
  words(
    doc,
    caption,
    width - margin - doc.widthOfString(caption),
    23,
    10,
    quiet,
  );
  const townsInFrame = drawMap(doc, bounds, towns, {
    x: margin,
    y: mapY,
    width: inner,
    height: mapBottom - mapY,
  });
  const focus = townsInFrame[0];
  const area = details.national
    ? "United States  ·  Alaska and Hawaii shown as insets"
    : details.selection
      ? "Selected county  ·  " + details.selection
      : focus
        ? "Map area includes " +
          focus.name +
          (focus.sourceName.match(/, [A-Z]{2}$/)?.[0] ?? "")
        : "";
  if (area) words(doc, area, margin + 42, 59, 9, quiet);
  const legendY = mapBottom + 11;
  words(
    doc,
    details.bins.length
      ? "Color Scale" + (details.unit ? "  ·  " + details.unit : "")
      : "Map Layer",
    margin,
    legendY,
    12,
  );
  words(doc, "Map Key", keyX, legendY, 12);
  const row = legendY + 19;
  if (details.bins.length) {
    const step = scaleWidth / details.bins.length;
    for (const [i, bin] of details.bins.entries()) {
      doc.rect(margin + i * step, row, step + 0.05, 7).fill(bin.color);
      words(doc, bin.label, margin + i * step, row + 10, 8.5, quiet);
    }
  } else words(doc, details.title, margin, row, 10, quiet);
  for (const { key, x, y } of keyItems) {
    drawKeySymbol(doc, key, keyX + x, row + y);
    words(doc, key.label, keyX + x + 17, row + y + 1, 9);
  }
  let noteY = row + Math.max(35, keyHeight) + 5;
  doc
    .moveTo(margin, noteY - 3)
    .lineTo(width - margin, noteY - 3)
    .lineWidth(0.55)
    .stroke("#c6d2c4");
  if (notesPage) {
    words(
      doc,
      "Filter settings and data sources on page 2",
      margin,
      noteY + 4,
      9,
      quiet,
    );
    doc.addPage();
    drawSvg(doc, mark, margin, margin, 27, 27);
    words(doc, "Home Range", margin + 36, margin + 3, 14, quiet);
    words(doc, details.title, margin, margin + 48, 23);
    words(doc, "Filter Settings and Sources", margin, margin + 84, 14);
    noteY = margin + 113;
  }
  doc
    .font("Map")
    .fontSize(9.5)
    .fillColor(ink)
    .text(filterText, margin, noteY + 3, { width: inner, lineGap: 1 });
  doc
    .fontSize(8)
    .fillColor(quiet)
    .text(details.sources, margin, doc.y + 4, { width: inner, lineGap: 1 });
  const result = toBlob(doc);
  doc.end();
  return result;
}

async function waitForLayers(referenceMap, access) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (!access.active || access.status.hidden) {
      const ready = await referenceMap.ready();
      if (ready.errors.length)
        throw Error(
          "Some place markers could not load. Check your connection and try again.",
        );
      if (!access.active || access.status.hidden) return;
    }
    if (access.status.dataset.state === "error")
      throw Error(access.status.textContent);
    await new Promise((done) => setTimeout(done, 80));
  }
  throw Error(
    "The distance layer is still loading. Let the map finish updating and try again.",
  );
}

export async function downloadMap({
  getState,
  getSelected,
  referenceMap,
  access,
}) {
  const font = await printFont();
  await waitForLayers(referenceMap, access);
  // Snapshot extent, legend and points together before yielding back to the map.
  const bounds = mapBounds(),
    details = mapDetails(getState(), access);
  details.national = !byId("map").classList.contains("zoomed");
  const selected = getSelected();
  if (selected) {
    const r = selected.el.getBBox();
    if (
      r.x + r.width >= bounds.x &&
      r.x <= bounds.x + bounds.width &&
      r.y + r.height >= bounds.y &&
      r.y <= bounds.y + bounds.height
    )
      details.selection = selected.name + ", " + selected.state;
  }
  const file = await makePdf(bounds, details, referenceMap.cityPoints, font);
  const url = URL.createObjectURL(file);
  const save = Object.assign(document.createElement("a"), {
    href: url,
    download:
      "home-range-" +
      details.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-$/, "") +
      ".pdf",
  });
  document.body.append(save);
  save.click();
  save.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
