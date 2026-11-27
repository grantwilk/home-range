import assert from "node:assert/strict";

export async function checkNature(page, base) {
  // A shared view can require both water types while displaying only the lake.
  const link = base + "?rivers=0..5&lakes=0..1&layer=lakes&match=all";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(link);
  const ready = () =>
    page.waitForFunction(
      () =>
        document.querySelector("#nature-outline")?.getAttribute("d")?.length >
          10 && document.querySelector("#access-status")?.hidden,
      undefined,
      { timeout: 90000 },
    );
  await ready();
  assert.equal(await page.locator("#reference-pins [data-key] > *").count(), 0);
  assert.equal(
    await page.locator('[data-key="lakes"] [type=range]').count(),
    2,
  );
  assert.equal(
    await page.locator("#legend-name").innerText(),
    "Distance to Lakes of 400+ Acres",
  );
  await page.locator("#search").click();
  await page.locator("#query").fill("42.54637, -88.2981");
  await page.locator("#query").press("Enter");
  await page.locator(".local-reading").first().waitFor();
  const lake = page.locator('#county-matches [data-filter-id="lakes"]');
  assert.match(await lake.innerText(), /Powers Lake/);
  assert.equal(await lake.locator(".match-status").innerText(), "Match");
  assert.equal(await lake.locator(".match-reading").innerText(), "0 mi");
  await page.locator("#close").click();
  await page.goto(
    base + "?freshwater=0..1&parks=0..20&layer=freshwater&match=all",
  );
  await ready();
  for (const [point, name] of [
    ["41.76, -88.315", "Fox River"],
    ["42.54637, -88.2981", "Powers Lake"],
  ]) {
    await page.locator("#search").click();
    await page.locator("#query").fill(point);
    await page.locator("#query").press("Enter");
    await page.locator(".local-reading").first().waitFor();
    const reading = await page.locator(".local-reading").first().innerText();
    assert.ok(reading.includes(name) && reading.includes("Match"), reading);
    await page.locator("#close").click();
  }
  await page.goto(link);
  await ready();
  await page.locator('[data-eye="rivers"]').click();
  await ready();
  assert.equal(new URL(page.url()).searchParams.get("layer"), "rivers");
  await page.locator("#facility-sources").click();
  assert.ok(
    await page.locator('a[download][href$="rivers.json.gz"]').isVisible(),
  );
  await page.locator("#close").click();
  await page.goto(base + "?layer=coast");
  await ready();
  assert.equal(
    await page
      .locator('[data-key="coast"] .switch')
      .getAttribute("aria-checked"),
    "false",
  );
  await page
    .locator('[data-key="coast"] [data-subtype]')
    .selectOption("mountains");
  await ready();
  assert.equal(await page.locator("#legend-keys .nature-line").count(), 1);
  await page
    .locator('[data-key="mountains"] [data-subtype]')
    .selectOption("parks");
  await ready();
  await page.locator('[data-key="parks"] [data-drop]').click();
  assert.equal(await page.locator("#nature-outline").getAttribute("d"), null);
}
