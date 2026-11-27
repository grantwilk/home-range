// Run against the release bundle nested under a project path, as on GitHub Pages.
import { projection } from "../spatial.js";
import {
  calendarMonths,
  checkCatalogLayout,
  pickMeasure,
} from "./catalog-browser.mjs";
import {
  checkCountyProfile,
  checkMonthlyClimate,
} from "./county-profile-browser.mjs";
import { checkHazards } from "./hazards-browser.mjs";
import { checkLocalAccess } from "./access-browser.mjs";
import { checkReferenceMotion } from "./reference-motion-browser.mjs";
import { checkPdfExport } from "./pdf-browser.mjs";
import { checkColdDays } from "./cold-days-browser.mjs";
import { checkNature } from "./nature-browser.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
async function pauseActiveFilters(page) {
  // Every click rebuilds the cards. Re-query the first active switch each time.
  const active = page.locator('.filter-row .switch[aria-checked="true"]');
  while (await active.count()) await active.first().click();
}

// Two native inputs can exist even when their painted grips overlap completely.
async function checkGrips(card) {
  const track = card.locator(".range-track");
  await track.scrollIntoViewIfNeeded();
  const grips = [];
  for (const bound of ["min", "max"]) {
    const grip = card.locator(`[data-grip="${bound}"]`);
    assert.ok(await grip.isVisible(), `${bound} grip is hidden`);
    const box = await grip.boundingBox();
    assert.ok(
      box.width >= 8 && box.height >= 8,
      `${bound} grip is too small to see`,
    );
    grips.push(box);
  }
  const [low, high] = grips;
  assert.ok(low.x + low.width <= high.x, "The painted grips overlap");
  assert.ok(
    Math.abs(low.y + low.height / 2 - (high.y + high.height / 2)) <= 2,
    "Both grips must share the track",
  );
  assert.equal(await card.getByRole("slider").count(), 2);
  assert.equal(await card.locator(".num:visible").count(), 2);
}

async function checkGripPixels(card) {
  // Compare the normal track with the same track while hiding only one grip.
  // If a grip is occluded or transparent, its removal changes no visible pixels.
  const track = card.locator(".range-track");
  const normal = await track.screenshot({ animations: "disabled" });
  for (const bound of ["min", "max"]) {
    const hidden = await track.screenshot({
      animations: "disabled",
      style: `[data-grip="${bound}"] { visibility: hidden !important; }`,
    });
    assert.ok(
      !normal.equals(hidden),
      `The ${bound} handle painted no visible pixels`,
    );
  }
}

async function checkNationalFit(page) {
  // The full interactive surface extends behind the floating legend. At reset,
  // the complete national geometry is fitted into the unobstructed space above it.
  await page.waitForFunction(
    () => {
      const bounds = (selector) =>
        document.querySelector(selector).getBoundingClientRect();
      const map = bounds("#map");
      const counties = bounds("#areas");
      const tools = bounds(".maptools");
      const legend = bounds(".legend");
      return (
        Math.abs(map.top - bounds(".mapcard").top) <= 1 &&
        Math.abs(map.bottom - bounds(".mapcard").bottom) <= 1 &&
        counties.width > 0 &&
        counties.left >= map.left - 1 &&
        counties.right <= map.right + 1 &&
        counties.top >= bounds(".map-toolbar").bottom - 1 &&
        counties.bottom <= legend.top + 1 &&
        Math.abs(tools.bottom - legend.bottom) <= 1 &&
        map.bottom - tools.bottom <= 20 &&
        map.right - tools.right <= 20 &&
        tools.left >= legend.right + 4
      );
    },
    undefined,
    { timeout: 5000 },
  );
}

async function checkLowerMapInteraction(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => document.fonts.ready);
  await checkNationalFit(page);
  await page.locator("#zoomin").click();
  await page.locator("#zoomin").click();
  // Hunt County moves into the open strip beside the legend at this extent.
  const hunt = await page.locator('[data-uid="c48231"]').boundingBox();
  const legend = await page.locator(".legend").boundingBox();
  const x = hunt.x + hunt.width / 2,
    y = hunt.y + hunt.height / 2;
  assert.ok(
    x > legend.x + legend.width && y > legend.y,
    "test point must be in the former clipped strip",
  );
  await page.mouse.click(x, y);
  await page.locator("dialog[open]").waitFor();
  assert.equal(await page.locator("#dialog-title").innerText(), "Hunt County");
  await page.locator("#close").click();
  await page.locator("#fit").click();
  await checkNationalFit(page);
}

async function checkUpperMapInteraction(page, base) {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(base + "?extent=9,-3500,-3000");
    await page.locator("#map.zoomed").waitFor();
    const point = await page.evaluate(() => {
      const logo = document.querySelector(".map-scope").getBoundingClientRect();
      const actions = document
        .querySelector(".map-actions")
        .getBoundingClientRect();
      const x = (logo.right + actions.left) / 2;
      const y = logo.top + logo.height / 2;
      return { x, y, uid: document.elementFromPoint(x, y)?.dataset.uid };
    });
    assert.match(
      point.uid ?? "",
      /^c[0-9]{5}$/,
      "A county fills the open toolbar area",
    );
    await page.mouse.click(point.x, point.y);
    await page.locator("#locate-detail").waitFor();
    assert.ok(
      (await page.locator("#dialog-body").innerText()).includes(
        "FIPS " + point.uid.slice(1),
      ),
    );
    await page.locator("#close").click();

    const viewport = page.locator("#viewport");
    const before = await viewport.getAttribute("transform");
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 12, point.y + 30, { steps: 5 });
    await page.mouse.up();
    assert.notEqual(await viewport.getAttribute("transform"), before);
  }
}

