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
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(() =>
    localStorage.setItem(
      "wildbrick-settings",
      JSON.stringify({ quality: "low", distance: 2, maxMobs: 4, music: 0 }),
    ),
  );
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      /Shader Error|VALIDATE_STATUS|THREE.WebGLProgram/.test(m.text())
    )
      errors.push(m.text());
  });
  await mkdir("test-results", { recursive: true });
  await page.goto(process.env.TEST_URL || "http://127.0.0.1:8800", {
    waitUntil: "networkidle",
  });
  assert.match(await page.title(), /WhiteBrick/);
  await page.locator("#new").click();
  await page.locator("[name=gamemode]").selectOption("survival");
  await page.locator("button[type=submit]").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.keyboard.press("Escape");
  await page.locator("#save").click();
  await page.waitForFunction(
    () => document.querySelector("#toast").textContent === "Wereld opgeslagen.",
  );
  const read = () =>
    page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const r = indexedDB.open("wildbrick", 1);
          r.onsuccess = () => {
            const db = r.result,
              q = db.transaction("worlds").objectStore("worlds").getAll();
            q.onsuccess = () => {
              db.close();
              resolve(q.result[0]);
            };
            q.onerror = () => reject(q.error);
          };
        }),
    );
  const write = (data) =>
    page.evaluate(
      (save) =>
        new Promise((resolve, reject) => {
          const r = indexedDB.open("wildbrick", 1);
          r.onsuccess = () => {
            const db = r.result,
              tx = db.transaction("worlds", "readwrite");
            tx.objectStore("worlds").put(save);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
      data,
    );
  const load = async () => {
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("#load").click();
    await page.locator(".world-open").click();
    await page.waitForFunction(() => !!document.pointerLockElement);
    await page.keyboard.press("F3");
    await page.waitForFunction(() =>
      document.querySelector("#debug").textContent.includes("Look"),
    );
  };
  const save = async () => {
    if (await page.locator("#back").count())
      await page.locator("#back").click();
    await page.waitForFunction(() => !!document.pointerLockElement);
    await page.keyboard.press("Escape");
    await page.locator("#save").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#toast").textContent === "Wereld opgeslagen.",
    );
    return read();
  };
  let data = await read();
  data.rules = { keepInventory: true, difficulty: "peaceful", dayLength: 1200 };
  data.position = [4.5, 40, 7.5];
  data.rotation = [0, 0];
  data.survival = {
    health: 20,
    hunger: 10,
    saturation: 0,
    xp: 700,
    items: {
      7: 4,
      9: 32,
      103: 12,
      13: 3,
      110: 3,
      111: 10,
      100: 1,
      200: 1,
      117: 5,
      119: 2,
      131: 1,
    },
  };
  data.hotbar = [100, 200, 117, 58, 62, 20, 65, 116, 119];
  data.changes = [];
  for (let x = 0; x <= 12; x++)
    for (let z = -3; z <= 12; z++) {
      data.changes.push({ x, y: 39, z, id: 2 });
      for (let y = 40; y < 59; y++) data.changes.push({ x, y, z, id: 0 });
    }
  for (const [x, y, z, id] of [
    [2, 40, 5, 62],
    [6, 40, 5, 20],
    [4, 40, 3, 19],
    [8, 39, 5, 50],
    [8, 40, 5, 67],
    [9, 39, 5, 11],
    [10, 40, 5, 65],
  ])
    data.changes.push({ x, y, z, id });
  data.blockEntities = {
    chests: { "2,40,5": Array(27).fill(null) },
    furnaces: {},
    crops: { "8,40,5": { age: 39, stage: 1 } },
  };
  data.mobs = [];
  data.weather = { kind: "clear", remaining: 300, cycle: 0 };
  await write(data);
  await load();
  let yaw = 0,
    pitch = 0;
  const aim = async (x, y, z) => {
    await page.waitForTimeout(120);
    const debug = await page.locator("#debug").innerText(),
      look = debug.match(/Look ([\d.-]+) \/ ([\d.-]+)/),
      pos = debug.match(/XYZ ([\d.-]+) \/ ([\d.-]+) \/ ([\d.-]+)/);
    assert.ok(look, "Look direction is available");
    yaw = Number(look[1]);
    pitch = Number(look[2]);
    const dx = x - Number(pos[1]),
      dy = y - Number(pos[2]) - 1.62,
      dz = z - Number(pos[3]),
      ny = Math.atan2(-dx, -dz),
      np = Math.atan2(dy, Math.hypot(dx, dz));
    await page.evaluate(
      ([mx, my]) => {
        const e = new MouseEvent("mousemove");
        Object.defineProperties(e, {
          movementX: { value: mx },
          movementY: { value: my },
        });
        document.dispatchEvent(e);
      },
      [-(ny - yaw) / 0.002, -(np - pitch) / 0.002],
    );
    await page.waitForFunction(
      ([y, p]) => {
        const m = document
          .querySelector("#debug")
          .textContent.match(/Look ([\d.-]+) \/ ([\d.-]+)/);
        return (
          m &&
          Math.abs(Number(m[1]) - y) < 0.005 &&
          Math.abs(Number(m[2]) - p) < 0.005
        );
      },
      [ny, np],
    );
    yaw = ny;
    pitch = np;
  };
  const right = async () => {
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
  };
  await page.keyboard.press("KeyE");
  assert.equal(await page.locator("[data-craft-slot]").count(), 4);
  await page.locator("summary").filter({ hasText: "Receptenboek" }).click();
  await page.locator('[data-book="table-9"]').click();
  await page.locator("#craft-output").click();
  await page.locator('[data-area="inventory"][data-index="0"]').click();
  if (await page.locator(".inventory-cursor").isVisible())
    await page
      .locator('[data-area="inventory"][data-item="0"]')
      .first()
      .click();
  assert.match(await page.locator("#block-name").innerText(), /Werkbank/);
  await page.locator("#back").click();
  await aim(4.5, 40.5, 3.5);
  await right();
  assert.equal(await page.locator("[data-craft-slot]").count(), 9);
  await page.locator("summary").filter({ hasText: "Receptenboek" }).click();
  await page.locator('[data-book="pick-2"]').click();
  await page.locator("#craft-output").click();
  await page.locator('[data-area="inventory"][data-index="0"]').click();
  if (await page.locator(".inventory-cursor").isVisible())
    await page
      .locator('[data-area="inventory"][data-item="0"]')
      .first()
      .click();
  assert.match(
    await page.locator("#block-name").innerText(),
    /IJzeren pikhouweel/,
  );
  await page.locator("#back").click();
  await aim(2.5, 40.5, 5.5);
  await right();
  await page.screenshot({ path: "test-results/whitebrick-open-chest.png" });
  await page.locator('[data-area="inventory"][data-item="7"]').click();
  await page.locator('[data-container="0"]').click({ button: "right" });
  assert.equal(
    await page.locator('[data-container="0"] img').getAttribute("alt"),
    "Eikenstam",
  );
  await page.locator("#back").click();
  await aim(6.5, 40.5, 5.5);
  await right();
  await page.locator('[data-area="inventory"][data-item="13"]').click();
  await page.locator('[data-container="0"]').click({ button: "right" });
  await page.locator('[data-area="inventory"][data-item="110"]').click();
  await page.locator('[data-container="1"]').click({ button: "right" });
  if (await page.locator(".inventory-cursor").isVisible())
    await page
      .locator('[data-area="inventory"][data-item="0"]')
      .first()
      .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-container="2"] img')
        ?.getAttribute("alt") === "IJzerstaaf",
    null,
    { timeout: 30000 },
  );
  await page.locator('[data-container="2"]').click();
  await page.screenshot({ path: "test-results/whitebrick-furnace.png" });
  data = await save();
  assert.equal(data.blockEntities.chests["2,40,5"][0].id, 7);
  assert.equal(data.blockEntities.furnaces["6,40,5"].input, null);
  assert.equal(data.blockEntities.crops["8,40,5"].stage, 2);
  assert.ok(data.survival.xp >= 702);
  assert.equal(data.schemaVersion, 5);
  // Verify migrated records and interactive state survive a full reload.
  await load();
  yaw = 0;
  pitch = 0; // Stored view is restored; set a known view through an explicit save fixture.
  data = await save();
  data.position = [4.5, 40, 7.5];
  data.rotation = [0, 0];
  await write(data);
  await load();
  yaw = 0;
  pitch = 0;
  await aim(2.5, 40.5, 5.5);
  await right();
  assert.equal(
    await page.locator('[data-container="0"] img').getAttribute("alt"),
    "Eikenstam",
  );
  await page.locator('[data-container="0"]').click();
  assert.equal(await page.locator('[data-container="0"] img').count(), 0);
  await page.locator("#back").click();
  // The weather selection affects the saved simulation, not just the menu.
  await page.keyboard.press("Escape");
  await page.locator("#settings").click();
  await page.locator("#weather").selectOption("thunder");
  await page.locator("#back").click();
  await page.locator("#save").click();
  await page.waitForFunction(
    () => document.querySelector("#toast").textContent === "Wereld opgeslagen.",
  );
  data = await read();
  assert.equal(data.weather.kind, "thunder");
  // Deterministic combat fixture: a low-health animal in melee range.
  data.rules.difficulty = "normal";
  data.position = [4.5, 40, 7.5];
  data.rotation = [0, 0];
  data.hotbar[0] = 201;
  data.survival.items[201] = 1;
  data.survival.slotInventory.slots[0]={id:201,count:1};
  data.mobs = [
    {
      id: "combat-cow",
      kind: "cow",
      state: "Idle",
      x: 4.5,
      y: 40,
      z: 5.2,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: 0,
      health: 2,
      timer: 100,
      cooldown: 0,
      hurt: 0,
      pathTimer: 0,
      age: 0,
      fuse: 0,
    },
  ];
  await write(data);
  await load();
  yaw = 0;
  pitch = 0;
  await aim(4.5, 40.9, 5.2);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(900);
  await page.screenshot({ path: "test-results/whitebrick-combat.png" });
  data = await save();
  assert.ok(!data.mobs.some((m) => m.id === "combat-cow" && m.health > 0));
  assert.ok(
    data.drops.some((d) => d.id === 121),
    "Combat produces real loot",
  );
  // Environmental damage and keepInventory respawn, with a safe spawnpoint.
  data.survival.health = 1;
  data.position = [4.5, 40, 7.5];
  data.rotation = [0, 0];
  data.spawnpoint = [8.5, 40, 8.5];
  data.changes = data.changes.filter(
    (c) => !(c.x === 4 && c.y === 40 && c.z === 7),
  );
  data.changes.push({ x: 4, y: 40, z: 7, id: 23 });
  data.mobs = [];
  await write(data);
  await load();
  await page.locator("#respawn").waitFor({ timeout: 15000 });
  assert.match(await page.locator("h1").innerText(), /You Died/);
  await page.screenshot({ path: "test-results/whitebrick-death.png" });
  await page.locator("#respawn").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  data = await save();
  assert.equal(data.survival.health, 20);
  assert.equal(data.survival.items[201], 1);
  assert.deepEqual(errors, []);
  console.log(
    "WhiteBrick expansion QA passed: 2×2/3×3 crafting, tool tiers, chest transfer/reload, timed fuel-based smelting, crops, XP, weather persistence, combat loot, lava damage and keepInventory respawn; no shader/runtime errors.",
  );
} finally {
  await browser.close();
}
