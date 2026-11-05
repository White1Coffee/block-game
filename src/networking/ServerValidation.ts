import type { ServerMessage } from "./NetworkProtocol";
import { gameruleDefinitions } from "../world/Gamerules";

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const number = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const integer = (v: unknown) => number(v) && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown) => typeof v === "string" && v.length <= 1024;
const vector = (v: unknown) =>
  Array.isArray(v) && v.length === 3 && v.every(number);
const chunkKey = (v: unknown) =>
  typeof v === "string" && /^-?\d{1,8},-?\d{1,8}$/.test(v);
const blockKey = (v: string) => /^-?\d{1,10},\d{1,3},-?\d{1,10}$/.test(v);
const mode = (v: unknown) =>
  ["creative", "survival", "adventure", "spectator"].includes(String(v));
function rules(v: unknown) {
  return (
    object(v) &&
    gameruleDefinitions.every((r) =>
      r.type === "boolean"
        ? typeof v[r.name] === "boolean"
        : integer(v[r.name]) &&
          Number(v[r.name]) >= r.min! &&
          Number(v[r.name]) <= r.max!,
    ) &&
    ["peaceful", "easy", "normal", "hard"].includes(String(v.difficulty)) &&
    number(v.dayLength) &&
    v.dayLength > 0
  );
}
const stack = (v: unknown): boolean =>
  v === null ||
  (object(v) &&
    integer(v.id) &&
    integer(v.count) &&
    Number(v.count) > 0 &&
    Number(v.count) <= 64);
