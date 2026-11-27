import assert from "node:assert/strict";

export async function checkReferenceMotion(page, base) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.clock.install();
  await page.goto(
    base +
      "?airports=0..80&hospitals=0..60&grocery=0..30&layer=grocery&extent=3,-900,-550",
  );
  for (const key of ["airports", "hospitals", "grocery"]) {
    await page
      .locator(`#reference-pins [data-key="${key}"] path`)
      .first()
      .waitFor();
  }
  await page.locator("#access-status").waitFor({ state: "hidden" });
  await page.evaluate(() => document.fonts.ready);
  const svg = page.locator("#map");
  const frame = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  await frame();
  const snapshot = () =>
    page.evaluateHandle(() => ({
      pin: document.querySelector("#reference-pins path"),
      town: document.querySelector("#reference-towns text"),
      transform: document.querySelector("#viewport").getAttribute("transform"),
    }));
  const checkHeld = async (before) => {
    const state = await before.evaluate(({ pin, town, transform }) => ({
      moved:
        transform !==
        document.querySelector("#viewport").getAttribute("transform"),
      pinHeld: pin.isConnected,
      townHeld: town.isConnected,
    }));
    assert.deepEqual(state, { moved: true, pinHeld: true, townHeld: true });
  };
  const checkReleased = async (before) => {
    await page.waitForFunction(({ pin }) => !pin.isConnected, before);
    assert.ok(await page.locator("#reference-pins path").count());
    await before.dispose();
  };
  const { x, y, width, height } = await svg.boundingBox();
  const cx = x + width / 2,
    cy = y + height / 2;
  await page.mouse.move(cx, cy);
  const pan = await snapshot();
  await page.mouse.down();
  await page.mouse.move(cx + 100, cy + 40, { steps: 5 });
  await frame();
  await checkHeld(pan);
  await page.mouse.up();
  await checkReleased(pan);

  // Advance input time explicitly so a busy runner cannot turn the gap
  // between two wheel events into the end of the gesture.
  await page.clock.pauseAt(
    new Date(await page.evaluate(() => Date.now() + 1000)),
  );
  const wheel = await snapshot();
  for (let i = 0; i < 4; i++) {
    await svg.dispatchEvent("wheel", {
      clientX: cx,
      clientY: cy,
      deltaY: -4,
      ctrlKey: true,
    });
    await page.clock.runFor(32);
    await checkHeld(wheel);
  }
  await page.clock.runFor(300);
  await checkReleased(wheel);
}
