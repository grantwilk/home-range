import { projection } from "./spatial.js";
import { validPoint } from "./facility-model.js";

import { loadCityPoints } from "./map-reference.js";
const clean = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
const cache = new Map();
function getCoordinates(text) {
  const match = text.match(
    /^\s*([+-]?\d+(?:\.\d+)?)\s*[,;]\s*([+-]?\d+(?:\.\d+)?)\s*$/,
  );
  if (!match) return null;
  const point = [text, +match[2], +match[1]];
  return validPoint(point) && projection(point.slice(1)) ? point : null;
}
async function geocode(query) {
  if (cache.has(query)) return cache.get(query);
  const url = new URL("https://photon.komoot.io/api/");
  url.search = new URLSearchParams({
    q: query,
    lang: "en",
    countrycode: "US",
    limit: "10",
  }).toString();
  const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw Error("Online address search is unavailable.");
  const results = (await r.json()).features
    .filter((f) => f.properties.countrycode?.toUpperCase() === "US")
    .map((f) => {
      const p = f.properties;
      const name = [
        ...new Set(
          [
            p.name,
            [p.housenumber, p.street].filter(Boolean).join(" "),
            p.city || p.district,
            p.state,
            p.postcode,
          ].filter(Boolean),
        ),
      ].join(", ");
      return [name, ...f.geometry.coordinates.slice(0, 2)];
    })
    .filter((p) => validPoint(p) && projection(p.slice(1)));
  cache.set(query, results);
  return results;
}
export function editPlaces(filter, { dialog, showDialog, esc, onSave }) {
  const draft = filter.points.map((p) => [...p]);
  showDialog(
    "Custom Places",
    `<form id="place-search"><label for="place-query">Enter an address, city, place name, or coordinates</label><div class="place-entry"><input class="searchinput" id="place-query" autocomplete="off" placeholder="Madison, WI"><button class="secondary">Search</button></div></form><div id="place-message" class="micro" role="status"></div><div id="place-options"></div><h3>Selected Places</h3><div id="chosen-places"></div><p class="micro">Search uses <a href="https://photon.komoot.io/">Photon</a> and <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>. Shared views include selected names and coordinates.</p><button class="secondary" id="save-places">Apply Places</button>`,
  );
  const $ = (id) => dialog.querySelector("#" + id),
    msg = $("place-message"),
    options = $("place-options");
  const list = () => {
    const el = $("chosen-places");
    el.innerHTML = draft.length
      ? draft
          .map(
            (p, i) =>
              `<div class="minirow"><span>${esc(p[0])}</span><button class="secondary" data-index="${i}" aria-label="Remove ${esc(p[0])}">Remove</button></div>`,
          )
          .join("")
      : '<p class="micro">Your list is empty.</p>';
    el.querySelectorAll("button").forEach(
      (b) =>
        (b.onclick = () => {
          draft.splice(+b.dataset.index, 1);
          list();
        }),
    );
  };
  list();
  let sequence = 0;
  $("place-search").onsubmit = async (event) => {
    event.preventDefault();
    const q = $("place-query").value.trim();
    if (!q) return;
    const token = ++sequence;
    msg.textContent = "Searching…";
    options.replaceChildren();
    const coordinate = getCoordinates(q);
    let result = coordinate ? [coordinate] : [],
      offline = false;
    if (!coordinate) {
      const [towns, remote] = await Promise.allSettled([
        loadCityPoints(),
        geocode(q),
      ]);
      const query = clean(q);
      const matches =
        towns.status === "fulfilled"
          ? towns.value
              .filter((p) => clean(p[0]).includes(query))
              .sort(
                (a, b) =>
                  Number(clean(b[0]) === query) -
                    Number(clean(a[0]) === query) || b[3] - a[3],
              )
              .slice(0, 5)
          : [];
      offline = remote.status === "rejected";
      result = [...matches, ...(offline ? [] : remote.value)];
    }
    if (token !== sequence || !msg.isConnected) return;
    msg.textContent =
      (offline ? "Online search unavailable. " : "") +
      (result.length
        ? "Select a U.S. result to add."
        : "No match. Try a fuller address or enter coordinates.");
    for (const p of result) {
      const button = document.createElement("button");
      button.className = "optionrow";
      button.textContent = p[0];
      button.type = "button";
      button.onclick = () => {
        if (!draft.some((v) => v[1] === p[1] && v[2] === p[2]))
          draft.push(p.slice(0, 3));
        list();
        msg.textContent = "Added to your list.";
        options.replaceChildren();
        $("place-query").select();
      };
      options.append(button);
    }
  };
  $("save-places").onclick = () => {
    filter.points = draft;
    dialog.close();
    onSave();
  };
  $("place-query").focus();
}
