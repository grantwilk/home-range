import assert from "node:assert/strict";

export async function checkCountyProfile(page, base) {
  const dialog = page.getByRole("dialog");
  const profile = dialog.locator("#county-profile");
  const matches = profile.locator("#county-matches");
  const groups = profile.locator("details[data-group]");
  const row = (id) => matches.locator(`[data-filter-id="${id}"]`);
  const close = () => page.locator("#close").click();
  const openCounty = async (fips) => {
    await page.locator("#search").click();
    await page.locator("#query").fill(fips);
    await page.locator(`#suggest [data-place="c${fips}"]`).click();
    await profile.waitFor();
  };
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(
    base + "?violentCrimeRate=0..0&janLow=-60..75&paused=janLow&layer=janLow",
  );
  // Zero is a real rate for Menominee. Kalawao has no published observation.
  // All three counties retain their full profile and the same match rows.
  for (const [fips, verdict, status] of [
    ["55078", "Matches Your Filters", "Match"],
    ["55025", "Outside Your Filters", "Outside"],
    ["15005", "Uncertain Match", "Unknown"],
  ]) {
    await openCounty(fips);
    assert.match(await matches.innerText(), new RegExp(verdict, "i"));
    assert.equal(
      await row("violentCrimeRate").locator(".match-status").innerText(),
      status,
    );
    assert.equal(await matches.locator(".match-row").count(), 1);
    assert.equal(await groups.count(), 4);
    assert.equal(await groups.locator("summary").first().isVisible(), true);
    if (status === "Match")
      assert.match(
        await row("violentCrimeRate").locator(".match-reading").innerText(),
        /^0\b/,
      );
    if (status === "Unknown")
      assert.doesNotMatch(
        await row("violentCrimeRate").locator(".match-reading").innerText(),
        /^0\b/,
      );
    await close();
  }

  await page.goto(base + "?janLow=10..11&hospitals=0..5&layer=janLow");
  await openCounty("55025");
  assert.equal(
    await row("janLow").locator(".match-status").innerText(),
    "Match",
  );
  assert.match(
    await row("janLow").locator(".match-reading").innerText(),
    /10\.8°F/,
  );
  assert.match(
    await row("janLow").locator(".match-range").innerText(),
    /10.*11/,
  );
  const local = row("hospitals");
  assert.equal(await local.count(), 1);
  assert.doesNotMatch(
    await local.locator(".match-reading").innerText(),
    /\d+(?:\.\d+)?\s*mi\b/,
  );
  assert.doesNotMatch(
    await local.locator(".match-status").innerText(),
    /^(match|outside)$/i,
  );
  assert.equal(
    await groups.evaluateAll((els) => els.every((el) => !el.open)),
    true,
  );
  assert.equal(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    true,
  );
  const weather = groups
    .filter({ has: page.locator("summary", { hasText: "Climate & Weather" }) })
    .first();
  await weather.locator("summary").first().focus();
  await page.keyboard.press("Enter");
  assert.equal(await weather.evaluate((el) => el.open), true);
  const hazards = groups
    .filter({ has: page.locator("summary", { hasText: "Natural Hazards" }) })
    .first();
  await hazards.locator("summary").first().tap();
  assert.equal(await hazards.evaluate((el) => el.open), true);
  assert.match(await hazards.innerText(), /Tornado/i);
  await close();

  await page.goto(base + "?filters=none");
  await openCounty("55025");
  assert.match(await matches.innerText(), /No Active Filters/i);
  assert.equal(await matches.locator(".match-row").count(), 0);
  assert.equal(await groups.count(), 4);
  await close();
}

