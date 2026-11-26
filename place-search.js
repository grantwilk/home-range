// Index each immutable source directory once. County identifiers retain their
// leading zeros; town results carry the Census row used to center the map.
const normalized = (text) =>
  text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{Mark}/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
const cityDirectories = new WeakMap();
const countyDirectories = new WeakMap();

function cityIndex(rows) {
  if (!cityDirectories.has(rows)) {
    cityDirectories.set(
      rows,
      rows.map((row) => {
        const comma = row[0].lastIndexOf(", ");
        const name = row[0].slice(0, comma),
          state = row[0].slice(comma + 2);
        return {
          kind: "town",
          name,
          state,
          text: normalized(name),
          population: row[3],
          row,
        };
      }),
    );
  }
  return cityDirectories.get(rows);
}
function countyIndex(counties) {
  if (!countyDirectories.has(counties)) {
    const states = new Map(),
      names = new Map();
    const entries = counties.map((row) => {
      const full = normalized(row.stateName);
      states.set(row.state.toLowerCase(), row.state);
      states.set(full, row.state);
      names.set(row.state, full);
      return {
        kind: "county",
        name: row.name,
        state: row.state,
        text: normalized(row.name),
        id: row.id,
        row,
      };
    });
    countyDirectories.set(counties, { entries, states, names });
  }
  return countyDirectories.get(counties);
}
function nameRank(text, query, terms) {
  if (text === query) return 0;
  if (text.startsWith(query + " ")) return 1;
  if (text.startsWith(query)) return 2;
  if (text.includes(query)) return 3;
  return terms.every((term) => text.includes(term)) ? 4 : Infinity;
}
const empty = [];
export function findPlaces(query, counties, towns = empty, limit = 25) {
  const { entries, states, names } = countyIndex(counties);
  const q = normalized(query);
  if (!q) return { total: 0, results: [] };
  const digits = /^\d+$/.test(q);
  const stateOnly = states.get(q);
  const allTerms = q.split(" ");
  let state = null,
    stem = q,
    explicit = false;
  if (!stateOnly) {
    // A comma unambiguously separates the state. A spelled-out state at the
    // end is also accepted; retain an exact town such as West New York, NJ.
    const comma = query.lastIndexOf(",");
    if (comma >= 0) {
      state = states.get(normalized(query.slice(comma + 1)));
      if (state) {
        explicit = true;
        stem = normalized(query.slice(0, comma));
      }
    }
    if (!state)
      for (let i = 1; i < allTerms.length; i++) {
        const suffix = allTerms.slice(i).join(" ");
        state = states.get(suffix);
        if (state) {
          explicit = suffix.length === 2;
          stem = allTerms.slice(0, i).join(" ");
          break;
        }
      }
  }
  const terms = stem.split(" ");
  const cities = [],
    areas = [];
  for (const [rows, matches] of [
    [entries, areas],
    ...(digits ? [] : [[cityIndex(towns), cities]]),
  ]) {
    for (const item of rows) {
      let rank = Infinity;
      if (digits && item.id?.includes(q)) rank = item.id === q ? 0 : 4;
      else if (digits) continue;
      else if (stateOnly && q.length === 2) {
        if (item.state === stateOnly) rank = 6;
      } else if (state && item.state !== state) {
        if (!explicit && item.text === q) rank = 0;
      } else {
        rank = nameRank(item.text, stem, terms);
        if (stateOnly === item.state) rank = Math.min(rank, 6);
        else if (
          !state &&
          item.kind === "county" &&
          terms.every((t) =>
            [
              item.text,
              names.get(item.state),
              item.state.toLowerCase(),
              item.id,
            ].some((s) => s.includes(t)),
          )
        )
          rank = Math.min(rank, 7);
      }
      if (Number.isFinite(rank)) matches.push({ item, rank });
    }
  }
  const compare = (a, b) =>
    a.rank - b.rank ||
    (b.item.population ?? -1) - (a.item.population ?? -1) ||
    a.item.name.localeCompare(b.item.name, "en") ||
    a.item.state.localeCompare(b.item.state, "en");
  cities.sort(compare);
  areas.sort(compare);
  const results = [];
  let c = 0,
    a = 0;
  while (results.length < limit && (c < cities.length || a < areas.length)) {
    const cr = cities[c]?.rank ?? Infinity,
      ar = areas[a]?.rank ?? Infinity;
    // Alternate equally ranked county and town hits so a statewide query
    // leaves both kinds of result accessible in the first page.
    if (
      cr < ar ||
      (cr === ar && (results.at(-1)?.kind === "county" || !results.length))
    )
      results.push(cities[c++].item);
    else results.push(areas[a++].item);
  }
  return { total: cities.length + areas.length, results };
}

// Some same-name Census geographies carry technical identifiers in the source
// label. Show their map coordinates in the result so the user can choose one.
export function townDescription({ name, state, row }) {
  const bare = name.replace(/ \(\d{7,10}\)$/, "");
  const descriptor = bare.match(
    / (CDP|town|village|borough|municipality|city)$/,
  )?.[1];
  const label =
    (descriptor ? bare.slice(0, -descriptor.length - 1) : bare) + ", " + state;
  let detail =
    descriptor === "CDP"
      ? "Census-designated place"
      : descriptor
        ? descriptor[0].toUpperCase() + descriptor.slice(1)
        : "City / town";
  if (bare !== name)
    detail += " · " + row[2].toFixed(2) + ", " + row[1].toFixed(2);
  return { label, detail };
}
