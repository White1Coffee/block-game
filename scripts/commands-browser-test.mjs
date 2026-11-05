import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
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
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.TEST_URL || "http://127.0.0.1:8800/", {
    waitUntil: "networkidle",
  });
  await page.locator("#new").click();
  await page.locator("[name=name]").fill("Commands QA");
  await page.locator("[name=seed]").fill("commands-qa");
  await page.locator("button[type=submit]").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.waitForTimeout(1000);
  const saved = () =>
    page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const r = indexedDB.open("wildbrick", 1);
          r.onsuccess = () => {
            const db = r.result,
              q = db.transaction("worlds").objectStore("worlds").getAll();
            q.onsuccess = () => {
              db.close();
              resolve(q.result.filter((s) => !s.backupOf)[0]);
            };
            q.onerror = () => reject(q.error);
          };
        }),
    );
  // Chromium rate-limits pointer-lock requests; pace repeated open/close automation.
  const command = async (text) => {
    console.log(text);
    await page.keyboard.press("/");
    await page.locator("#chat-input").fill(text);
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => !document.querySelector("#chat").classList.contains("open"),
    );
    try {
      await page.waitForFunction(
        () => !!document.pointerLockElement,
        undefined,
        { timeout: 5000 },
      );
    } catch (e) {
      console.log(
        await page.evaluate(() => ({
          panel: document.querySelector("#panel").textContent,
          chat: document.querySelector("#chat").textContent,
          toast: document.querySelector("#toast").textContent,
          focus: document.activeElement?.tagName,
        })),
      );
      throw e;
    }
    await page.waitForTimeout(1100);
  };
  await page.keyboard.press("F3");
  await page.waitForTimeout(250);
  await page.keyboard.press("KeyT");
  assert.equal(await page.locator("#chat-input").inputValue(), "");
  assert.equal(
    await page.evaluate(() => document.pointerLockElement === null),
    true,
  );
  const before = await page.locator("#debug").innerText();
  await page.keyboard.type("wasd test");
  await page.waitForTimeout(250);
  assert.equal(
    await page
      .locator("#debug")
      .innerText()
      .then((t) => t.match(/XYZ.*\n/)[0]),
    before.match(/XYZ.*\n/)[0],
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !!document.pointerLockElement);
  assert.match(
    await page.locator(".chat-messages").innerText(),
    /<Player> wasd test/,
  );
  await page.keyboard.press("/");
  assert.equal(await page.locator("#chat-input").inputValue(), "/");
  await page.keyboard.type("gamemode spec");
  await page.keyboard.press("Tab");
  assert.equal(
    await page.locator("#chat-input").inputValue(),
    "/gamemode spectator ",
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !!document.pointerLockElement);
  assert.equal((await saved()).mode, "spectator");
  await page.keyboard.down("ShiftLeft");
  await page.waitForTimeout(400);
  await page.keyboard.up("ShiftLeft");
  await page.keyboard.press("/");
  await page.keyboard.press("ArrowUp");
  assert.equal(
    (await page.locator("#chat-input").inputValue()).trim(),
    "/gamemode spectator",
  );
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.locator("#chat-input").inputValue(), "/");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !!document.pointerLockElement);
  assert.equal(await page.locator("#panel").isVisible(), false);
  for (const mode of [
    "adventure",
    "survival",
    "creative",
    "0",
    "1",
    "2",
    "3",
  ]) {
    await command("/gamemode " + mode);
    assert.equal(
      (await saved()).mode,
      { 0: "survival", 1: "creative", 2: "adventure", 3: "spectator" }[mode] ??
        mode,
    );
  }
  const initialStock = (await saved()).survival.items;
  for (const text of [
    "/give diamond 64",
    "/give minecraft:diamond 64",
    "/give @s stone 32",
    "/give Player iron_ingot 32",
    "/give oak_planks 64",
    "/give diamond_pickaxe 1",
  ])
    await command(text);
  let state = await saved();
  assert.equal(state.survival.items[113], 128);
  assert.equal(state.survival.items[3], (initialStock[3] ?? 0) + 32);
  assert.equal(state.survival.items[216], 1);
  for (const text of [
    "/summon cow",
    "/summon zombie",
    "/summon skeleton ~ ~1 ~",
  ])
    await command(text);
  state = await saved();
  assert.ok(state.mobs.some((m) => m.kind === "cow"));
  assert.ok(state.mobs.some((m) => m.kind === "hollow"));
  assert.ok(state.mobs.some((m) => m.kind === "bonewalker"));
  assert.equal(new Set(state.mobs.map((m) => m.id)).size, state.mobs.length);
  for (const text of [
    "/gamerule keepInventory true",
    "/gamerule doDaylightCycle false",
    "/gamerule doWeatherCycle false",
    "/gamerule doMobSpawning false",
    "/gamerule randomTickSpeed 10",
    "/gamerule naturalRegeneration false",
    "/gamerule doMobLoot false",
    "/gamerule doTileDrops false",
    "/gamerule mobGriefing false",
    "/gamerule doFireTick false",
  ])
    await command(text);
  const frozen = await saved();
  await page.waitForTimeout(1500);
  await command("/give stick");
  state = await saved();
  assert.equal(state.day, frozen.day);
  assert.equal(state.weather.remaining, frozen.weather.remaining);
  assert.equal(state.rules.randomTickSpeed, 10);
  assert.equal(state.rules.keepInventory, true);
  const inventory = JSON.stringify(state.survival.items);
  for (const text of [
    "/not_a_command",
    "/give not_an_item",
    "/give diamond -1",
    "/summon not_a_mob",
    "/gamerule not_a_rule true",
    "/gamerule keepInventory yes",
  ])
    await command(text);
  assert.equal(JSON.stringify((await saved()).survival.items), inventory);
  assert.ok((await page.locator(".chat-message.error").count()) > 0);
  await command("/gamemode survival");
  await page.keyboard.press("KeyE");
  assert.equal(
    await page.locator('.inventory-slot[data-item="113"]').count(),
    2,
  );
  assert.deepEqual(
    await page
      .locator('.inventory-slot[data-item="113"] small')
      .allTextContents(),
    ["64", "64"],
  );
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !!document.pointerLockElement);
  await command("/gamemode spectator");
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#load").click();
  await page.locator(".world-open").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  assert.equal(await page.locator(".mode").innerText(), "SPECTATOR");
  await command("/gamerule randomTickSpeed");
  assert.match(
    await page.locator(".chat-messages").innerText(),
    /randomTickSpeed = 10/,
  );
  assert.equal((await saved()).survival.items[113], 128);
  await command("/give diamond 999999");
  state = await saved();
  const slots = Object.entries(state.survival.items).reduce(
    (sum, [id, n]) =>
      sum +
      Math.ceil(
        n /
          (Number(id) >= 200 ||
          [100, 101, 102, 104, 116, 131].includes(Number(id))
            ? 1
            : 64),
      ),
    0,
  );
  assert.equal(slots, 36);
  const full = JSON.stringify(state.survival.items);
  await command("/give diamond");
  assert.equal(JSON.stringify((await saved()).survival.items), full);
  // Persist a schema-3 fixture, load it through the actual menu, and verify its atomic migration backup.
  await page.keyboard.press("Escape");
  await page.locator("#home").click();
  await page.waitForSelector("#new");
  state = await saved();
  state.schemaVersion = 3;
  delete state.rules.doFireTick;
  await page.evaluate(
    (save) =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("wildbrick", 1);
        r.onsuccess = () => {
          const db = r.result,
            t = db.transaction("worlds", "readwrite");
          t.objectStore("worlds").put(save);
          t.oncomplete = () => {
            db.close();
            resolve();
          };
          t.onerror = () => reject(t.error);
        };
      }),
    state,
  );
  await page.locator("#load").click();
  await page.locator(".world-open").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await command("/gamerule doFireTick");
  assert.match(
    await page.locator(".chat-messages").innerText(),
    /doFireTick = true/,
  );
  const backup = await page.evaluate(
    (id) =>
      new Promise((resolve) => {
        const r = indexedDB.open("wildbrick", 1);
        r.onsuccess = () => {
          const db = r.result,
            q = db
              .transaction("worlds")
              .objectStore("worlds")
              .get("backup:" + id);
          q.onsuccess = () => {
            db.close();
            resolve(q.result);
          };
        };
      }),
    state.id,
  );
  assert.equal(backup.schemaVersion, 3);
  assert.equal(backup.rules.doFireTick, undefined);
  assert.equal((await saved()).schemaVersion, 5);
  await page.keyboard.press("/");
  await page.keyboard.type("gamerule ");
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/commands.png" });
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  console.log(
    "Commands browser QA passed: focus, controls, history, completion, all modes, items, real mobs, rules, overflow, reload and migration backup.",
  );
} finally {
  await browser.close();
}
