import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

// Parse the file that the browser downloaded, including its embedded Unicode
// fonts. A valid download event alone cannot catch a blank or rasterized map.
async function inspectPdf(bytes, palette) {
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
    if (palette?.length) {
      const title = firstPageText.items.find((item) =>
        /color scale/i.test(item.str),
      );
      assert.ok(title, "The color scale needs a visible heading");
      const viewport = map.getViewport({ scale: 1 });
      const { canvas, context } = document.canvasFactory.create(
        viewport.width,
        viewport.height,
      );
      await map.render({ canvas, canvasContext: context, viewport }).promise;
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
  const download = async (label) => {
    const action = page.locator("#export-pdf");
    assert.ok(
      await action.isVisible(),
      "Export PDF must be available from the map",
    );
    const before = page.url();
    // Distance layers can repaint the legend between Playwright calls. Read
    // its current nodes and their computed colors in one browser turn.
    const palette = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#colors b"), (band) =>
        getComputedStyle(band)
          .backgroundColor.match(/\d+/g)
          .map(Number)
          .slice(0, 3),
      ),
    );
    const [saved] = await Promise.all([
      page.waitForEvent("download", { timeout: 60000 }),
      action.click(),
    ]);
    assert.match(saved.suggestedFilename(), /\.pdf$/i);
    const path = join(directory, label + ".pdf");
    await saved.saveAs(path);
    assert.equal(await saved.failure(), null);
    assert.equal(page.url(), before, "Export must preserve the current view");
    return inspectPdf(await readFile(path), palette);
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
  const national = await download("national-climate");
  assert.match(national, /Average January Low/i);
  assert.match(national, /New York|Los Angeles|Chicago/i);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    base + "?airports=0..25&hospitals=0..15&janLow=-50..30&layer=janLow",
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
  await page.locator("[data-key=airports] .switch").click();
  await pin("airports").waitFor({ state: "detached" });
  assert.equal(await keyEntry("airports").count(), 0);
  assert.ok(await pin("hospitals").count());
  const paused = await download("madison-hospitals");
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
  const complete = await download("madison-all-places");
  for (const type of categories) {
    const label = (await keyEntry(type).innerText()).trim();
    assert.ok(label);
    assert.ok(
      mapKey(complete).toLowerCase().includes(label.toLowerCase()),
      `PDF key is missing ${label}`,
    );
  }
}
