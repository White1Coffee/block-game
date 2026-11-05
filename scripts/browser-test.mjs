import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

// Uses an existing Edge installation. BROWSER_PATH can point to Chrome/Chromium.
// Start npm run dev (or npm run preview) first; TEST_URL overrides the origin.
const browser = await chromium.launch({
  ...(process.env.BROWSER_PATH
    ? { executablePath: process.env.BROWSER_PATH }
    : { channel: "msedge" }),
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mkdir("test-results", { recursive: true });
  await page.goto(process.env.TEST_URL || "http://127.0.0.1:8800/", {
    waitUntil: "networkidle",
  });
  await page.locator("#new").waitFor();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "test-results/menu.png" });
  await page.locator("#new").click();
  await page.locator("[name=name]").fill("Browser QA");
  await page.locator("[name=seed]").fill("wildbrick-browser-qa");
  await page.locator("button[type=submit]").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.waitForTimeout(3000);
  await page.keyboard.press("F3");
  await page.waitForFunction(() =>
    /Chunks [1-9]/.test(document.querySelector("#debug").textContent),
  );
  assert.match(await page.locator("#debug").innerText(), /Chunks [1-9]/);
  const coords = async () => {
    const text = await page.locator("#debug").innerText();
    return text
      .match(/XYZ ([\d.-]+) \/ ([\d.-]+) \/ ([\d.-]+)/)
      .slice(1)
      .map(Number);
  };
  const before = await coords();
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(600);
  await page.keyboard.up("KeyW");
  const after = await coords();
  assert.ok(
    Math.hypot(after[0] - before[0], after[2] - before[2]) > 0.5,
    "W moves the player",
  );
  await page.keyboard.press("Space");
  await page.waitForTimeout(100);
  await page.keyboard.press("Space");
  await page.waitForTimeout(150);
  assert.match(await page.locator("#debug").innerText(), /Vliegen/);
  await page.keyboard.down("Space");
  await page.waitForTimeout(300);
  await page.keyboard.up("Space");
  await page.keyboard.press("Space");
  await page.waitForTimeout(80);
  await page.keyboard.press("Space");
  await page.waitForTimeout(1000);
  // Look toward the ground; actual pointer-lock mouse movement drives pitch.
  await page.evaluate(() => {
    const event = new MouseEvent("mousemove");
    Object.defineProperties(event, {
      movementX: { value: 0 },
      movementY: { value: 400 },
    });
    document.dispatchEvent(event);
  });
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/gameplay.png" });
  await page.keyboard.press("KeyE");
  await page.locator('[data-block="18"]').click();
  await page.locator('[data-area="inventory"][data-index="0"]').click();
  assert.match(await page.locator("#block-name").innerText(), /Baksteen/);
  await page.keyboard.press("KeyE");
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.keyboard.press("Escape");
  await page.locator("#save").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#toast")?.textContent === "Wereld opgeslagen.",
  );
  const saved = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("wildbrick", 1);
        req.onsuccess = () => {
          const db = req.result;
          const r = db.transaction("worlds").objectStore("worlds").getAll();
          r.onsuccess = () => {
            db.close();
            resolve(r.result);
          };
          r.onerror = () => reject(r.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
  assert.equal(saved.length, 1);
  assert.equal(saved[0].seed, "wildbrick-browser-qa");
  assert.equal(saved[0].hotbar[0], 18);
  assert.ok(
    saved[0].changes.some((c) => c.id === 0),
    "Mining stores an air edit",
  );
  assert.ok(
    saved[0].changes.some((c) => c.id !== 0),
    "Placement stores a block edit",
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#load").click();
  await page.locator(".world-open").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  assert.equal(await page.locator("#block-name").innerText(), "Baksteen");
  await page.keyboard.press("Escape");
  await page.locator("#home").click();
  await page.locator("#new").waitFor();
  // A full/blocked database must report an error without breaking gameplay.
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("Test quota reached", "QuotaExceededError");
    };
  });
  await page.locator("#new").click();
  await page.locator("button[type=submit]").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#toast")
      ?.textContent?.startsWith("Opslaan mislukt."),
  );
  await page.keyboard.press("Escape");
  await page.locator("#save").click();
  await page.waitForTimeout(150);
  assert.deepEqual(errors, [], "No unhandled browser errors");
  console.log(
    "Browser QA passed: menu, world creation, movement, flight, mining, placement, inventory, IndexedDB save/reload and storage failure handling.",
  );
} finally {
  await browser.close();
}