async function checkPlaceSearchAndToolbar(page, base) {
  await page.goto(base + "?janLow=15..35&layer=janLow");
  await page.locator("#areas path").first().waitFor();
  assert.equal(await page.locator("#reset, #filter-count").count(), 0);
  const mapToolbar = page.locator(".map-toolbar");
  const railTitle = page.locator(".railtitle");
  for (const { width, height } of [
    { width: 1360, height: 820 },
    { width: 768, height: 1000 },
    { width: 320, height: 680 },
  ]) {
    await page.setViewportSize({ width, height });
    const tools = mapToolbar.locator("#search, #share, #export-pdf");
    assert.equal(await tools.count(), 3);
    const title = await mapToolbar.locator(".map-scope").boundingBox();
    const map = await page.locator(".mapcard").boundingBox();
    let previous = title;
    for (const id of ["search", "share", "export-pdf"]) {
      const action = mapToolbar.locator("#" + id);
      const rect = await action.boundingBox();
      assert.ok(
        rect && rect.width >= 24 && rect.height >= 24,
        `Hit area for ${id} at ${width}px`,
      );
      assert.ok(
        rect.x >= previous.x + previous.width - 1,
        `Toolbar overlap at ${width}px`,
      );
      assert.ok(
        Math.abs(rect.y + rect.height / 2 - (title.y + title.height / 2)) <= 2,
        `Toolbar wraps at ${width}px`,
      );
      assert.ok(rect.x + rect.width <= map.x + map.width + 1);
      assert.ok(
        (await action.getAttribute("aria-label")) ||
          (await action.innerText()).trim(),
      );
      previous = rect;
    }
    const heading = await railTitle.locator("#filters-title").boundingBox();
    const any = await railTitle.locator("#any").boundingBox();
    const all = await railTitle.locator("#all").boundingBox();
    const rail = await railTitle.boundingBox();
    assert.ok(
      all.x >= heading.x + heading.width && any.x >= all.x + all.width - 1,
    );
    assert.ok(
      Math.abs(heading.y + heading.height / 2 - (any.y + any.height / 2)) <= 2,
    );
    const fold = railTitle.locator("#fold");
    const right = (await fold.isVisible())
      ? (await fold.boundingBox()).x
      : rail.x + rail.width;
    assert.ok(
      right - (any.x + any.width) >= -1 && right - (any.x + any.width) <= 30,
      `Match controls must align right at ${width}px`,
    );
  }
  // Distinguish the city of Washington, IA from its same-name county.
  const input = page.locator("#query");
  await mapToolbar.locator("#search").click();
  await input.fill("Washington, IA");
  const suggest = page.locator("#suggest");
  await suggest
    .locator("[data-town]")
    .filter({ hasText: /Washington, IA/ })
    .first()
    .waitFor();
  const county = suggest
    .locator("[data-place]")
    .filter({ hasText: /Washington County/i });
  await county.click();
  assert.equal(
    await page.locator("#dialog-title").innerText(),
    "Washington County",
  );
  await page.locator("#close").click();

  await mapToolbar.locator("#search").click();
  await input.fill("Madison WI");
  const town = suggest
    .locator("[data-town]")
    .filter({ hasText: /Madison, WI/ });
  await town.first().waitFor();
  await input.press("Enter");
  await page.locator("dialog").waitFor({ state: "hidden" });
  // The Census representative point is near downtown Madison, Wisconsin.
  // Reproject it independently and check that the new map view is centered there.
  const assertCentered = (longitude, latitude) => {
    const [x, y] = projection([longitude, latitude]);
    const extent = new URL(page.url()).searchParams.get("extent");
    assert.ok(extent, "Selecting a place must save the new extent");
    const [scale, tx, ty] = extent.split(",").map(Number);
    assert.ok(scale >= 12);
    assert.ok(
      Math.abs(tx + scale * x - 480) < 1 && Math.abs(ty + scale * y - 302) < 1,
    );
  };
  assertCentered(-89.429856, 43.087815);
  assert.equal(new URL(page.url()).searchParams.get("janLow"), "15..35");

  await mapToolbar.locator("#search").click();
  await input.fill("44.65, -90.14");
  await input.press("Enter");
  await page.locator("dialog").waitFor({ state: "hidden" });
  assertCentered(-90.14, 44.65);
}

async function checkLandscape(page, base) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(base + "?filters=none");
  await page.locator("#areas path").first().waitFor();
  for (const [term, family, key, bound, amount] of [
    ["farms", "landCover", "farmCover", "min", "30"],
    ["buildings", "landCover", "developedCover", "max", "20"],
  ]) {
    await page.locator("#add-filter").click();
    await page.locator("#catalog-search").fill(term);
    await pickMeasure(page, family, key);
    const row = page.locator(`.filter-row[data-key="${key}"]`);
    await checkGrips(row);
    const number = row.locator(`.num[data-bound="${bound}"]`);
    await number.fill(amount);
    await number.press("Enter");
  }
  await page.locator('[data-eye="farmCover"]').click();
  await page.waitForURL(
    (url) =>
      url.searchParams.get("layer") === "farmCover" &&
      url.searchParams.get("developedCover") === "0..20",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator("#areas path").first().waitFor();
  assert.equal(
    await page.locator("#legend-name").innerText(),
    "Crops & Pasture",
  );
  assert.match(await page.locator("#legend-sub").innerText(), /county land/);
  assert.equal(await page.locator(".filter-row[data-key]").count(), 2);
  await page.locator("#search").click();
  await page.locator("#query").fill("55025");
  await page.locator('#suggest [data-place="c55025"]').click();
  const detail = page
    .locator("#county-profile details[data-group]")
    .filter({ has: page.locator("summary", { hasText: "Land & Terrain" }) });
  await detail.locator("summary").first().click();
  assert.match(await detail.innerText(), /Crops & Pasture/);
  assert.equal(await detail.locator("ul").count(), 1);
  const shares = await detail
    .locator("ul")
    .first()
    .locator("li b")
    .allTextContents();
  assert.ok(shares.length >= 7 && shares.every((text) => text.endsWith("%")));
  assert.equal(
    await detail.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    true,
  );
  await page.locator("#close").click();
}

