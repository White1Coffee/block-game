import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { ServerWorld } from "../server/ServerWorld.ts";
import { defaults } from "../server/ServerConfig.ts";
await mkdir(".lan-test", { recursive: true });
const root = await mkdtemp(resolve(".lan-test", "inventory-")),
  port = 18810,
  url = "http://127.0.0.1:" + port;
const world = await ServerWorld.open(defaults, root);
world.data.spawnpoint = [8.5, 61, 8.5];
world.data.rules.doMobSpawning = false;
for (let x = 5; x <= 12; x++)
  for (let z = 4; z <= 11; z++) {
    world.world.set(x, 60, z, 3);
    for (let y = 61; y < 65; y++) world.world.set(x, y, z, 0);
  }
world.world.set(8, 62, 6, 62);
world.entities.chest("8,62,6")[0] = { id: 113, count: 16 };
await world.save();
world.dispose();
let logs = "",
  browser;
const server = spawn(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "server/index.ts"],
  {
    env: { ...process.env, PORT: String(port), WHITEBRICK_DATA_ROOT: root },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  },
);
server.stdout.on("data", (b) => (logs += b));
server.stderr.on("data", (b) => (logs += b));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  for (let i = 0; !logs.includes("Server status: ONLINE"); i++) {
    if (i > 100 || server.exitCode !== null) throw Error(logs);
    await delay(100);
  }
  browser = await chromium.launch({
    channel: "msedge",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  const contexts = [];
  for (let i = 0; i < 2; i++) {
    const c = await browser.newContext({
      viewport: { width: 1280, height: 960 },
    });
    await c.addInitScript(() => {
      localStorage.setItem(
        "wildbrick-settings",
        JSON.stringify({ quality: "low", distance: 2, volume: 0, music: 0 }),
      );
      window.netMessages = [];
      const W = WebSocket;
      window.WebSocket = class extends W {
        constructor(...args) {
          super(...args);
          if (String(args[0]).includes("whitebrick")) {
            window.netSocket = this;
            this.addEventListener("message", (e) =>
              window.netMessages.push(JSON.parse(e.data)),
            );
          }
        }
      };
    });
    contexts.push(c);
  }
  const a = await contexts[0].newPage(),
    b = await contexts[1].newPage(),
    errors = [];
  for (const p of [a, b]) p.on("pageerror", (e) => errors.push(e.message));
  const slot = (p, n) =>
    p.locator(`[data-area="inventory"][data-index="${n}"]`);
  const craft = (p, n) => p.locator(`[data-area="craft"][data-index="${n}"]`);
  const cursorId = (p) =>
    p.locator(".inventory-cursor img").getAttribute("alt");
  const readSP = (p) =>
    p.evaluate(
      () =>
        new Promise((resolve) => {
          const r = indexedDB.open("wildbrick", 1);
          r.onsuccess = () => {
            const db = r.result,
              q = db.transaction("worlds").objectStore("worlds").getAll();
            q.onsuccess = () => {
              db.close();
              resolve(q.result.filter((s) => !s.backupOf)[0]);
            };
          };
        }),
    );
  await a.goto(url, { waitUntil: "networkidle" });
  await a.locator("#new").click();
  await a.locator("[name=name]").fill("Slot inventory QA");
  await a.locator("button[type=submit]").click();
  await a.waitForFunction(() => !!document.pointerLockElement);
  await a.evaluate(() => {
    window.controlKeys = [];
    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey && ["KeyA", "KeyS"].includes(e.code))
        window.controlKeys.push({
          code: e.code,
          prevented: e.defaultPrevented,
        });
    });
  });
  await a.keyboard.press("Control+a");
  await a.keyboard.press("Control+s");
  assert.deepEqual(
    await a.evaluate(() => window.controlKeys.map((e) => e.prevented)),
    [true, true],
  );
  assert.equal(await a.evaluate(() => window.getSelection().toString()), "");
  await a.keyboard.press("Escape");
  await a.locator("#resume").waitFor();
  await delay(350);
  await a.keyboard.press("Escape");
  await a.waitForFunction(() => !!document.pointerLockElement);
  await a.keyboard.press("Digit3");
  await a.keyboard.press("KeyE");
  assert.equal(
    await a.locator('.inventory-slot[data-area="inventory"]').count(),
    36,
  );
  const before = await slot(a, 2).getAttribute("title");
  await a.locator("#item-search").fill("diamond");
  await a.locator("#item-search").press("Control+a");
  assert.equal(
    await a
      .locator("#item-search")
      .evaluate((e) => e.selectionEnd - e.selectionStart),
    7,
  );
  await a.locator('[data-block="113"]').click();
  assert.equal(await slot(a, 2).getAttribute("title"), before);
  assert.match(await cursorId(a), /Diamant/i);
  await slot(a, 24).click();
  assert.match(await slot(a, 24).getAttribute("title"), /Diamant/);
  assert.equal(await slot(a, 24).locator("small").innerText(), "64");
  await slot(a, 24).click({ button: "right" });
  assert.equal(await slot(a, 24).locator("small").innerText(), "32");
  await slot(a, 31).click({ button: "right" });
  await slot(a, 25).click();
  assert.equal(await slot(a, 25).locator("small").innerText(), "31");
  await slot(a, 25).hover();
  await a.keyboard.press("Digit8");
  assert.match(await slot(a, 7).getAttribute("title"), /Diamant/);
  await slot(a, 24).dragTo(slot(a, 30));
  assert.match(await slot(a, 30).getAttribute("title"), /Diamant/);
  assert.match(await slot(a, 24).getAttribute("title"), /Leeg/);
  await a.locator("#item-search").fill("oak_log");
  await a.locator('[data-block="7"]').click({ button: "right" });
  await craft(a, 0).click();
  await a.locator('[data-area="output"]').click();
  assert.equal(await a.locator(".inventory-cursor small").innerText(), "4");
  await slot(a, 20).click();
  assert.match(await slot(a, 20).getAttribute("title"), /planken/i);
  await a.locator("#item-search").fill("diamond");
  await a.locator('[data-block="113"]').click();
  async function distribute(indices, button = "left") {
    const boxes = await Promise.all(
      indices.map((i) => slot(a, i).boundingBox()),
    );
    await a.mouse.move(boxes[0].x + 26, boxes[0].y + 26);
    await a.mouse.down({ button });
    for (const box of boxes)
      await a.mouse.move(box.x + 26, box.y + 26, { steps: 6 });
    await a.mouse.up({ button });
  }
  await distribute([12, 13, 14]);
  for (const i of [12, 13, 14])
    assert.equal(await slot(a, i).locator("small").innerText(), "21");
  await distribute([15, 16], "right");
  assert.match(await slot(a, 15).getAttribute("title"), /Diamant/);
  assert.match(await slot(a, 16).getAttribute("title"), /Leeg/);
  assert.equal(await a.locator(".inventory-cursor").isVisible(), false);
  await a.locator("#item-search").focus();
  await a.keyboard.press("Escape");
  await a.waitForFunction(() => !!document.pointerLockElement);
  await delay(300);
  await a.keyboard.press("Escape");
  await a.locator("#save").click();
  await a.waitForFunction(
    () => document.querySelector("#toast").textContent === "Wereld opgeslagen.",
  );
  let save = await readSP(a);
  assert.equal(save.survival.slotInventory.slots[30].id, 113);
  assert.equal(save.survival.slotInventory.slots[7].count, 31);
  assert.equal(save.survival.slotInventory.slots[20].count, 4);
  assert.equal(save.survival.slotInventory.slots[2].id, save.hotbar[2]);
  assert.equal(save.schemaVersion, 5);
  await a.reload({ waitUntil: "networkidle" });
  await a.locator("#load").click();
  await a.locator(".world-open").click();
  await a.waitForFunction(() => !!document.pointerLockElement);
  await a.keyboard.press("KeyE");
  assert.match(await slot(a, 30).getAttribute("title"), /Diamant/);
  assert.equal(await slot(a, 7).locator("small").innerText(), "31");
  await mkdir("test-results", { recursive: true });
  await a.screenshot({ path: "test-results/inventory-slots.png" });
  await a.locator("#back").click();
  await a.waitForFunction(() => !!document.pointerLockElement);
  await a.keyboard.press("Escape");
  await a.locator("#home").click();
  console.log(
    "Singleplayer inventory QA passed: chosen destinations, splitting, one-item placement, number keys, dragging, real crafting and reload.",
  );
  async function join(p, name) {
    await p.bringToFront();
    if (!(await p.locator("#multiplayer").count()))
      await p.goto(url, { waitUntil: "networkidle" });
    await p.locator("#multiplayer").click();
    await p.locator("#lan-join:not([disabled])").waitFor();
    await p.locator("#lan-name").fill(name);
    await p.locator("#lan-join").click();
    await p.waitForFunction(() =>
      window.netMessages.some((m) => m.type === "welcome"),
    );
    if (await p.locator("#resume").isVisible())
      await p.locator("#resume").click();
    await p.waitForFunction(() => !!document.pointerLockElement);
  }
  await join(a, "Alice");
  await b.goto(url, { waitUntil: "networkidle" });
  await join(b, "Bob");
  async function resume(p) {
    await p.bringToFront();
    if (await p.locator("#resume").isVisible())
      await p.locator("#resume").click();
    await p.waitForFunction(() => !!document.pointerLockElement);
  }
  async function openChest(p) {
    await resume(p);
    await p.mouse.down({ button: "right" });
    await delay(80);
    await p.mouse.up({ button: "right" });
    await p.locator('[data-area="container"][data-index="0"]').waitFor();
  }
  await openChest(a);
  await openChest(b);
  await a.bringToFront();
  await a.locator('[data-area="container"][data-index="0"]').click();
  await a.waitForFunction(
    () => document.querySelector(".inventory-cursor img")?.alt === "Diamant",
  );
  await slot(a, 23).click();
  await a.waitForFunction(
    () =>
      document.querySelector('[data-area="inventory"][data-index="23"] small')
        ?.textContent === "16",
  );
  await b.bringToFront();
  await b.locator('[data-area="container"][data-index="0"]').click();
  await delay(250);
  assert.equal(await b.locator(".inventory-cursor").isVisible(), false);
  await a.bringToFront();
  await slot(a, 23).click({ button: "right" });
  await a.waitForFunction(
    () =>
      document.querySelector('[data-area="inventory"][data-index="23"] small')
        ?.textContent === "8",
  );
  await slot(a, 18).click();
  await a.waitForFunction(
    () =>
      document.querySelector('[data-area="inventory"][data-index="18"] small')
        ?.textContent === "8",
  );
  // Replay one inventory transaction: server must apply it exactly once.
  await a.evaluate(() => {
    const m = {
      type: "inventory",
      tx: "repeat-slot-transaction",
      action: {
        kind: "click",
        area: "inventory",
        index: 18,
        button: 0,
        shift: false,
      },
    };
    window.netSocket.send(JSON.stringify(m));
    window.netSocket.send(JSON.stringify(m));
  });
  await a.waitForFunction(() =>
    window.netMessages.some(
      (m) =>
        m.type === "snapshot" &&
        m.self.survival.slotInventory.cursor?.id === 113 &&
        m.self.survival.slotInventory.cursor.count === 8,
    ),
  );
  await slot(a, 26).click();
  await a.waitForFunction(
    () =>
      document.querySelector('[data-area="inventory"][data-index="26"] small')
        ?.textContent === "8",
  );
  const checkpoint = logs.length;
  server.stdin.write("save\n");
  for (let i = 0; !logs.slice(checkpoint).includes("Opgeslagen."); i++) {
    if (i > 100) throw Error(logs);
    await delay(100);
  }
  save = JSON.parse(
    await readFile(resolve(root, "MultiplayerWorld", "world.json"), "utf8"),
  );
  const alice = save.players.find((p) => p.name === "Alice"),
    bob = save.players.find((p) => p.name === "Bob");
  assert.equal(alice.survival.slotInventory.slots[23].count, 8);
  assert.equal(alice.survival.slotInventory.slots[26].count, 8);
  assert.equal(bob.survival.items[113] ?? 0, 0);
  assert.equal(save.world.blockEntities.chests["8,62,6"][0], null);
  assert.deepEqual(errors, []);
  console.log(
    "Multiplayer inventory QA passed: server-authoritative cursor and slots, simultaneous shared chest use, transaction replay and persistent positions.",
  );
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const done = new Promise((resolve) => server.once("exit", resolve));
    server.stdin.write("stop\n");
    await Promise.race([done, delay(10000)]);
    if (server.exitCode === null) server.kill();
  }
}
