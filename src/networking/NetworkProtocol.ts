import type { GameMode } from "../player/GameModes";
import type { SurvivalSave } from "../inventory/Survival";
import type { WorldSave } from "../storage/WorldStorage";
import type { Mob } from "../entities/MobSystem";
import type { SavedDrop } from "../inventory/DropSystem";
import type { BlockEntitySave } from "../world/BlockEntities";
import type { Projectile } from "../entities/Projectiles";
import type { XPOrb } from "../entities/ExperienceOrbs";
import type { InventoryAction } from "../inventory/InventoryTransactions";
export const PROTOCOL_VERSION = 3;
export const STEP = 1 / 20;
export const INPUT_KEYS = [
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "Space",
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
];
export interface MovementInput {
  seq: number;
  keys: string[];
  yaw: number;
  pitch: number;
  flying: boolean;
}
export interface SkinReference {
  hash: string;
  model: "classic" | "slim";
  layers: boolean;
}
export interface PlayerSnapshot {
  id: string;
  name: string;
  position: number[];
  velocity: number[];
  yaw: number;
  pitch: number;
  mode: GameMode;
  grounded: boolean;
  flying: boolean;
  sneaking: boolean;
  held: number;
  action: number;
  skin?: SkinReference;
}
export interface SelfSnapshot extends PlayerSnapshot {
  knockback: number[];
  ack: number;
  survival: SurvivalSave;
  durability: Record<number, number>;
  hotbar: number[];
  spawnpoint: number[];
  role: "Admin" | "Player";
  dead: boolean;
}
export interface ChunkSnapshot {
  checksum: number;
  blocks?: number[];
  type: "chunk";
  key: string;
  revision: number;
  changes: number[][];
  states: NonNullable<WorldSave["blockStates"]>;
}
export interface WorldSnapshot {
  type: "snapshot";
  tick: number;
  self: SelfSnapshot;
  players: PlayerSnapshot[];
  mobs: Mob[];
  drops: SavedDrop[];
  day: number;
  weather: NonNullable<WorldSave["weather"]>;
  rules: NonNullable<WorldSave["rules"]>;
  containers?: BlockEntitySave;
  tickMs: number;
  arrows: Projectile[];
  xpOrbs: XPOrb[];
}
export type ClientMessage =
  | { type: "inventory"; tx: string; action: InventoryAction }
  | {
      type: "hello";
      protocol: number;
      generator: number;
      name: string;
      token?: string;
    }
  | { type: "input"; input: MovementInput }
  | {
      type: "action";
      tx: string;
      action:
        | "stop"
        | "mine"
        | "place"
        | "use"
        | "attack"
        | "eat"
        | "respawn"
        | "equip"
        | "enchant";
      item?: number;
      key?: string;
    }
  | { type: "select"; slot: number; item: number }
  | {
      type: "craft";
      tx: string;
      grid: number[];
      size: number;
      repeat: boolean;
      station?: string;
    }
  | {
      type: "container";
      tx: string;
      key: string;
      slot: number;
      item: number;
      count: number;
      take: boolean;
    }
  | { type: "chat"; text: string }
  | { type: "skin"; png: string; model: "classic" | "slim"; layers: boolean }
  | { type: "resync"; key: string }
  | { type: "ping"; time: number };
export type ServerMessage =
  | {
      type: "welcome";
      token?: string;
      sessionId: string;
      serverId: string;
      viewDistance: number;
      world: WorldSave;
      self: SelfSnapshot;
    }
  | WorldSnapshot
  | ChunkSnapshot
  | {
      type: "block";
      key: string;
      revision: number;
      change: { x: number; y: number; z: number; id: number };
      state?: NonNullable<WorldSave["blockStates"]>[string];
    }
  | { type: "chat"; text: string; kind: "system" | "error" | "local" }
  | { type: "error"; message: string; fatal?: boolean }
  | { type: "shutdown"; message: string }
  | { type: "ack"; tx: string; ok: boolean; message?: string }
  | OpenContainerMessage
  | { type: "pong"; time: number };
