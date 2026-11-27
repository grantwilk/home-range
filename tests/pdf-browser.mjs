import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { layers } from "../model.js";
import { referenceSymbols } from "../map-reference.js";

const rgb = (hex) =>
  [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

// Parse the file that the browser downloaded, including its embedded Unicode
// fonts. A valid download event alone cannot catch a blank or rasterized map.
async function inspectPdf(bytes, { layer, painted, absent }) {
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  const loading = getDocument({
    data: Uint8Array.from(bytes),
    isEvalSupported: false,
  });
  try {
    const document = await loading.promise;
    const map = await document.getPage(1);
    const drawing = await map.getOperatorList();
    assert.ok(
      drawing.fnArray.filter((op) => op === OPS.constructPath).length > 20,
      "Downloaded map must contain vector geography",
    );
    // Sample the displayed color key on the rendered PDF page. The county fill
    // and its legend are painted separately and can use different colors by mistake.
    const firstPageText = await map.getTextContent();
    const viewport = map.getViewport({ scale: 1 });
    const { canvas, context } = document.canvasFactory.create(
      viewport.width,
      viewport.height,
    );
    await map.render({ canvas, canvasContext: context, viewport }).promise;
    const key = firstPageText.items.find((item) => item.str === "Map Key");
    assert.ok(key, "The front page needs a map key");
    const keyTop = viewport.convertToViewportPoint(
      key.transform[4],
      key.transform[5],
    )[1];
    // Exclude both header and footer, so the key's swatches and symbols cannot
    // stand in for actual county coloring and facility markers on the map.
    const mapPixels = context.getImageData(
      0,
      74,
      canvas.width,
      Math.floor(keyTop) - 90,
    ).data;
    const counts = new Map();
    for (let i = 0; i < mapPixels.length; i += 4) {
      const n =
        (mapPixels[i] << 16) | (mapPixels[i + 1] << 8) | mapPixels[i + 2];
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const pixelsOf = (hex) =>
      counts.get(Number.parseInt(hex.slice(1), 16)) ?? 0;
    for (const color of painted)
      assert.ok(pixelsOf(color) > 0, `Map missing ${color}`);
    for (const color of absent)
      assert.equal(pixelsOf(color), 0, `Unexpected map color ${color}`);
    if (layer !== "solid") {
      const metric = layers[layer];
      assert.ok(
        metric.colors.some((color) => pixelsOf(color) > 20),
        `Map needs ${layer} geography`,
      );
      const palette = metric.colors.map(rgb);
      const title = firstPageText.items.find((item) =>
        /color scale/i.test(item.str),
      );
      assert.ok(title, "The color scale needs a visible heading");
      const [left, top] = viewport.convertToViewportPoint(
        title.transform[4],
        title.transform[5],
      );
      const width = Math.floor(canvas.width / 2 - left);
      const band = context.getImageData(
        Math.floor(left),
        Math.ceil(top),
        width,
        26,
      ).data;
      let matches = false;
      for (let y = 0; y < 26 && !matches; y++) {
        let nextColor = 0;
        for (let x = 0; x < width && nextColor < palette.length; x++) {
          const i = (y * width + x) * 4;
          if (
            palette[nextColor].every(
              (value, channel) => Math.abs(band[i + channel] - value) <= 2,
            )
          )
            nextColor++;
        }
        matches = nextColor === palette.length;
      }
      assert.ok(
        matches,
        "PDF scale colors must match the map’s displayed palette in order",
      );
    }
    const text = [];
    for (let i = 1; i <= document.numPages; i++) {
      const page = i === 1 ? map : await document.getPage(i);
      const content = i === 1 ? firstPageText : await page.getTextContent();
      text.push(...content.items.map((item) => item.str));
    }
    return text.join(" ").replace(/\s+/g, " ");
  } finally {
    await loading.destroy();
  }
}

function mapKey(text) {
  const key = text.split(/Map Key/i)[1];
  assert.ok(key, "The exported page must have a readable map key");
  return key.split(
    /Match (?:All|Any)\s*·|No active filters|Filter settings and data sources/i,
  )[0];
}

export async function checkPdfExport(page, base, directory) {
  const action = page.locator("#export-pdf");
  const dialog = page.locator("#pdf-options");
  const download = async (
    label,
    { extent, layer, hide = [], painted = [], absent = [] } = {},
  ) => {
    const before = page.url();
    const liveLayer = await page.locator("#legend-name").innerText();
    await action.click();
    assert.ok(await dialog.isVisible());
    assert.ok(
      await dialog.locator('[name="extent"][value="current"]').isChecked(),
    );
    if (extent)
      await dialog.locator(`[name="extent"][value="${extent}"]`).check();
    const select = dialog.locator("#pdf-layer");
    if (layer) await select.selectOption(layer);
    const chosen = await select.inputValue();
    for (const key of hide)
      await dialog.locator(`[name="symbols"][value="${key}"]`).uncheck();
    const [saved] = await Promise.all([
      page.waitForEvent("download", { timeout: 120000 }),
      dialog.locator("#pdf-download").click(),
    ]);
    assert.match(saved.suggestedFilename(), /\.pdf$/i);
    const path = join(directory, label + ".pdf");
    await saved.saveAs(path);
    assert.equal(await saved.failure(), null);
    await dialog.waitFor({ state: "hidden" });
    assert.equal(page.url(), before, "Export must preserve the current view");
    assert.equal(await page.locator("#legend-name").innerText(), liveLayer);
    return inspectPdf(await readFile(path), { layer: chosen, painted, absent });
  };
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto(base);
  await page.locator("#areas path").first().waitFor();
  const towns = page.locator("#reference-towns text");
  await towns.first().waitFor();
  const nationalLabels = await towns.allTextContents();
  assert.match(nationalLabels.join(" "), /New York|Los Angeles|Chicago/i);
  assert.match(
    await page.locator("#reference-key").innerText(),
    /cit(?:y|ies)|town/i,
  );
  assert.equal(
    await page.locator("#reference-pins [data-key=airports]").count(),
    0,
  );
  const beforeCancel = page.url();
  await action.click();
  await dialog.locator('[name="extent"][value="national"]').check();
  await dialog.locator("#pdf-layer").selectOption("solid");
  await dialog.locator("#pdf-cancel").click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(page.url(), beforeCancel);
  const national = await download("national-climate");
  assert.match(national, /Average January Low/i);
  assert.match(national, /New York|Los Angeles|Chicago/i);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    base +
      "?airports=0..25&hospitals=0..15&janLow=-50..30&populationDensity=0..100&paused=populationDensity&layer=janLow",
  );
  await page.locator("#areas path").first().waitFor();
  await page.locator("#search").click();
  await page.locator("#query").fill("55025");
  await page.locator("#query").press("Enter");
  await page.locator("#locate-detail").click();
  const extent = new URL(page.url()).searchParams.get("extent");
  assert.ok(extent && Number(extent.split(",")[0]) > 1);
  const pin = (key) => page.locator(`#reference-pins [data-key="${key}"]`);
  const keyEntry = (key) => page.locator(`#reference-key [data-key="${key}"]`);
  await pin("hospitals").first().waitFor();
  await pin("airports").first().waitFor();
  await towns
    .filter({ hasText: /Madison/i })
    .first()
    .waitFor();
  for (const type of ["airports", "hospitals"]) {
    assert.ok(await keyEntry(type).isVisible(), type);
  }
  const symbol = (key) =>
    keyEntry(key).evaluate((el) =>
      Array.from(el.querySelectorAll("path,polygon,circle,rect,line,use")).map(
        (shape) => [
          shape.tagName,
          shape.getAttribute("d"),
          shape.getAttribute("points"),
          shape.getAttribute("href"),
          getComputedStyle(shape).fill,
          getComputedStyle(shape).stroke,
        ],
      ),
    );
  const airportSymbol = await symbol("airports");
  const hospitalSymbol = await symbol("hospitals");
  assert.ok(airportSymbol.length && hospitalSymbol.length);
  assert.notDeepEqual(
    airportSymbol,
    hospitalSymbol,
    "Symbols must distinguish active point layers",
  );
  const local = await download("madison-services");
  assert.match(local, /Average January Low/i);
  assert.match(mapKey(local), /airport/i);
  assert.match(mapKey(local), /hospital/i);
  assert.match(mapKey(local), /cit(?:y|ies)|town/i);
  assert.match(local, /0 mi to 25 mi/i);
  assert.match(local, /0 mi to 15 mi/i);
  assert.match(local, /Madison/i);
  assert.match(local, /Dane County, WI/i);
  assert.doesNotMatch(local, /Los Angeles|New York City/i);
  // Export the entire country from a zoomed phone map. A paused layer may
  // color the PDF, while the enabled hospital filter still constrains matches.
  const alternative = await download("national-population", {
    extent: "national",
    layer: "populationDensity",
    hide: ["hospitals"],
    painted: [referenceSymbols.airports.color],
    absent: [referenceSymbols.hospitals.color],
  });
  assert.match(alternative, /County Population Density/i);
  assert.match(alternative, /Alaska and Hawaii shown as insets/i);
  assert.match(alternative, /Los Angeles|New York/i);
  assert.match(alternative, /0 mi to 15 mi/i);
  assert.doesNotMatch(mapKey(alternative), /hospital/i);
  assert.match(mapKey(alternative), /airport/i);
  assert.equal(
    await page
      .locator("[data-key=populationDensity] .switch")
      .getAttribute("aria-checked"),
    "false",
  );
  assert.equal(await keyEntry("hospitals").isVisible(), true);
  await page.locator("[data-key=airports] .switch").click();
  await pin("airports").waitFor({ state: "detached" });
  assert.equal(await keyEntry("airports").count(), 0);
  assert.ok(await pin("hospitals").count());
  const paused = await download("madison-hospitals", { layer: "hospitals" });
  assert.ok(paused.includes(layers.hospitals.name));
  assert.match(mapKey(paused), /hospital/i);
  assert.doesNotMatch(paused, /airport/i);
  await page.locator("[data-drop=airports]").click();
  assert.equal(await keyEntry("airports").count(), 0);
  assert.equal(await pin("airports").count(), 0);
  assert.ok(await keyEntry("hospitals").isVisible());
  assert.ok(await towns.count());
  // The key must also work for the dense layers and a personal point. Keep
  // the same local extent so every enabled type has a record in the viewport.
  const allPlaces = new URL(base);
  allPlaces.search =
    "airports=0..25&hospitals=0..15&schools=0..10&grocery=0..5&cities=0..50&custom=0..10&janLow=-50..30&layer=janLow";
  allPlaces.searchParams.set("cities.population", "1000..10000000");
  allPlaces.searchParams.set("extent", extent);
  allPlaces.hash = new URLSearchParams({
    place: JSON.stringify(["Madison test point", -89.4, 43.07]),
  });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(allPlaces.href);
  const categories = [
    "airports",
    "hospitals",
    "schools",
    "grocery",
    "cities",
    "custom",
  ];
  for (const type of categories) {
    await pin(type).first().waitFor();
    assert.ok(await keyEntry(type).isVisible(), type);
  }
  const symbols = await Promise.all(categories.map(symbol));
  assert.equal(
    new Set(symbols.map((item) => JSON.stringify(item))).size,
    categories.length,
  );
  const complete = await download("madison-all-places", {
    layer: "solid",
    painted: [
      "#7ca38a",
      "#d8ded4",
      ...categories.map((key) => referenceSymbols[key].color),
    ],
  });
  assert.doesNotMatch(complete, /Color Scale/i);
  assert.match(mapKey(complete), /Matches filters/i);
  assert.match(complete, /Madison/i);
  assert.doesNotMatch(complete, /Alaska and Hawaii shown as insets/i);
  for (const name of [
    "Average January Low",
    ...categories.map((key) => layers[key].name),
  ])
    assert.ok(
      complete.includes(name),
      `PDF should list the applied filter ${name}`,
    );
  for (const type of categories) {
    const label = (await keyEntry(type).innerText()).trim();
    assert.ok(label);
    assert.ok(
      mapKey(complete).toLowerCase().includes(label.toLowerCase()),
      `PDF key is missing ${label}`,
    );
  }

  // Dense nationwide distance shading and overlapping point and shoreline
  // filters exercise the PDF clipping work even when all symbols are hidden.
  await page.goto(
    base +
      "?grocery=0..10&schools=0..25&hospitals=0..30&airports=0..80&coast=0..100&coldDays=0..25&coldDays.cutoff=0&coldDays~2=0..50&coldDays~2.cutoff=10&novHigh=30..70&layer=grocery",
  );
  await page.locator("#areas path").first().waitFor();
  const hidden = ["grocery", "schools", "hospitals", "airports"];
  const dense = await download("national-grocery-distance", {
    hide: hidden,
    absent: hidden.map((key) => referenceSymbols[key].color),
  });
  assert.match(dense, /Alaska and Hawaii shown as insets/i);
  assert.match(mapKey(dense), /Cities & towns/i);
  assert.doesNotMatch(mapKey(dense), /hospital|school|airport|grocery/i);
  assert.match(dense, /Distance to Grocery Stores 0 mi to 10 mi/i);
  assert.match(dense, /Days Below 0°F 0 days\/yr to 25 days\/yr/i);
  assert.match(dense, /Days Below 10°F 0 days\/yr to 50 days\/yr/i);
}
