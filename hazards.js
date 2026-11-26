// Registry keys match FEMA's published county percentile fields.
const catalog = {
  RISK_SCORE: ["Overall Natural Hazard Risk", "combined composite"],
  IFLD_RISKS: ["Inland Flooding Risk", "inland floods riverine river flooding"],
  CFLD_RISKS: ["Coastal Flooding Risk", "coastal floods"],
  TRND_RISKS: ["Tornado Risk", "tornadoes tornados twisters"],
  HRCN_RISKS: ["Hurricane Risk", "hurricanes tropical cyclones"],
  ERQK_RISKS: ["Earthquake Risk", "earthquakes seismic"],
  TSUN_RISKS: ["Tsunami Risk", "tsunamis"],
  WFIR_RISKS: ["Wildfire Risk", "wildfires forest fires"],
  DRGT_RISKS: ["Drought Risk", "droughts"],
  HWAV_RISKS: ["Heat Wave Risk", "heat waves heatwaves"],
  LNDS_RISKS: ["Landslide Risk", "landslides mudslides"],
  AVLN_RISKS: ["Avalanche Risk", "avalanches"],
  CWAV_RISKS: ["Cold Wave Risk", "cold waves cold snaps"],
  HAIL_RISKS: ["Hail Risk", "hailstorms"],
  ISTM_RISKS: ["Ice Storm Risk", "ice storms"],
  LTNG_RISKS: ["Lightning Risk", "lightning strikes"],
  SWND_RISKS: ["Strong Wind Risk", "strong winds windstorms"],
  VLCN_RISKS: [
    "Volcanic Activity Risk",
    "volcano volcanoes volcanos eruptions",
  ],
  WNTW_RISKS: ["Winter Weather Risk", "winter storms blizzards"],
};

export const hazardLayers = Object.fromEntries(
  Object.entries(catalog).map(([key, [name, searchTerms]]) => [
    key,
    {
      name,
      searchTerms,
      hazard: true,
      icon: "hazard",
      unit: "/ 100",
      period: "Dec 2025",
      description:
        key === "RISK_SCORE"
          ? "FEMA’s national ranking for the combined hazards it could assess in this county. Higher scores mean greater risk relative to other counties."
          : "FEMA’s national ranking for this hazard. A score of 80 means the county has higher risk than about 80% of the counties FEMA scored.",
      bins: [20, 40, 60, 80, 95],
      colors: [
        "#f5e9c9",
        "#ebcf9b",
        "#dea975",
        "#c67f59",
        "#a45449",
        "#743346",
      ],
      domain: [0, 100],
      step: 0.01,
    },
  ]),
);

export function countyHazards(dataset, fips) {
  const row = dataset.counties[fips];
  const values = {},
    ratings = {};
  if (row)
    dataset.fields.forEach((key, i) => {
      values[key] = row.scores[i];
      ratings[key] = dataset.ratingLabels[row.ratings[i]];
    });
  return { values, ratings };
}
