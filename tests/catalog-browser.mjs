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
      .locator(`.filter-row[data-key="${added[0]}"] [data-subtype]`)
      .selectOption(key);
  }
  await page.locator(`.filter-row[data-key="${key}"]`).waitFor();
  const after = await keys();
  for (const existing of before) assert.ok(after.includes(existing));
}

export async function checkCatalogLayout(page, base) {
  await page.goto(base);
  await page.locator("#areas path").first().waitFor();
  await page.locator("#add-filter").click();
  const search = page.locator("#catalog-search");
  const sections = page.locator("#catalog-options section");
  for (const width of [1280, 700, 699, 390]) {
    await page.setViewportSize({ width, height: 740 });
    for (const term of ["", "proximity"]) {
      await search.fill(term);
      const boxes = await sections.evaluateAll((groups) =>
        groups.map((group) => {
          const heading = group.firstElementChild.getBoundingClientRect();
          const buttons = [...group.querySelectorAll("button")].map((el) =>
            el.getBoundingClientRect(),
          );
          return {
            x: heading.x,
            y: heading.y,
            bottom: buttons.at(-1).bottom,
            heights: buttons.map((b) => b.height),
          };
        }),
      );
      if (width >= 700) {
        const columns = Map.groupBy(boxes, (box) => box.x);
        assert.equal(columns.size, 2);
        const [left, right] = [...columns.values()];
        assert.ok(Math.abs(left[0].y - right[0].y) < 1);
        assert.ok(Math.abs(left.at(-1).bottom - right.at(-1).bottom) < 1);
        for (const { heights } of boxes)
          assert.ok(Math.max(...heights) - Math.min(...heights) < 1);
      } else {
        assert.equal(new Set(boxes.map((box) => box.x)).size, 1);
        boxes.slice(1).forEach((box, i) => assert.ok(box.y >= boxes[i].bottom));
      }
    }
    await search.fill("earthquake");
    assert.equal(await sections.count(), 1);
    const result = await sections.boundingBox();
    const field = await search.boundingBox();
    assert.ok(Math.abs(result.width - field.width) < 1);
  }
  await search.fill("xyz-nomatch");
  await page.locator("#catalog-empty").waitFor();
  await page.locator("#close").click();
}
