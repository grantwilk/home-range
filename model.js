import { landscapeLayers, landShareLabel } from "./landscape.js";
import { hazardLayers } from "./hazards.js";
import {
  citySize,
  facilityLayers,
  facilityOptions,
  restoreFacility,
} from "./facility-model.js";
// County and point measurements share the same inclusive range controls.
const thermal = [
  "#507995",
  "#6c9ca6",
  "#9ab9a3",
  "#c8cc95",
  "#e9cc87",
  "#dfa76f",
  "#bc7255",
];
const moisture = [
  "#ece0ab",
  "#d1d39d",
  "#a6c4a2",
  "#80b3a5",
  "#59999b",
  "#437d8c",
  "#375d79",
];
const sky = [
  "#f2d99a",
  "#ddd296",
  "#b9c5a3",
  "#91b4ac",
  "#749cab",
  "#63849b",
  "#4f6586",
];
const crimeColors = [
  "#f5e9d9",
  "#ecd2b7",
  "#dbb08f",
  "#c38972",
  "#9f6264",
  "#744454",
];
const snowColors = [
  "#f2f4f4",
  "#d7e5e8",
  "#b9d4df",
  "#93bad0",
  "#6e9bbc",
  "#4b79a4",
  "#375781",
];
const climate = "1991–2020";
// Each successive decade occupies a similar amount of slider travel.
function graduatedStops(steps) {
  const stops = [0];
  for (const step of steps) {
    for (let i = stops.length === 1 ? 1 : 11; i <= 100; i++)
      stops.push(Number((i * step).toFixed(2)));
  }
  return stops;
}
export const cityMetric = {
  ...citySize,
  sliderStops: graduatedStops([10, 100, 1_000, 10_000, 100_000]),
  sliderTicks: [0, 1_000, 10_000, 100_000, 1_000_000, 10_000_000],
};
const densityStops = graduatedStops([0.01, 0.1, 1, 10, 100, 1000]);
export function residentsPerSquareMile(residents, landAreaM2) {
  if (
    !Number.isFinite(residents) ||
    residents < 0 ||
    !Number.isFinite(landAreaM2) ||
    landAreaM2 <= 0
  )
    return null;
  return Math.round(((residents * 1609.344 ** 2) / landAreaM2) * 100) / 100;
}
const layer = (
  name,
  unit,
  icon,
  period,
  description,
  bins,
  colors,
  domain,
) => ({
  name,
  unit,
  icon,
  period,
  description,
  bins,
  colors,
  domain,
});
function seasonalHumidity(season) {
  return layer(
    season + "-Month Relative Humidity",
    "%",
    "droplet",
    "1981–2010",
    "Average near-surface relative humidity in the county’s " +
      season.toLowerCase() +
      " month. Humidity uses 1981–2010 averages. The month is based on 1991–2020 temperatures.",
    [40, 50, 60, 65, 70, 75],
    moisture,
    [0, 100],
  );
}
export const months =
  "January February March April May June July August September October November December".split(
    " ",
  );
export const temperatureStats = ["Low", "High"];
export const temperatureKey = (month, stat) =>
  months[month].slice(0, 3).toLowerCase() + stat;
