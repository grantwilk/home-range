const cover = {
  forestCover: [
    "Forest",
    "Deciduous, evergreen, and mixed forest. Forested wetlands count under Wetlands.",
    "#35684b",
    "woods wooded trees woodland",
  ],
  farmCover: [
    "Crops & Pasture",
    "Cultivated crops, hayfields, and pasture.",
    "#996d2d",
    "farms farming farmland agricultural agriculture fields ranches",
  ],
  grassCover: [
    "Grassland",
    "Land dominated by grasses or other low-growing plants. Native prairie is one possible grassland.",
    "#748034",
    "prairie meadow grasslands herbaceous",
  ],
  developedCover: [
    "Developed Land",
    "Built-up areas, roads, and developed open space such as lawns.",
    "#805b69",
    "urban buildings residential paved suburbs cities",
  ],
  wetlandCover: [
    "Wetlands",
    "Woody and herbaceous wetlands.",
    "#377c83",
    "swamps bogs marshes",
  ],
  shrubCover: [
    "Shrubland",
    "Land dominated by shrubs or scrub.",
    "#847546",
    "scrub bushes brush",
  ],
  barrenCover: [
    "Bare Ground",
    "Exposed rock, sand, and other sparsely vegetated ground.",
    "#926649",
    "barren soil sand rock",
  ],
  mossLichenCover: [
    "Moss & Lichen",
    "Land dominated by mosses or lichens. This type is mapped separately in Alaska.",
    "#74734e",
    "tundra mosses lichens",
  ],
  snowCover: [
    "Perennial Snow & Ice",
    "Snowfields and ice that persist through summer.",
    "#558094",
    "glacier glaciers permanent snowfields",
  ],
};
export const coverKeys = Object.keys(cover);

// Use the same class color for its county profile bar and its map scale.
function shareColors(swatch) {
  const channels = swatch.match(/[a-f\d]{2}/gi).map((hex) => parseInt(hex, 16));
  return [0.09, 0.22, 0.37, 0.53, 0.69, 0.84, 1].map((weight) => {
    const shade = channels.map((c) => Math.round(253 + (c - 253) * weight));
    return "#" + shade.map((c) => c.toString(16).padStart(2, "0")).join("");
  });
}

export const landscapeLayers = {};
for (const [key, [name, detail, swatch, searchTerms]] of Object.entries(
  cover,
)) {
  landscapeLayers[key] = {
    name,
    description:
      detail +
      " Measured as a percentage of county land, excluding open water.",
    searchTerms,
    landCover: true,
    icon: "landCover",
    unit: "%",
    domain: [0, 100],
    bins: [1, 10, 25, 50, 75, 90],
    colors: shareColors(swatch),
    swatch,
  };
}

export function landscapeValues(dataset, id) {
  const row = dataset.counties[id];
  return row
    ? Object.fromEntries(dataset.keys.map((key, i) => [key, row[i]]))
    : {};
}

export function landShareLabel(percent) {
  if (!Number.isFinite(percent)) return "No data";
  if (percent > 0 && percent < 0.1) return "<0.1%";
  if (percent > 99.9 && percent < 100) return ">99.9%";
  return percent.toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
}
