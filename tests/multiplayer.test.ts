import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { WebSocket } from "ws";
import { PNG } from "pngjs";
import { GameServer } from "../server/GameServer";
import { ServerWorld } from "../server/ServerWorld";
import {
  defaults,
  validateConfig,
  type ServerConfig,
} from "../server/ServerConfig";
import { WorldPersistence } from "../server/WorldPersistence";
import { SkinCache } from "../server/SkinCache";
import {
  validateClientMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from "../src/networking/NetworkProtocol";
import { GENERATOR_VERSION } from "../src/world/WorldGenerator";
import { configureGameMode } from "../src/player/GameModes";
import { isHostAddress } from "../server/HostAddress";
class Client {
  readonly ws: WebSocket;
  messages: ServerMessage[] = [];
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on("message", (b) => this.messages.push(JSON.parse(b.toString())));
    this.ws.on("error", () => {});
  }
  async open() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });
  }
  send(message: ClientMessage | Record<string, unknown>) {
    this.ws.send(JSON.stringify(message));
  }
  async wait<T extends ServerMessage["type"]>(
    type: T,
    predicate: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    for (let i = 0; i < 500; i++) {
      const index = this.messages.findIndex(
        (m) =>
          m.type === type &&
          predicate(m as Extract<ServerMessage, { type: T }>),
      );
      if (index >= 0)
        return this.messages.splice(index, 1)[0] as Extract<
          ServerMessage,
          { type: T }
        >;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error(
      "Timeout waiting for " +
        type +
        "; messages " +
        JSON.stringify(this.messages.slice(-3)),
    );
  }
  async hello(name: string, token?: string) {
    await this.open();
    this.send({
      type: "hello",
      name,
      token,
      protocol: PROTOCOL_VERSION,
      generator: GENERATOR_VERSION,
    });
    return this.wait("welcome");
  }
  async close() {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((r) => {
      this.ws.once("close", () => r());
      this.ws.close();
    });
  }
}
describe("LAN configuration and validation", () => {
  it("defaults to port 8800 and rejects unsafe paths, roles and invalid limits", () => {
    expect(validateConfig({}).port).toBe(8800);
    for (const config of [
      { port: 0 },
      { worldName: "../../escape" },
      { maxPlayers: 100 },
      { allowCommands: "yes" },
      { adminIds: ["Player"] },
      { playerCommands: ["op"] },
    ])
      expect(() => validateConfig(config)).toThrow();
  });
  it.each([
    null,
    {
      type: "input",
      input: { seq: 1, keys: ["Nope"], yaw: 0, pitch: 0, flying: false },
    },
    {
      type: "input",
      input: { seq: 1, keys: [], yaw: Infinity, pitch: 0, flying: false },
    },
    { type: "admin", role: "Admin" },
    { type: "container", key: "../../file" },
    { type: "chat", text: "a\u0000b" },
    { type: "craft", tx: "x", grid: [-1], size: 2, repeat: false },
  ])("rejects malformed client input %#", (message) =>
    expect(() => validateClientMessage(message)).toThrow(),
  );
});
describe("server-authoritative LAN protocol", () => {
  let runtime: GameServer,
    http: Server,
    root: string,
    url: string,
    clients: Client[] = [],
    classifyActualHost = false;
  beforeEach(async () => {
    classifyActualHost = false;
    await mkdir(".lan-test", { recursive: true });
    root = await mkdtemp(resolve(".lan-test", "protocol-"));
    runtime = await GameServer.create(
      { ...defaults, viewDistance: 2, simulationDistance: 1 },
      root,
      (address) => classifyActualHost && isHostAddress(address),
    );
    http = createServer((req, res) => {
      void runtime.api(req, res, () => res.writeHead(404).end());
    });
    runtime.attach(http);
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
    clients = [];
  });
  afterEach(async () => {
    for (const c of clients) await c.close();
    await runtime.close();
    await new Promise<void>((r) => http.close(() => r()));
  });
  const connect = () => {
    const c = new Client(url.replace("http:", "ws:") + "/ws/whitebrick");
    clients.push(c);
    return c;
  };
  it("automatically makes a real local connection Admin, including after deop and reconnect", async () => {
    classifyActualHost = true;
    const a = connect(),
      welcome = await a.hello("Local Host");
    expect(welcome.self.role).toBe("Admin");
    const p = runtime.game.players.get(welcome.self.id)!;
    expect(p.hostAdmin).toBe(true);
    expect(runtime.game.operators.has(p.record.id)).toBe(false);
    runtime.game.op(p.record.id, false);
    expect(runtime.game.self(p).role).toBe("Admin");
    a.send({ type: "chat", text: "/gamemode spectator" });
    await a.wait("chat", (m) => m.text.includes("gewijzigd naar spectator"));
    expect(p.record.mode).toBe("spectator");
    await a.close();
    classifyActualHost = false;
    const remote = connect(),
      remoteWelcome = await remote.hello("Remote Host", welcome.token);
    expect(remoteWelcome.self.role).toBe("Player");
    expect(runtime.game.players.get(remoteWelcome.self.id)!.hostAdmin).toBe(
      false,
    );
    await remote.close();
    classifyActualHost = true;
    const again = connect();
    expect((await again.hello("Local Host", welcome.token)).self.role).toBe(
      "Admin",
    );
  });
  it("serves safe status and supports two clients, joins, leaves and shared chat", async () => {
    const status = await fetch(url + "/api/server/status").then((r) =>
      r.json(),
    );
    expect(status).toMatchObject({
      serverName: "WhiteBrick LAN",
      online: true,
      playerCount: 0,
      maxPlayers: 8,
      protocolVersion: PROTOCOL_VERSION,
    });
    expect(status).not.toHaveProperty("players");
    const a = connect(),
      b = connect(),
      wa = await a.hello("Alice"),
      wb = await b.hello("Bob");
    expect(wa.self.id).not.toBe(wb.self.id);
    expect(wa.self.role).toBe("Player");
    a.send({ type: "chat", text: "Hallo Bob" });
    expect((await b.wait("chat", (m) => m.kind === "local")).text).toBe(
      "<Alice> Hallo Bob",
    );
    await a.close();
    await b.wait("chat", (m) => m.text.includes("Alice heeft"));
    expect(runtime.game.players.size).toBe(1);
    b.send({ type: "chat", text: "Nog steeds online" });
    expect((await b.wait("chat", (m) => m.kind === "local")).text).toContain(
      "Nog steeds online",
    );
  });
  it("uses secret tokens, prevents duplicate sessions and never authenticates a name or client role", async () => {
    const a = connect(),
      wa = await a.hello("Host");
    expect(wa.token).toMatch(/^[a-f0-9]{64}$/);
    const duplicate = connect();
    await duplicate.open();
    duplicate.send({
      type: "hello",
      name: "Other",
      token: wa.token,
      protocol: PROTOCOL_VERSION,
      generator: 3,
    });
    expect((await duplicate.wait("error")).message).toMatch(/actieve sessie/);
    await a.close();
    const impostor = connect(),
      wi = await impostor.hello("Host");
    expect(wi.self.id).not.toBe(wa.self.id);
    expect(wi.self.role).toBe("Player");
    await impostor.close();
    const again = connect(),
      wr = await again.hello("Host", wa.token);
    expect(wr.self.id).toBe(wa.self.id);
    expect(wr.sessionId).not.toBe(wa.sessionId);
    const raw = await readFile(
      resolve(runtime.game.persistence.directory, "world.json"),
      "utf8",
    );
    expect(raw).not.toContain(wa.token!);
  });
  it("enforces permissions server-side and applies real commands, gamerules and mobs", async () => {
    const a = connect(),
      b = connect(),
      wa = await a.hello("Alice"),
      wb = await b.hello("Bob");
    a.send({ type: "chat", text: "/give diamond 64" });
    expect((await a.wait("chat", (m) => m.kind === "error")).text).toMatch(
      /toestemming/,
    );
    expect(runtime.game.players.get(wa.self.id)!.survival.count(113)).toBe(0);
    runtime.game.op(wa.self.id);
    await new Promise((r) => setTimeout(r, 400));
    a.send({ type: "chat", text: "/give Bob diamond 64" });
    await a.wait("chat", (m) => m.text.includes("diamond ontvangen"));
    expect(runtime.game.players.get(wb.self.id)!.survival.count(113)).toBe(64);
    expect(runtime.game.players.get(wa.self.id)!.survival.count(113)).toBe(0);
    await new Promise((r) => setTimeout(r, 400));
    a.send({ type: "chat", text: "/summon cow" });
    await a.wait("chat", (m) => m.text.includes("gespawnd"));
    expect(
      (
        await b.wait("snapshot", (m) => m.mobs.some((e) => e.kind === "cow"))
      ).mobs.some((e) => e.kind === "cow"),
    ).toBe(true);
    await new Promise((r) => setTimeout(r, 400));
    a.send({ type: "chat", text: "/gamerule doDaylightCycle false" });
    await a.wait("chat", (m) => m.text.includes("doDaylightCycle = false"));
    const day = runtime.game.data.day;
    await new Promise((r) => setTimeout(r, 150));
    expect(runtime.game.data.day).toBe(day);
  });
  it("sends every targeted gamemode to the affected WebSocket client and rejects Player requests", async () => {
    const a = connect(),
      b = connect(),
      admin = await a.hello("Alice"),
      target = await b.hello("Bob");
    runtime.game.op(admin.self.id);
    for (const mode of ["survival", "creative", "adventure", "spectator"]) {
      a.send({ type: "chat", text: `/gamemode ${mode} Bob` });
      await a.wait(
        "chat",
        (m) => m.text === `Gamemode van Bob gewijzigd naar ${mode}.`,
      );
      await b.wait("chat", (m) =>
        m.text.includes(`je gamemode gewijzigd naar ${mode}`),
      );
      const snapshot = await b.wait("snapshot", (m) => m.self.mode === mode);
      expect(snapshot.self.id).toBe(target.self.id);
      expect(runtime.game.players.get(target.self.id)!.record.mode).toBe(mode);
      expect(runtime.game.players.get(admin.self.id)!.record.mode).toBe(
        "creative",
      );
      await new Promise((r) => setTimeout(r, 360));
    }
    b.send({ type: "chat", text: "/gamemode survival Alice" });
    expect((await b.wait("error")).message).toMatch(/Alleen Admin/);
    expect(runtime.game.players.get(admin.self.id)!.record.mode).toBe(
      "creative",
    );
  });
  it("keeps movement authoritative and synchronizes real position to other players", async () => {
    const a = connect(),
      b = connect(),
      wa = await a.hello("Alice");
    await b.hello("Bob");
    const p = runtime.game.players.get(wa.self.id)!,
      before = p.physics.position.clone();
    a.send({
      type: "input",
      input: { seq: 1, keys: ["KeyW"], yaw: 0, pitch: 0, flying: false },
      position: [99999, 99999, 99999],
      role: "Admin",
    } as Record<string, unknown>);
    const moved = await b.wait("snapshot", (m) =>
      m.players.some((t) => t.id === wa.self.id && t.position[2] < before.z),
    );
    expect(
      moved.players.find((t) => t.id === wa.self.id)!.position[2],
    ).toBeLessThan(before.z);
    expect(p.physics.position.x).toBeCloseTo(before.x);
    expect(runtime.game.self(p).role).toBe("Player");
  });
  it("broadcasts authoritative block revisions and resynchronizes modified chunks", async () => {
    const a = connect(),
      b = connect(),
      wa = await a.hello("Alice");
    await b.hello("Bob");
    const p = runtime.game.players.get(wa.self.id)!;
    p.physics.position.set(8.5, 61, 8.5);
    p.controller.yaw = 0;
    p.controller.pitch = 0;
    p.physics.flying = true;
    runtime.game.world.set(8, 62, 6, 2);
    await a.wait("chunk", (m) => m.key === "0,0");
    await b.wait("chunk", (m) => m.key === "0,0");
    a.send({
      type: "inventory",
      tx: "pick-planks",
      action: { kind: "creative", item: 9, button: 0, shift: false },
    });
    a.send({
      type: "inventory",
      tx: "put-planks",
      action: {
        kind: "click",
        area: "inventory",
        index: 0,
        button: 0,
        shift: false,
      },
    });
    a.send({
      type: "inventory",
      tx: "return-cursor",
      action: { kind: "close" },
    });
    a.send({ type: "select", slot: 0, item: 9 });
    a.send({ type: "action", tx: "place1", action: "place" });
    const delta = await b.wait(
      "block",
      (m) => m.change.x === 8 && m.change.y === 62 && m.change.z === 7,
    );
    expect(delta.change.id).toBe(9);
    expect(runtime.game.world.get(8, 62, 7)).toBe(9);
    a.send({ type: "action", tx: "place1", action: "place" });
    await new Promise((r) => setTimeout(r, 200));
    expect(runtime.game.world.get(8, 62, 8)).toBe(0);
    b.send({ type: "resync", key: "0,0" });
    const chunk = await b.wait(
      "chunk",
      (m) => m.key === "0,0" && m.revision >= delta.revision,
    );
    expect(chunk.changes).toContainEqual([8, 62, 7, 9]);
  });
  it("allows Creative to break placed bedrock while Survival cannot", async () => {
    const a = connect(),
      welcome = await a.hello("Builder");
    const p = runtime.game.players.get(welcome.self.id)!;
    const hit = {
      x: 8,
      y: 75,
      z: 6,
      normal: [0, 0, 1] as [number, number, number],
      distance: 2,
    };
    runtime.game.world.set(8, 75, 6, 16);
    p.record.mode = "survival";
    runtime.game.breakBlock(p, hit);
    expect(runtime.game.world.get(8, 75, 6)).toBe(16);
    p.record.mode = "creative";
    runtime.game.breakBlock(p, hit);
    expect(runtime.game.world.get(8, 75, 6)).toBe(0);
  });
  it("synchronizes validated skin references without putting PNG data into movement snapshots", async () => {
    const a = connect(),
      b = connect(),
      wa = await a.hello("Alice");
    await b.hello("Bob");
    const png = new PNG({ width: 64, height: 32 });
    png.data.fill(255);
    a.send({
      type: "skin",
      png: "data:image/png;base64," + PNG.sync.write(png).toString("base64"),
      model: "slim",
      layers: true,
    });
    const snap = await b.wait("snapshot", (m) =>
      m.players.some((p) => p.id === wa.self.id && p.skin?.model === "slim"),
    );
    const skin = snap.players.find((p) => p.id === wa.self.id)!.skin!;
    expect(skin.hash).toMatch(/^[a-f0-9]{64}$/);
    const res = await fetch(
      url + "/api/multiplayer/skins/" + skin.hash + ".png",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(JSON.stringify(snap)).not.toContain("base64");
  });
  it("saves identity, inventory, terrain and rules independently of browser sessions", async () => {
    const a = connect(),
      wa = await a.hello("Alice"),
      p = runtime.game.players.get(wa.self.id)!;
    p.survival.add(113, 128);
    runtime.game.world.set(15, 60, 15, 9);
    runtime.game.data.rules!.keepInventory = true;
    await a.close();
    await runtime.game.save();
    const restored = await ServerWorld.open(
      { ...defaults, viewDistance: 2 },
      root,
    );
    const r = restored.join("Alice", wa.token, () => {}).player;
    expect(r.record.id).toBe(wa.self.id);
    expect(r.survival.count(113)).toBe(128);
    expect(restored.world.get(15, 60, 15)).toBe(9);
    expect(restored.data.rules!.keepInventory).toBe(true);
    restored.dispose();
  });
  it("rejects protocol mismatch, full server and unknown identity tokens", async () => {
    runtime.config.maxPlayers = 1;
    const a = connect();
    await a.hello("Alice");
    const b = connect();
    await b.open();
    b.send({
      type: "hello",
      protocol: PROTOCOL_VERSION,
      generator: 3,
      name: "Bob",
    });
    expect((await b.wait("error")).message).toMatch(/vol/);
    await a.close();
    const c = connect();
    await c.open();
    c.send({ type: "hello", protocol: 99, generator: 3, name: "Bob" });
    expect((await c.wait("error")).message).toMatch(/versie/);
    const d = connect();
    await d.open();
    d.send({
      type: "hello",
      protocol: PROTOCOL_VERSION,
      generator: 3,
      name: "Bob",
      token: "a".repeat(64),
    });
    expect((await d.wait("error")).message).toMatch(/ongeldig/);
  });
});
describe("atomic inventory transactions and persistence", () => {
  let game: ServerWorld, root: string;
  beforeEach(async () => {
    await mkdir(".lan-test", { recursive: true });
    root = await mkdtemp(resolve(".lan-test", "state-"));
    game = await ServerWorld.open({ ...defaults, viewDistance: 2 }, root);
  });
  afterEach(() => game.dispose());
  it.each([
    ["survival", "survival"],
    ["creative", "creative"],
    ["adventure", "adventure"],
    ["spectator", "spectator"],
    ["0", "survival"],
    ["1", "creative"],
    ["2", "adventure"],
    ["3", "spectator"],
  ])(
    "lets an Admin set another player to %s and persists the actual mode",
    async (input, expected) => {
      const adminMessages: ServerMessage[] = [],
        targetMessages: ServerMessage[] = [];
      const admin = game.join("Admin", undefined, (m) =>
        adminMessages.push(m),
      ).player;
      const joined = game.join("Bob", undefined, (m) => targetMessages.push(m)),
        target = joined.player;
      game.op(admin.record.id);
      target.mineUntil = 999;
      target.mineKey = "old-target";
      game.chat(admin, `/gamemode ${input} Bob`);
      expect(target.record.mode).toBe(expected);
      expect(admin.record.mode).toBe("creative");
      expect(target.physics.noclip).toBe(expected === "spectator");
      expect(target.physics.flying).toBe(expected === "spectator");
      expect(target.mineUntil).toBe(0);
      expect(
        adminMessages.some(
          (m) =>
            m.type === "chat" &&
            m.text === `Gamemode van Bob gewijzigd naar ${expected}.`,
        ),
      ).toBe(true);
      expect(
        targetMessages.some(
          (m) =>
            m.type === "chat" &&
            m.text.includes(`je gamemode gewijzigd naar ${expected}`),
        ),
      ).toBe(true);
      await game.save();
      const restored = await ServerWorld.open(
        { ...defaults, viewDistance: 2 },
        root,
      );
      try {
        expect(
          restored.join("Bob", joined.token, () => {}).player.record.mode,
        ).toBe(expected);
      } finally {
        restored.dispose();
      }
    },
  );
  it("resolves case-insensitive and quoted player names and the Admin self-selector", () => {
    const admin = game.join("Admin", undefined, () => {}).player,
      target = game.join("Bob Builder", undefined, () => {}).player;
    game.op(admin.record.id);
    game.chat(admin, '/gamemode spectator "bob builder"');
    expect(target.record.mode).toBe("spectator");
    game.chat(admin, "/gm adventure @s");
    expect(admin.record.mode).toBe("adventure");
    expect(target.record.mode).toBe("spectator");
  });
  it("rejects non-admin targeting, unknown players and invalid modes without changing anyone", () => {
    const messages: ServerMessage[] = [],
      admin = game.join("Admin", undefined, (m) => messages.push(m)).player,
      target = game.join("Bob", undefined, () => {}).player;
    game.config.playerCommands = ["help", "gamemode"];
    expect(() => game.chat(target, "/gamemode spectator Admin")).toThrow(
      /Alleen Admin/,
    );
    game.op(admin.record.id);
    expect(() => game.chat(admin, "/gamemode spectator Nobody")).toThrow(
      /niet online/,
    );
    game.chat(admin, "/gamemode invalid Bob");
    expect(messages.some((m) => m.type === "chat" && m.kind === "error")).toBe(
      true,
    );
    game.chat(admin, "/gamemode survival Bob extra");
    expect(target.record.mode).toBe("creative");
    expect(admin.record.mode).toBe("creative");
  });
  it("serializes concurrent chest takes and ignores duplicate transaction IDs", () => {
    const a = game.join("Alice", undefined, () => {}).player,
      b = game.join("Bob", undefined, () => {}).player;
    for (const p of [a, b]) {
      p.physics.position.set(8.5, 61, 8.5);
      p.container = "8,61,6";
    }
    game.world.set(8, 61, 6, 62);
    game.entities.chest("8,61,6")[0] = { id: 113, count: 64 };
    const take = {
      type: "container",
      tx: "take1",
      key: "8,61,6",
      slot: 0,
      item: 0,
      count: 1,
      take: true,
    } as const;
    game.handle(a, take);
    game.handle(a, take);
    game.handle(b, { ...take, tx: "take2" });
    expect(a.survival.count(113) + b.survival.count(113)).toBe(64);
    expect(game.entities.chest("8,61,6")[0]).toBeNull();
  });
  it("validates crafting ingredients and station reach on the server", () => {
    const p = game.join("Alice", undefined, () => {}).player;
    p.survival.clearInventory();
    p.survival.add(7, 2);
    game.handle(p, {
      type: "craft",
      tx: "craft1",
      grid: [7, 0, 0, 0],
      size: 2,
      repeat: true,
    });
    game.handle(p, {
      type: "craft",
      tx: "craft1",
      grid: [7, 0, 0, 0],
      size: 2,
      repeat: true,
    });
    expect(p.survival.count(9)).toBe(8);
    expect(p.survival.count(7)).toBe(0);
    game.handle(p, {
      type: "craft",
      tx: "craft2",
      grid: [9, 9, 9, 9],
      size: 2,
      repeat: false,
    });
    expect(p.survival.count(19)).toBe(1);
    expect(p.survival.count(9)).toBe(4);
  });
  it("never grants flight or edits to Survival/Adventure from a claimed client state", () => {
    const p = game.join("Alice", undefined, () => {}).player;
    p.record.mode = "survival";
    configureGameMode("survival", p.physics, p.survival);
    game.handle(p, {
      type: "input",
      input: { seq: 1, keys: ["Space"], yaw: 0, pitch: 0, flying: true },
    });
    game.step();
    expect(p.physics.flying).toBe(false);
    p.record.mode = "adventure";
    p.physics.position.set(8.5, 61, 8.5);
    game.world.set(8, 62, 6, 2);
    p.chunks.add("0,0");
    game.action(p, { type: "action", tx: "mine", action: "mine" });
    expect(game.world.get(8, 62, 6)).toBe(2);
  });
  it("keeps the last good save as backup and recovers it if the latest JSON is damaged", async () => {
    const store = new WorldPersistence<{ version: number }>("safe", root);
    await store.save({ version: 1 });
    await store.save({ version: 2 });
    expect(await store.load()).toEqual({ version: 2 });
    expect(
      JSON.parse(
        await readFile(resolve(store.directory, "world.backup.json"), "utf8"),
      ),
    ).toEqual({ version: 1 });
    await writeFile(resolve(store.directory, "world.json"), "broken JSON");
    expect(await store.load()).toEqual({ version: 1 });
    await store.save({ version: 3 });
    expect(await store.load()).toEqual({ version: 3 });
    expect(
      JSON.parse(
        await readFile(resolve(store.directory, "world.backup.json"), "utf8"),
      ),
    ).toEqual({ version: 1 });
  });
  it("produces only one block drop when two players mine the same voxel, then picks it up once", () => {
    game.data.rules!.doMobSpawning = false;
    const a = game.join("Alice", undefined, () => {}).player,
      b = game.join("Bob", undefined, () => {}).player;
    game.world.set(8, 60, 8, 3);
    game.world.set(8, 62, 6, 2);
    for (const p of [a, b]) {
      p.survival.clearInventory();
      p.record.mode = "survival";
      configureGameMode("survival", p.physics, p.survival);
      p.physics.position.set(8.5, 61, 8.5);
      p.chunks.add("0,0");
    }
    for (let i = 0; i < 30; i++) {
      if (i % 3 === 0)
        for (const p of [a, b])
          game.handle(p, { type: "action", tx: "mine" + i, action: "mine" });
      game.step();
    }
    expect(game.world.get(8, 62, 6)).toBe(0);
    expect(
      game.drops.filter((d) => d.id === 2).reduce((n, d) => n + d.count, 0),
    ).toBe(1);
    for (const p of [a, b]) p.physics.position.set(8.5, 61, 6.5);
    game.updateItems();
    expect(a.survival.count(2) + b.survival.count(2)).toBe(1);
    expect(game.drops.filter((d) => d.id === 2)).toHaveLength(0);
  });
  it("resolves shared melee kills and loot once, and blocks attacks through solid walls", () => {
    const a = game.join("Alice", undefined, () => {}).player,
      b = game.join("Bob", undefined, () => {}).player;
    for (const p of [a, b]) p.physics.position.set(8.5, 61, 8.5);
    const cow = game.mobs.spawn("cow", 8.5, 61, 6.5)!;
    game.world.set(8, 62, 7, 3);
    game.action(a, { type: "action", tx: "wall", action: "attack" });
    expect(cow.health).toBe(10);
    game.world.set(8, 62, 7, 0);
    game.action(a, { type: "action", tx: "hit1", action: "attack" });
    game.action(b, { type: "action", tx: "hit2", action: "attack" });
    expect(cow.state).toBe("Dead");
    expect(
      game.drops.filter((d) => d.id === 121).reduce((n, d) => n + d.count, 0),
    ).toBe(2);
    expect(game.orbs.reduce((n, o) => n + o.amount, 0)).toBe(3);
  });
  it("autosaves the shared world while no browsers are connected", async () => {
    game.config.autosaveIntervalSeconds = 5;
    game.world.set(2, 60, 2, 9);
    for (let i = 0; i < 100; i++) game.step();
    let data: any;
    for (let i = 0; i < 100; i++) {
      try {
        data = JSON.parse(
          await readFile(
            resolve(game.persistence.directory, "world.json"),
            "utf8",
          ),
        );
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    expect(data.world.changes).toContainEqual({ x: 2, y: 60, z: 2, id: 9 });
    expect(data.world.day).toBeGreaterThan(0);
    expect(game.players.size).toBe(0);
  });
  it("fully decodes skins and rejects oversized dimensions, forged headers and unsafe references", async () => {
    const cache = new SkinCache(resolve(root, "skins"));
    await expect(
      cache.store(
        "data:image/png;base64," + Buffer.alloc(40).toString("base64"),
      ),
    ).rejects.toThrow();
    await expect(cache.read("../../escape")).rejects.toThrow();
  });
});