const monthlyTemperatures = Object.fromEntries(
  temperatureStats.flatMap((stat) =>
    months.map((name, month) => [
      temperatureKey(month, stat),
      {
        ...layer(
          `Average ${name} ${stat}`,
          "°F",
          stat === "Low" ? "thermo" : "sun",
          climate,
          `Average daily ${stat.toLowerCase()} temperature across the county in ${name} (1991–2020).`,
          [0, 20, 32, 50, 70, 90],
          thermal,
          [-60, 115],
        ),
        month,
        temperatureStat: stat,
        monthlySeries: "monthly" + stat,
      },
    ]),
  ),
);
export const monthlyTemperatureKeys = Object.keys(monthlyTemperatures);
export const layers = {
  ...monthlyTemperatures,
  coldLow: layer(
    "Coldest-Month Average Low",
    "°F",
    "thermo",
    climate,
    "Average daily low in the calendar month with the lowest mean temperature in this county.",
    [0, 10, 20, 30, 40, 50],
    thermal,
    [-60, 75],
  ),
  hotHigh: layer(
    "Hottest-Month Average High",
    "°F",
    "sun",
    climate,
    "Average daily high in the calendar month with the highest mean temperature in this county.",
    [65, 70, 75, 80, 85, 90],
    thermal,
    [40, 115],
  ),
  coldHumidity: seasonalHumidity("Coldest"),
  hotHumidity: seasonalHumidity("Hottest"),
  heatDays: {
    ...layer(
      "Hot Days",
      "days/yr",
      "sun",
      climate,
      "Average number of days per year when the countywide daily high reaches or exceeds your chosen temperature.",
      [5, 15, 30, 60, 90, 120],
      thermal,
      [0, 366],
    ),
    threshold: { min: 60, max: 110, initial: 90 },
  },
  coldDays: {
    ...layer(
      "Cold Days",
      "days/yr",
      "snow",
      climate,
      "Average days per year when the countywide daily low fell below your threshold. Daily records cover the contiguous U.S.",
      [0.1, 1, 5, 15, 30, 90],
      snowColors,
      [0, 366],
    ),
    threshold: { min: -60, max: 60, initial: -30 },
  },
  rainfall: layer(
    "Annual Rainfall",
    "in/yr",
    "rain",
    climate,
    "Average inches of liquid precipitation per year across the county. ERA5 estimates rain separately from frozen precipitation.",
    [10, 20, 30, 40, 50, 70],
    moisture,
    [0, 100],
  ),
  snowfall: layer(
    "Annual Snowfall",
    "in/yr",
    "snow",
    "2008–09 through 2025–26, excluding 2020–21",
    "Average inches of new snow over an October–September season. NOAA covers the contiguous U.S. Counties with incomplete coverage are marked on the map.",
    [1, 5, 15, 30, 60, 100],
    snowColors,
    [0, 300],
  ),
  wetDays: layer(
    "Wet Days",
    "days/yr",
    "rain",
    climate,
    "Average number of days per year with at least 0.01 inches of precipitation averaged across the county.",
    [60, 80, 100, 120, 140, 160],
    moisture,
    [0, 366],
  ),
  cloudyDays: layer(
    "Cloudy Days per Year",
    "days/yr",
    "cloud",
    climate,
    "A day counts when modeled cloud cover averages at least 80% across the county over 24 hours, including nighttime. The range uses the 1991–2020 annual average.",
    [20, 40, 60, 80, 100, 120],
    sky,
    [0, 366],
  ),
  elevation: {
    ...layer(
      "Average County Elevation",
      "ft",
      "mountain",
      "GMTED2010",
      "Average elevation across the county, in feet above sea level. Each area contributes in proportion to its size.",
      [250, 1000, 2500, 5000, 7500, 10000],
      [
        "#edf2db",
        "#ccdcb8",
        "#acc59b",
        "#94a77f",
        "#8d896e",
        "#796956",
        "#584b43",
      ],
      [0, 12000],
    ),
    step: 1,
  },
  populationDensity: {
    ...layer(
      "County Population Density",
      "people/mi²",
      "people",
      "July 1, 2025",
      "Residents per square mile of land. Lower values indicate more sparsely populated counties. Water is excluded.",
      [10, 50, 250, 1000, 5000],
      ["#e4e7f0", "#c6cde3", "#a7aed1", "#868abc", "#675fa2", "#493c7f"],
      [0, densityStops.at(-1)],
    ),
    step: 0.01,
    sliderStops: densityStops,
    sliderTicks: [0, 1, 10, 100, 1000, 10000, 100000],
  },
  violentCrimeRate: layer(
    "Reported Violent Crime Rate",
    "per 100k",
    "shield",
    "2014 and 2016",
    "Homicide, rape, robbery, and aggravated assault reported to police per 100,000 residents served. Annual average for 2014 and 2016. Compare counties within the same state because reporting practices differ.",
    [100, 200, 300, 500, 800],
    crimeColors,
    [0, 2000],
  ),
  homicideRate: layer(
    "Homicide Death Rate",
    "per 100k",
    "shield",
    "2017–2023",
    "Annual homicide deaths per 100,000 residents, averaged over 2017–2023. Deaths count in the victim’s home county. Counties with fewer than 10 deaths over the period have no published rate.",
    [2, 5, 10, 15, 25],
    crimeColors,
    [0, 65],
  ),
  ...landscapeLayers,
  ...hazardLayers,
  ...facilityLayers,
};
// Each key identifies one source series and calendar month, including in share URLs.
const calendarClimate = {
  coldHumidity: {
    suffix: "Humidity",
    label: "Relative Humidity",
    bins: [40, 50, 60, 65, 70, 75],
  },
  rainfall: {
    suffix: "Rainfall",
    label: "Rainfall",
    bins: [0.5, 1, 2, 3, 5, 8],
  },
  cloudyDays: {
    suffix: "CloudyDays",
    label: "Cloudy Days",
    bins: [1, 3, 5, 8, 12, 18],
  },
  wetDays: { suffix: "WetDays", label: "Wet Days", bins: [2, 4, 6, 8, 12, 18] },
  heatDays: {
    suffix: "HeatDays",
    label: "Hot Days",
    bins: [1, 3, 7, 12, 18, 24],
  },
  coldDays: {
    suffix: "ColdDays",
    label: "Cold Days",
    bins: [0.1, 1, 3, 7, 14, 21],
  },
};
export const monthKeys = (baseKey) =>
  months.map(
    (month) =>
      month.slice(0, 3).toLowerCase() + calendarClimate[baseKey].suffix,
  );