export async function checkMonthlyClimate(page, base) {
  // Previous shares stored percentages. A saved 10–11% must not quietly become 10–11 g/m³.
  await page.goto(base + "?novHumidity=10..11&janLow=0..20&layer=novHumidity");
  await page.locator("dialog[open]").waitFor();
  assert.match(
    await page.locator("#dialog-body").innerText(),
    /relative humidity/i,
  );
  await page.locator("#close").click();
  const migrated = page.locator('[data-key="novAbsoluteHumidity"]');
  assert.equal(
    await migrated.locator(".switch").getAttribute("aria-checked"),
    "false",
  );
  assert.equal(
    await migrated.locator('.num[data-bound="min"]').inputValue(),
    "0",
  );
  assert.equal(
    await migrated.locator('.num[data-bound="max"]').inputValue(),
    "30",
  );
  assert.equal(
    await page
      .locator('[data-key="janLow"] .switch')
      .getAttribute("aria-checked"),
    "true",
  );
  assert.equal(new URL(page.url()).searchParams.has("novHumidity"), false);

  await page.goto(base + "?filters=none");
  const add = async (key) => {
    await page.locator("#add-filter").click();
    await page.locator('[data-pick="humidity"]').click();
    await page
      .locator(".filter-row")
      .last()
      .locator("[data-subtype]")
      .selectOption(key);
  };
  await add("novAbsoluteHumidity");
  const november = page.locator('[data-key="novAbsoluteHumidity"]');
  const upper = november.locator('.num[data-bound="max"]');
  await upper.fill("4");
  await upper.press("Tab");
  await add("julAbsoluteHumidity");
  await november.locator("[data-eye]").click();
  assert.equal(await november.getByRole("slider").count(), 2);
  assert.equal(await upper.inputValue(), "4");
  const share = new URL(page.url());
  assert.equal(share.searchParams.get("novAbsoluteHumidity"), "0..4");
  assert.equal(share.searchParams.get("layer"), "novAbsoluteHumidity");
  assert.ok(share.searchParams.has("julAbsoluteHumidity"));
  await page.reload();
  await page.locator("#search").click();
  await page.locator("#query").fill("04013");
  await page.locator('#suggest [data-place="c04013"]').click();
  const row = page.locator(
    '#county-matches [data-filter-id="novAbsoluteHumidity"]',
  );
  // A separate extraction of the Maricopa polygon from the native climate grid.
  const maricopaNovember = "5.8 g/m³";
  assert.equal(
    await row.locator(".match-reading").innerText(),
    maricopaNovember,
  );
  assert.equal(await row.locator(".match-status").innerText(), "Outside");
  const weather = page.locator(
    '#county-profile details[data-group="Climate & Weather"]',
  );
  await weather.locator("summary").click();
  const monthly = weather.getByRole("table").first();
  const novemberValues = monthly.getByRole("row").filter({
    has: page.getByRole("rowheader", { name: "Nov", exact: true }),
  });
  assert.equal(
    await novemberValues.getByRole("cell").last().innerText(),
    maricopaNovember,
  );
  const climateNote = monthly.locator("+ .profile-note");
  assert.match(await climateNote.innerText(), /1991–2020/);
  assert.match(
    await climateNote.innerText(),
    /grams of water vapor per cubic meter/i,
  );
  await page.locator("#close").click();

  // Hold one real November file in transit. The county modal should update
  // its results in place without closing the section the reader opened.
  const daysFile = "**/data/monthly-days/11.json.gz";
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(daysFile, async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.goto(
      base +
        "?novColdDays=0..3&novColdDays.cutoff=10&novRainfall=0..2&novWetDays=0..10&novCloudyDays=0..9&layer=novColdDays",
    );
    await page.locator("#search").click();
    await page.locator("#query").fill("55025");
    await page.locator('#suggest [data-place="c55025"]').click();
    const weather = page.locator(
      '#county-profile details[data-group="Climate & Weather"]',
    );
    await weather.locator("summary").click();
    release();
    const readings = page.locator("#county-matches");
    for (const [key, expected] of [
      ["novColdDays", "1 days/mo"],
      ["novRainfall", "1.9 in/mo"],
      ["novWetDays", "8.9 days/mo"],
      ["novCloudyDays", "7.3 days/mo"],
    ]) {
      const measurement = readings.locator(`[data-filter-id="${key}"]`);
      await measurement
        .locator(".match-reading")
        .filter({ hasText: expected })
        .waitFor();
      assert.equal(
        await measurement.locator(".match-reading").innerText(),
        expected,
      );
      assert.equal(
        await measurement.locator(".match-status").innerText(),
        "Match",
      );
    }
    assert.equal(await weather.evaluate((el) => el.open), true);
    const november = weather
      .locator("table")
      .last()
      .getByRole("row")
      .filter({
        has: page.getByRole("rowheader", { name: "Nov", exact: true }),
      });
    assert.deepEqual(await november.locator("td").allTextContents(), [
      "1.9 in",
      "8.9 days",
      "7.3 days",
    ]);
    await page.locator("#close").click();
  } finally {
    release();
    await page.unroute(daysFile);
  }
}
