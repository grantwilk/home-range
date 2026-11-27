import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { NatureIndex } from "../nature-spatial.js";
import { unitVector } from "../spatial.js";

const nearest = (index, lon, lat) => {
  const hit = index.nearest(...unitVector(lon, lat), lon, lat);
  return { name: index.names[hit.id], miles: hit.miles };
};
test("Powers Lake, the Fox River, parks and ranges use mapped geometry", () => {
  for (const [key, anchors] of Object.entries({
    mountains: [[-105.615, 40.255, /Longs Peak/, 0, 0]],
    parks: [
      [-110.828, 44.46, /Yellowstone/, 0, 0],
      [-150.1764, 63.9973, /Denali/, 0, 0.001],
      [-150.1764, 64.00049, /Denali/, 0.2, 0.24],
    ],
    rivers: [
      [-88.315, 41.76, /Fox River/, 0, 0.15],
      [-88.38, 41.76, /Fox River/, 2, 4],
    ],
    lakes: [
      [-88.2981, 42.54637, /Powers Lake/, 0, 0],
      [-88.33, 42.54637, /Powers Lake/, 0.8, 1.1],
    ],
  })) {
    const path = new URL("../data/nature/" + key + ".json.gz", import.meta.url);
    const index = new NatureIndex(JSON.parse(gunzipSync(readFileSync(path))));
    for (const [lon, lat, name, min, max] of anchors) {
      const hit = nearest(index, lon, lat);
      assert.match(hit.name, name);
      assert.ok(
        hit.miles >= min && hit.miles <= max,
        key + " distance was " + hit.miles,
      );
    }
  }
});

