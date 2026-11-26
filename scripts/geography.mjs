// Rebuild with: node scripts/geography.mjs [county-shapefile.zip] [county-gazetteer.zip]
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { geoAlbersUsa, geoGraticule, geoPath } from "d3-geo";
import { feature, merge, mesh } from "topojson-client";

const countyUrl =
  "https://www2.census.gov/geo/tiger/GENZ2017/shp/cb_2017_us_county_500k.zip";
const gazetteerUrl =
  "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2017_Gazetteer/2017_Gaz_counties_national.zip";
const scratch = mkdtempSync(join(tmpdir(), "atlas-geography-"));

function archive(local, url, sha) {
  const file = local ? resolve(local) : join(scratch, url.split("/").pop());
  if (!local) execFileSync("curl", ["--retry", "3", "-fsSL", url, "-o", file]);
  assert.equal(
    createHash("sha256").update(readFileSync(file)).digest("hex"),
    sha,
    url,
  );
  return file;
}

try {
  const boundaries = archive(
    process.argv[2],
    countyUrl,
    "d14db6b3034dbf42916067106fa753aad3cbc443ddbd87df6d2784adb8e00ff4",
  );
  const gazetteer = archive(
    process.argv[3],
    gazetteerUrl,
    "919aa22b692596d140ca435002f4010a65a4311e77909cd3ed0f3e01e48ba580",
  );
  execFileSync("unzip", ["-q", boundaries, "-d", scratch]);

  // Simplify shared arcs once. Protect every offshore island independently, with
  // a tighter tolerance for smaller polygon parts. Units are spherical meters.
  const topologyFile = join(scratch, "boundaries.json");
  execFileSync(
    "npm",
    [
      "exec",
      "--yes",
      "--package=mapshaper@0.8.11",
      "--",
      "mapshaper",
      join(scratch, "cb_2017_us_county_500k.shp"),
      "-filter",
      "Number(STATEFP) <= 56",
      "-rename-layers",
      "counties",
      "-explode",
      "-simplify",
      "variable",
      "dp",
      "interval=Math.min(650, Math.sqrt(this.area) / 15)",
      "keep-shapes",
      "-dissolve",
      "GEOID",
      "copy-fields=STATEFP",
      "-o",
      "format=topojson",
      "quantization=1000000",
      topologyFile,
    ],
    { stdio: "inherit" },
  );
  const topology = JSON.parse(readFileSync(topologyFile));
  const names = new Map(
    execFileSync("unzip", ["-p", gazetteer], { encoding: "latin1" })
      .trim()
      .split(/\r?\n/)
      .slice(1)
      .map((row) => {
        const [, id, , name] = row.split("\t");
        return [id, name];
      }),
  );

  // Retain established state labels, their placement, and the county draw order.
  const atlas = JSON.parse(
    readFileSync(
      new URL(
        "../node_modules/us-atlas/counties-albers-10m.json",
        import.meta.url,
      ),
    ),
  );
  const labelPath = geoPath();
  const abbreviations =
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(
      " ",
    );
  const states = feature(atlas, atlas.objects.states)
    .features.sort((a, b) => a.id.localeCompare(b.id))
    .map((s, i) => ({
      id: s.id,
      name: s.properties.name,
      abbr: abbreviations[i],
      xy: labelPath.centroid(s).map(Math.round),
    }));
  assert.equal(states.length, abbreviations.length);

  const projection = geoAlbersUsa().scale(1300).translate([487.5, 305]);
  const countyPaths = new Map();
  let countyBorders = "",
    outline = "",
    land = "";
  // The Alaska inset uses 35% of the mainland scale. An additional decimal
  // preserves island coastlines; fills, meshes and their clip use identical rounding.
  for (const alaska of [false, true]) {
    const path = geoPath(projection).digits(alaska ? 3 : 2);
    const geometries = topology.objects.counties.geometries.filter(
      (g) => (g.properties.STATEFP === "02") === alaska,
    );
    const region = { type: "GeometryCollection", geometries };
    for (const g of geometries) {
      const id = g.properties.GEOID;
      const d = path(feature(topology, g));
      assert.ok(names.has(id) && d?.endsWith("Z"), id);
      countyPaths.set(id, { id, name: names.get(id), d });
    }
    const sameState = (a, b) => a.properties.STATEFP === b.properties.STATEFP;
    countyBorders += path(
      mesh(topology, region, (a, b) => a !== b && sameState(a, b)),
    );
    outline += path(
      mesh(topology, region, (a, b) => a === b || !sameState(a, b)),
    );
    land += path(merge(topology, geometries));
  }
  const counties = atlas.objects.counties.geometries.map(({ id }) => {
    assert.ok(countyPaths.has(id), id);
    return countyPaths.get(id);
  });
  assert.equal(countyPaths.size, 3142);
  assert.equal(counties.length, countyPaths.size);
  const grid = geoPath(projection).digits(1)(
    geoGraticule()
      .extent([
        [-130, 22],
        [-62, 53],
      ])
      .step([5, 5])(),
  );
  writeFileSync(
    new URL("../data/geography.json", import.meta.url),
    JSON.stringify({
      states,
      counties,
      grid,
      outline,
      countyBorders,
      land,
      source:
        "U.S. Census Bureau, 2017 cartographic county boundaries at 1:500,000, simplified for display",
      url: countyUrl,
    }),
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