function survival(v: unknown) {
  if (
    !object(v) ||
    !number(v.health) ||
    !number(v.hunger) ||
    !object(v.items) ||
    !Object.entries(v.items).every(
      ([key, n]) => /^\d+$/.test(key) && integer(n),
    )
  )
    return false;
  if (v.slotInventory === undefined) return true;
  const s = v.slotInventory;
  return (
    object(s) &&
    Array.isArray(s.slots) &&
    s.slots.length === 36 &&
    s.slots.every(stack) &&
    Array.isArray(s.craft) &&
    s.craft.length === 9 &&
    s.craft.every(stack) &&
    stack(s.cursor) &&
    integer(s.revision)
  );
}
function player(v: unknown, self = false): boolean {
  if (
    !object(v) ||
    !text(v.id) ||
    !text(v.name) ||
    !vector(v.position) ||
    !vector(v.velocity) ||
    !number(v.yaw) ||
    !number(v.pitch) ||
    !mode(v.mode) ||
    !["grounded", "flying", "sneaking"].every(
      (k) => typeof v[k] === "boolean",
    ) ||
    !integer(v.held) ||
    !number(v.action)
  )
    return false;
  if (
    v.skin !== undefined &&
    (!object(v.skin) ||
      typeof v.skin.hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(v.skin.hash) ||
      !["classic", "slim"].includes(String(v.skin.model)) ||
      typeof v.skin.layers !== "boolean")
  )
    return false;
  return (
    !self ||
    (vector(v.knockback) &&
      integer(v.ack) &&
      survival(v.survival) &&
      object(v.durability) &&
      Array.isArray(v.hotbar) &&
      v.hotbar.length === 9 &&
      v.hotbar.every(integer) &&
      vector(v.spawnpoint) &&
      ["Admin", "Player"].includes(String(v.role)) &&
      typeof v.dead === "boolean")
  );
}
function states(v: unknown) {
  return (
    object(v) &&
    Object.entries(v).every(
      ([k, s]) => blockKey(k) && object(s) && number(s.rotation),
    )
  );
}
function containers(v: unknown) {
  return (
    object(v) &&
    object(v.chests) &&
    object(v.furnaces) &&
    object(v.crops) &&
    Object.entries(v.chests).every(
      ([k, s]) =>
        blockKey(k) && Array.isArray(s) && s.length === 27 && s.every(stack),
    ) &&
    Object.entries(v.furnaces).every(
      ([k, f]) =>
        blockKey(k) &&
        object(f) &&
        stack(f.input) &&
        stack(f.fuel) &&
        stack(f.output) &&
        ["burn", "burnMax", "progress", "xp"].every((n) => number(f[n])),
    )
  );
}
/** Reject malformed data before it can enter world, inventory or rendering state. */
export function validateServerMessage(value: unknown): ServerMessage {
  let nodes = 0;
  const safe = (v: unknown, depth = 0): boolean => {
    if (++nodes > 200000 || depth > 24) return false;
    if (typeof v === "number") return number(v);
    if (v === null || ["string", "boolean", "undefined"].includes(typeof v))
      return true;
    if (Array.isArray(v)) return v.every((x) => safe(x, depth + 1));
    return (
      object(v) &&
      Object.entries(v).every(
        ([k, x]) =>
          !["__proto__", "constructor", "prototype"].includes(k) &&
          safe(x, depth + 1),
      )
    );
  };
  if (!object(value) || !safe(value)) throw Error("Ongeldig serverbericht.");
  const v = value;
  let valid = false;
  switch (v.type) {
    case "welcome":
      valid =
        text(v.sessionId) &&
        text(v.serverId) &&
        integer(v.viewDistance) &&
        Number(v.viewDistance) <= 16 &&
        (v.token === undefined ||
          (typeof v.token === "string" && /^[a-f0-9]{64}$/.test(v.token))) &&
        player(v.self, true) &&
        object(v.world) &&
        typeof v.world.seed === "string" &&
        integer(v.world.version) &&
        Array.isArray(v.world.changes) &&
        (v.world.height === undefined ||
          (integer(v.world.height) &&
            Number(v.world.height) >= 16 &&
            Number(v.world.height) <= 256));
      break;
    case "snapshot":
      valid =
        integer(v.tick) &&
        player(v.self, true) &&
        Array.isArray(v.players) &&
        v.players.length <= 32 &&
        v.players.every((p) => player(p)) &&
        Array.isArray(v.mobs) &&
        v.mobs.length <= 256 &&
        v.mobs.every(
          (m) =>
            object(m) &&
            text(m.id) &&
            [
              "cow",
              "pig",
              "sheep",
              "chicken",
              "hollow",
              "bonewalker",
              "burster",
              "crawler",
            ].includes(String(m.kind)) &&
            [
              "x",
              "y",
              "z",
              "vx",
              "vy",
              "vz",
              "yaw",
              "health",
              "timer",
              "cooldown",
              "hurt",
              "pathTimer",
              "age",
              "fuse",
            ].every((k) => number(m[k])),
        ) &&
        Array.isArray(v.drops) &&
        v.drops.every(
          (d) =>
            object(d) &&
            integer(d.id) &&
            integer(d.count) &&
            vector(d.position) &&
            number(d.age),
        ) &&
        Array.isArray(v.xpOrbs) &&
        v.xpOrbs.every(
          (o) =>
            object(o) &&
            text(o.id) &&
            number(o.amount) &&
            vector(o.position) &&
            number(o.age),
        ) &&
        Array.isArray(v.arrows) &&
        v.arrows.every(
          (a) =>
            object(a) &&
            text(a.id) &&
            text(a.owner) &&
            ["x", "y", "z", "vx", "vy", "vz", "age"].every((k) =>
              number(a[k]),
            ) &&
            typeof a.stuck === "boolean",
        ) &&
        number(v.day) &&
        number(v.tickMs) &&
        object(v.weather) &&
        ["clear", "rain", "thunder"].includes(String(v.weather.kind)) &&
        number(v.weather.remaining) &&
        integer(v.weather.cycle) &&
        rules(v.rules) &&
        (v.containers === undefined || containers(v.containers));
      break;
    case "chunk":
      valid =
        chunkKey(v.key) &&
        integer(v.revision) &&
        integer(v.checksum) &&
        states(v.states) &&
        Array.isArray(v.changes) &&
        v.changes.length <= 65536 &&
        v.changes.every(
          (c) =>
            Array.isArray(c) &&
            c.length === 4 &&
            c.every(integer) &&
            c[0] < 16 &&
            c[1] < 256 &&
            c[2] < 16 &&
            c[3] < 256,
        ) &&
        (v.blocks === undefined ||
          (Array.isArray(v.blocks) &&
            v.blocks.length >= 4096 &&
            v.blocks.length <= 65536 &&
            v.blocks.length % 256 === 0 &&
            v.blocks.every((n) => integer(n) && n < 256)));
      break;
    case "block":
      valid =
        chunkKey(v.key) &&
        integer(v.revision) &&
        object(v.change) &&
        ["x", "y", "z", "id"].every(
          (k) =>
            number((v.change as Record<string, unknown>)[k]) &&
            Number.isSafeInteger((v.change as Record<string, unknown>)[k]),
        ) &&
        integer(v.change.id) &&
        Number(v.change.id) < 256 &&
        `${Math.floor(Number(v.change.x) / 16)},${Math.floor(Number(v.change.z) / 16)}` ===
          v.key &&
        (v.state === undefined ||
          (object(v.state) && number(v.state.rotation)));
      break;
    case "ack":
      valid =
        typeof v.tx === "string" &&
        /^[A-Za-z0-9:_-]{1,80}$/.test(v.tx) &&
        typeof v.ok === "boolean" &&
        (v.message === undefined || text(v.message));
      break;
    case "chat":
      valid =
        text(v.text) && ["system", "error", "local"].includes(String(v.kind));
      break;
    case "error":
      valid =
        text(v.message) &&
        (v.fatal === undefined || typeof v.fatal === "boolean");
      break;
    case "shutdown":
      valid = text(v.message);
      break;
    case "pong":
      valid = number(v.time);
      break;
    case "open":
      valid =
        typeof v.key === "string" &&
        blockKey(v.key) &&
        ["table", "chest", "furnace"].includes(String(v.kind)) &&
        containers(v.containers);
      break;
  }
  if (!valid) throw Error("Ongeldig serverbericht: " + String(v.type));
  return v as unknown as ServerMessage;
}
