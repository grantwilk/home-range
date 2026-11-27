import { esc } from "./html.js";
import { icon } from "./icons.js";
import { combine } from "./spatial.js";
import { coverKeys, landShareLabel } from "./landscape.js";
import { hazardLayers } from "./hazards.js";
import {
  layers,
  months,
  countyReading,
  cutoffFor,
  filterId,
  viewedId,
  fmt,
  matchRange,
  metricName,
} from "./model.js";

const group = (title, symbol, preview, content) =>
  `<details class="profile-group" data-group="${esc(title)}"><summary><span class="profile-icon">${icon(symbol, 17)}</span><span><strong>${esc(title)}</strong><small>${esc(preview)}</small></span>${icon("chevron", 16)}</summary><div class="group-content">${content}</div></details>`;
const fact = (label, reading, note = "") =>
  `<div class="profile-fact"><dt>${esc(label)}${note ? `<small>${esc(note)}</small>` : ""}</dt><dd>${esc(reading)}</dd></div>`;

function temperatureChart(values) {
  const low = values.monthlyLow,
    high = values.monthlyHigh;
  if (
    ![low, high].every(
      (series) => series?.length === 12 && series.every(Number.isFinite),
    )
  )
    return "";
  const bottom = Math.min(0, 10 * Math.floor(Math.min(...low) / 10));
  const top = Math.max(60, 10 * Math.ceil(Math.max(...high) / 10));
  const x = (i) => 33 + i * 30;
  const y = (v) => 71 - (58 * (v - bottom)) / (top - bottom);
  const line = (series) => series.map((v, i) => `${x(i)},${y(v)}`);
  const highs = line(high),
    lows = line(low);
  return `<svg class="profile-chart" viewBox="0 0 380 94" role="img" aria-label="Average daily highs and lows through the year in degrees Fahrenheit. Exact values are in the monthly table.">
    ${[bottom, Math.round((bottom + top) / 2), top].map((v) => `<path d="M28 ${y(v)}H370" stroke="#dce5da"/><text x="21" y="${y(v) + 3}" text-anchor="end">${v}°</text>`).join("")}
    <polygon points="${highs.concat([...lows].reverse()).join(" ")}" fill="#e0e9d4"/>
    <polyline points="${highs.join(" ")}" fill="none" stroke="#a66433" stroke-width="2.4"/>
    <polyline points="${lows.join(" ")}" fill="none" stroke="#447582" stroke-width="2.4"/>
    ${months.map((m, i) => `<text x="${x(i)}" y="86" text-anchor="middle">${m.slice(0, 3)}</text>`).join("")}</svg>`;
}

function monthTable(values, columns) {
  return `<table class="profile-months"><thead><tr><th scope="col">Month</th>${columns.map(([, label]) => `<th scope="col">${label}</th>`).join("")}</tr></thead><tbody>${months
    .map(
      (month, i) =>
        `<tr><th scope="row">${month.slice(0, 3)}</th>${columns.map(([key, , unit]) => `<td>${fmt(values[key]?.[i] ?? null, unit)}</td>`).join("")}</tr>`,
    )
    .join("")}</tbody></table>`;
}

