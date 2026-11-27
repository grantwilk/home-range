import assert from "node:assert/strict";
import { pickMeasure } from "./catalog-browser.mjs";

export async function checkColdDays(page, base) {
  await page.goto(base + "?filters=none");
  await page.locator("#areas path").first().waitFor();
  await page.locator("#add-filter").click();
  await page.locator("#catalog-search").fill("cold days");
  const result = page.locator('[data-pick="temperatureDays"]');
  assert.equal(await result.getAttribute("data-measure"), "coldDays");
  await result.click();
  const card = page.locator('.filter-row[data-key="coldDays"]');
  const cutoff = card.locator(".cutoff");
  const maximum = card.locator('[data-bound="max"].num');
  assert.equal(await cutoff.count(), 1);
  assert.equal(await cutoff.inputValue(), "-30");
  assert.equal(await card.getByRole("slider").count(), 2);
  await maximum.fill("14");
  await maximum.press("Enter");
  await page.waitForURL((url) => url.searchParams.get("coldDays") === "0..14");
  assert.match(
    await page.locator("#legend-name").innerText(),
    /below [−-]30°F/i,
  );

  // Dane County had 3 days below −30°F and 475 below 0°F in the 30-year record.
  async function daneReading() {
    await page.locator("#search").click();
    await page.locator("#query").fill("55025");
    await page.locator("#query").press("Enter");
    const text = await page.locator(".detailval").innerText();
    await page.locator("#close").click();
    return text;
  }
  assert.equal(await daneReading(), "0.1 days/yr");
  assert.equal(
    await page.locator('#areas path[fill="url(#uncertain)"]').count(),
    35,
  );
  await cutoff.fill("0");
  await cutoff.press("Enter");
  await page
    .locator('#areas path[data-uid="c55025"][fill="#d8ded4"]')
    .waitFor();
  assert.match(await page.locator("#legend-name").innerText(), /below 0°F/i);
  assert.equal(await daneReading(), "15.8 days/yr");
  await page.locator("#add-filter").click();
  await pickMeasure(page, "temperatureDays", "heatDays");
  const hotCutoff = page.locator('[data-key="heatDays"] .editor .cutoff');
  await hotCutoff.fill("95");
  await hotCutoff.press("Enter");
  await page.locator("#share").click();
  const share = await page.evaluate(() => navigator.clipboard.readText());
  const params = new URL(share).searchParams;
  assert.equal(params.get("coldDays"), "0..14");
  assert.equal(params.get("coldDays.cutoff"), "0");
  assert.equal(params.get("heatDays.cutoff"), "95");
  await page.goto("about:blank");
  await page.goto(share);
  assert.equal(await cutoff.inputValue(), "0");
  assert.equal(await maximum.inputValue(), "14");
  assert.equal(await hotCutoff.inputValue(), "95");
  assert.match(await page.locator("#legend-name").innerText(), /below 0°F/i);

  await page.locator("#add-filter").click();
  await page.locator("#catalog-search").fill("cold days");
  await page.locator('[data-pick="temperatureDays"]').click();
  const second = page.locator('[data-card="coldDays~2"]');
  await second.locator(".cutoff").fill("10");
  await second.locator(".cutoff").press("Enter");
  await second.locator('.num[data-bound="max"]').fill("30");
  await second.locator('.num[data-bound="max"]').press("Enter");
  await second.locator("[data-eye]").click();
  assert.match(await page.locator("#legend-name").innerText(), /below 10°F/i);
  await page.locator("#share").click();
  const both = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto(both);
  await second.waitFor();
  assert.equal(await second.locator(".cutoff").inputValue(), "10");
  assert.equal(
    await page.locator('[data-card="coldDays"] .cutoff').inputValue(),
    "0",
  );
  assert.equal(
    await second.locator("[data-eye]").getAttribute("aria-pressed"),
    "true",
  );
  await page.locator("#export-pdf").click();
  const coloring = page.locator("#pdf-layer");
  assert.equal(await coloring.inputValue(), "coldDays~2");
  assert.match(
    await coloring.locator('option[value="coldDays"]').innerText(),
    /below 0°F/i,
  );
  assert.match(
    await coloring.locator('option[value="coldDays~2"]').innerText(),
    /below 10°F/i,
  );
  await page.locator("#pdf-cancel").click();
  await page.locator('[data-drop="coldDays"]').click();
  assert.equal(
    await page.locator('.filter-row[data-key="coldDays"]').count(),
    1,
  );
  assert.equal(await second.locator(".cutoff").inputValue(), "10");
  assert.match(await page.locator("#legend-name").innerText(), /below 10°F/i);
  await second.locator("[data-drop]").click();
  assert.equal(
    await page.locator('.filter-row[data-key="coldDays"]').count(),
    0,
  );
}
