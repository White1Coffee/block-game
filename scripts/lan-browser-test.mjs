import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { ServerWorld } from "../server/ServerWorld.ts";
import { defaults } from "../server/ServerConfig.ts";
await mkdir(".lan-test", { recursive: true });
const root = await mkdtemp(resolve(".lan-test", "browser-")),
  port = Number(process.env.LAN_TEST_PORT) || 18800,
  url = "http://127.0.0.1:" + port;
const fixture = await ServerWorld.open(defaults, root);
fixture.data.spawnpoint = [8.5, 61, 8.5];
fixture.data.rules.doMobSpawning = false;
fixture.data.rules.doDaylightCycle = false;
for (let x = 3; x <= 14; x++)
  for (let z = 2; z <= 12; z++) {
    fixture.world.set(x, 60, z, 3);
    for (let y = 61; y <= 68; y++) fixture.world.set(x, y, z, 0);
  }
fixture.world.set(8, 62, 6, 2);
await fixture.save();
fixture.dispose();
let child,
  logs = "",
  browser;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function start() {
  logs = "";
  child = spawn(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "server/index.ts"],
    {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port), WHITEBRICK_DATA_ROOT: root },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  child.stdout.on("data", (b) => (logs += b));
  child.stderr.on("data", (b) => (logs += b));
  for (let i = 0; i < 100; i++) {
    if (logs.includes("Server status: ONLINE")) return;
    if (child.exitCode !== null) throw Error(logs);
    await delay(100);
  }
  throw Error("Server startup timeout: " + logs);
}
async function stop() {
  const done = new Promise((r) => child.once("exit", r));
  child.stdin.write("stop\n");
  await Promise.race([
    done,
    delay(15000).then(() => {
      throw Error("Shutdown timeout " + logs);
    }),
  ]);
  assert.match(logs, /Wereld opgeslagen/);
}
try {
  await start();
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /WhiteBrick/);
  assert.match(logs, /Multiplayer LAN URL: http:\/\//);
  browser = await chromium.launch({
    ...(process.env.BROWSER_PATH
      ? { executablePath: process.env.BROWSER_PATH }
      : { channel: "msedge" }),
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  const contexts = [];
  for (let i = 0; i < 2; i++) {
    const c = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    await c.addInitScript(() => {
      localStorage.setItem(
        "wildbrick-settings",
        JSON.stringify({
          quality: "low",
          distance: 2,
          music: 0,
          volume: 0,
          maxMobs: 0,
        }),
      );
      window.lanMessages = [];
      window.lanSocket = null;
      const Native = window.WebSocket;
      window.WebSocket = class extends Native {
        constructor(...args) {
          super(...args);
          if (String(args[0]).includes("/ws/whitebrick")) {
            window.lanSocket = this;
            this.addEventListener("message", (e) => {
              window.lanMessages.push(JSON.parse(e.data));
              if (window.lanMessages.length > 1000)
                window.lanMessages.splice(0, 100);
            });
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
  await a.goto(url, { waitUntil: "networkidle" });
  // Create a real private world first, proving multiplayer never inserts remote state into IndexedDB.
  await a.locator("#new").click();
  await a.locator("[name=name]").fill("Private QA");
  await a.locator("button[type=submit]").click();
  await a.waitForFunction(() => !!document.pointerLockElement);
  await a.keyboard.press("Escape");
  await a.locator("#home").click();
  await a.waitForSelector("#multiplayer");
  const count = (p) =>
    p.evaluate(
      () =>
        new Promise((resolve) => {
          const r = indexedDB.open("wildbrick", 1);
          r.onupgradeneeded = () => {
            r.result.createObjectStore("worlds", { keyPath: "id" });
          };
          r.onsuccess = () => {
            const db = r.result,
              q = db.transaction("worlds").objectStore("worlds").getAll();
            q.onsuccess = () => {
              db.close();
              resolve(q.result.filter((s) => !s.backupOf).length);
            };
          };
        }),
    );
  assert.equal(await count(a), 1);
  async function join(p, name) {
    await p.bringToFront();
    await p.locator("#multiplayer").click();
    await p.locator("#lan-join:not([disabled])").waitFor();
    await p.locator("#lan-name").fill(name);
    await p.locator("#lan-join").click();
    await p.waitForFunction(() =>
      window.lanMessages.some((m) => m.type === "welcome"),
    );
    if (await p.locator("#resume").isVisible())
      await p.locator("#resume").click();
    await p.waitForFunction(() => !!document.pointerLockElement);
    await p.keyboard.press("F3");
    await p.waitForFunction(() =>
      document.querySelector("#debug").textContent.includes("LAN"),
    );
  }
  await join(a, "Alice");
  await b.goto(url, { waitUntil: "networkidle" });
  await b.locator("#character").click();
  const skin = new PNG({ width: 64, height: 64 });
  for (let i = 0; i < skin.data.length; i += 4) {
    skin.data[i] = 70;
    skin.data[i + 1] = 130;
    skin.data[i + 2] = 220;
    skin.data[i + 3] = 255;
  }
  await b.locator("#skin-upload").setInputFiles({
    name: "Blue.png",
    mimeType: "image/png",
    buffer: PNG.sync.write(skin),
  });
  await b.waitForFunction(
    () => document.querySelector("#skin-status").textContent === "Blue.png",
  );
  await b.locator("#skin-model").selectOption("slim");
  await b.locator("#apply-skin").click();
  await b.waitForFunction(
    () =>
      document.querySelector("#toast").textContent ===
      "Skin opgeslagen en toegepast.",
  );
  await b.locator("#character-back").click();
  await join(b, "Bob");
  await a.waitForFunction(() =>
    /players 1/.test(document.querySelector("#debug").textContent),
  );
  await b.waitForFunction(() =>
    /players 1/.test(document.querySelector("#debug").textContent),
  );
  const identity = await a.evaluate(
    () => window.lanMessages.find((m) => m.type === "welcome").self.id,
  );
  // Both browsers run on the host computer and must be Admin without console op.
  assert.ok(identity);
  await a.waitForFunction(() =>
    window.lanMessages.some(
      (m) => m.type === "snapshot" && m.self.role === "Admin",
    ),
  );
  await a.waitForFunction(() =>
    window.lanMessages.some(
      (m) =>
        m.type === "snapshot" &&
        m.players.some((p) => p.name === "Bob" && p.skin?.model === "slim"),
    ),
  );
  async function resume(p) {
    await p.bringToFront();
    if (await p.locator("#resume").isVisible())
      await p.locator("#resume").click();
    await p.waitForFunction(() => !!document.pointerLockElement);
  }
  async function chat(p, text) {
    await resume(p);
    await p.keyboard.press("/");
    await p.locator("#chat-input").fill(text);
    await p.keyboard.press("Enter");
    await p.waitForFunction(() => !!document.pointerLockElement);
    await delay(1100);
  }
  await chat(a, "Hallo Bob");
  await b.waitForFunction(() =>
    window.lanMessages.some(
      (m) => m.type === "chat" && m.text === "<Alice> Hallo Bob",
    ),
  );
  await chat(b, "/gamemode survival Bob");
  await b.waitForFunction(() =>
    window.lanMessages.some(
      (m) =>
        m.type === "snapshot" &&
        m.self.mode === "survival" &&
        m.self.role === "Admin",
    ),
  );
  await chat(a, "/gamemode creative Bob");
  await chat(a, "/give Bob diamond 64");
  await b.waitForFunction(() =>
    window.lanMessages.some(
      (m) => m.type === "snapshot" && m.self.survival.items[113] === 64,
    ),
  );
  await chat(a, "/summon cow ~2 ~ ~");
  await b.waitForFunction(() =>
    window.lanMessages.some(
      (m) => m.type === "snapshot" && m.mobs.some((e) => e.kind === "cow"),
    ),
  );
  await chat(a, "/gamerule keepInventory true");
  await b.waitForFunction(() =>
    window.lanMessages.some(
      (m) => m.type === "snapshot" && m.rules.keepInventory === true,
    ),
  );
  // Place an actual block through the game inventory + mouse controls.
  await resume(a);
  await a.keyboard.press("KeyE");
  await a.locator('[data-block="9"]').first().click();
  await a.locator('[data-area="inventory"][data-index="0"]').click();
  await a.locator("#back").click();
  await a.waitForFunction(() => !!document.pointerLockElement);
  await a.mouse.down({ button: "right" });
  await delay(80);
  await a.mouse.up({ button: "right" });
  await b.waitForFunction(() =>
    window.lanMessages.some(
      (m) =>
        m.type === "block" &&
        m.change.x === 8 &&
        m.change.y === 62 &&
        m.change.z === 7 &&
        m.change.id === 9,
    ),
  );
  await delay(300);
  await a.mouse.down({ button: "left" });
  await delay(80);
  await a.mouse.up({ button: "left" });
  await b.waitForFunction(() =>
    window.lanMessages.some(
      (m) =>
        m.type === "block" &&
        m.change.x === 8 &&
        m.change.y === 62 &&
        m.change.z === 7 &&
        m.change.id === 0,
    ),
  );
  // Move Bob and check both the server's snapshot and the other client's remote-player count.
  await resume(b);
  await b.keyboard.down("KeyD");
  await delay(550);
  await b.keyboard.up("KeyD");
  await a.waitForFunction(() =>
    window.lanMessages.some(
      (m) =>
        m.type === "snapshot" &&
        m.players.some((p) => p.name === "Bob" && p.position[0] > 9.5),
    ),
  );
  await b.keyboard.press("F5");
  await delay(250);
  await b.keyboard.press("F5");
  await delay(250);
  await b.keyboard.press("F5");
  // Change the live skin while still connected.
  await b.keyboard.press("Escape");
  await b.locator("#change-skin").click();
  await b.locator("#skin-model").selectOption("classic");
  await b.locator("#apply-skin").click();
  await a.waitForFunction(() =>
    window.lanMessages.some(
      (m) =>
        m.type === "snapshot" &&
        m.players.some((p) => p.name === "Bob" && p.skin?.model === "classic"),
    ),
  );
  await b.locator("#character-back").click();
  await b.locator("#resume").click();
  assert.equal(await count(a), 1);
  assert.equal(await count(b), 0);
  // A transient socket close triggers automatic reauthentication, not a duplicate player.
  await b.evaluate(() => window.lanSocket.close(4000, "Test reconnect"));
  await b.waitForFunction(
    () => window.lanMessages.filter((m) => m.type === "welcome").length >= 2,
    undefined,
    { timeout: 20000 },
  );
  assert.equal(
    (await fetch(url + "/api/server/status").then((r) => r.json())).playerCount,
    2,
  );
  await a.close();
  await b.waitForFunction(() =>
    window.lanMessages.some(
      (m) => m.type === "chat" && m.text.includes("Alice heeft"),
    ),
  );
  // Close propagation is asynchronous; old leave messages may be present after reconnects.
  for (let i = 0; i < 100; i++) {
    if (
      (await fetch(url + "/api/server/status").then((r) => r.json()))
        .playerCount === 1
    )
      break;
    await delay(50);
  }
  assert.equal(
    (await fetch(url + "/api/server/status").then((r) => r.json())).playerCount,
    1,
    logs +
      "\n" +
      JSON.stringify(
        await b.evaluate(() =>
          window.lanMessages
            .filter((m) => ["chat", "error", "welcome"].includes(m.type))
            .map((m) =>
              m.type === "welcome" ? { type: m.type, id: m.self.id } : m,
            ),
        ),
      ),
  );
  await stop();
  await b.waitForFunction(() =>
    document
      .querySelector("#connection-message")
      ?.textContent.includes("host stopt"),
  );
  const saved = JSON.parse(
    await readFile(resolve(root, "MultiplayerWorld", "world.json"), "utf8"),
  );
  assert.equal(
    saved.players.find((p) => p.name === "Bob").survival.items[113],
    64,
  );
  assert.equal(saved.world.rules.keepInventory, true);
  assert.ok(
    saved.world.changes.some(
      (c) => c.x === 8 && c.y === 62 && c.z === 7 && c.id === 0,
    ),
  );
  await start();
  await b.reload({ waitUntil: "networkidle" });
  await join(b, "Bob");
  await b.waitForFunction(() =>
    window.lanMessages.some(
      (m) => m.type === "welcome" && m.self.survival.items[113] === 64,
    ),
  );
  assert.equal(
    (await fetch(url + "/api/server/status").then((r) => r.json())).playerCount,
    1,
  );
  await mkdir("test-results", { recursive: true });
  await b.screenshot({ path: "test-results/lan-multiplayer.png" });
  assert.deepEqual(errors, []);
  await stop();
  console.log(
    "LAN production browser QA passed: HTTP, two independent browser identities, real skins, movement, building/mining, chat, admin permissions, mobs, rules, SP isolation, live skin changes, reconnect, browser independence, shutdown and persisted restart.",
  );
} finally {
  await browser?.close();
  if (child?.exitCode === null) {
    child.stdin.write("stop\n");
    await delay(1000);
    if (child.exitCode === null) child.kill();
  }
}