export type OpenContainerMessage = {
  type: "open";
  key: string;
  kind: "table" | "chest" | "furnace";
  containers: BlockEntitySave;
};
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function integer(v: unknown, min: number, max: number) {
  return (
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max
  );
}
function text(v: unknown, max: number) {
  return typeof v === "string" && v.length <= max;
}
function transaction(v: unknown) {
  return typeof v === "string" && /^[A-Za-z0-9:_-]{1,80}$/.test(v);
}
function key(v: unknown) {
  return typeof v === "string" && /^-?\d{1,8},\d{1,3},-?\d{1,8}$/.test(v);
}
/** No client position, damage, inventory, permissions or arbitrary filenames are accepted. */
export function validateClientMessage(value: unknown): ClientMessage {
  if (!object(value)) throw Error("Ongeldig netwerkbericht.");
  const v = value;
  let valid = false;
  switch (v.type) {
    case "inventory": {
      const a = v.action,
        areas = ["inventory", "craft", "container", "output"];
      valid =
        transaction(v.tx) &&
        object(a) &&
        (a.kind === "close" ||
          (a.kind === "distribute" &&
            Array.isArray(a.slots) &&
            a.slots.length <= 72 &&
            (a.button === 0 || a.button === 2) &&
            a.slots.every(
              (slot) =>
                object(slot) &&
                ["inventory", "craft", "container"].includes(
                  String(slot.area),
                ) &&
                integer(slot.index, 0, 35),
            )) ||
          (a.kind === "click" &&
            areas.includes(String(a.area)) &&
            integer(a.index, 0, 35) &&
            (a.button === 0 || a.button === 2) &&
            typeof a.shift === "boolean") ||
          (a.kind === "move" &&
            areas.includes(String(a.from)) &&
            areas.includes(String(a.to)) &&
            integer(a.index, 0, 35) &&
            integer(a.target, 0, 35)) ||
          (a.kind === "hotbar" &&
            areas.includes(String(a.area)) &&
            integer(a.index, 0, 35) &&
            integer(a.hotbar, 0, 8)) ||
          (a.kind === "creative" &&
            integer(a.item, 1, 1000) &&
            (a.button === 0 || a.button === 2) &&
            typeof a.shift === "boolean") ||
          (a.kind === "recipe" && text(a.recipe, 80)));
      break;
    }
    case "hello":
      valid =
        integer(v.protocol, 1, 100) &&
        integer(v.generator, 1, 100) &&
        typeof v.name === "string" &&
        /^[A-Za-z0-9_ -]{1,20}$/.test(v.name) &&
        v.name.trim().length > 0 &&
        (v.token === undefined ||
          (typeof v.token === "string" && /^[a-f0-9]{64}$/.test(v.token)));
      break;
    case "input": {
      const i = v.input;
      valid =
        object(i) &&
        integer(i.seq, 0, 2147483647) &&
        Array.isArray(i.keys) &&
        i.keys.length <= INPUT_KEYS.length &&
        i.keys.every((k) => typeof k === "string" && INPUT_KEYS.includes(k)) &&
        typeof i.yaw === "number" &&
        Number.isFinite(i.yaw) &&
        Math.abs(i.yaw) < 1000000 &&
        typeof i.pitch === "number" &&
        Number.isFinite(i.pitch) &&
        Math.abs(i.pitch) <= 1.56 &&
        typeof i.flying === "boolean";
      break;
    }
    case "action":
      valid =
        transaction(v.tx) &&
        typeof v.action === "string" &&
        [
          "stop",
          "mine",
          "place",
          "use",
          "attack",
          "eat",
          "respawn",
          "equip",
          "enchant",
        ].includes(v.action) &&
        (v.item === undefined || integer(v.item, 0, 1000)) &&
        (v.key === undefined || text(v.key, 80));
      break;
    case "select":
      valid = integer(v.slot, 0, 8) && integer(v.item, 0, 1000);
      break;
    case "craft":
      valid =
        transaction(v.tx) &&
        (v.size === 2 || v.size === 3) &&
        Array.isArray(v.grid) &&
        v.grid.length === Number(v.size) ** 2 &&
        v.grid.every((n) => integer(n, 0, 1000)) &&
        typeof v.repeat === "boolean" &&
        (v.station === undefined || key(v.station));
      break;
    case "container":
      valid =
        transaction(v.tx) &&
        key(v.key) &&
        integer(v.slot, 0, 26) &&
        integer(v.item, 0, 1000) &&
        integer(v.count, 1, 64) &&
        typeof v.take === "boolean";
      break;
    case "chat":
      valid =
        text(v.text, 1024) &&
        typeof v.text === "string" &&
        !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(v.text);
      break;
    case "skin":
      valid =
        text(v.png, 50000) &&
        typeof v.png === "string" &&
        v.png.startsWith("data:image/png;base64,") &&
        (v.model === "classic" || v.model === "slim") &&
        typeof v.layers === "boolean";
      break;
    case "resync":
      valid = typeof v.key === "string" && /^-?\d{1,8},-?\d{1,8}$/.test(v.key);
      break;
    case "ping":
      valid = typeof v.time === "number" && Number.isFinite(v.time);
      break;
  }
  if (!valid)
    throw Error("Ongeldig of onbekend netwerkbericht: " + String(v.type));
  return v as unknown as ClientMessage;
}