const monthLimits = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
for (const [baseKey, { suffix, label, bins }] of Object.entries(
  calendarClimate,
)) {
  monthKeys(baseKey).forEach((key, month) => {
    const name = months[month];
    const days = suffix.endsWith("Days");
    layers[key] = {
      ...layers[baseKey],
      name: `Average ${name} ${label}`,
      unit: days ? "days/mo" : baseKey === "rainfall" ? "in/mo" : "%",
      domain: days
        ? [0, monthLimits[month]]
        : baseKey === "rainfall"
          ? [0, 35]
          : [0, 100],
      bins,
      baseKey,
      month,
      monthlySeries: "monthly" + suffix,
      description: `Average ${label.toLowerCase()} in ${name} across the county.`,
    };
  });
}
export const poles = {
  coldHumidity: ["Less humid", "More humid"],
  hotHumidity: ["Less humid", "More humid"],
  wetDays: ["Drier", "Wetter"],
  ...Object.fromEntries(
    monthKeys("wetDays").map((key) => [key, ["Drier", "Wetter"]]),
  ),
  ...Object.fromEntries(
    monthKeys("coldHumidity").map((key) => [key, ["Less humid", "More humid"]]),
  ),
};
// These measures take a second input that changes what is being measured.
export const repeatableMeasures = new Set([
  ...monthKeys("heatDays"),
  ...monthKeys("coldDays"),
  "heatDays",
  "coldDays",
  "cities",
  "custom",
]);
export const maxFilters = 256;
export const filterId = (filter) => filter.id ?? filter.key;
export const viewedId = (state) => state.layerId ?? state.layer;
export function measureKey(id) {
  if (typeof id !== "string") return undefined;
  if (Object.hasOwn(layers, id)) return id;
  const parts = /^([A-Za-z]+)~([1-9]\d*)$/.exec(id);
  if (
    parts &&
    repeatableMeasures.has(parts[1]) &&
    Number(parts[2]) >= 2 &&
    Number(parts[2]) <= maxFilters
  )
    return parts[1];
}
export function setViewedFilter(state, filter) {
  state.layer = filter?.key ?? null;
  if (filter?.id) state.layerId = filter.id;
  else delete state.layerId;
}
export function cutoffFor(state, key) {
  const threshold = layers[key]?.threshold;
  if (threshold) {
    const selected =
      state.layer === key &&
      state.county.find((f) => filterId(f) === viewedId(state));
    return (
      (selected || state.county.find((f) => f.key === key))?.cutoff ??
      threshold.initial
    );
  }
}
export function value(place, key, cutoff = layers[key]?.threshold?.initial) {
  const readings = place.values;
  const metric = layers[key];
  let x = readings?.[key];
  if (metric?.monthlySeries) {
    const series = readings?.[metric.monthlySeries];
    if (series) x = series[metric.month];
  }
  if (metric?.threshold) {
    x = validCutoff(cutoff, metric.threshold)
      ? x?.[cutoff - metric.threshold.min]
      : null;
  }
  return Number.isFinite(x) ? x : null;
}
// Exact inputs and shared links retain the full count between slider stops.
export function sliderPosition(metric, limit) {
  const stops = metric.sliderStops;
  if (!stops) return limit;
  const i = stops.findIndex((n) => n >= limit);
  if (i < 0) return stops.length - 1;
  if (i === 0 || stops[i] - limit < limit - stops[i - 1]) return i;
  return i - 1;
}
export function matchRange(place, filter) {
  const x = value(place, filter.key, filter.cutoff);
  if (x !== null) return x >= filter.min && x <= filter.max;
  if (place.hazardRatings?.[filter.key] === "Not Applicable")
    return filter.min === 0;
  return null;
}
export function outcome(place, filters, mode) {
  const active = filters.filter((f) => f.on);
  if (!active.length) return true;
  let unknown = false;
  for (const f of active) {
    const pass = matchRange(place, f);
    if (pass === null) {
      unknown = true;
      continue;
    }
    if (mode === "all" && !pass) return false;
    if (mode === "any" && pass) return true;
  }
  return unknown ? null : mode === "all";
}
export const color = (metric, x) =>
  metric.colors[metric.bins.filter((bound) => x >= bound).length];