async function checkAnnualPrecipitation(page, base) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(base + "?filters=none");
  await page.locator("#areas path").first().waitFor();
  for (const [key, limit] of [
    ["snowfall", "0"],
    ["rainfall", "50"],
  ]) {
    await page.locator("#add-filter").click();
    await page.locator("#catalog-search").fill(key);
    await pickMeasure(page, "annualPrecipitation", key);
    const card = page.locator(`.filter-row[data-key="${key}"]`);
    await checkGrips(card);
    const max = card.locator('.num[data-bound="max"]');
    await max.fill(limit);
    await max.press("Enter");
    await page.waitForURL((url) => url.searchParams.get(key) === "0.." + limit);
  }
  await page.locator('[data-eye="rainfall"]').click();
  assert.equal(
    await page.locator("#legend-name").innerText(),
    "Annual Rainfall",
  );
  assert.match(await page.locator("#legend-sub").innerText(), /1991–2020/);
  assert.match(await page.locator("#credits").innerText(), /ERA5/);
  // Miami-Dade averages zero inches of snow. Dane gets both rain and snow.
  const county = (id) => page.locator(`#areas path[data-uid="c${id}"]`);
  await page
    .locator('#areas path[data-uid="c55025"][fill="#d8ded4"]')
    .waitFor();
  assert.doesNotMatch(
    await county("12086").getAttribute("fill"),
    /url\(|#d8ded4/,
  );
  await page.locator('[data-eye="snowfall"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator("#areas path").first().waitFor();
  assert.equal(
    await page.locator("#legend-name").innerText(),
    "Annual Snowfall",
  );
  assert.equal(await page.locator("#legend-unit").innerText(), "in/yr");
  assert.match(
    await page.locator("#legend-sub").innerText(),
    /excluding 2020–21/,
  );
  assert.match(
    await page.locator("#credits").innerText(),
    /NOAA National Gridded Snowfall Analysis/,
  );
  assert.equal(new URL(page.url()).searchParams.get("rainfall"), "0..50");
  assert.equal(new URL(page.url()).searchParams.get("snowfall"), "0..0");
  await page.locator("#any").click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-uid="c55025"]').getAttribute("fill") !==
      "#d8ded4",
  );
}

