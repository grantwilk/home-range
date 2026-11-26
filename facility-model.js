// Facility measures are evaluated at a geographic point; county records hold none of these values.
const catalog = {
  schools: [
    "Distance to K–12 Schools",
    "Nearest public or private school offering any K–12 grade.",
    5,
  ],
  hospitals: [
    "Distance to Major Hospitals",
    "Selected hospitals with documented bypass surgery and a verified site. Coverage is partial.",
    30,
  ],
  grocery: [
    "Distance to Grocery Stores",
    "Supermarkets, superstores, and identified large grocery stores in the USDA SNAP directory.",
    5,
  ],
  airports: [
    "Distance to Commercial Airports",
    "Airports in Madison’s FAA hub class or larger.",
    60,
  ],
  cities: [
    "Distance to Major Cities",
    "Distance to a city or town’s representative point. Choose the population range below.",
    50,
  ],
  custom: [
    "Distance to Custom Places",
    "Distance to the nearest place in your own list.",
    10,
  ],
  coast: [
    "Distance to the Coast & Great Lakes",
    "Straight-line miles to a mapped U.S. shoreline, including ocean coasts, bays, sounds, tidal riverbanks, and the Great Lakes.",
    25,
    "Shoreline",
  ],
  mountains: [
    "Distance to Mountain Ranges",
    "Miles to a mapped mountain range. Locations inside the range, including its valleys, are at zero miles.",
    25,
    "Mountain range boundary",
  ],
  parks: [
    "Distance to Parks, Forests & Preserves",
    "Miles to mapped public land in national or state parks, forests, and qualifying preserves. Locations inside are at zero miles.",
    10,
    "Public land boundary",
  ],
  rivers: [
    "Distance to Larger Rivers",
    "Miles to a mapped river centerline. The size cutoff includes the Fox River through Aurora, Illinois.",
    5,
    "River centerline",
  ],
  lakes: [
    "Distance to Lakes of 400+ Acres",
    "Miles to a lake of at least 400 acres, including Powers Lake, Wisconsin. Locations on the lake are at zero miles.",
    5,
    "Lake shoreline",
  ],
  freshwater: [
    "Distance to a Larger River or Lake",
    "Miles to the closer of a qualifying river centerline or a lake of at least 400 acres.",
    5,
    "River centerline or lake shoreline",
    ["rivers", "lakes"],
  ],
};
export const accessColors = [
  "#275b56",
  "#4e8174",
  "#7ca38a",
  "#aac09a",
  "#d1d9ae",
  "#e9ead2",
];
// Give short walks and drives room on the slider, while allowing distant inland locations.
const natureStops = [0];
for (const [step, end] of [
  [0.5, 10],
  [1, 50],
  [5, 150],
  [25, 500],
  [100, 2000],
]) {
  for (let miles = natureStops.at(-1) + step; miles <= end; miles += step)
    natureStops.push(miles);
}
export const facilityLayers = Object.fromEntries(
  Object.entries(catalog).map(
    ([key, [name, description, radius, nature, members]]) => [
      key,
      {
        name,
        description,
        radius,
        facility: true,
        nature,
        members,
        icon: "location",
        unit: "mi",
        domain: [0, nature ? natureStops.at(-1) : 120],
        ...(nature
          ? {
              sliderStops: natureStops,
              sliderTicks: [0, 10, 50, 150, 500, 2000],
            }
          : {}),
        bins: [2, 5, 15, 30, 60],
        colors: accessColors,
        period: "Straight-line distance",
      },
    ],
  ),
);
export const citySize = {
  name: "City population",
  unit: "residents",
  domain: [0, 10_000_000],
  step: 1,
};
export function validPoint(row) {
  return (
    Array.isArray(row) &&
    typeof row[0] === "string" &&
    row[0].trim().length > 0 &&
    Number.isFinite(row[1]) &&
    Math.abs(row[1]) <= 180 &&
    Number.isFinite(row[2]) &&
    Math.abs(row[2]) <= 90
  );
}
export function facilityOptions(key) {
  const options = {};
  if (key === "cities") options.citySize = { min: 150_000, max: 10_000_000 };
  if (key === "custom") options.points = [];
  return options;
}
export function restoreFacility(f, input) {
  if (f.key === "cities" && input.citySize) {
    const { min, max } = input.citySize;
    if (
      Number.isInteger(min) &&
      Number.isInteger(max) &&
      min >= 0 &&
      min <= max &&
      max <= citySize.domain[1]
    )
      f.citySize = { min, max };
  }
  if (f.key === "custom" && Array.isArray(input.points))
    f.points = input.points.filter(validPoint).map(([n, x, y]) => [n, x, y]);
}
