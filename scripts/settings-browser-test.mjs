import { chromium } from "playwright-core";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  ...(process.env.BROWSER_PATH
    ? { executablePath: process.env.BROWSER_PATH }
    : { channel: "msedge" }),
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const url = process.env.TEST_URL || "http://127.0.0.1:8800";
  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator("#settings").click();
  await page.locator("#graphics").selectOption("low");
  await page.locator("#volume").evaluate((el) => {
    el.value = ".2";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page
    .locator("summary")
    .filter({ hasText: "Toetsen aanpassen" })
    .click();
  await page.locator('[data-binding="KeyW"]').click();
  await page.keyboard.press("KeyG");
  assert.equal(
    await page.locator('[data-binding="KeyW"] kbd').textContent(),
    "KeyG",
  );
  await page.locator("#back").click();
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#settings").click();
  assert.equal(await page.locator("#graphics").inputValue(), "low");
  assert.equal(Number(await page.locator("#volume").inputValue()), 0.2);
  assert.equal(
    await page.locator('[data-binding="KeyW"] kbd').textContent(),
    "KeyG",
  );
  await page.locator("#back").click();
  await page.locator("#new").click();
  await page.locator("[name=height]").selectOption("128");
  await page.locator("[name=seed]").fill("whitebrick-settings-qa");
  await page.locator("button[type=submit]").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.waitForTimeout(1500);
  await page.keyboard.press("F3");
  await page.waitForFunction(() =>
    document.querySelector("#debug").textContent.includes("XYZ"),
  );
  const coords = async () =>
    (await page.locator("#debug").innerText())
      .match(/XYZ ([\d.-]+) \/ ([\d.-]+) \/ ([\d.-]+)/)
      .slice(1)
      .map(Number);
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  await page.keyboard.down("ControlLeft");
  await page.keyboard.down("Space");
  await page.waitForFunction(
    () => {
      const text = document.querySelector("#debug").textContent;
      const match = text.match(/XYZ [\d.-]+ \/ ([\d.-]+)/);
      return text.includes("Vliegen") && Number(match?.[1]) > 70;
    },
    null,
    { timeout: 20000 },
  );
  await page.keyboard.up("Space");
  await page.keyboard.up("ControlLeft");
  const before = await coords();
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(300);
  await page.keyboard.up("KeyW");
  const unmoved = await coords();
  assert.ok(
    Math.abs(unmoved[2] - before[2]) < 0.1,
    "Old binding no longer moves",
  );
  await page.keyboard.down("KeyG");
  await page.waitForFunction((start) => {
    const m = document
      .querySelector("#debug")
      .textContent.match(/XYZ [\d.-]+ \/ [\d.-]+ \/ ([\d.-]+)/);
    return Math.abs(Number(m?.[1]) - start) > 0.6;
  }, before[2]);
  await page.keyboard.up("KeyG");
  assert.ok(
    Math.abs((await coords())[2] - before[2]) > 0.4,
    "New binding moves",
  );
  await page.keyboard.down("ControlLeft");
  await page.keyboard.down("KeyG");
  await page.waitForFunction(
    (start) => {
      const match = document
        .querySelector("#debug")
        .textContent.match(/XYZ [\d.-]+ \/ [\d.-]+ \/ ([\d.-]+)/);
      return Math.abs(Number(match?.[1]) - start) > 40;
    },
    before[2],
    { timeout: 15000 },
  );
  await page.keyboard.up("KeyG");
  await page.keyboard.up("ControlLeft");
  await page.waitForTimeout(1000);
  const debug = await page.locator("#debug").innerText();
  assert.ok(
    Math.abs((await coords())[2] - before[2]) > 32,
    `Crossed multiple chunk boundaries: ${debug}`,
  );
  const count = Number(debug.match(/Chunks (\d+)/)[1]);
  assert.ok(count > 10 && count <= 121, "Streaming bounds loaded chunk meshes");
  await page.keyboard.press("Escape");
  await page.locator("#save").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#toast")?.textContent === "Wereld opgeslagen.",
  );
  // High-altitude positions remain valid when a 128-block world is reloaded.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const r = indexedDB.open("wildbrick", 1);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("worlds", "readwrite"),
            store = tx.objectStore("worlds"),
            get = store.getAll();
          get.onsuccess = () => {
            const save = get.result[0];
            save.position = [8, 110, 8];
            save.flying = true;
            store.put(save);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#load").click();
  await page.locator(".world-open").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.keyboard.press("F3");
  await page.waitForFunction(() =>
    document.querySelector("#debug").textContent.includes("XYZ"),
  );
  assert.ok((await coords())[1] > 109, "Reload did not reset altitude");
  assert.deepEqual(errors, []);
  console.log(
    "Settings browser QA passed: quality/volume/bindings persistence, remapped controls, 128-block world, chunk streaming/unloading and high-altitude reload.",
  );
} finally {
  await browser.close();
}