async function checkCrime(page, base) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(base + "?filters=none");
  await page.locator("#areas path").first().waitFor();
  await page.locator("#add-filter").click();
  await page.locator("#catalog-search").fill("crime");
  const picker = page.locator(
    '[data-group="Population & Nearby Places"] [data-pick="crime"]',
  );
  assert.match(await picker.innerText(), /County Crime/);
  await picker.click();
  const card = page.locator('.filter-row[data-key="violentCrimeRate"]');
  assert.equal(
    await card.locator("[data-subtype]").inputValue(),
    "violentCrimeRate",
  );
  assert.equal(
    await page.locator("#legend-name").innerText(),
    "Reported Violent Crime Rate",
  );
  assert.match(await page.locator("#legend-sub").innerText(), /2014.*2016/);
  assert.match(
    await page.locator("#credits").innerText(),
    /County Health Rankings|CHR&R/i,
  );
  const max = card.locator('.num[data-bound="max"]');
  assert.equal(await max.inputValue(), "2000");
  await max.fill("0");
  await max.press("Enter");
  await page.waitForURL(
    (url) => url.searchParams.get("violentCrimeRate") === "0..0",
  );
  const fill = (fips) =>
    page.locator(`#areas path[data-uid="c${fips}"]`).getAttribute("fill");
  // The URL changes immediately; county fills update on the next animation frame.
  await page
    .locator('#areas path[data-uid="c55025"][fill="#d8ded4"]')
    .waitFor();
  assert.equal(
    await fill("15005"),
    "url(#uncertain)",
    "Kalawao has no published rate",
  );
  assert.equal(await fill("55025"), "#d8ded4", "Dane exceeds zero");
  assert.doesNotMatch(
    await fill("55078"),
    /url\(|#d8ded4/,
    "Menominee has a numeric zero",
  );
  assert.equal(
    await page.locator('#areas path[fill="url(#uncertain)"]').count(),
    191,
  );
  assert.equal(
    new URL(page.url()).searchParams.get("violentCrimeRate"),
    "0..0",
  );
  await card.locator(".switch").click();
  assert.equal(
    await fill("15005"),
    "url(#missing)",
    "a missing map value with no active filter",
  );
  await page.locator("#add-filter").click();
  await pickMeasure(page, "crime", "homicideRate");
  await page.locator('[data-eye="homicideRate"]').click();
  assert.equal(
    await page.locator("#legend-name").innerText(),
    "Homicide Death Rate",
  );
  assert.match(await page.locator("#legend-sub").innerText(), /2017.*2023/);
  assert.match(
    await page.locator("#credits").innerText(),
    /NCHS|National Center for Health Statistics/i,
  );
  const homicide = page.locator('.filter-row[data-key="homicideRate"]');
  assert.equal(
    await homicide.locator('.num[data-bound="max"]').inputValue(),
    "65",
  );
  for (const input of await homicide.locator(".num").all()) {
    assert.equal(await input.getAttribute("step"), "0.1");
    await input.fill("2.3");
    await input.press("Enter");
  }
  await page.waitForURL(
    (url) => url.searchParams.get("homicideRate") === "2.3..2.3",
  );
  await page
    .locator('#areas path[data-uid="c17031"][fill="#d8ded4"]')
    .waitFor();
  assert.doesNotMatch(
    await fill("55025"),
    /url\(|#d8ded4/,
    "Dane matches 2.3 at both ends",
  );
  assert.equal(await fill("17031"), "#d8ded4", "Cook exceeds 2.3");
  assert.equal(
    await fill("55078"),
    "url(#uncertain)",
    "Menominee's mortality rate is suppressed",
  );
  const shared = new URL(page.url());
  assert.equal(shared.searchParams.get("layer"), "homicideRate");
  assert.equal(shared.searchParams.get("violentCrimeRate"), "0..0");
  assert.equal(shared.searchParams.get("homicideRate"), "2.3..2.3");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator("#areas path").first().waitFor();
  assert.equal(
    await page.locator("#legend-name").innerText(),
    "Homicide Death Rate",
  );
  assert.equal(
    await card.locator(".switch").getAttribute("aria-checked"),
    "false",
  );
  assert.equal(await card.locator('.num[data-bound="max"]').inputValue(), "0");
  assert.equal(
    await page
      .locator('[data-eye="homicideRate"]')
      .getAttribute("aria-pressed"),
    "true",
  );
}

const tmp = await mkdtemp(join(tmpdir(), "home-range-browser-"));
let server, browser;
try {
  await cp(new URL("../dist", import.meta.url), join(tmp, "home-range"), {
    recursive: true,
  });
  server = spawn(
    "python3",
    ["-u", "-m", "http.server", "0", "--bind", "127.0.0.1", "--directory", tmp],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const [ready] = await once(server.stdout, "data");
  const port = ready.toString().match(/port (\d+)/)[1],
    base = "http://127.0.0.1:" + port + "/home-range/";
  browser = await chromium.launch({
    channel: process.env.HOME_RANGE_BROWSER || "chrome",
    headless: true,
  });
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
    hasTouch: true,
  });
  const page = await context.newPage();
  // Open the reported broken page, then deploy the release and reload the
  // same tab. Keep both legacy modules available and cacheable at their URLs.
  const project = join(tmp, "home-range");
  const oldFiles = {
    "index.html":
      '<script type="module" src="./app.js?v=filter-families"></script>',
    "app.js": 'import { measureFor } from "./facility-model.js"; measureFor();',
    "facility-model.js": "export const citySize = 1;",
  };
  const past = new Date(Date.now() - 7 * 86400000);
  for (const [name, contents] of Object.entries(oldFiles)) {
    const file = join(project, name);
    await writeFile(file, contents);
    await utimes(file, past, past);
  }
  const legacyFailure = page.waitForEvent("pageerror");
  await page.goto(base);
  assert.match((await legacyFailure).message, /export named 'measureFor'/);
  await cp(
    new URL("../dist/index.html", import.meta.url),
    join(project, "index.html"),
  );
  const issues = [];
  page.on("pageerror", (e) => issues.push(String(e)));
  page.on("response", (r) => {
    if (r.status() >= 400) issues.push(r.status() + " " + r.url());
  });
  await page.reload();
  await page.waitForSelector("#loading", { state: "hidden" });
  assert.equal(await page.title(), "Home Range");
  assert.equal(
    (await page.locator(".map-scope").innerText()).trim(),
    "Home Range",
  );
  assert.equal(await page.locator("#areas path").count(), 3142);
  assert.equal(page.url(), base);
  const historySize = await page.evaluate(() => history.length);
  await checkLowerMapInteraction(page);
  assert.equal(await page.locator(".results, #saved-nav, .topbar").count(), 0);
  assert.equal(await page.locator(".filter-row").count(), 1);
  assert.equal(
    await page.locator(".filter-row .switch").getAttribute("aria-checked"),
    "false",
  );
  assert.equal(
    await page.locator('[data-eye="janLow"]').getAttribute("aria-pressed"),
    "true",
  );
  for (const [family, key] of [
    ["temperature", "julHigh"],
    ["wetDays", "wetDays"],
    ["cloudyDays", "cloudyDays"],
  ]) {
    await page.locator("#add-filter").click();
    await pickMeasure(page, family, key);
  }
  await pauseActiveFilters(page);
  for (const card of await page.locator(".filter-row").all()) {
    assert.equal(
      await card.locator(".switch").getAttribute("aria-checked"),
      "false",
    );
    await checkGrips(card);
  }
  await page.locator('[data-key="janLow"] .switch').click();
  await page.locator('[data-key="julHigh"] .switch').click();
  const row = (key) => page.locator(`[data-key="${key}"]`);
  const exact = (key, bound) => row(key).locator(`.num[data-bound="${bound}"]`);
  const thumb = (key, bound) =>
    row(key).locator(`.range[data-bound="${bound}"]`);
  const setBound = async (key, bound, value) => {
    const input = exact(key, bound);
    await input.fill(String(value));
    await input.press("Enter");
  };
  await setBound("janLow", "min", 40);
  await setBound("julHigh", "max", 80);
  const expectColoredCount = (expected) =>
    page.waitForFunction(
      (n) =>
        document.querySelectorAll(
          '#areas path:not([fill="#d8ded4"]):not([fill^="url("])',
        ).length === n,
      expected,
      { timeout: 5_000 },
    );
  await expectColoredCount(6);
  await page.locator("#any").click();
  await expectColoredCount(486);
  // An OR combines whole inclusive intervals, even when both ends constrain each metric.
  await setBound("janLow", "max", 42);
  await setBound("julHigh", "min", 78);
  await expectColoredCount(223);
  await page.locator("#all").click();
  await expectColoredCount(0);
  await page.locator("#any").click();
  await page.locator('[data-eye="cloudyDays"]').click();
  await page.locator("#zoomin").click();
  const editedUrl = new URL(page.url());
  assert.equal(editedUrl.searchParams.get("janLow"), "40..42");
  assert.equal(editedUrl.searchParams.get("layer"), "cloudyDays");
  assert.equal(editedUrl.searchParams.get("match"), "any");
  assert.ok(editedUrl.searchParams.has("extent"));
  assert.equal(await page.evaluate(() => history.length), historySize);
  const transform = await page.locator("#viewport").getAttribute("transform");
  await page.locator("#share").click();
  const share = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto("about:blank");
  assert.equal(share, editedUrl.href);
  await page.goto(share);
  await page.waitForSelector("#loading", { state: "hidden" });
  assert.equal(
    await page.locator("#viewport").getAttribute("transform"),
    transform,
  );
  assert.equal(await exact("janLow", "min").inputValue(), "40");
  assert.equal(await exact("janLow", "max").inputValue(), "42");
  assert.equal(
    await page.locator('[data-eye="cloudyDays"]').getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await page.locator("#station, #county, #points").count(), 0);
  await page.locator("#search").click();
  await page.locator("#query").fill("04013");
  await page.locator("#query").press("Enter");
  assert.equal(await page.locator(".detailval").innerText(), "16.7 days/yr");
  await page.locator("#close").click();
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(
    await page.locator('[data-eye="cloudyDays"]').getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await page.locator("#any").getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("#coverage, #coverage-label").count(), 0);
  const addButton = page.locator("#add-filter");
  const panelList = page.locator("#filters");
  const buttonBefore = await addButton.boundingBox();
  const listBounds = await panelList.boundingBox();
  assert.ok(buttonBefore.y >= listBounds.y + listBounds.height - 1);
  await panelList.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  assert.deepEqual(await addButton.boundingBox(), buttonBefore);
  const mapRect = await page.locator("#map").boundingBox();
  await page.locator("#add-filter").click();
  await pickMeasure(page, "temperatureDays", "heatDays");
  await page.locator('[data-view="heatDays"]').click();
  assert.deepEqual(await page.locator("#map").boundingBox(), mapRect);
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  const filterCutoff = row("heatDays").locator(".editor .cutoff");
  assert.equal(await row("heatDays").locator(".cutoff").count(), 1);
  await filterCutoff.fill("87");
  await filterCutoff.press("Enter");
  assert.equal(
    await page.locator("#legend-name").innerText(),
    "Days at or Above 87°F",
  );
  await pauseActiveFilters(page);
  await page.locator('[data-key="heatDays"] .switch').click();
  assert.equal(await row("heatDays").locator(".editor").count(), 1);
  assert.equal(await row("heatDays").locator(".range").count(), 2);
  assert.equal(await row("heatDays").locator(".switch").count(), 1);
  await filterCutoff.fill("95");
  await filterCutoff.press("Enter");
  await page.waitForFunction(
    () =>
      document.getElementById("legend-name").textContent ===
      "Days at or Above 95°F",
  );
  assert.equal(new URL(page.url()).searchParams.has("mapCutoff"), false);
  await page.locator('[data-eye="cloudyDays"]').click();
  assert.match(
    await page.locator("#credits").innerText(),
    /North American Regional Reanalysis/,
  );
  await page.locator("#fold").click();
  assert.equal(await page.locator("#filters").isVisible(), false);
  assert.ok((await page.locator("#map").boundingBox()).height > mapRect.height);
  await page.locator("#fold").click();
  assert.equal(await page.locator("#filters").isVisible(), true);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.locator('[data-key="wetDays"] .switch').click();
  assert.match(
    await page.locator('[data-key="wetDays"] .endpoints').innerText(),
    /Drier/,
  );
  await page.locator('[data-drop="wetDays"]').click();
  assert.equal(await page.locator('[data-key="wetDays"]').count(), 0);
  while (await page.locator("[data-drop]").count())
    await page.locator("[data-drop]").first().click();
  assert.equal(
    await page.locator("#legend-name").innerText(),
    "County Boundaries",
  );
  await page.locator("#share").click();
  const empty = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto("about:blank");
  await page.goto(empty);
  await page.waitForSelector("#loading", { state: "hidden" });
  assert.equal(await page.locator(".eye").count(), 0);
  await page.locator("#add-filter").click();
  assert.deepEqual(
    (
      await page
        .locator("[data-pick]")
        .evaluateAll((els) => els.map((el) => el.dataset.pick))
    ).sort(),
    [
      "temperature",
      "humidity",
      "distance",
      "nature",
      "landCover",
      "hazard",
      "temperatureDays",
      "wetDays",
      "annualPrecipitation",
      "cloudyDays",
      "elevation",
      "populationDensity",
      "crime",
    ].sort(),
  );
  assert.deepEqual(
    (
      await page.locator("#dialog-body .catalog-heading").allTextContents()
    ).sort(),
    [
      "Climate & Weather",
      "Population & Nearby Places",
      "Land & Terrain",
      "Natural Hazards",
    ].sort(),
  );
  await page.locator('[data-pick="cloudyDays"]').click();
  assert.equal(
    await page.locator('[data-eye="cloudyDays"]').getAttribute("aria-pressed"),
    "true",
  );
  assert.match(
    await page.locator('[data-key="cloudyDays"] .endpoints').innerText(),
    /366 days\/yr/,
  );
  // Use physical pointer events at coincident handles, including a touch gesture
  // in the scrollable mobile sheet. Either side must be independently reachable.
  await page.setViewportSize({ width: 1280, height: 800 });
  await setBound("cloudyDays", "min", 50);
  await setBound("cloudyDays", "max", 50);
  const cloudTrack = row("cloudyDays").locator(".range-track");
  const gripCenter = async (bound) => {
    const grip = row("cloudyDays").locator(`[data-grip="${bound}"]`);
    await grip.scrollIntoViewIfNeeded();
    const box = await grip.boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const leftGrip = await gripCenter("min");
  const desktopTrack = await cloudTrack.boundingBox();
  await page.mouse.move(leftGrip.x, leftGrip.y);
  await page.mouse.down();
  await page.mouse.move(leftGrip.x - desktopTrack.width / 4, leftGrip.y, {
    steps: 8,
  });
  await page.mouse.up();
  assert.ok(
    Number(await exact("cloudyDays", "min").inputValue()) < 35,
    "drag lower handle left",
  );
  assert.equal(await exact("cloudyDays", "max").inputValue(), "50");
  await setBound("cloudyDays", "min", 50);
  await page.setViewportSize({ width: 375, height: 812 });
  const rightGrip = await gripCenter("max");
  const mobileTrack = await cloudTrack.boundingBox();
  const touch = await context.newCDPSession(page);
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [rightGrip],
  });
  for (let i = 1; i <= 8; i++) {
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: rightGrip.x + (mobileTrack.width * i) / 32, y: rightGrip.y },
      ],
    });
  }
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await touch.detach();
  assert.ok(
    Number(await exact("cloudyDays", "max").inputValue()) > 65,
    "drag upper handle right by touch",
  );
  assert.equal(await exact("cloudyDays", "min").inputValue(), "50");
  const humidity = await (
    await page.request.get(base + "data/absolute-humidity.json")
  ).json();
  for (const [key, month] of [
    ["coldAbsoluteHumidity", "December"],
    ["hotAbsoluteHumidity", "July"],
  ]) {
    await page.locator("#add-filter").click();
    await pickMeasure(page, "humidity", key);
    await page.locator(`[data-eye="${key}"]`).click();
    assert.ok(
      (await page.locator("#legend-sub").innerText()).includes(humidity.period),
    );
    assert.ok(
      (await page.locator("#credits").innerText()).includes(humidity.credit),
    );
    await page.locator("#search").click();
    await page.locator("#query").fill("04013");
    await page.locator("#query").press("Enter");
    assert.equal(
      await page.locator(".detailval").innerText(),
      humidity.counties["04013"][key].toFixed(1) + " g/m³",
    );
    assert.match(
      await page.locator(".detailval + p").innerText(),
      new RegExp(month),
    );
    await page.locator("#close").click();
  }
  await page.locator("#share").click();
  const humidityLink = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  await page.goto("about:blank");
  await page.goto(humidityLink);
  await page.waitForSelector("#loading", { state: "hidden" });
  assert.equal(
    await page
      .locator('[data-eye="hotAbsoluteHumidity"]')
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    await page
      .locator('[data-key="coldAbsoluteHumidity"] .switch')
      .getAttribute("aria-checked"),
    "true",
  );
  await page.locator('[data-drop="cloudyDays"]').click();
  // Check the intersection and union against the published county values.
  const coldMax = 4;
  const hotMin = 16;
  const readings = Object.values(humidity.counties).map(
    ({ coldAbsoluteHumidity: cold, hotAbsoluteHumidity: hot }) => ({
      coldMatches: Number.isFinite(cold) && cold <= coldMax,
      hotMatches: Number.isFinite(hot) && hot >= hotMin,
      hotMeasured: Number.isFinite(hot),
      bothMeasured: Number.isFinite(cold) && Number.isFinite(hot),
    }),
  );
  const both = readings.filter((r) => r.coldMatches && r.hotMatches);
  const either = readings.filter((r) => r.coldMatches || r.hotMatches);
  const uncertain = readings.filter(
    (r) => !r.coldMatches && !r.hotMatches && !r.bothMeasured,
  );
  assert.ok(both.length > 0 && either.length > both.length);
  await setBound("coldAbsoluteHumidity", "max", coldMax);
  await setBound("hotAbsoluteHumidity", "min", hotMin);
  await page.locator("#all").click();
  await expectColoredCount(both.length);
  await page.locator("#any").click();
  // A matched county still needs a value for the displayed hot-month layer to have a color.
  await expectColoredCount(either.filter((r) => r.hotMeasured).length);
  assert.equal(
    await page.locator('#areas path[fill="url(#uncertain)"]').count(),
    uncertain.length,
  );
  await pauseActiveFilters(page);
  await page.locator("#all").click();
  await page.locator("#add-filter").click();
  await page.locator('[data-pick="populationDensity"]').click();
  await page.locator('[data-eye="populationDensity"]').click();
  const population = page.locator('[data-key="populationDensity"]');
  const residents = exact("populationDensity", "min");
  const slider = thumb("populationDensity", "min");
  const upperSlider = thumb("populationDensity", "max");
  assert.match(await page.locator("#legend-sub").innerText(), /July 1, 2025/);
  assert.match(await page.locator("#credits").innerText(), /U.S. Census/);
  assert.equal(await residents.inputValue(), "0");
  assert.equal(await exact("populationDensity", "max").inputValue(), "100000");
  await slider.press("ArrowRight");
  assert.equal(await residents.inputValue(), "0.01");
  await slider.press("Home");
  await upperSlider.press("Home");
  assert.equal(await exact("populationDensity", "max").inputValue(), "0");
  await upperSlider.press("End");
  assert.equal(await exact("populationDensity", "max").inputValue(), "100000");
  await setBound("populationDensity", "max", 0.03);
  assert.equal(
    await upperSlider.getAttribute("aria-valuetext"),
    "0.03 people/mi²",
  );
  await expectColoredCount(1);
  await page.locator("#search").click();
  await page.locator("#query").fill("02290");
  await page.locator("#query").press("Enter");
  assert.equal(await page.locator(".detailval").innerText(), "0.03 people/mi²");
  await page.locator("#close").click();
  await setBound("populationDensity", "max", 73481.17);
  await setBound("populationDensity", "min", 73481.17);
  assert.equal(
    await slider.getAttribute("aria-valuetext"),
    "73,481.17 people/mi²",
  );
  await expectColoredCount(1);
  await page.locator("#share").click();
  const populationLink = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  await page.goto("about:blank");
  await page.goto(populationLink);
  await page.waitForSelector("#loading", { state: "hidden" });
  assert.equal(await residents.inputValue(), "73481.17");
  await expectColoredCount(1);
  // Crossing either exact end clamps the edited end. The other exact value stays intact.
  await setBound("populationDensity", "min", 73481.18);
  assert.equal(await residents.inputValue(), "73481.17");
  await setBound("populationDensity", "max", 73481.16);
  assert.equal(
    await exact("populationDensity", "max").inputValue(),
    "73481.17",
  );
  await expectColoredCount(1);
  await upperSlider.press("End");
  assert.equal(await residents.inputValue(), "73481.17");
  await setBound("populationDensity", "min", 73481.18);
  await expectColoredCount(0);
  await page.setViewportSize({ width: 320, height: 670 });
  assert.ok(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= innerWidth &&
        document.getElementById("colors").scrollWidth <=
          document.getElementById("colors").clientWidth + 1,
    ),
  );
  await page.locator("#fit").click();
  await checkNationalFit(page);
  await page.locator("#fold").click();
  await checkNationalFit(page);
  await page.locator("#fold").click();
  await page.locator('[data-drop="populationDensity"]').click();
  assert.equal(await population.count(), 0);
  const legacyView = {
    layer: "janLow",
    mode: "any",
    county: [
      { key: "janLow", op: "max", limit: 10, on: true },
      { key: "janLow", op: "min", limit: 40, on: true },
      { key: "wetDays", op: "max", limit: 80, on: true },
    ],
  };
  await page.goto("about:blank");
  await page.goto(
    base + "#view=" + encodeURIComponent(JSON.stringify(legacyView)),
  );
  await page.locator("dialog[open]").waitFor();
  assert.match(await page.locator("#dialog-body").innerText(), /contain a gap/);
  await page.locator("#close").click();
  assert.equal(
    await row("janLow").locator(".switch").getAttribute("aria-checked"),
    "false",
  );
  assert.equal(
    await row("wetDays").locator(".switch").getAttribute("aria-checked"),
    "true",
  );
  assert.equal(await exact("wetDays", "max").inputValue(), "80");
  // Exercise the county climate and demographic measures while off and on, including overlapping and
  // nearly overlapping values on the graduated population slider.
  await page.goto("about:blank");
  await page.goto(base);
  await page.waitForSelector("#loading", { state: "hidden" });
  const temperatureKeys = calendarMonths.flatMap((name) => {
    const month = name.slice(0, 3).toLowerCase();
    return [month + "Low", month + "High"];
  });
  const keys = [
    ...temperatureKeys,
    "heatDays",
    "wetDays",
    "cloudyDays",
    "coldAbsoluteHumidity",
    "hotAbsoluteHumidity",
    "elevation",
    "populationDensity",
  ];
  for (const key of keys) {
    if (!(await row(key).count())) {
      await page.locator("#add-filter").click();
      const family = temperatureKeys.includes(key)
        ? "temperature"
        : key.endsWith("Humidity")
          ? "humidity"
          : key === "heatDays"
            ? "temperatureDays"
            : key;
      await pickMeasure(page, family, key);
    }
  }
  await pauseActiveFilters(page);
  // All 24 monthly temperature choices are used. Calendar-month humidity
  // choices remain after adding the two county-specific seasonal extremes.
  await page.locator("#add-filter").click();
  assert.equal(
    await page.locator("[data-pick=temperature]:visible").count(),
    0,
  );
  assert.equal(await page.locator("[data-pick=humidity]:visible").count(), 1);
  await page.locator("#close").click();
  assert.equal(await page.locator(".filter-row").count(), keys.length);
  assert.equal(
    await page.locator("[data-comparison], [data-add], [data-remove]").count(),
    0,
  );
  assert.equal(
    await page
      .locator("#filters")
      .getByText(/^(?:at least|at most|add limit|additional limit)$/i)
      .count(),
    0,
  );
  for (const key of keys) {
    const card = row(key);
    assert.equal(
      await card.locator(".switch").getAttribute("aria-checked"),
      "false",
    );
    assert.equal(await card.locator(".editor").count(), 1);
    await checkGrips(card);
    await card.locator(".switch").click();
    await checkGrips(card);
    await card.locator(".switch").click();
  }
  await page.locator('[data-eye="cloudyDays"]').click();
  await setBound("cloudyDays", "min", 16.7);
  assert.equal(
    await row("cloudyDays").locator(".switch").getAttribute("aria-checked"),
    "true",
  );
  await setBound("cloudyDays", "max", 16.7);
  await expectColoredCount(2);
  assert.deepEqual(
    await page
      .locator('#areas path:not([fill="#d8ded4"]):not([fill^="url("])')
      .evaluateAll((els) => els.map((el) => el.dataset.uid).sort()),
    ["c04013", "c48033"],
  );
  await pauseActiveFilters(page);
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: width > 400 ? 800 : 670 });
    for (const maximum of [0.03, 0.04]) {
      await setBound("populationDensity", "min", 0.03);
      await setBound("populationDensity", "max", maximum);
      await checkGrips(row("populationDensity"));
      await checkGripPixels(row("populationDensity"));
      await expectColoredCount(1);
      assert.equal(
        await exact("populationDensity", "max").inputValue(),
        String(maximum),
      );
    }
    const popSwitch = row("populationDensity").locator(".switch");
    await popSwitch.click();
    await checkGrips(row("populationDensity"));
    await checkGripPixels(row("populationDensity"));
  }
  await page.locator('[data-eye="elevation"]').click();
  await setBound("elevation", "min", 10000);
  await expectColoredCount(7);
  await setBound("elevation", "max", 11405);
  await setBound("elevation", "min", 11405);
  await expectColoredCount(1);
  assert.equal(
    await page
      .locator('#areas path:not([fill="#d8ded4"]):not([fill^="url("])')
      .getAttribute("data-uid"),
    "c08111",
  );
  await page.locator("#share").click();
  const elevationLink = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  await page.goto("about:blank");
  await page.goto(elevationLink);
  await expectColoredCount(1);
  assert.equal(
    await page.locator("#legend-name").innerText(),
    "Average County Elevation",
  );
  assert.equal(await exact("elevation", "min").inputValue(), "11405");
  assert.equal(await exact("elevation", "max").inputValue(), "11405");
  assert.match(await page.locator("#credits").innerText(), /GMTED2010/);
  await page.locator("#search").click();
  await page.locator("#query").fill("08111");
  await page.locator("#query").press("Enter");
  assert.equal(await page.locator(".detailval").innerText(), "11,405 ft");
  await page.locator("#close").click();
  // Choose two independent months and verify the shared mobile view.
  await page.goto(base + "?janLow=15..35&wetDays=32..85&layer=janLow");
  const cards = () =>
    page
      .locator(".filter-row")
      .evaluateAll((els) => els.map((el) => el.dataset.key));
  const monthSelect = (key) => row(key).locator("[data-temperature-month]");
  const statSelect = (key) => row(key).locator("[data-temperature-stat]");
  await monthSelect("janLow").waitFor();
  assert.deepEqual(
    await monthSelect("janLow").locator("option").allTextContents(),
    calendarMonths,
  );
  await page.locator("#add-filter").click();
  await page.locator('[data-pick="temperature"]').click();
  await monthSelect("febLow").selectOption("10");
  await statSelect("novLow").selectOption("High");
  await setBound("novHigh", "min", 58);
  await setBound("novHigh", "max", 72);
  await page.locator("[data-eye=novHigh]").click();
  assert.equal(
    await page.locator("#legend-name").innerText(),
    "Average November High",
  );
  await page.locator("#share").click();
  const monthlyLink = new URL(
    await page.evaluate(() => navigator.clipboard.readText()),
  );
  assert.equal(monthlyLink.searchParams.get("janLow"), "15..35");
  assert.equal(monthlyLink.searchParams.get("novHigh"), "58..72");
  assert.equal(monthlyLink.searchParams.get("layer"), "novHigh");
  await page.goto("about:blank");
  await page.goto(monthlyLink.href);
  await monthSelect("novHigh").waitFor();
  // Independently counted from the January low, November high, and wet-day records.
  await expectColoredCount(173);
  await page.locator("#any").click();
  await expectColoredCount(2332);
  await page.locator("#all").click();
  await expectColoredCount(173);
  assert.deepEqual(await cards(), ["janLow", "wetDays", "novHigh"]);
  assert.equal(await monthSelect("novHigh").inputValue(), "10");
  assert.equal(await statSelect("novHigh").inputValue(), "High");
  assert.equal(await exact("janLow", "min").inputValue(), "15");
  assert.equal(await exact("janLow", "max").inputValue(), "35");
  assert.equal(await exact("novHigh", "min").inputValue(), "58");
  assert.equal(await exact("novHigh", "max").inputValue(), "72");
  for (const key of ["janLow", "novHigh"]) {
    assert.equal(
      await row(key).locator(".switch").getAttribute("aria-checked"),
      "true",
    );
    for (const selector of [monthSelect(key), statSelect(key)]) {
      await selector.scrollIntoViewIfNeeded();
      const box = await selector.boundingBox();
      assert.ok(
        box.x >= 0 &&
          box.x + box.width <= (await page.evaluate(() => innerWidth)),
      );
    }
  }
  // Switching a paused card to an occupied month selects its available
  // statistic and preserves that card's position, eye, and sibling's bounds.
  await row("novHigh").locator(".switch").click();
  await statSelect("novHigh").selectOption("Low");
  await monthSelect("novLow").selectOption("0");
  assert.deepEqual(await cards(), ["janLow", "wetDays", "janHigh"]);
  assert.ok(await statSelect("janHigh").locator('[value="Low"]').isDisabled());
  assert.equal(
    await row("janHigh").locator(".switch").getAttribute("aria-checked"),
    "false",
  );
  assert.equal(
    await page.locator("[data-eye=janHigh]").getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await exact("janLow", "min").inputValue(), "15");
  assert.equal(await exact("janLow", "max").inputValue(), "35");
  await page.locator("#add-filter").click();
  await page.locator("[data-pick=temperature]").click();
  assert.ok(await monthSelect("febLow").locator('[value="0"]').isDisabled());
  // Shared seasonal extremes still identify the same two county measures.
  await page.goto(base + "?coldLow=0..30&hotHigh=70..85&layer=hotHigh");
  await row("hotHigh").waitFor();
  assert.deepEqual(await cards(), ["coldLow", "hotHigh"]);
  assert.equal(
    await page.locator("#legend-name").innerText(),
    "Hottest-Month Average High",
  );
  assert.equal(await exact("coldLow", "max").inputValue(), "30");
  assert.equal(await exact("hotHigh", "min").inputValue(), "70");
  // An authored URL and a bookmark must work without first clicking Share.
  const bookmark =
    base +
    "?tag=home&TRND_RISKS=0.01..22.22&janLow=20..35&layer=TRND_RISKS&match=all";
  await page.goto(bookmark);
  await page.waitForSelector("#loading", { state: "hidden" });
  assert.equal(await exact("TRND_RISKS", "min").inputValue(), "0.01");
  await setBound("TRND_RISKS", "max", 18.56);
  assert.equal(
    new URL(page.url()).searchParams.get("TRND_RISKS"),
    "0.01..18.56",
  );
  assert.equal(new URL(page.url()).searchParams.get("tag"), "home");
  await page.reload();
  await page.waitForSelector("#loading", { state: "hidden" });
  assert.equal(await exact("TRND_RISKS", "max").inputValue(), "18.56");
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.locator("#share").click();
  assert.equal(await page.locator("#copy-link").inputValue(), page.url());
  await page.locator("#close").click();
  await page.goto(
    base + "?janLow=-20..40&julHigh=60..90&paused=janLow&layer=julHigh",
  );
  const about = row("janLow").getByRole("img", {
    name: "About Temperature",
  });
  const hint = row("janLow").locator(".filter-help-text");
  const otherHint = row("julHigh").locator(".filter-help-text");
  assert.equal(await hint.isVisible(), false);
  const cardHeight = await row("janLow").evaluate((el) => el.offsetHeight);
  await about.hover();
  assert.ok(await hint.isVisible());
  assert.equal(await otherHint.isVisible(), false);
  assert.equal(await hint.textContent(), await otherHint.textContent());
  assert.equal(
    await row("janLow").locator(".switch").getAttribute("aria-checked"),
    "false",
  );
  assert.equal(
    await row("julHigh").locator("[data-eye]").getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    await row("janLow").evaluate((el) => el.offsetHeight),
    cardHeight,
  );
  await hint.hover();
  assert.ok(await hint.isVisible());
  await page.locator("#filters-title").hover();
  assert.equal(await hint.isVisible(), false);
  await about.focus();
  assert.ok(await hint.isVisible());
  await about.press("Escape");
  assert.equal(await hint.isVisible(), false);
  await about.tap();
  assert.ok(await hint.isVisible());
  await page.locator("#filters-title").tap();
  assert.equal(await hint.isVisible(), false);
  await checkCatalogLayout(page, base);
  await checkHazards(page, base);
  await checkLandscape(page, base);
  await checkCountyProfile(page, base);
  await checkMonthlyClimate(page, base);
  await checkAnnualPrecipitation(page, base);
  await checkCrime(page, base);
  await checkColdDays(page, base);
  await checkLocalAccess(page, base);
  await checkNature(page, base);
  const motionPage = await browser.newPage();
  await checkReferenceMotion(motionPage, base);
  await motionPage.close();
  await checkPdfExport(page, base, tmp);
  await checkUpperMapInteraction(page, base);
  await checkPlaceSearchAndToolbar(page, base);
  assert.deepEqual(issues, []);
  console.log(
    "Desktop, mobile, independent layer visibility, scrollable rail, shared extent, heat cutoffs, all/any and subpath release checks passed.",
  );
} finally {
  await browser?.close();
  server?.kill();
  await rm(tmp, { recursive: true, force: true });
}
