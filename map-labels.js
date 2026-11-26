import { projection } from "./spatial.js";

// Use actual PDF font metrics when supplied. This estimate reserves extra room
// for wide glyphs, and leaves space for accents above the Latin cap height.
function estimatedWidth(name, size) {
  let em = 0;
  for (const c of name) {
    if (/\p{Mark}/u.test(c)) continue;
    if (/[ilI.,'’\s]/u.test(c)) em += 0.32;
    else if (/[MWmw@]/u.test(c) || c.codePointAt(0) > 0x2fff) em += 1.08;
    else if (/[A-Z]/u.test(c)) em += 0.77;
    else em += 0.61;
  }
  return em * size;
}

// Census uses administrative qualifiers and geography IDs to disambiguate
// records in the directory. Position identifies the town on the printed map.
function displayName(sourceName) {
  return sourceName
    .replace(/, [A-Z]{2}$/, "")
    .replace(
      / (?:CDP|city|town|village|borough|municipality) \(\d{7,10}\)$/,
      "",
    )
    .replace(
      / (?:metropolitan government|metro government|consolidated government|unified government|urban county)(?: \(balance\))?$/,
      "",
    )
    .replace(/(?: city)? \(balance\)$/, "")
    .replace(/ (?:CDP|city|town|village|borough|municipality)$/, "");
}

function overlaps(a, b) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function labelPosition(place, width, fontSize, frame, occupied, gap) {
  const { dotX, dotY } = place;
  const paddedWidth = width + 2.6;
  const height = 1.35 * fontSize + 2;
  // Right/left keep text adjacent to its dot. Above/below work along a frame
  // edge or narrow coast, without separating the name from its real location.
  const candidates = [
    [dotX + gap, dotY - height / 2],
    [dotX - gap - paddedWidth, dotY - height / 2],
    [dotX - paddedWidth / 2, dotY - gap - height],
    [dotX - paddedWidth / 2, dotY + gap],
    [dotX + gap, dotY - height],
    [dotX - gap - paddedWidth, dotY - height],
    [dotX + gap, dotY],
    [dotX - gap - paddedWidth, dotY],
  ];
  for (const [left, top] of candidates) {
    const box = { x: left, y: top, width: paddedWidth, height };
    if (
      left < 1 ||
      top < 1 ||
      left + paddedWidth > frame.width - 1 ||
      top + height > frame.height - 1
    )
      continue;
    if (!occupied.some((other) => overlaps(box, other))) {
      return { x: left + 1.3, y: top + 1 + fontSize, box };
    }
  }
  return null;
}

const directories = new WeakMap();
function directory(points) {
  let sorted = directories.get(points);
  if (sorted) return sorted;
  sorted = [];
  for (const [sourceName, lon, lat, population] of points) {
    if (
      typeof sourceName !== "string" ||
      !Number.isFinite(lon) ||
      !Number.isFinite(lat) ||
      Math.abs(lon) > 180 ||
      Math.abs(lat) > 90
    )
      continue;
    const xy = projection([lon, lat]);
    if (xy)
      sorted.push({
        name: displayName(sourceName),
        sourceName,
        population,
        px: xy[0],
        py: xy[1],
      });
  }
  sorted.sort(
    (a, b) =>
      (b.population ?? -1) - (a.population ?? -1) ||
      a.sourceName.localeCompare(b.sourceName, "en"),
  );
  directories.set(points, sorted);
  return sorted;
}

/**
 * Place Census names and dots in map-local PDF points. Text x/y is its left
 * baseline. Reserved rectangles and returned text boxes use top-left x/y.
 * Facility symbol boxes block text and can replace a dot at its source position.
 * measureText(name, fontSize) can supply the width from the embedded PDF font.
 */
export function selectTownLabels(
  points,
  bounds,
  size,
  { reserved = [], symbols = [], measureText = estimatedWidth } = {},
) {
  if (
    ![
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      size.width,
      size.height,
    ].every(Number.isFinite) ||
    Math.min(bounds.width, bounds.height, size.width, size.height) <= 0
  )
    return [];
  const scale = Math.min(1, Math.max(bounds.width / 1000, bounds.height / 625));
  const cap = Math.max(
    1,
    Math.min(
      64,
      Math.floor((size.width * size.height) / (5700 + 1850 * scale)),
    ),
  );
  const separation = 25 + 14 * scale;
  const occupied = [...reserved];
  const textObstacles = [...reserved, ...symbols];
  const labels = [];
  const places = [];
  const minPopulation = 3000 * scale ** 3;
  for (const { name, sourceName, population, px, py } of directory(points)) {
    if (population !== null && population < minPopulation) continue;
    const dotX = ((px - bounds.x) / bounds.width) * size.width;
    const dotY = ((py - bounds.y) / bounds.height) * size.height;
    if (dotX < 3 || dotY < 3 || dotX > size.width - 3 || dotY > size.height - 3)
      continue;
    places.push({ name, sourceName, population, dotX, dotY });
  }
  const leaders = [],
    others = [],
    cells = new Set();
  const cellWidth = 78 + 19 * scale,
    cellHeight = 54 + 12 * scale;
  const columns = Math.ceil(size.width / cellWidth);
  for (const place of places) {
    const cell =
      Math.floor(place.dotX / cellWidth) +
      columns * Math.floor(place.dotY / cellHeight);
    if (!cells.has(cell)) {
      cells.add(cell);
      leaders.push(place);
    } else others.push(place);
  }
  // Give each populated portion of a rural or national map a chance before
  // adding more names in a dense metro. Within each pass the largest goes first.
  for (const candidates of [leaders, others]) {
    for (const place of candidates) {
      if (labels.length >= cap) return labels;
      if (
        labels.some(
          (p) =>
            (p.dotX - place.dotX) ** 2 + (p.dotY - place.dotY) ** 2 <
            separation ** 2,
        )
      )
        continue;
      const dot = {
        x: place.dotX - 2.8,
        y: place.dotY - 2.8,
        width: 5.6,
        height: 5.6,
      };
      if (occupied.some((other) => overlaps(dot, other))) continue;
      const fontSize = place.population >= 500000 ? 8.7 : 8;
      const width = measureText(place.name, fontSize);
      if (!Number.isFinite(width) || width < 0) continue;
      const covering = symbols.filter((box) => overlaps(dot, box));
      let gap = 4.2;
      for (const box of covering) {
        gap = Math.max(
          gap,
          place.dotX - box.x + 1,
          box.x + box.width - place.dotX + 1,
          place.dotY - box.y + 1,
          box.y + box.height - place.dotY + 1,
        );
      }
      const position = labelPosition(
        place,
        width,
        fontSize,
        size,
        textObstacles,
        gap,
      );
      if (!position) continue;
      labels.push({
        ...place,
        fontSize,
        ...position,
        coveredDot: covering.length > 0,
      });
      occupied.push(dot, position.box);
      textObstacles.push(dot, position.box);
    }
  }
  return labels;
}
