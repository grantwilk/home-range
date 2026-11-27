import { pickMeasure } from "./catalog-browser.mjs";
import { projection } from "../spatial.js";
import assert from "node:assert/strict";

// Color profiles and subpixel rounding differ slightly across browser engines.
function sameColor(actual, expected) {
  const channels = (text) => text.match(/\d+/g).map(Number);
  const rgb = channels(actual),
    reference = channels(expected);
  return rgb.every((value, i) => Math.abs(value - reference[i]) <= 1);
}

// Measure stroke thickness in CSS pixels, accounting for both SVG conventions.
async function borderWidths(page) {
  return page.evaluate(() => {
    const overlay = document.getElementById("access-overlay");
    const paths = ["county-borders", "state-borders"].map((id) =>
      document.getElementById(id),
    );
    return paths.map((path) => {
      if (
        !path?.getAttribute("d") ||
        !(
          overlay.compareDocumentPosition(path) &
          Node.DOCUMENT_POSITION_FOLLOWING
        )
      )
        return 0;
      const style = getComputedStyle(path);
      if (style.stroke === "none" || Number(style.strokeOpacity) === 0)
        return 0;
      const matrix = path.getScreenCTM();
      return (
        parseFloat(style.strokeWidth) *
        (style.vectorEffect === "non-scaling-stroke"
          ? 1
          : Math.hypot(matrix.a, matrix.b))
      );
    });
  });
}
export async function checkLocalAccess(page, base) {
  const failures = [];
  page.on("pageerror", (e) => failures.push(e.message));
  const ready = async () => {
    // A new legend can change the map's available height. Wait for paint and
    // sample the completion/error atomically across that second resize.
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        ),
    );
    const completion = await page.waitForFunction(
      () => {
        const status = document.getElementById("access-status");
        if (status?.dataset.state === "error") return status.textContent;
        if (
          status?.hidden &&
          document.getElementById("access-overlay").style.display !== "none"
        )
          return "ready";
        return false;
      },
      undefined,
      { timeout: 90000 },
    );
    assert.equal(await completion.jsonValue(), "ready");
  };
  const add = async (key) => {
    await page.locator("#add-filter").click();
    await pickMeasure(page, "distance", key);
  };
  const readPoint = async (coordinate, key) => {
    await page.locator("#search").click();
    await page.locator("#query").fill(coordinate);
    await page.locator("#query").press("Enter");
    await page.locator(".local-reading").first().waitFor();
    const matches = page.locator("#county-matches");
    const row = matches.locator(`[data-filter-id="${key}"]`);
    const text = key
      ? (await row.locator(".match-reading").innerText()) +
        " · " +
        (await row.locator(".match-status").innerText())
      : await matches.innerText();
    await page.locator("#close").click();
    return text;
  };
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(base);
  await page.locator("#areas path").first().waitFor();
  for (const key of ["airports", "schools", "hospitals", "grocery"]) {
    await add(key);
    await ready();
    assert.ok(
      await page
        .locator("#legend-sub")
        .innerText()
        .then((t) => /locations/.test(t)),
    );
    assert.equal(
      await page.locator('[data-key="' + key + '"] input[type=range]').count(),
      2,
    );
    const readings = await readPoint("43.0731, -89.4012");
    assert.match(readings, /\bmi\b/);
    assert.equal(await page.locator(".access-unit").count(), 0);
    assert.equal(
      await page.locator(`[data-key="${key}"] [data-subtype]`).inputValue(),
      key,
    );
    if (key === "airports") {
      assert.match(readings, /Dane County|Madison/i);
      assert.match(await readPoint("42.3601, -71.0589"), /Logan/i);
    }
    await page.locator('[data-drop="' + key + '"]').click();
  }
  // Each place list contributes one distance vote even when the symbol is shared.
  const lists = new URL(base);
  lists.search =
    "custom=0..10&custom~2=0..10&cities=0..100&cities.population=200000..500000&cities~2=0..100&cities~2.population=2711226..2711226&layer=custom~2&match=all";
  lists.hash = new URLSearchParams({
    place: JSON.stringify(["Home in Madison", -89.4012, 43.0731]),
    "place~2": JSON.stringify(["Family in Chicago", -87.684939, 41.837045]),
  });
  await page.goto(lists.href);
  await ready();
  assert.equal(
    await page.locator('#reference-key [data-key="custom"]').count(),
    1,
  );
  assert.equal(
    await page.locator('#reference-key [data-key="cities"]').count(),
    1,
  );
  const listsAtMadison = await readPoint("43.0731, -89.4012");
  assert.match(listsAtMadison, /Outside Your Filters/);
  for (const source of [
    "Home in Madison",
    "Family in Chicago",
    "Chicago, IL",
    "Madison, WI",
  ])
    assert.ok(listsAtMadison.includes(source), source);
  await page.locator("#any").click();
  await ready();
  assert.match(await readPoint("43.0731, -89.4012"), /Matches Your Filters/);
  await page.goto(base);
  await page.locator("#areas path").first().waitFor();
  await add("cities");
  await ready();
  const city = page.locator('.filter-row[data-key="cities"]');
  assert.equal(await city.locator("input[type=range]").count(), 4);
  for (const bound of ["min", "max"]) {
    const edit = city.locator(
      "[data-setting=citySize] .num[data-bound=" + bound + "]",
    );
    await edit.fill("2711226");
    await edit.press("Tab");
  }
  await page.waitForFunction(
    () =>
      document
        .querySelector("#legend-sub")
        .textContent.endsWith("· 1 location"),
    undefined,
    { timeout: 15000 },
  );
  const chicago = await readPoint("41.837045, -87.684939");
  assert.match(chicago, /Chicago, IL/);
  assert.match(
    await readPoint("41.837045, -87.684939", "cities"),
    /0 mi · Match/,
  );
  await page.locator("[data-drop=cities]").click();
  await add("custom");
  await page.route("https://photon.komoot.io/**", (r) => r.abort());
  for (const q of ["43.0731, -89.4012", "Aurora, IL"]) {
    await page.locator("#place-query").fill(q);
    await page.locator("#place-query").press("Enter");
    await page
      .locator("#place-options button")
      .filter({ hasText: q })
      .first()
      .click();
  }
  await page.locator("#save-places").click();
  await ready();
  assert.match(await readPoint("43.0731, -89.4012", "custom"), /0 mi · Match/);
  assert.match(await readPoint("42.99, -89.7", "custom"), /mi · Outside/);
  const low = page.locator("[data-key=janLow] .num[data-bound=min]");
  await low.fill("50");
  await low.press("Tab");
  await ready();
  assert.match(await readPoint("43.0731, -89.4012"), /Outside Your Filters/);
  await low.fill("-60");
  await low.press("Tab");
  await page.locator("[data-key=janLow] .switch").click();
  await ready();
  // These points are within one county, on opposite sides of the 10-mile
  // range around Madison. Sample the final browser paint, including SVG clips.
  await page.locator("#search").click();
  await page.locator("#query").fill("55025");
  await page.locator("#query").press("Enter");
  await page.locator("#locate-detail").click();
  await ready();
  const overlay = page.locator("#access-overlay");
  assert.ok((await overlay.locator("use, path").count()) > 0);
  assert.equal(
    await page.locator("#map canvas, #map foreignObject, #map image").count(),
    0,
  );
  await page
    .locator("#reference-pins [data-key=custom] > *")
    .first()
    .waitFor({ state: "attached" });
  assert.equal(
    await page.locator("#highlight path").getAttribute("d"),
    await page.locator('[data-uid="c55025"]').getAttribute("d"),
  );

  const initialStrokes = await borderWidths(page);
  assert.ok(
    initialStrokes[0] > 0 && initialStrokes[1] > initialStrokes[0],
    "County edges must be visible, with stronger state borders above coverage",
  );
  assert.ok(
    (await page.locator("#land-clip path, #land-clip use").count()) > 0,
  );

  const screenPoint = async (lon, lat) =>
    page.evaluate(
      ([x, y]) => {
        const point = new DOMPoint(x, y).matrixTransform(
          document.getElementById("viewport").getScreenCTM(),
        );
        return { x: Math.floor(point.x), y: Math.floor(point.y) };
      },
      projection([lon, lat]),
    );
  async function pixel(lon, lat) {
    const point = await screenPoint(lon, lat);
    const screenshot = await page.screenshot({
      // Isolate the coverage paint underneath separately tested place markers and labels.
      style:
        "#reference-pins, #reference-towns { visibility: hidden !important; }",
      clip: { ...point, width: 1, height: 1 },
      scale: "css",
    });
    return page.evaluate(
      async (bytes) => {
        const bitmap = await createImageBitmap(
          new Blob([Uint8Array.from(bytes)], { type: "image/png" }),
        );
        const ctx = new OffscreenCanvas(1, 1).getContext("2d");
        ctx.drawImage(bitmap, 0, 0);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return `rgb(${r}, ${g}, ${b})`;
      },
      [...screenshot],
    );
  }
  const outside = await page
    .locator("#legend-keys .swatch")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const inside = await page
    .locator("#colors b")
    .evaluateAll((bands) =>
      bands.map((band) => getComputedStyle(band).backgroundColor),
    );
  assert.ok(sameColor(await pixel(-89.7, 42.99), outside));
  const inBand = (color) => inside.some((band) => sameColor(color, band));
  assert.ok(
    inBand(await pixel(-89.32, 43.075)),
    "The interior county location must be painted with an access band",
  );
  await page.locator("[data-key=janLow] .switch").click();
  await page.locator("#any").click();
  await ready();
  assert.ok(inBand(await pixel(-89.7, 42.99)));
  await page.locator("#all").click();
  await ready();
  assert.ok(sameColor(await pixel(-89.7, 42.99), outside));

  // A matching pin and an excluded spot in the same county open the same
  // profile, with the distance calculated at the actual inspected location.
  for (const [lon, lat, verdict, distance] of [
    [-89.4012, 43.0731, "Match", /^0 mi$/],
    [-89.7, 42.99, "Outside", /mi$/],
  ]) {
    const point = await screenPoint(lon, lat);
    await page.mouse.click(point.x, point.y);
    const profile = page.locator("#county-profile");
    const reading = profile.locator('.local-reading[data-filter-id="custom"]');
    await reading.waitFor();
    assert.equal(
      await page.locator("#dialog-title").innerText(),
      "Dane County",
    );
    assert.match(await reading.locator(".match-reading").innerText(), distance);
    assert.equal(await reading.locator(".match-status").innerText(), verdict);
    assert.equal(await profile.locator("details[data-group]").count(), 4);
    assert.equal(
      await profile.getByRole("button", { name: "County Profile" }).count(),
      0,
    );
    await page.locator("#close").click();
  }
  while (
    await page
      .locator("#viewport")
      .evaluate((el) => el.transform.baseVal.consolidate().matrix.a < 25)
  ) {
    await page.locator("#zoomin").click();
  }
  await ready();
  const zoomedStrokes = await borderWidths(page);
  zoomedStrokes.forEach((width, i) => {
    assert.ok(width > 0 && width <= 2.5, "Zoomed borders should stay thin");
    assert.ok(
      Math.abs(width - initialStrokes[i]) <= 0.65,
      "Zoom must not inflate boundary strokes",
    );
  });
  // At this scale each pair straddles an actual geographic edge by about
  // four screen pixels. Move north along a meridian for known air distances.
  const minMiles = page.locator("[data-key=custom] .num[data-bound=min]");
  await minMiles.fill("5");
  await minMiles.press("Enter");
  await ready();
  for (const [miles, shouldMatch] of [
    [4.5, false],
    [5.5, true],
    [9.5, true],
    [10.5, false],
  ]) {
    const lat = 43.0731 + ((miles / 3958.7613) * 180) / Math.PI;
    const color = await pixel(-89.4012, lat);
    assert.ok(
      shouldMatch ? inBand(color) : sameColor(color, outside),
      `The map must place ${miles} miles on the correct side of the 5–10 mile range`,
    );
  }
  await minMiles.fill("0");
  await minMiles.press("Enter");
  await ready();
  assert.match(await readPoint("43.0731, -89.4012", "custom"), /0 mi · Match/);
  const approaching = await readPoint("43.08, -89.50", "custom");
  const miles = Number(approaching.match(/([\d.]+) mi/)?.[1]);
  assert.ok(miles > 4 && miles < 6, approaching);
  await page.locator("[data-eye=janLow]").click();
  await ready();
  assert.ok(
    await page
      .locator("#legend-name")
      .innerText()
      .then((s) => s.includes("January")),
  );
  await page.locator("#share").click();
  const share = await page.evaluate(() => navigator.clipboard.readText());
  const sharedUrl = new URL(share);
  assert.equal(sharedUrl.searchParams.has("custom.unit"), false);
  assert.equal(sharedUrl.searchParams.has("place"), false);
  assert.equal(
    new URLSearchParams(sharedUrl.hash.slice(1)).getAll("place").length,
    2,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("about:blank");
  await page.goto(share);
  await ready();
  assert.equal(
    await page.locator("[data-key=custom] [data-subtype]").inputValue(),
    "custom",
  );
  await page.locator("[data-custom]").click();
  assert.equal(await page.locator("#chosen-places button").count(), 2);
  await page.locator("#chosen-places button").last().click();
  await page.locator("#close").click();
  await page.locator("[data-custom]").click();
  assert.equal(await page.locator("#chosen-places button").count(), 2);
  await page.locator("#close").click();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  // Boston has a scored airport distance and an insufficient-data tsunami
  // result. On the mobile map the same land point changes from the uncertainty
  // hatch to a distance band when the two criteria change from All to Any.
  const coast = new URL(base);
  coast.search = "TSUN_RISKS=0..100&airports=0..60&layer=airports";
  await page.goto(coast.href);
  await page.locator("#areas path").first().waitFor();
  await ready();
  await page.locator("#search").click();
  await page.locator("#query").fill("25025");
  await page.locator("#query").press("Enter");
  await page.locator("#locate-detail").click();
  await ready();
  await page.locator("#search").click();
  await page.locator("#query").fill("42.343, -71.075");
  await page.locator("#query").press("Enter");
  await page.locator("#zoom-point").click();
  await ready();
  assert.match(await readPoint("42.343, -71.075"), /Uncertain Match/);
  assert.ok(
    (await overlay.locator('use[fill="url(#access-uncertain)"]').count()) > 0,
  );
  const unknown = await pixel(-71.075, 42.343);
  const background = await page
    .locator("#uncertain rect")
    .evaluate((el) => getComputedStyle(el).fill);
  assert.ok(
    sameColor(unknown, background),
    "The interior Boston sample must use the visible uncertainty pattern",
  );
  const offshore = await pixel(-70.65, 42.35);
  await overlay.evaluate((el) => (el.style.visibility = "hidden"));
  assert.equal(
    await pixel(-70.65, 42.35),
    offshore,
    "Facility regions must be clipped at the coastline",
  );
  await overlay.evaluate((el) => el.style.removeProperty("visibility"));
  await page.locator("#any").click();
  await ready();
  assert.match(await readPoint("42.343, -71.075"), /Matches Your Filters/);
  assert.ok(inBand(await pixel(-71.075, 42.343)));
  const mobileStrokes = await borderWidths(page);
  assert.ok(mobileStrokes[0] > 0 && mobileStrokes[1] > mobileStrokes[0]);
  // A travel-time bookmark may contain straight-line criteria too. Recover the
  // valid ranges and give people a chance to replace the old minute interval.
  const legacy = {
    county: [
      { key: "airports", min: 6, max: 12, units: "min", on: true },
      { key: "schools", min: 1, max: 9, units: "mi", on: true },
    ],
    layer: "schools",
  };
  for (const saved of [
    "?airports=6..12&airports.unit=min&schools=1..9&layer=schools",
    "#view=" + encodeURIComponent(JSON.stringify(legacy)),
  ]) {
    await page.goto("about:blank");
    await page.goto(base + saved);
    await page.locator("dialog[open]").waitFor();
    const warning = await page.locator("#dialog-body").innerText();
    assert.match(warning, /minutes?|travel.time/i);
    assert.match(warning, /paus|off|disabl/i);
    await page.locator("#close").click();
    const airport = page.locator(".filter-row[data-key=airports]");
    const school = page.locator(".filter-row[data-key=schools]");
    assert.equal(
      await airport.locator(".switch").getAttribute("aria-checked"),
      "false",
    );
    assert.equal(
      await school.locator(".switch").getAttribute("aria-checked"),
      "true",
    );
    assert.equal(
      await school.locator(".num[data-bound=min]").inputValue(),
      "1",
    );
    assert.equal(
      await school.locator(".num[data-bound=max]").inputValue(),
      "9",
    );
    assert.notDeepEqual(
      await airport
        .locator(".num")
        .evaluateAll((els) => els.map((el) => el.value)),
      ["6", "12"],
    );
    await page.locator("#share").click();
    const clean = new URL(
      await page.evaluate(() => navigator.clipboard.readText()),
    );
    assert.equal(clean.searchParams.has("airports.unit"), false);
    assert.ok(clean.searchParams.getAll("paused").includes("airports"));
  }
  assert.deepEqual(failures, []);
}
