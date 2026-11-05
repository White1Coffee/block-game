import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkClient } from "../src/networking/NetworkClient";
import { MultiplayerSession } from "../src/networking/MultiplayerSession";
import { PlayerController } from "../src/player/PlayerController";
import { PlayerPhysics } from "../src/player/PlayerPhysics";
import { validateServerMessage } from "../src/networking/ServerValidation";
import {
  validateClientMessage,
  PROTOCOL_VERSION,
} from "../src/networking/NetworkProtocol";

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  bufferedAmount = 0;
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  constructor() {
    Socket.instances.push(this);
  }
  send(value: string) {
    this.sent.push(value);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}
const status = {
  serverId: "test-server",
  online: true,
  serverName: "Test",
  worldName: "World",
  playerCount: 0,
  maxPlayers: 8,
  protocolVersion: PROTOCOL_VERSION,
};
const self = {
  id: "test",
  name: "Test",
  position: [0.5, 5, 0.5],
  velocity: [0, 0, 0],
  knockback: [0, 0, 0],
  yaw: 0,
  pitch: 0,
  mode: "creative",
  grounded: false,
  flying: true,
  sneaking: false,
  held: 0,
  action: 0,
  ack: 0,
  survival: { health: 20, hunger: 20, items: {} },
  durability: {},
  hotbar: Array(9).fill(0),
  spawnpoint: [0.5, 5, 0.5],
  role: "Player",
  dead: false,
};
const welcome = {
  type: "welcome",
  sessionId: "session",
  serverId: "test-server",
  viewDistance: 2,
  world: { seed: "test", version: 3, changes: [], height: 80 },
  self,
};
beforeEach(() => {
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("location", { protocol: "http:", host: "host:8800" });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => status })),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("client lifecycle and authoritative input", () => {
  it("cancels a connection while the status request is still pending", async () => {
    let release!: (value: unknown) => void;
    vi.stubGlobal("fetch", () => new Promise((r) => (release = r)));
    const client = new NetworkClient(
      "Test",
      () => {},
      () => {},
    );
    const connecting = client.connect();
    client.close();
    release({ ok: true, json: async () => status });
    await connecting;
    expect(Socket.instances).toHaveLength(0);
  });
  it("retries a lost acknowledgement with the same transaction ID and stops after acknowledgement", async () => {
    const client = new NetworkClient(
      "Test",
      () => {},
      () => {},
    );
    await client.connect();
    vi.useFakeTimers();
    const socket = Socket.instances[0];
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify(welcome) });
    expect(client.connected).toBe(true);
    client.send({
      type: "inventory",
      tx: "same-id",
      action: { kind: "close" },
    });
    await vi.advanceTimersByTimeAsync(2100);
    expect(
      socket.sent.map((s) => JSON.parse(s)).filter((m) => m.tx === "same-id"),
    ).toHaveLength(2);
    socket.onmessage?.({
      data: JSON.stringify({ type: "ack", tx: "same-id", ok: true }),
    });
    await vi.advanceTimersByTimeAsync(2100);
    expect(
      socket.sent.map((s) => JSON.parse(s)).filter((m) => m.tx === "same-id"),
    ).toHaveLength(2);
    client.close();
  });
  it("does not predict movement that could not be sent and keeps the next sequence usable", () => {
    const session = new MultiplayerSession(
        "Test",
        () => {},
        () => {},
      ),
      input = new PlayerController(),
      player = new PlayerPhysics({ solid: () => false });
    session.network.connected = true;
    player.position.set(0, 5, 0);
    player.flying = true;
    input.keys.add("KeyW");
    const send = vi.spyOn(session.network, "send").mockReturnValue(false);
    session.update(0.05, input, player);
    expect(player.position.z).toBe(0);
    send.mockReturnValue(true);
    session.update(0.05, input, player);
    expect(player.position.z).toBeLessThan(0);
    expect(send.mock.calls.at(-1)?.[0]).toMatchObject({
      type: "input",
      input: { seq: 1 },
    });
    session.close();
  });
});
describe("network runtime validation", () => {
  it.each([
    null,
    {},
    { type: "snapshot", players: [] },
    {
      type: "block",
      key: "0,0",
      revision: 1,
      change: { x: 100, y: 5, z: 0, id: 3 },
    },
    { type: "ack", tx: "", ok: true },
    { ...welcome, self: { ...self, position: [null, 0, 0] } },
    {
      ...welcome,
      self: {
        ...self,
        skin: { hash: "../../file", model: "classic", layers: true },
      },
    },
    {
      type: "chunk",
      key: "0,0",
      revision: 1,
      checksum: 0,
      changes: [[16, 5, 0, 3]],
      states: {},
    },
    {
      type: "chunk",
      key: "0,0",
      revision: 1,
      checksum: 0,
      changes: [],
      states: JSON.parse('{"__proto__":{"rotation":0}}'),
    },
  ])("rejects malformed server payload %#", (value) =>
    expect(() => validateServerMessage(value)).toThrow(),
  );
  it.each(["", " ", "\n", "x".repeat(81)])(
    "rejects invalid transaction IDs %j",
    (tx) =>
      expect(() =>
        validateClientMessage({ type: "action", tx, action: "mine" }),
      ).toThrow(),
  );
});