function countyGroups(county, state, periodFor) {
  const v = county.values;
  function metricFact(key, label) {
    const cutoff = cutoffFor(state, key);
    return fact(
      label ?? metricName(key, cutoff),
      countyReading(county, key, cutoff),
      periodFor(key, county),
    );
  }
  const seasonalRow = (label, month, temp, humidity) => {
    const period = months[v[month] - 1];
    const stat = temp === "coldLow" ? "Low" : "High";
    return fact(
      label + (period ? " · " + period : ""),
      countyReading(county, temp) + " / " + countyReading(county, humidity),
      stat + " temperature / absolute humidity",
    );
  };
  const tempPeriod = periodFor("janLow", county);
  const humidityPeriod = periodFor("coldAbsoluteHumidity", county);
  const climatePeriod =
    tempPeriod === humidityPeriod
      ? `${tempPeriod} averages.`
      : `Temperature · ${tempPeriod}. Absolute humidity · ${humidityPeriod}.`;
  const climate = `<h4>Temperature &amp; Humidity</h4>${temperatureChart(v)}
    ${monthTable(v, [
      ["monthlyLow", "Avg. Low", "°F"],
      ["monthlyHigh", "Avg. High", "°F"],
      [
        "monthlyAbsoluteHumidity",
        "Absolute Humidity",
        layers.coldAbsoluteHumidity.unit,
      ],
    ])}
    <p class="profile-note">${esc(climatePeriod)} Humidity is measured in grams of water vapor per cubic meter of air.</p>
    <dl class="profile-facts">${seasonalRow("Coldest Month", "coldMonth", "coldLow", "coldAbsoluteHumidity")}${seasonalRow("Hottest Month", "hotMonth", "hotHigh", "hotAbsoluteHumidity")}</dl>
    <h4>Rain &amp; Cloud by Month</h4>${monthTable(v, [
      ["monthlyRainfall", "Rainfall", "in"],
      ["monthlyWetDays", "Wet Days", "days"],
      ["monthlyCloudyDays", "Cloudy Days", "days"],
    ])}
    <h4>Annual Averages</h4><dl class="profile-facts">${["rainfall", "snowfall", "wetDays", "cloudyDays", "heatDays", "coldDays"].map((k) => metricFact(k)).join("")}</dl>`;
  const community = `<dl class="profile-facts">${fact("County Population", fmt(county.residents ?? null, "residents"), layers.populationDensity.period)}${["populationDensity", "violentCrimeRate", "homicideRate"].map((k) => metricFact(k)).join("")}</dl>${county.populationNote ? `<p class="profile-note">${esc(county.populationNote)}</p>` : ""}<div data-nearby></div>`;
  const shares = coverKeys
    .filter((k) => Number.isFinite(v[k]))
    .sort((a, b) => v[b] - v[a]);
  const terrain = `<dl class="profile-facts">${metricFact("elevation")}</dl><h4>Land Cover</h4>
    ${shares.length ? `<ul class="land-shares">${shares.map((k) => `<li><span>${esc(layers[k].name)}</span><span class="land-track" aria-hidden="true"><i style="width:${v[k]}%;background:${layers[k].swatch}"></i></span><b>${esc(landShareLabel(v[k]))}</b></li>`).join("")}</ul><p class="profile-note">${esc(periodFor(shares[0], county))} · Share of classified land, excluding open water.</p>` : "<p>Land cover data unavailable.</p>"}<div data-nature></div>`;
  const hazards = `<p class="profile-note">National risk percentiles · December 2025. A higher score means greater risk relative to other counties.</p><dl class="profile-facts">${Object.keys(
    hazardLayers,
  )
    .map((k) => fact(layers[k].name, countyReading(county, k)))
    .join("")}</dl>`;
  return (
    group(
      "Climate & Weather",
      "thermo",
      "Monthly averages, precipitation, and day counts",
      climate,
    ) +
    group(
      "Population & Nearby Places",
      "people",
      "Residents, crime, and nearby places",
      community,
    ) +
    group(
      "Land & Terrain",
      "mountain",
      shares.length
        ? "Elevation · " +
            layers[shares[0]].name +
            " " +
            landShareLabel(v[shares[0]])
        : "Elevation and land cover",
      terrain,
    ) +
    group(
      "Natural Hazards",
      "hazard",
      "Overall risk and individual hazards",
      hazards,
    )
  );
}

