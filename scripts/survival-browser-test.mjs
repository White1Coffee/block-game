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
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.addInitScript(() =>
    localStorage.setItem(
      "wildbrick-settings",
      JSON.stringify({ quality: "low", distance: 2 }),
    ),
  );
  await page.goto(process.env.TEST_URL || "http://127.0.0.1:8800", {
    waitUntil: "networkidle",
  });
  await page.locator("#new").click();
  await page.locator("[name=seed]").fill("survival-qa");
  await page.locator("[name=gamemode]").selectOption("survival");
  await page.locator("button[type=submit]").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.keyboard.press("Escape");
  await page.locator("#save").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#toast")?.textContent === "Wereld opgeslagen.",
  );
  // Deterministic arena fixture. This edits only this isolated test context's save.
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("wildbrick", 1);
        req.onsuccess = () => {
          const db = req.result,
            tx = db.transaction("worlds", "readwrite"),
            store = tx.objectStore("worlds"),
            get = store.getAll();
          get.onsuccess = () => {
            const s = get.result[0];
            s.position = [4.5, 40, 6.5];
            s.rotation = [0, 0];
            s.survival = { health: 20, hunger: 10, items: { 7: 4, 105: 2 } };
            s.hotbar = [7, 9, 103, 19, 100, 4, 2, 105, 104];
            s.changes = [];
            for (let z = -3; z <= 10; z++)
              for (let x = 0; x <= 8; x++) {
                s.changes.push({ x, y: 39, z, id: 2 });
                for (let y = 40; y < 59; y++)
                  s.changes.push({ x, y, z, id: 0 });
              }
            s.changes.push({ x: 4, y: 41, z: 3, id: 7 });
            store.put(s);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#load").click();
  await page.locator(".world-open").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.keyboard.press("F3");
  await page.keyboard.press("Space");
  await page.waitForTimeout(80);
  await page.keyboard.press("Space");
  await page.waitForTimeout(1000);
  await page.waitForFunction(() =>
    document.querySelector("#debug").textContent.includes("Op de grond"),
  );
  assert.doesNotMatch(
    await page.locator("#debug").innerText(),
    /Vliegen/,
    "Survival cannot fly",
  );
  await page.keyboard.press("KeyF");
  await page.waitForFunction(() =>
    document.querySelector("#vitals").textContent.includes("15 / 20"),
  );
  assert.match(
    await page.locator("#vitals").innerText(),
    /15 \/ 20/,
    "Food restores hunger",
  );
  await page.mouse.down();
  await page.waitForFunction(
    () => !document.querySelector("#mining-progress").hidden,
  );
  await page.waitForFunction(
    () => document.querySelector("#mining-progress").hidden,
    null,
    { timeout: 15000 },
  );
  await page.mouse.up();
  await page.keyboard.down("KeyW");
  await page.waitForFunction(
    () => document.querySelector('[data-slot="0"] small').textContent === "5",
    null,
    { timeout: 10000 },
  );
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(600);
  await page.keyboard.press("KeyE");
  assert.match(
    await page.locator('[data-area="inventory"][data-item="7"]').innerText(),
    /5/,
    "Mined log was picked up",
  );
  assert.equal(
    await page.locator("[data-craft-slot]").count(),
    4,
    "Player grid is 2×2",
  );
  const craft = async (id) => {
    if (!(await page.locator(".recipe-book").evaluate((el) => el.open)))
      await page.locator("summary").filter({ hasText: "Receptenboek" }).click();
    await page.locator(`[data-book="${id}"]`).click();
    await page.locator("#craft-output").click();
    await page.locator('[data-area="inventory"][data-index="0"]').click();
    if (await page.locator(".inventory-cursor").isVisible())
      await page
        .locator('[data-area="inventory"][data-item="0"]')
        .first()
        .click();
  };
  await craft("planks-7");
  await craft("planks-7");
  await craft("sticks-9");
  await craft("table-9");
  assert.match(await page.locator("#block-name").innerText(), /Werkbank/);
  await page.locator("#back").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.evaluate(() => {
    const e = new MouseEvent("mousemove");
    Object.defineProperties(e, {
      movementX: { value: 0 },
      movementY: { value: 350 },
    });
    document.dispatchEvent(e);
  });
  await page.waitForTimeout(150);
  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(250);
  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
  await page.locator("[data-craft-slot]").first().waitFor();
  assert.equal(
    await page.locator("[data-craft-slot]").count(),
    9,
    "Workbench opens a 3×3 grid",
  );
  await craft("planks-7");
  await craft("pick-0");
  assert.match(
    await page.locator("#block-name").innerText(),
    /Houten pikhouweel/,
  );
  await page.screenshot({ path: "test-results/survival-crafting.png" });
  await page.locator("#back").click();
  await page.keyboard.press("Escape");
  await page.locator("#save").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#toast")?.textContent === "Wereld opgeslagen.",
  );
  const data = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open("wildbrick", 1);
        req.onsuccess = () => {
          const db = req.result,
            r = db.transaction("worlds").objectStore("worlds").getAll();
          r.onsuccess = () => {
            db.close();
            resolve(r.result[0]);
          };
        };
      }),
  );
  assert.equal(data.mode, "survival");
  assert.equal(data.survival.items[100], 1);
  assert.equal(data.survival.items[19] ?? 0, 0);
  assert.ok(data.changes.some((c) => c.id === 19));
  assert.deepEqual(errors, []);
  console.log(
    "Survival browser QA passed: no flight, eating, timed mining, drops/pickup, finite resources, crafting, placing a workbench, station-gated tools and persistence.",
  );
} finally {
  await browser.close();
}
