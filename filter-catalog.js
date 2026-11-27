// A catalog entry groups interchangeable measures. Each card and shared URL
// keeps its concrete measure key so several hazards or place types can coexist.
import { coverKeys } from "./landscape.js";
import {
  layers,
  freshFilter,
  monthlyTemperatureKeys,
  monthKeys,
  months,
  filterId,
  repeatableMeasures,
  maxFilters,
} from "./model.js";

const single = (key, description, searchTerms) => ({
  id: key,
  keys: [key],
  name: layers[key].name,
  description,
  searchTerms,
});
export const catalog = [
  {
    name: "Climate & Weather",
    entries: [
      {
        id: "temperature",
        name: "Temperature",
        label: "Month",
        description: "Choose the average high or low for any month.",
        keys: monthlyTemperatureKeys,
      },
      {
        id: "humidity",
        name: "Absolute Humidity",
        label: "Month",
        description: "Choose how much water vapor is in the air each month.",
        keys: [
          ...monthKeys("coldAbsoluteHumidity"),
          "coldAbsoluteHumidity",
          "hotAbsoluteHumidity",
        ],
      },
      {
        id: "temperatureDays",
        name: "Hot & Cold Days",
        label: "Count",
        description:
          "Choose how many hot or cold days you want in a month or year.",
        searchName: "temperature threshold days",
        keys: [
          "heatDays",
          "coldDays",
          ...monthKeys("heatDays"),
          ...monthKeys("coldDays"),
        ],
        periodMeasures: ["heatDays", "coldDays"],
        independentRanges: true,
      },
      {
        id: "annualPrecipitation",
        name: "Precipitation",
        label: "Measure",
        description: "Choose how much rain or snow falls.",
        keys: ["rainfall", "snowfall", ...monthKeys("rainfall")],
        periodMeasures: ["rainfall", "snowfall"],
        independentRanges: true,
      },
      {
        ...single(
          "wetDays",
          "Choose how many days get measurable rain or snow.",
          "precipitation rain rainy dry",
        ),
        label: "Period",
        keys: ["wetDays", ...monthKeys("wetDays")],
      },
      {
        ...single(
          "cloudyDays",
          "Choose how many days are mostly cloudy.",
          "cloud cover overcast clear sunny cloudy sunshine",
        ),
        name: "Cloudy Days",
        label: "Period",
        keys: ["cloudyDays", ...monthKeys("cloudyDays")],
      },
    ],
  },
  {
    name: "Population & Nearby Places",
    entries: [
      single(
        "populationDensity",
        "Choose how many people live per square mile.",
        "people populous residents rural urban crowded density",
      ),
      {
        id: "crime",
        independentRanges: true,
        name: "County Crime",
        label: "Measure",
        description:
          "Compare violent crime or homicide rates per 100,000 people.",
        searchTerms: "public safety crime rate",
        keys: ["violentCrimeRate", "homicideRate"],
      },
      {
        id: "distance",
        name: "Distance to Places",
        label: "Place Type",
        description:
          "Straight-line miles to schools, hospitals, grocery stores, airports, cities, or your own places.",
        help: "Choose the straight-line distance to the nearest place of this type.",
        searchTerms: "nearby radius proximity within miles",
        keys: [
          "schools",
          "hospitals",
          "grocery",
          "airports",
          "cities",
          "custom",
        ],
      },
    ],
  },
  {
    name: "Land & Terrain",
    entries: [
      {
        id: "landCover",
        name: "Land Cover",
        label: "Cover Type",
        description:
          "Choose how much county land is forest, farmland, or another type.",
        searchTerms: "satellite terrain type land use landscape",
        keys: coverKeys,
        independentRanges: true,
      },
      single(
        "elevation",
        "Choose the county’s average height above sea level.",
        "altitude height",
      ),
      {
        id: "nature",
        name: "Distance to Nature",
        label: "Feature Type",
        description:
          "Straight-line miles to a shoreline, mountain range, park, forest, river, or lake.",
        help: "Choose the straight-line distance to the nearest natural feature.",
        searchTerms: "nearby radius proximity within miles",
        keys: ["coast", "mountains", "parks", "rivers", "lakes", "freshwater"],
      },
    ],
  },
  {
    name: "Natural Hazards",
    entries: [
      {
        id: "hazard",
        name: "Natural Hazard Risk",
        label: "Hazard Type",
        description:
          "Overall risk or one of 18 hazards, including floods and tornadoes.",
        help: "Compare each county’s risk from hazards like floods and tornadoes.",
        searchTerms: "FEMA natural disasters",
        keys: Object.keys(layers).filter((key) => layers[key].hazard),
      },
    ],
  },
];
const byMeasure = new Map(
  catalog.flatMap((group) =>
    group.entries.flatMap((entry) => entry.keys.map((key) => [key, entry])),
  ),
);
// These county-specific seasonal measures can still be displayed from earlier shares.
const seasonalTemperatures = new Map(
  [
    ["coldLow", "Choose the average low in the coldest month."],
    ["hotHigh", "Choose the average high in the hottest month."],
  ].map(([key, description]) => [key, single(key, description)]),
);
export const entryFor = (key) =>
  byMeasure.get(key) ?? seasonalTemperatures.get(key);