function distanceReading(row, point, result) {
  if (!row)
    return !point
      ? "Point needed"
      : result?.error
        ? "Unavailable"
        : "Measuring…";
  if (!row.name) return "No eligible locations";
  return fmt(Number.isFinite(row.miles) ? row.miles : null, "mi");
}
function distanceNote(f, row) {
  const notes = [];
  if (f.citySize)
    notes.push(
      `${f.citySize.min.toLocaleString("en-US")}–${f.citySize.max.toLocaleString("en-US")} residents`,
    );
  if (f.key === "custom" && f.points.length > 1)
    notes.push(`${f.points[0][0]} + ${f.points.length - 1} more`);
  else if (f.key === "custom" && f.points.length && !row?.name)
    notes.push(f.points[0][0]);
  if (row?.name)
    notes.push(
      (layers[f.key].nature ? "Mapped feature" : "Nearest location") +
        " · " +
        row.name,
    );
  return notes.join(" · ");
}

function showReadings(root, county, point, result, state, periodFor, dayLoad) {
  const active = state.county.filter((f) => f.on);
  const dayMessage = (metric) =>
    metric?.threshold &&
    dayLoad.missing.has(metric.month) &&
    dayLoad.status !== "ready"
      ? dayLoad.status === "error"
        ? "Unavailable"
        : "Loading…"
      : "";
  const distances = new Map(result?.rows?.map((row) => [row.id, row]));
  let overall = 2,
    passed = 0;
  const rows = active.map((f) => {
    const metric = layers[f.key],
      local = metric.facility;
    const row = distances.get(filterId(f));
    let hit;
    if (!local) hit = county ? matchRange(county, f) : null;
    else if (!row) hit = null;
    else if (!row.name) hit = false;
    else
      hit = Number.isFinite(row.miles)
        ? row.miles >= f.min && row.miles <= f.max
        : null;
    const status = hit === null ? "Unknown" : hit ? "Match" : "Outside";
    overall = combine(overall, hit === null ? -1 : Number(hit), state.mode);
    if (hit) passed++;
    const reading = local
      ? distanceReading(row, point, result)
      : dayMessage(metric) || countyReading(county, f.key, f.cutoff);
    const note = local && distanceNote(f, row);
    return `<li class="match-row${local && row ? " local-reading" : ""}" data-filter-id="${filterId(f)}" data-result="${status.toLowerCase()}"><div><strong>${esc(metricName(f.key, f.cutoff))}</strong><small class="match-range">Target ${fmt(f.min, metric.unit)} – ${fmt(f.max, metric.unit)}</small>${note ? `<small>${esc(note)}</small>` : ""}</div><div><b class="match-reading">${esc(reading)}</b><span class="match-status">${status}</span></div></li>`;
  });
  const hasLocal = active.some((f) => layers[f.key].facility);
  const pending =
    (hasLocal && point && !result) ||
    (dayLoad.status === "loading" &&
      active.some((f) => dayMessage(layers[f.key])));
  const verdict = pending
    ? "Checking Filters…"
    : overall === 2
      ? "No Active Filters"
      : overall === -1
        ? "Uncertain Match"
        : overall === 1
          ? "Matches Your Filters"
          : "Outside Your Filters";
  const matches = root.querySelector("#county-matches");
  matches.innerHTML = `<div class="match-heading"><h3>Filter Matches</h3>${active.length ? `<span>${state.mode === "all" ? "Match All" : "Match Any"}</span>` : ""}</div>
    <div class="match-summary" data-verdict="${pending ? "pending" : overall}"><strong>${verdict}</strong>${active.length ? `<span>${passed} of ${active.length} matched</span>` : ""}</div>
    ${hasLocal ? `<p class="profile-note">${point ? "Distances are measured at the selected point." : "Click a point in this county on the map to check distances."}</p>` : ""}
    ${result?.error ? '<p class="profile-note" role="status">Distances are unavailable for this point.</p>' : ""}
    ${rows.length ? `<ul class="match-list">${rows.join("")}</ul>` : ""}`;
  const viewed = state.county.find((f) => filterId(f) === viewedId(state));
  const measure = layers[state.layer];
  const current = root.querySelector("[data-current]");
  if (measure) {
    const reading = measure.facility
      ? distanceReading(distances.get(viewedId(state)), point, result)
      : dayMessage(measure) ||
        countyReading(county, state.layer, cutoffFor(state, state.layer));
    const season = {
      coldLow: "coldMonth",
      coldAbsoluteHumidity: "coldMonth",
      hotHigh: "hotMonth",
      hotAbsoluteHumidity: "hotMonth",
    }[state.layer];
    const month = season && months[(county?.values[season] ?? 0) - 1];
    current.innerHTML = `<span class="profile-icon">${icon(measure.icon)}</span><div><strong>${esc(metricName(state.layer, viewed?.cutoff))}</strong><div class="detailval">${esc(reading)}</div><p>${[month, periodFor(state.layer, county)].filter(Boolean).map(esc).join(" · ")}</p></div>`;
  }
  for (const [target, nature] of [
    ["[data-nearby]", false],
    ["[data-nature]", true],
  ]) {
    const host = root.querySelector(target);
    if (!host) continue;
    const local = state.county.filter(
      (f) =>
        layers[f.key].facility &&
        !!layers[f.key].nature === nature &&
        (f.on || filterId(f) === viewedId(state)),
    );
    host.innerHTML = !local.length
      ? ""
      : `<h4>Distances at This Point</h4>${!point ? '<p class="profile-note">Select a point on the map to measure distances.</p>' : ""}<dl class="profile-facts">${local
          .map((f) => {
            const row = distances.get(filterId(f));
            return fact(
              metricName(f.key),
              distanceReading(row, point, result),
              distanceNote(f, row),
            );
          })
          .join("")}</dl>`;
  }
}

