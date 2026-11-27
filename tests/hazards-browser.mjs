import { pickMeasure } from "./catalog-browser.mjs";
import assert from "node:assert/strict";

// National percentiles and applicability for Dane County, WI, from FEMA's
// December 2025 county table. These benchmark the column used for each layer.
const daneScores = {
  RISK_SCORE: 93.86,
  AVLN_RISKS: null,
  CFLD_RISKS: null,
  CWAV_RISKS: 98.98,
  DRGT_RISKS: 39.85,
  ERQK_RISKS: 70.67,
  HAIL_RISKS: 98.92,
  HWAV_RISKS: 95.34,
  HRCN_RISKS: 29.16,
  ISTM_RISKS: 83.44,
  LNDS_RISKS: 89.41,
  LTNG_RISKS: 90.39,
  IFLD_RISKS: 94.31,
  SWND_RISKS: 92.46,
  TRND_RISKS: 97.58,
  TSUN_RISKS: null,
  VLCN_RISKS: null,
  WFIR_RISKS: 60.24,
  WNTW_RISKS: 93.57,
};

export async function checkHazards(page, base) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(base);
  await page.locator("#areas path").first().waitFor();
  const catalog = () => page.locator("#add-filter").click();
  const row = (key) => page.locator(`[data-key="${key}"]`);
  const eye = (key) => page.locator(`[data-eye="${key}"]`).click();
  const pick = (key) => pickMeasure(page, "hazard", key);
  const drop = (key) => page.locator(`[data-drop="${key}"]`).click();
  const input = (key, bound) => row(key).locator(`.num[data-bound="${bound}"]`);
  const bound = async (key, which, value) => {
    const num = input(key, which);
    await num.fill(String(value));
    await num.press("Enter");
  };
  const detail = async (fips) => {
    await page.locator("#search").click();
    await page.locator("#query").fill(fips);
    await page.locator("#query").press("Enter");
    const value = await page.locator(".detailval").innerText();
    const verdicts = await page
      .locator("#county-matches .match-status")
      .allInnerTexts();
    await page.locator("#close").click();
    return { value, verdicts: verdicts.join("\n") };
  };

  await catalog();
  assert.ok(
    await page.getByRole("heading", { name: /natural hazards/i }).isVisible(),
  );
  const search = page.locator("#catalog-search");
  for (const [term, key] of [
    ["tsunami", "TSUN_RISKS"],
    ["volcano", "VLCN_RISKS"],
    ["tornadoes", "TRND_RISKS"],
  ]) {
    await search.fill(term);
    assert.deepEqual(
      await page
        .locator("[data-pick]:visible")
        .evaluateAll((els) => els.map((el) => el.dataset.pick)),
      ["hazard"],
    );
    await search.press("Enter");
    const select = row(key).locator("[data-subtype]");
    assert.equal(await select.inputValue(), key, `Search for ${term}`);
    assert.deepEqual(
      (
        await select
          .locator("option")
          .evaluateAll((els) => els.map((el) => el.value))
      ).sort(),
      Object.keys(daneScores).sort(),
    );
    await drop(key);
    await catalog();
  }
  await pick("RISK_SCORE");
  let previous = "RISK_SCORE";
  for (const [key, expected] of Object.entries(daneScores)) {
    if (previous !== key) {
      await row(previous).locator("[data-subtype]").selectOption(key);
      assert.equal(await row(previous).count(), 0);
    }
    previous = key;
    await eye(key);
    assert.equal(await row(key).getByRole("slider").count(), 2, key);
    assert.equal(
      Number(await input(key, "min").getAttribute("step")),
      0.01,
      key,
    );
    const { value } = await detail("55025");
    if (expected === null) assert.match(value, /not applicable/i, key);
    else assert.equal(Number(value.match(/\d+(?:\.\d+)?/)?.[0]), expected, key);
  }
  await drop(previous);

  await catalog();
  await pick("HRCN_RISKS");
  await eye("HRCN_RISKS");
  await bound("HRCN_RISKS", "max", 0);
  assert.match(
    await page.locator("#legend-keys").innerText(),
    /not applicable/i,
  );
  const california = await detail("06037"),
    alaska = await detail("02020");
  assert.match(california.value, /^0(?:\D|$).*zero modeled loss/i);
  assert.match(california.verdicts, /\bmatch\b/i);
  assert.match(alaska.value, /not applicable/i);
  assert.match(alaska.verdicts, /\bmatch\b/i);
  assert.match((await detail("55025")).verdicts, /outside/i);
  const legacy = await detail("09001");
  assert.match(legacy.value, /no matching county boundary/i);
  assert.match(legacy.verdicts, /unknown|uncertain/i);

  await bound("HRCN_RISKS", "max", 29.17);
  await bound("HRCN_RISKS", "min", 0.01);
  assert.match((await detail("55025")).verdicts, /\bmatch\b/i);
  assert.match((await detail("02020")).verdicts, /outside/i);
  assert.match((await detail("06037")).verdicts, /outside/i);
  await catalog();
  await pick("RISK_SCORE");
  assert.ok(
    await row("RISK_SCORE")
      .locator("[data-subtype] option[value=HRCN_RISKS]")
      .isDisabled(),
  );
  assert.ok(
    await row("RISK_SCORE")
      .locator("[data-subtype] option[value=RISK_SCORE]")
      .isEnabled(),
  );
  await row("RISK_SCORE").locator(".switch").click();
  await eye("RISK_SCORE");
  await page.locator("#share").click();
  const share = await page.evaluate(() => navigator.clipboard.readText());
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("about:blank");
  await page.goto(share);
  await page.locator("#areas path").first().waitFor();
  assert.equal(await input("HRCN_RISKS", "min").inputValue(), "0.01");
  assert.equal(await input("HRCN_RISKS", "max").inputValue(), "29.17");
  assert.equal(
    await row("RISK_SCORE").locator(".switch").getAttribute("aria-checked"),
    "false",
  );
  assert.equal(
    await page.locator('[data-eye="RISK_SCORE"]').getAttribute("aria-pressed"),
    "true",
  );
  assert.match((await detail("55025")).verdicts, /\bmatch\b/i);

  await drop("HRCN_RISKS");
  await catalog();
  await pick("TSUN_RISKS");
  await eye("TSUN_RISKS");
  await bound("TSUN_RISKS", "max", 0);
  assert.match((await detail("55025")).verdicts, /\bmatch\b/i);
  const florida = await detail("12086");
  assert.match(florida.value, /insufficient/i);
  assert.match(florida.verdicts, /unknown|uncertain/i);
  assert.match((await detail("41007")).verdicts, /outside/i);
  // In overall-score view the fill distinguishes a matching inland county,
  // a known excluded county and both sources of uncertainty.
  await eye("RISK_SCORE");
  const fill = (fips) =>
    page.locator(`[data-uid="c${fips}"]`).getAttribute("fill");
  assert.match(await fill("55025"), /^#/);
  assert.notEqual(await fill("55025"), await fill("41007"));
  assert.equal(await fill("12086"), "url(#uncertain)");
  assert.equal(await fill("09001"), "url(#uncertain)");
}
