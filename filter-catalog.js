// A catalog entry groups interchangeable measures. Each card and shared URL
// keeps its concrete measure key so several hazards or place types can coexist.
import { coverKeys } from "./landscape.js";
import { layers, freshFilter, monthlyTemperatureKeys } from "./model.js";

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
        description: "Choose a month and its average daily low or high.",
        keys: monthlyTemperatureKeys,
      },
      {
        id: "humidity",
        name: "Relative Humidity",
        label: "Month",
        description:
          "Average humidity in the county’s coldest or hottest month.",
        keys: ["coldHumidity", "hotHumidity"],
      },
      single(
        "heatDays",
        "Days per year reaching a temperature you choose.",
        "heat hot warm threshold temperature",
      ),
      {
        id: "annualPrecipitation",
        name: "Annual Precipitation",
        label: "Measure",
        description: "Average inches of rainfall or snowfall per year.",
        keys: ["rainfall", "snowfall"],
        independentRanges: true,
      },
      single(
        "wetDays",
        "Days per year with measurable precipitation.",
        "precipitation rain rainy dry",
      ),
      single(
        "cloudyDays",
        "Days per year with at least 80% average countywide cloud cover.",
        "cloud cover overcast clear sunny cloudy sunshine sky",
      ),
    ],
  },
  {
    name: "Population & Nearby Places",
    entries: [
      single(
        "populationDensity",
        "Residents per square mile of county land.",
        "people populous residents rural urban crowded density",
      ),
      {
        id: "crime",
        independentRanges: true,
        name: "County Crime",
        label: "Measure",
        description:
          "Reported violent offenses or homicide deaths per 100,000 residents.",
        searchTerms: "public safety crime rate",
        keys: ["violentCrimeRate", "homicideRate"],
      },
      {
        id: "distance",
        name: "Distance to Places",
        label: "Place Type",
        description:
          "Straight-line miles to schools, hospitals, grocery stores, airports, cities, or your own places.",
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
          "Choose how much of a county is forest, farmland, grassland, or built up.",
        searchTerms: "satellite terrain type land use landscape",
        keys: coverKeys,
        independentRanges: true,
      },
      single(
        "elevation",
        "Average height above sea level, in feet.",
        "altitude height",
      ),
      {
        id: "nature",
        name: "Distance to Nature",
        label: "Feature Type",
        description:
          "Straight-line miles to a shoreline, mountain range, park, forest, river, or lake.",
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
  ["coldLow", "hotHigh"].map((key) => [
    key,
    single(key, layers[key].description),
  ]),
);
export const entryFor = (key) =>
  byMeasure.get(key) ?? seasonalTemperatures.get(key);
export const canAddFilter = (used) =>
  [...byMeasure.keys()].some((key) => !used.has(key));

export function optionName(key) {
  if (key === "coast") return "Coast & Great Lakes";
  if (key === "freshwater") return "Larger Rivers or Lakes";
  if (key === "RISK_SCORE") return "All Hazards Combined";
  if (key === "coldHumidity") return "Coldest Month";
  if (key === "hotHumidity") return "Hottest Month";
  return layers[key].name.replace(/^Distance to /, "").replace(/ Risk$/, "");
}

const aliases = {
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
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return catalog
    .map((group) => ({
      name: group.name,
      entries: group.entries.flatMap((entry) => {
        const common = [group.name, entry.name, entry.searchTerms]
          .join(" ")
          .toLowerCase();
        const matches = entry.keys.filter((key) => {
          if (used.has(key)) return false;
          const m = layers[key];
          const terms = [
            common,
            m.name,
            optionName(key),
            aliases[key],
            m.searchTerms,
            m.description,
          ]
            .join(" ")
            .toLowerCase();
          return words.every((word) => terms.includes(word));
        });
        return matches.length
          ? [
              {
                entry,
                key: matches[0],
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

export function newCard(key) {
  const card = freshFilter(key, key !== "custom");
  if (layers[key].facility) card.max = layers[key].radius;
  return card;
}

// Remember a card’s edited subtypes during the session. Only the chosen one is
// active, and only its settings and custom locations are included when sharing.
const previousChoices = new WeakMap();
export function changeSubtype(current, key) {
  if (key === current.key || !entryFor(current.key).keys.includes(key))
    return current;
  const saved = previousChoices.get(current) ?? new Map();
  saved.set(current.key, current);
  const next = saved.get(key) ?? newCard(key);
  if (!saved.has(key)) {
    const initial = newCard(current.key);
    if (
      !entryFor(key).independentRanges &&
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
  return next;
}