test("coastal distances retain bay shores and river mouths and exclude inland riverbanks", () => {
  const path = new URL("../data/nature/coast.json.gz", import.meta.url);
  const index = new NatureIndex(JSON.parse(gunzipSync(readFileSync(path))));
  // Tide gauge positions come from NOAA CO-OPS station metadata (IDs below).
  // Gauges sometimes sit on piers, so allow some distance from the mapped shore.
  // https://api.tidesandcurrents.noaa.gov/mdapi/prod/
  const anchors = [
    // Check the mouths independently of their upstream river gauges. A mouth
    // station can sit on a jetty or island just outside the mapped shoreline.
    ["Saybrook Jetty (8462723)", -72.3433, 41.2633, "Atlantic", 0, 0.75],
    ["St. Johns entrance (8720214)", -81.395, 30.3967, "Atlantic", 0, 1.5],
    ["Savannah entrance (8670870)", -80.90303, 32.034695, "Atlantic", 0, 2.5],
    ["The Battery (8518750)", -74.01417, 40.700554, "Atlantic", 0, 0.5],
    ["Southwest Pass (8760959)", -89.4283, 28.9317, "Gulf", 0, 2],
    // These gauges sit on the river. Distance is straight to the nearest
    // coastal shore, which can be on another bay or barrier island.
    ["Jacksonville Main Street (8720226)", -81.6583, 30.32, "Atlantic", 8, 22],
    ["Savannah riverfront (8670681)", -81.0917, 32.0817, "Atlantic", 3, 20],
    [
      "Potomac at Washington (8594900)",
      -77.021667,
      38.873333,
      "Atlantic",
      15,
      40,
    ],
    [
      "Columbia at Vancouver (9440083)",
      -122.695772,
      45.631172,
      "Pacific",
      40,
      95,
    ],
    // The TIGER river polygon at Essex inherits the name Long Island Sound.
    // NOAA places the gauge on the Connecticut River, five miles from the sound.
    ["Connecticut at Essex (8462925)", -72.385, 41.3483, "Atlantic", 3, 7],
    // USGS station IDs identify the WGS84 locations at waterdata.usgs.gov.
    [
      "St. Johns near Geneva (02234000)",
      -81.035337,
      28.714161,
      "Atlantic",
      12,
      30,
    ],
    [
      "Savannah near Evans (02195520)",
      -82.123222,
      33.592861,
      "Atlantic",
      100,
      155,
    ],
    [
      "Hudson at Green Island (01358000)",
      -73.689083,
      42.75225,
      "Atlantic",
      85,
      155,
    ],
    [
      "Mississippi at Baton Rouge (07374000)",
      -91.191556,
      30.445667,
      "Gulf",
      25,
      90,
    ],
    [
      "Mississippi at New Orleans (07374510)",
      -90.136185,
      29.934927,
      "Gulf",
      3,
      17,
    ],
    // The Baltimore gauge is in Northwest Harbor, upstream of the Patapsco
    // mouth. Tolchester Beach sits directly on the Chesapeake Bay shoreline.
    ["Baltimore (8574680)", -76.57831, 39.266693, "Atlantic", 2.5, 10],
    ["Tolchester Beach (8573364)", -76.24455, 39.213444, "Atlantic", 0, 0.5],
    // The Engelhard gauge sits upstream in Far Creek. The nearby mainland
    // point lies on NOAA's charted shore along the TIGER Pamlico Sound polygon.
    [
      "Engelhard, Far Creek (8653471)",
      -75.9888992,
      35.5093994,
      "Atlantic",
      0.6,
      1.8,
    ],
    [
      "Pamlico Sound near Engelhard",
      -75.976883,
      35.489708,
      "Atlantic",
      0,
      0.25,
    ],
    // NOAA charted shoreline beside the TIGER polygon named Green Island Sound.
    // Census classifies this sound as H3010, the same code used for inland rivers.
    ["Green Island Sound, Georgia", -81.098916, 31.894525, "Atlantic", 0, 0.25],
    ["Bremerton (9445958)", -122.623, 47.5617, "Pacific", 0, 0.5],
    ["Pensacola (8729840)", -87.2112, 30.4044, "Gulf", 0, 0.5],
    ["Duck ocean pier (8651370)", -75.7467, 36.1833, "Atlantic", 0, 0.5],
    // NC Wildlife Resources Commission, Midway Drive boat ramp, Albemarle Sound.
    // https://services1.arcgis.com/YfqBAUM5nWR3yhGP/arcgis/rest/services/NCWRC_Boating_Access_Areas_view/FeatureServer/0/68
    ["Midway Drive", -76.564728, 36.010874, "Atlantic", 0, 0.5],
    // A floating station in the middle of Chesapeake Bay.
    // https://buoybay.noaa.gov/locations/gooses-reef
    ["Gooses Reef buoy", -76.4147, 38.5563, "Atlantic", 3, 6],
    // Midpoint of NOAA's artificial chart truncation (S_ARC_CODE 3) in Nueces Bay.
    // Counting that line as coastline would put this open-water point at zero.
    ["Nueces Bay chart closure", -97.480853, 27.847088, "Gulf", 0.7, 1.5],
    // The Lake Mendota shore gauge is well inland from Lake Michigan.
    // https://waterdata.usgs.gov/monitoring-location/USGS-05428000/
    ["Lake Mendota", -89.37011836, 43.09499562, "Great Lakes", 65, 85],
    // This freshwater lake on the Albemarle-Pamlico peninsula also has a gauge.
    // https://waterdata.usgs.gov/monitoring-location/USGS-0208458893/
    ["Lake Mattamuskeet", -76.1838889, 35.5063889, "Atlantic", 3, 12],
    ["Chicago lakeshore", -87.602, 41.89, "Great Lakes", 0, 0.25],
    ["Chicago inland", -87.9, 41.89, "Great Lakes", 13, 16],
  ];
  for (const [site, lon, lat, basin, min, max] of anchors) {
    const hit = nearest(index, lon, lat);
    assert.equal(hit.name, basin + " shoreline", site);
    assert.ok(
      hit.miles >= min && hit.miles <= max,
      `${site}: expected ${min}–${max} miles, got ${hit.miles.toFixed(3)}`,
    );
  }
});

test("a polygon crossing the date line preserves its hole and overlapping land", () => {
  const encode = (points) => {
    const prev = [0, 0];
    let path = "";
    for (const pair of points)
      for (const [i, n] of pair.entries()) {
        const delta = n - prev[i];
        prev[i] = n;
        let v = delta < 0 ? -2 * delta - 1 : delta * 2;
        while (v >= 32) {
          path += String.fromCharCode((v & 31) + 95);
          v >>>= 5;
        }
        path += String.fromCharCode(v + 63);
      }
    return path;
  };
  const rect = (west, east, south, north) =>
    encode([
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ]);
  const index = new NatureIndex({
    geometry: "area",
    names: ["Main area", "Island"],
    scale: 1,
    parts: [
      [0, rect(176, -176, 0, 8), rect(178, -178, 2, 6)],
      [1, rect(179, 180, 3, 5)],
    ],
  });
  assert.equal(nearest(index, -179.5, 1).miles, 0);
  assert.ok(nearest(index, -179.5, 4).miles > 30);
  assert.deepEqual(nearest(index, 179.5, 4), { name: "Island", miles: 0 });
  assert.ok(nearest(index, -174, 4).miles > 130);
});