export async function openCountyProfile({
  county,
  point,
  state,
  periodFor,
  showDialog,
  select,
  inspect,
  countyAt,
  locateCounty,
  zoomToPoint,
  dayLoad,
}) {
  const title = () => county?.name || point?.name || "Selected Point";
  showDialog(
    title(),
    `<article id="county-profile">
    <div class="profile-location"><div id="point-caption"></div><button class="secondary profile-locate" type="button">${icon("location", 16)}<span></span></button></div>
    ${layers[state.layer] ? '<section class="profile-current" data-current aria-label="Map layer"></section>' : ""}
    <section id="county-matches" aria-label="Filter matches"></section><div class="profile-groups"></div>
    </article>`,
  );
  const root = document.getElementById("county-profile"),
    dialog = root.closest("dialog");
  function place() {
    select(county);
    document.getElementById("dialog-title").textContent = title();
    const location = [
      county?.stateName,
      county ? "FIPS " + county.id : "",
      point?.name,
      Number.isFinite(point?.population)
        ? fmt(point.population, "residents")
        : "",
      point ? `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}` : "",
    ].filter(Boolean);
    root.querySelector("#point-caption").textContent = location.join(" · ");
    const button = root.querySelector(".profile-locate");
    button.id = point ? "zoom-point" : "locate-detail";
    button.querySelector("span").textContent = point
      ? "Zoom Here"
      : "Locate on Map";
    button.onclick = () => (point ? zoomToPoint(point) : locateCounty(county));
    root.querySelector(".profile-groups").innerHTML = county
      ? countyGroups(county, state, periodFor)
      : "";
  }
  let result;
  const update = () => {
    if (root.isConnected && dialog.open)
      showReadings(root, county, point, result, state, periodFor, dayLoad);
  };
  place();
  update();
  if (dayLoad.status === "loading") dayLoad.done.then(update);
  if (!point) return;
  try {
    result = await inspect(point);
  } catch {
    result = { error: true };
  }
  if (!root.isConnected || !dialog.open) return;
  const resolved = countyAt(result.countyIndex);
  if (resolved && resolved !== county) {
    county = resolved;
    place();
  } else if (!county && !result.error)
    root
      .querySelector("#point-caption")
      .prepend("Outside mapped county boundaries · ");
  update();
}
