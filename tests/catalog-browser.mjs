import assert from "node:assert/strict";

// Add a family through the picker, then choose its measure on the new card.
// Existing siblings can have independently edited ranges and must survive.
export async function pickMeasure(page, family, key) {
  const rows = page.locator(".filter-row[data-key]");
  const keys = () => rows.evaluateAll((els) => els.map((el) => el.dataset.key));
  const before = await keys();
  await page.locator(`[data-pick="${family}"]`).click();
  const added = (await keys()).filter((value) => !before.includes(value));
  assert.equal(added.length, 1, `Adding ${family} should insert one card`);
  if (added[0] !== key) {
    await page
      .locator(`[data-key="${added[0]}"] [data-subtype]`)
      .selectOption(key);
  }
  await page.locator(`[data-key="${key}"]`).waitFor();
  const after = await keys();
  for (const existing of before) assert.ok(after.includes(existing));
}