export const freshFilter = (key, on = false) => ({
  key,
  on,
  min: layers[key].domain[0],
  max: layers[key].domain[1],
  cutoff: layers[key].threshold?.initial ?? 90,
  ...facilityOptions(key),
});
export const defaults = () => ({
  layer: "janLow",
  mode: "all",
  county: [freshFilter("janLow")],
});
const validCutoff = (x, { min, max }) =>
  Number.isInteger(x) && x >= min && x <= max;

function readRange(input, warnings) {
  const { key } = input;
  const metric = layers[key];
  const range = freshFilter(key, input.on === true);
  if (metric.facility) {
    restoreFacility(range, input);
    if (input.units === "min") {
      warnings.add(
        "Travel-time filters from this link were paused. Review their new straight-line distance ranges in miles.",
      );
      range.on = false;
      range.max = metric.radius;
      return range;
    }
  }
  const scale = 1 / (metric.step ?? 0.1);
  const [floor, ceiling] = metric.domain;
  const clamp = (v) => Math.max(floor, Math.min(ceiling, v));
  if (metric.threshold && input.cutoff !== undefined) {
    if (validCutoff(input.cutoff, metric.threshold))
      range.cutoff = input.cutoff;
    else
      warnings.add(
        `${metric.name} uses ${range.cutoff}°F because the link's temperature cutoff is invalid.`,
      );
  }

  if (Object.hasOwn(input, "min") || Object.hasOwn(input, "max")) {
    if (
      Number.isFinite(input.min) &&
      Number.isFinite(input.max) &&
      input.min <= input.max
    ) {
      range.min = clamp(Math.round(input.min * scale) / scale);
      range.max = clamp(Math.round(input.max * scale) / scale);
      if (range.min !== input.min || range.max !== input.max) {
        warnings.add(
          metric.name +
            " had endpoints outside the supported range or precision. Review its adjusted range.",
        );
      }
      return range;
    }
  } else if (
    ["min", "max"].includes(input.op) &&
    Number.isFinite(input.limit)
  ) {
    // Whole-number measures round legacy bounds. Finer bounds fall inward.
    const limit = clamp(input.limit);
    const round =
      scale === 1 ? Math.round : input.op === "min" ? Math.ceil : Math.floor;
    range[input.op] = round(limit * scale) / scale;
    return range;
  }

  warnings.add(
    metric.name +
      " had invalid bounds. Its filter is off and its full range is available to edit.",
  );
  range.on = false;
  return range;
}

function mergeRanges(ranges, mode, warnings) {
  const active = ranges.filter((f) => f.on);
  // Disabled alternatives do not affect the result. If none are active, retain
  // the saved limits for editing where a single interval can express them.
  const candidates = active.length ? active : ranges;
  const first = candidates[0];
  if (candidates.length === 1) return first;
  const metric = layers[first.key];
  const incompatible = (reason) => {
    warnings.add(
      metric.name +
        ": " +
        reason +
        ". Its filter is off with the first range available to edit.",
    );
    return { ...first, on: false };
  };
  if (metric.threshold && candidates.some((f) => f.cutoff !== first.cutoff)) {
    return incompatible("the link used different temperature cutoffs");
  }
  if (mode === "all") {
    const min = Math.max(...candidates.map((f) => f.min));
    const max = Math.min(...candidates.map((f) => f.max));
    if (min > max) return incompatible("the linked ranges do not overlap");
    return { ...first, min, max };
  }
  const sorted = [...candidates].sort((a, b) => a.min - b.min);
  const scale = 1 / (metric.step ?? 0.1);
  let max = sorted[0].max;
  for (const range of sorted.slice(1)) {
    // Adjacent tenth-degree or whole-person bins have no observable gap.
    if (Math.round(range.min * scale) > Math.round(max * scale) + 1) {
      return incompatible("the linked ranges contain a gap");
    }
    max = Math.max(max, range.max);
  }
  return { ...first, min: sorted[0].min, max };
}

// A threshold cannot carry across a change of units.
const replacements = new Map([
  ["cloud", "cloudyDays"],
  ["population", "populationDensity"],
]);
export const retiredMeasure = (key) => replacements.has(key);
function linkedLayer(raw) {
  if (raw.layerId && measureKey(raw.layerId) === raw.layer) return raw.layerId;
  return typeof raw.layer === "string" &&
    (retiredMeasure(raw.layer) || measureKey(raw.layer))
    ? raw.layer
    : raw.views?.county;
}
export function usesRetiredMeasure(raw) {
  return Boolean(
    raw &&
    (retiredMeasure(linkedLayer(raw)) ||
      (Array.isArray(raw.county) &&
        raw.county.slice(0, maxFilters).some((f) => retiredMeasure(f?.key)))),
  );
}