export const canAddFilter = (used) => used.size < maxFilters;
export const canAddKey = (key, used) =>
  !used.has(key) || repeatableMeasures.has(key);

export function optionName(key) {
  if (layers[key].baseKey) return months[layers[key].month];
  if (key === "wetDays" || key === "cloudyDays") return "Full Year";
  if (key === "coast") return "Coast & Great Lakes";
  if (key === "freshwater") return "Larger Rivers or Lakes";
  if (key === "RISK_SCORE") return "All Hazards Combined";
  if (key === "coldAbsoluteHumidity") return "Coldest Month";
  if (key === "hotAbsoluteHumidity") return "Hottest Month";
  return layers[key].name.replace(/^Distance to /, "").replace(/ Risk$/, "");
}

const aliases = {
  heatDays: "hot heat warm days above",
  coldDays: "cold freezing freeze frost subzero below zero winter nights",
  violentCrimeRate: "assault robbery rape murder police offenses",
  homicideRate: "murder deaths mortality",
  coast:
    "coastal ocean beach seashore gulf bay sound inlet estuary tidal barrier island puget chesapeake outer banks superior michigan huron erie ontario",
  mountains: "mountain mountainous terrain",
  parks:
    "outdoors forest preserve state parks national parks national forests state forests",
  rivers: "water waterway fox river",
  lakes: "water reservoirs powers lake",
  freshwater: "freshwater either",
  schools: "elementary middle high school education kindergarten k12 k-12",
  hospitals: "heart cardiac surgery medical care",
  custom: "addresses coordinates personal",
  airports: "flights planes",
  cities: "towns downtown city size",
};
export function catalogMatches(used, query = "") {
  const search = query.toLowerCase().trim();
  const words = search.split(/\s+/).filter(Boolean);
  return catalog
    .map((group) => ({
      name: group.name,
      entries: group.entries.flatMap((entry) => {
        const common = [
          group.name,
          search === entry.name.toLowerCase()
            ? entry.name
            : (entry.searchName ?? entry.name),
          entry.searchTerms,
        ]
          .join(" ")
          .toLowerCase();
        const matches = entry.keys.filter((key) => {
          if (!canAddKey(key, used)) return false;
          const m = layers[key];
          const terms = [
            common,
            m.name,
            optionName(key),
            aliases[m.baseKey ?? key],
            m.searchTerms,
            m.description,
          ]
            .join(" ")
            .toLowerCase();
          return words.every((word) => terms.includes(word));
        });
        // A search for hot or cold days defaults to the annual cutoff even
        // when the user already has a rule for a different temperature.
        const annual =
          entry.id === "temperatureDays"
            ? matches.filter((key) => layers[key].month === undefined)
            : [];
        const candidates = annual.length ? annual : matches;
        return matches.length
          ? [
              {
                entry,
                key: candidates.find((key) => !used.has(key)) ?? candidates[0],
                detail:
                  words.length && matches.length === 1 && entry.label
                    ? layers[matches[0]].name
                    : entry.description,
              },
            ]
          : [];
      }),
    }))
    .filter((group) => group.entries.length);
}

// A copy keeps its ID when a sibling is removed or the view is shared.
function assignId(card, existing) {
  const key = card.key;
  if (!repeatableMeasures.has(key)) return card;
  const used = new Set(existing.map(filterId));
  if (!used.has(filterId(card))) return card;
  let id = key;
  for (let n = 2; used.has(id); n++) id = key + "~" + n;
  if (id === key) delete card.id;
  else card.id = id;
  return card;
}

export function newCard(key, existing = []) {
  const card = freshFilter(key, key !== "custom");
  if (layers[key].facility) card.max = layers[key].radius;
  return assignId(card, existing);
}

// Remember a card’s edited subtypes during the session. Only the chosen one is
// active, and only its settings and custom locations are included when sharing.
const previousChoices = new WeakMap();
export function changeSubtype(current, key, existing = []) {
  if (key === current.key || !entryFor(current.key).keys.includes(key))
    return current;
  const saved = previousChoices.get(current) ?? new Map();
  saved.set(current.key, current);
  const next = saved.get(key) ?? newCard(key);
  if (!saved.has(key)) {
    const initial = newCard(current.key);
    const previous = layers[current.key];
    const metric = layers[key];
    const sameMeasure =
      (previous.baseKey ?? current.key) === (metric.baseKey ?? key);
    if (sameMeasure && metric.threshold) next.cutoff = current.cutoff;
    if (
      (!entryFor(key).independentRanges || sameMeasure) &&
      previous.unit === metric.unit &&
      (current.min !== initial.min || current.max !== initial.max)
    ) {
      const [lo, hi] = layers[key].domain;
      if (current.min <= hi && current.max >= lo) {
        next.min = Math.max(lo, current.min);
        next.max = Math.min(hi, current.max);
      }
    }
  }
  next.on = current.on && (key !== "custom" || next.points.length > 0);
  previousChoices.set(next, saved);
  return assignId(
    next,
    existing.filter((card) => card !== current),
  );
}