export function parseView(raw, warn = () => {}) {
  const state = defaults();
  if (!raw || typeof raw !== "object") return state;
  const warnings = new Set();
  state.mode = (raw.mode ?? raw.modes?.county) === "any" ? "any" : "all";
  const migrated = new Set();
  const linked = Array.isArray(raw.county)
    ? raw.county.slice(0, maxFilters)
    : [];
  const linkedKeys = new Set(linked.map((f) => f?.key));
  if (Array.isArray(raw.county)) {
    const grouped = new Map();
    if (raw.county.length > maxFilters)
      warnings.add(
        `Only the first ${maxFilters} linked filters were restored.`,
      );
    for (const input of linked) {
      if (retiredMeasure(input?.key)) {
        const key = replacements.get(input.key);
        migrated.add(input.key);
        if (!linkedKeys.has(key) && !grouped.has(key))
          grouped.set(key, [freshFilter(key)]);
        continue;
      }
      if (
        !input ||
        typeof input.key !== "string" ||
        !Object.hasOwn(layers, input.key)
      ) {
        warnings.add("An unrecognized layer was omitted from the linked view.");
        continue;
      }
      const range = readRange(input, warnings);
      if (input.id !== undefined && input.id !== input.key) {
        if (measureKey(input.id) !== input.key) {
          warnings.add(
            "A filter with an invalid copy number was omitted from the linked view.",
          );
          continue;
        }
        range.id = input.id;
      }
      const id = filterId(range);
      if (!grouped.has(id)) grouped.set(id, []);
      grouped.get(id).push(range);
    }
    state.county = [...grouped.values()].map((ranges) =>
      mergeRanges(ranges, state.mode, warnings),
    );
  }
  let desired = linkedLayer(raw);
  if (retiredMeasure(desired)) {
    migrated.add(desired);
    desired = replacements.get(desired);
    if (state.county.length && !state.county.some((f) => f.key === desired))
      state.county.push(freshFilter(desired));
  }
  if (migrated.has("cloud") && state.county.some((f) => f.key === "cloudyDays"))
    warnings.add(
      linkedKeys.has("cloudyDays")
        ? "This link referenced the former cloud-frequency percentage. Its saved Cloudy Days range and switch setting have been kept."
        : "This link used daytime cloud frequency (%). Cloudy Days measures days per year. Its filter is paused at the full range so you can choose new limits.",
    );
  if (
    migrated.has("population") &&
    state.county.some((f) => f.key === "populationDensity")
  )
    warnings.add(
      linkedKeys.has("populationDensity")
        ? "This link included a county population total. Its saved population density range and switch setting have been kept."
        : "This link used total residents. Population density measures people per square mile of land. Its filter is paused so you can choose a new range.",
    );
  setViewedFilter(
    state,
    state.county.find((f) => filterId(f) === desired) ?? state.county[0],
  );
  if (warnings.size) warn([...warnings].join(" "));
  return state;
}
export const fmt = (v, unit) =>
  v === null
    ? "No data"
    : v.toLocaleString("en-US", {
        maximumFractionDigits:
          unit === "/ 100" || unit === "people/mi²" ? 2 : 1,
      }) + (unit === "°F" ? "°F" : unit === "%" ? "%" : " " + unit);
export function metricName(key, cutoff = layers[key]?.threshold?.initial) {
  const metric = layers[key];
  if (metric?.threshold) {
    const prefix = metric.month === undefined ? "" : months[metric.month] + " ";
    const direction =
      (metric.baseKey ?? key) === "coldDays" ? "Below" : "at or Above";
    return `${prefix}Days ${direction} ${cutoff}°F`;
  }
  return layers[key].name;
}

export function countyReading(place, key, cutoff) {
  if (!place) return "No county data";
  const score = value(place, key, cutoff);
  if (layers[key].landCover) return landShareLabel(score);
  if (!layers[key].hazard) return fmt(score, layers[key].unit);
  const rating = place.hazardRatings?.[key];
  if (!rating) return "No matching county boundary";
  if (rating === "Not Applicable") return "Not applicable";
  if (rating === "Insufficient Data") return "Insufficient data";
  return (
    fmt(score, layers[key].unit) +
    " · " +
    (rating === "No Rating" ? "Zero modeled loss" : rating)
  );
}
