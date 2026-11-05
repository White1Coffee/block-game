import { randomBytes, randomUUID, createHash } from "node:crypto";
import { Vector3, Euler } from "three";
import { World } from "../src/world/World";
import { GENERATOR_VERSION } from "../src/world/WorldGenerator";
import { PlayerPhysics, playerEyeHeight } from "../src/player/PlayerPhysics";
import { PlayerController } from "../src/player/PlayerController";
import {
  configureGameMode,
  survivalLike,
  type GameMode,
} from "../src/player/GameModes";
import { Survival } from "../src/inventory/Survival";
import { block, blocks, INITIAL_HOTBAR } from "../src/blocks/BlockRegistry";
import {
  extras,
  tools,
  foods,
  enchantments,
  stackLimit,
} from "../src/inventory/ItemRegistry";
import { craftGrid } from "../src/inventory/RecipeRegistry";
import { BlockEntities, smelting, isFuel } from "../src/world/BlockEntities";
import {
  BlockInteractionSystem,
  placementPosition,
} from "../src/world/BlockInteractionSystem";
import { FireSystem } from "../src/world/FireSystem";
import { VoxelLighting } from "../src/world/VoxelLighting";
import { MobSystem, type Mob } from "../src/entities/MobSystem";
import { raycast, type VoxelHit } from "../src/blocks/BlockInteraction";
import { CommandRegistry } from "../src/commands/CommandRegistry";
import { parseCommand } from "../src/commands/CommandParser";
import { DEFAULT_RULES, migrateSave } from "../src/storage/SaveMigration";
import type { WorldSave } from "../src/storage/WorldStorage";
import type { SavedDrop } from "../src/inventory/DropSystem";
import type { Projectile } from "../src/entities/Projectiles";
import type { XPOrb } from "../src/entities/ExperienceOrbs";
import {
  STEP,
  type ClientMessage,
  type ServerMessage,
  type SelfSnapshot,
  type PlayerSnapshot,
  type SkinReference,
  type MovementInput,
} from "../src/networking/NetworkProtocol";
import type { ServerConfig } from "./ServerConfig";
import { WorldPersistence } from "./WorldPersistence";
import { chunkChecksum } from "../src/networking/ChunkChecksum";
import { inventoryAction } from "../src/inventory/InventoryTransactions";
import { inventoryContext } from "../src/inventory/InventoryContext";
type PlayerRecord = {
  flying?: boolean;
  id: string;
  tokenHash: string;
  name: string;
  mode: GameMode;
  position: number[];
  rotation: number[];
  survival: ReturnType<Survival["serialize"]>;
  durability: Record<number, number>;
  hotbar: number[];
  spawnpoint: number[];
  skin?: SkinReference;
};
export interface LANSave {
  schemaVersion: 1 | 2;
  serverId: string;
  world: WorldSave;
  players: PlayerRecord[];
  operators: string[];
  revisions: Record<string, number>;
  drops: SavedDrop[];
  xpOrbs: XPOrb[];
}
export interface ServerPlayer {
  hostAdmin?: boolean;
  record: PlayerRecord;
  physics: PlayerPhysics;
  controller: PlayerController;
  survival: Survival;
  send: (m: ServerMessage) => void;
  sessionId: string;
  ack: number;
  lastInput: number;
  queued: MovementInput[];
  selected: number;
  transactions: Map<string, Extract<ServerMessage, { type: "ack" }>>;
  chunks: Set<string>;
  chunkQueue: string[];
  mineKey: string;
  mineProgress: number;
  mineUntil: number;
  cooldown: number;
  action: number;
  eatUntil: number;
  eatId: number;
  container?: string;
  dead: boolean;
}
const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const keyOf = (x: number, z: number) =>
  `${Math.floor(x / 16)},${Math.floor(z / 16)}`;
export class ServerWorld {
  readonly players = new Map<string, ServerPlayer>();
  readonly world: World;
  readonly entities = new BlockEntities();
  readonly interactions: BlockInteractionSystem;
  readonly lighting: VoxelLighting;
  readonly fire: FireSystem;
  readonly mobs: MobSystem;
  readonly revisions = new Map<string, number>();
  readonly records = new Map<string, PlayerRecord>();
  readonly operators = new Set<string>();
  readonly commands = new CommandRegistry();
  readonly serverId: string;
  data: WorldSave;
  tick = 0;
  tickMs = 0;
  drops: SavedDrop[] = [];
  orbs: XPOrb[] = [];
  arrows: Projectile[] = [];
  private deltas: NonNullable<Extract<ServerMessage, { type: "block" }>>[] = [];
  private saveClock = 0;
  private weatherClock = 0;
  private mobSpawnIndex = 0;
  private chunkBudget = 4;
  constructor(
    readonly config: ServerConfig,
    readonly persistence: WorldPersistence<LANSave>,
    saved?: LANSave,
  ) {
    if (saved && ![1, 2].includes(saved.schemaVersion))
      throw Error("Onbekend LAN-saveschema; data is behouden.");
    this.serverId = saved?.serverId ?? randomUUID();
    this.data = migrateSave(
      saved?.world ?? {
        id: "lan-world",
        name: config.worldName,
        seed: config.seed,
        version: GENERATOR_VERSION,
        height: 80,
        updated: Date.now(),
        position: [8.5, 50, 8.5],
        rotation: [0, 0],
        hotbar: [...INITIAL_HOTBAR],
        changes: [],
        flying: false,
        rules: { ...DEFAULT_RULES },
      },
    );
    if (this.data.version !== GENERATOR_VERSION)
      throw Error("Serverwereld heeft een niet-ondersteunde generatorversie.");
    this.world = new World(
      this.data.seed,
      this.data.height ?? 80,
      this.data.version,
    );
    this.world.restore(this.data.changes);
    this.world.states = this.data.blockStates ?? {};
    this.entities.restore(this.data.blockEntities);
    this.interactions = new BlockInteractionSystem(this.world, this.entities);
    this.lighting = new VoxelLighting(this.world);
    this.world.lighting = this.lighting;
    this.fire = new FireSystem(this.world, this.data.fireState);
    for (const r of saved?.players ?? []) this.records.set(r.id, r);
    for (const id of [...config.adminIds, ...(saved?.operators ?? [])])
      this.operators.add(id);
    for (const [k, r] of Object.entries(saved?.revisions ?? {}))
      this.revisions.set(k, r);
    this.drops = structuredClone(saved?.drops ?? []);
    this.orbs = structuredClone(saved?.xpOrbs ?? []);
    this.mobs = new MobSystem({
      damage: (n, m, dir) => {
        const p = this.nearest(m, true);
        if (p && p.survival.damage(n)) {
          p.physics.knockback.set(dir[0] * 5, 0, dir[1] * 5);
          p.physics.velocity.y = 3;
        }
      },
      shoot: (m) => {
        const p = this.nearest(m, true);
        if (p)
          this.shoot(
            m.id,
            [m.x, m.y + 1.4, m.z],
            p.physics.position
              .clone()
              .add(new Vector3(0, 1, 0))
              .sub(new Vector3(m.x, m.y + 1.4, m.z))
              .normalize(),
            14,
          );
      },
      explode: (m) => this.explode(m),
      drop: (id, n, pos) => this.drop(id, n, pos),
      xp: (n, pos) =>
        this.orbs.push({ id: randomUUID(), amount: n, position: pos, age: 0 }),
      light: (x, y, z) =>
        this.lighting.level(
          x,
          y,
          z,
          Math.sin((this.data.day ?? 0) / 180 + 1) < 0,
        ),
      sound: () => {},
    });
    this.mobs.restore(this.data.mobs);
    this.mobs.maxMobs = 32;
    this.mobs.simulationDistance = config.simulationDistance * 16;
    this.world.events.subscribe(({ change }) => {
      const key = keyOf(change.x, change.z),
        revision = (this.revisions.get(key) ?? 0) + 1;
      this.revisions.set(key, revision);
      this.deltas.push({ type: "block", key, revision, change });
    });
  }
  static async open(config: ServerConfig, root?: string, lock = false) {
    const store = new WorldPersistence<LANSave>(config.worldName, root);
    if (lock) await store.acquireLock();
    try {
      const saved = await store.load((value) => {
        if (!value || typeof value !== "object") return false;
        const s = value as LANSave;
        return (
          Number.isInteger(s.schemaVersion) &&
          typeof s.serverId === "string" &&
          !!s.world &&
          typeof s.world.seed === "string" &&
          Array.isArray(s.world.changes) &&
          Array.isArray(s.players) &&
          Array.isArray(s.operators) &&
          !!s.revisions &&
          typeof s.revisions === "object"
        );
      });
      if (saved && saved.schemaVersion < 2)
        await store.backupBeforeMigration(`lan-v${saved.schemaVersion}`, saved);
      if (saved && (saved.world.schemaVersion ?? 0) < 5)
        await store.backupBeforeMigration(
          `world-v${saved.world.schemaVersion ?? 0}`,
          saved,
        );
      return new ServerWorld(config, store, saved);
    } catch (error) {
      if (lock) await store.releaseLock();
      throw error;
    }
  }
  join(name: string, token: string | undefined, send: ServerPlayer["send"]) {
    if (this.players.size >= this.config.maxPlayers)
      throw Error("Server is vol.");
    let record = token
      ? [...this.records.values()].find((r) => r.tokenHash === hashToken(token))
      : undefined;
    if (token && !record)
      throw Error(
        "Identiteitstoken ongeldig voor deze server. Verwijder alleen de LAN-identiteit via het multiplayer-menu om opnieuw te beginnen.",
      );
    if (record && this.players.has(record.id))
      throw Error(
        "Deze identiteit heeft al een actieve sessie. Sluit het andere tabblad.",
      );
    if (
      [...this.players.values()].some(
        (p) => p.record.name.toLowerCase() === name.trim().toLowerCase(),
      )
    )
      throw Error("Deze zichtbare naam is al in gebruik.");
    let issuedToken: string | undefined;
    if (!record) {
      issuedToken = randomBytes(32).toString("hex");
      const point = this.data.spawnpoint ?? [8.5, -1, 8.5],
        y =
          point[1] >= 0
            ? point[1]
            : this.world.generator.height(point[0], point[2]) + 3;
      record = {
        id: randomUUID(),
        tokenHash: hashToken(issuedToken),
        name: name.trim(),
        mode: this.config.defaultMode,
        position: [point[0], y, point[2]],
        rotation: [0, 0],
        survival: new Survival().serialize(),
        durability: {},
        hotbar: [...INITIAL_HOTBAR],
        spawnpoint: [point[0], y, point[2]],
      };
      this.records.set(record.id, record);
    }
    record.name = name.trim();
    const physics = new PlayerPhysics(this.world),
      survival = new Survival(record.survival, record.durability),
      controller = new PlayerController();
    physics.position.fromArray(record.position);
    physics.flying = record.flying ?? false;
    controller.yaw = record.rotation[0];
    controller.pitch = record.rotation[1];
    configureGameMode(record.mode, physics, survival);
    const p: ServerPlayer = {
      record,
      physics,
      survival,
      controller,
      send,
      sessionId: randomUUID(),
      ack: 0,
      lastInput: Date.now(),
      queued: [],
      selected: 0,
      transactions: new Map(),
      chunks: new Set(),
      chunkQueue: [],
      mineKey: "",
      mineProgress: 0,
      mineUntil: 0,
      cooldown: 0,
      action: 0,
      eatUntil: 0,
      eatId: 0,
      dead: survival.health <= 0,
    };
    if (!record.survival.slotInventory)
      survival.initializeHotbar(record.hotbar, record.mode === "creative");
    record.hotbar = survival.hotbarItems();
    this.players.set(record.id, p);
    return { player: p, token: issuedToken };
  }
  leave(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    this.capturePlayer(p);
    this.players.delete(id);
    this.broadcast({
      type: "chat",
      kind: "system",
      text: p.record.name + " heeft de server verlaten.",
    });
  }
  capturePlayer(p: ServerPlayer) {
    Object.assign(p.record, {
      position: p.physics.position.toArray(),
      rotation: [p.controller.yaw, p.controller.pitch],
      survival: p.survival.serialize(),
      durability: { ...p.survival.durability },
      flying: p.physics.flying,
    });
  }
  broadcast(message: ServerMessage) {
    for (const p of this.players.values()) p.send(message);
  }
  nearest(position: { x: number; y: number; z: number }, damageable = false) {
    return [...this.players.values()]
      .filter((p) => !p.dead && (!damageable || survivalLike(p.record.mode)))
      .sort(
        (a, b) =>
          a.physics.position.distanceToSquared(position) -
          b.physics.position.distanceToSquared(position),
      )[0];
  }
  snapshotPlayer(p: ServerPlayer): PlayerSnapshot {
    p.record.hotbar = p.survival.hotbarItems();
    return {
      id: p.record.id,
      name: p.record.name,
      position: p.physics.position.toArray(),
      velocity: p.physics.velocity.toArray(),
      yaw: p.controller.yaw,
      pitch: p.controller.pitch,
      mode: p.record.mode,
      grounded: p.physics.grounded,
      flying: p.physics.flying,
      sneaking: p.physics.sneaking,
      held: p.record.hotbar[p.selected],
      action: p.action,
      skin: p.record.skin,
    };
  }
  self(p: ServerPlayer): SelfSnapshot {
    return {
      knockback: p.physics.knockback.toArray(),
      ...this.snapshotPlayer(p),
      ack: p.ack,
      survival: p.survival.serialize(),
      durability: { ...p.survival.durability },
      hotbar: [...p.record.hotbar],
      spawnpoint: p.record.spawnpoint,
      role: this.isAdmin(p) ? "Admin" : "Player",
      dead: p.dead,
    };
  }
  welcomeWorld(): WorldSave {
    return {
      ...this.data,
      changes: [],
      blockStates: {},
      blockEntities: undefined,
      mobs: [],
      drops: [],
      xpOrbs: [],
      survival: undefined,
    };
  }
  op(id: string, enabled = true) {
    if (!this.records.has(id)) throw Error("Onbekend player-ID.");
    if (enabled) this.operators.add(id);
    else this.operators.delete(id);
    this.players.get(id)?.send({
      type: "chat",
      kind: "system",
      text: enabled
        ? "Je bent nu Admin."
        : this.players.get(id)?.hostAdmin
          ? "Je blijft automatisch Admin op de servercomputer."
          : "Je bent nu Player.",
    });
  }
  private isAdmin(p: ServerPlayer) {
    return p.hostAdmin === true || this.operators.has(p.record.id);
  }
  look(p: ServerPlayer) {
    return raycast(
      this.world,
      p.physics.position
        .clone()
        .add(new Vector3(0, playerEyeHeight(p.physics.sneaking), 0)),
      new Vector3(0, 0, -1).applyEuler(
        new Euler(p.controller.pitch, p.controller.yaw, 0, "YXZ"),
      ),
      6,
    );
  }
  distanceKey(p: ServerPlayer, key: string, id?: number) {
    const [x, y, z] = key.split(",").map(Number);
    return (
      Number.isFinite(x + y + z) &&
      p.physics.position.distanceTo(new Vector3(x + 0.5, y + 0.5, z + 0.5)) <=
        6 &&
      (id === undefined || this.world.get(x, y, z) === id)
    );
  }
  transact(p: ServerPlayer, tx: string, fn: () => void) {
    const previous = p.transactions.get(tx);
    if (previous) {
      p.send(previous);
      return;
    }
    let ack: Extract<ServerMessage, { type: "ack" }>;
    try {
      fn();
      ack = { type: "ack", tx, ok: true };
    } catch (e) {
      ack = {
        type: "ack",
        tx,
        ok: false,
        message: e instanceof Error ? e.message : "Actie geweigerd.",
      };
    }
    p.transactions.set(tx, ack);
    if (p.transactions.size > 2048)
      p.transactions.delete(p.transactions.keys().next().value!);
    p.send(ack);
  }
  handle(p: ServerPlayer, m: ClientMessage) {
    if (m.type === "inventory") {
      this.transact(p, m.tx, () => {
        if (p.dead || p.record.mode === "spectator")
          throw Error("Inventory is niet beschikbaar.");
        let station: null | {
          kind: "table" | "chest" | "furnace";
          key: string;
        } = null;
        if (p.container && this.distanceKey(p, p.container)) {
          const [x, y, z] = p.container.split(",").map(Number),
            id = this.world.get(x, y, z);
          if ([19, 20, 62].includes(id))
            station = {
              key: p.container,
              kind: id === 19 ? "table" : id === 20 ? "furnace" : "chest",
            };
        }
        const context = inventoryContext(
          p.survival,
          p.record.mode === "creative",
          station,
          this.entities,
          (stack) =>
            this.drop(
              stack.id,
              stack.count,
              p.physics.position
                .clone()
                .add(new Vector3(0, 0.8, 0))
                .toArray(),
              stack,
            ),
        );
        const f =
          station?.kind === "furnace"
            ? this.entities.furnace(station.key)
            : null;
        context.onOutput = (index) => {
          if (f && index === 2) {
            p.survival.addXP(f.xp);
            f.xp = 0;
          }
        };
        inventoryAction(p.survival, m.action, context);
        if (f && context.container)
          [f.input, f.fuel, f.output] = context.container;
        if (m.action.kind === "close") p.container = undefined;
        p.record.hotbar = p.survival.hotbarItems();
      });
      return;
    }
    if (m.type === "input") {
      if (p.dead) {
        p.ack = m.input.seq;
        return;
      }
      if (
        m.input.seq <= Math.max(p.ack, p.queued.at(-1)?.seq ?? 0) ||
        m.input.seq > p.ack + 200 ||
        p.queued.some((q) => q.seq === m.input.seq)
      )
        return;
      p.queued.push(m.input);
      if (p.queued.length > 4) p.queued.shift();
      p.lastInput = Date.now();
      return;
    }
    if (m.type === "ping") {
      p.send({ type: "pong", time: m.time });
      return;
    }
    if (m.type === "resync") {
      if (p.chunks.has(m.key)) this.sendChunk(p, m.key, true);
      return;
    }
    if (m.type === "chat") {
      this.chat(p, m.text);
      return;
    }
    if (m.type === "select") {
      if (p.selected !== m.slot) {
        p.mineKey = "";
        p.mineProgress = 0;
      }
      p.selected = m.slot;
      p.survival.selectedSlot = m.slot;
      return;
    }
    if (m.type === "action") this.transact(p, m.tx, () => this.action(p, m));
    if (m.type === "craft")
      this.transact(p, m.tx, () => {
        if (p.dead || p.record.mode === "spectator")
          throw Error("Crafting is niet beschikbaar.");
        if (m.size === 3 && (!m.station || !this.distanceKey(p, m.station, 19)))
          throw Error("Werkbank buiten bereik.");
        if (!craftGrid(p.survival, m.grid, m.size, m.repeat))
          throw Error("Ingrediënten ontbreken of inventory is vol.");
      });
    if (m.type === "container")
      this.transact(p, m.tx, () => {
        if (
          p.dead ||
          p.record.mode === "spectator" ||
          p.container !== m.key ||
          !this.distanceKey(p, m.key)
        )
          throw Error("Container buiten bereik.");
        const [x, y, z] = m.key.split(",").map(Number),
          id = this.world.get(x, y, z);
        if (id !== 62 && id !== 20) throw Error("Container bestaat niet meer.");
        const f = id === 20 ? this.entities.furnace(m.key) : null,
          slots = f ? [f.input, f.fuel, f.output] : this.entities.chest(m.key);
        if (m.slot >= slots.length) throw Error("Ongeldig slot.");
        let ok = false;
        if (m.take) {
          ok = this.entities.transferFrom(p.survival, slots, m.slot);
          if (ok && f && m.slot === 2) {
            p.survival.addXP(f.xp);
            f.xp = 0;
          }
        } else if (
          !(f && m.slot === 2) &&
          !(f && m.slot === 1 && !isFuel(m.item)) &&
          !(f && m.slot === 0 && !smelting[m.item])
        )
          ok = this.entities.transferTo(
            p.survival,
            slots,
            m.slot,
            m.item,
            m.count,
          );
        if (f) [f.input, f.fuel, f.output] = slots;
        if (!ok)
          throw Error("Overdracht geweigerd; voorraad of ruimte is veranderd.");
      });
  }
  chat(p: ServerPlayer, text: string) {
    const clean = text.trim();
    if (!clean) return;
    if (!clean.startsWith("/")) {
      this.broadcast({
        type: "chat",
        kind: "local",
        text: `<${p.record.name}> ${clean.slice(0, 256)}`,
      });
      return;
    }
    const tokens = parseCommand(clean).map((t) => t.value),
      name = tokens[0];
    let target = p,
      line = clean;
    const isAdmin = this.isAdmin(p),
      allowed = (permission: string) =>
        permission === "command.help" ||
        (this.config.allowCommands &&
          (isAdmin ||
            this.config.playerCommands.includes(
              permission.replace("command.", ""),
            )));
    const isGamemode = name === "gamemode" || name === "gm";
    if (isGamemode && tokens.length === 3) {
      if (!isAdmin) throw Error("Alleen Admin mag andere spelers wijzigen.");
      target =
        tokens[2] === "@s"
          ? p
          : [...this.players.values()].find(
              (t) => t.record.name.toLowerCase() === tokens[2].toLowerCase(),
            )!;
      if (!target) throw Error(`Speler niet online: ${tokens[2]}.`);
      line = "/" + name + " " + tokens[1];
    }
    if (name === "give" && tokens[1] && tokens[1] !== "@s") {
      const other = [...this.players.values()].find(
        (t) => t.record.name.toLowerCase() === tokens[1].toLowerCase(),
      );
      if (other) {
        if (other !== p && !isAdmin)
          throw Error("Alleen Admin mag items aan anderen geven.");
        target = other;
      }
    }
    const result = this.commands.execute(line, {
      playerName: target.record.name,
      position: p.physics.position,
      yaw: p.controller.yaw,
      inventory: target.survival,
      world: this.world,
      mobs: this.mobs,
      rules: this.data.rules!,
      hasPermission: allowed,
      setMode: (mode) => {
        target.record.mode = mode;
        target.mineProgress = 0;
        target.mineKey = "";
        target.mineUntil = 0;
        target.eatUntil = 0;
        target.action = 0;
        target.queued = [];
        target.controller.clear();
        configureGameMode(mode, target.physics, target.survival);
      },
      setRule: (key, value) => {
        (this.data.rules as unknown as Record<string, boolean | number>)[key] =
          value;
      },
    });
    p.send({
      type: "chat",
      kind: result.ok ? "system" : "error",
      text:
        result.ok && isGamemode
          ? `Gamemode van ${target.record.name} gewijzigd naar ${target.record.mode}.`
          : result.message,
    });
    if (result.changed && isGamemode && target !== p)
      target.send({
        type: "chat",
        kind: "system",
        text: `${p.record.name} heeft je gamemode gewijzigd naar ${target.record.mode}.`,
      });
    if (result.changed)
      void this.save().catch((e) =>
        p.send({ type: "error", message: "Opslaan mislukt: " + String(e) }),
      );
  }
  action(p: ServerPlayer, m: Extract<ClientMessage, { type: "action" }>) {
    if (m.action === "stop") {
      p.mineKey = "";
      p.mineProgress = 0;
      p.mineUntil = 0;
      return;
    }
    if (m.action === "respawn") {
      if (!p.dead) throw Error("Je bent niet dood.");
      const kept = p.survival;
      p.survival = new Survival();
      if (this.data.rules!.keepInventory) {
        p.survival = new Survival(
          {
            ...kept.serialize(),
            health: 20,
            hunger: 20,
            saturation: 5,
            air: 10,
          },
          kept.durability,
        );
        p.survival.durability = kept.durability;
        p.survival.enchantments = kept.enchantments;
        p.survival.equipment = kept.equipment;
        p.survival.xp = kept.xp;
      }
      p.dead = false;
      p.physics.position.fromArray(p.record.spawnpoint);
      configureGameMode(p.record.mode, p.physics, p.survival);
      return;
    }
    if (p.dead || p.record.mode === "spectator")
      throw Error("Geen interactie in deze staat.");
    const selected = p.record.hotbar[p.selected];
    if (m.action === "equip") {
      if (!p.survival.count(131)) throw Error("Borstplaat ontbreekt.");
      p.survival.equipment = p.survival.equipment ? 0 : 131;
      return;
    }
    if (m.action === "enchant") {
      if (
        !m.key ||
        !Object.hasOwn(enchantments, m.key) ||
        !p.survival.enchant(selected, m.key as keyof typeof enchantments)
      )
        throw Error("Enchantment niet mogelijk.");
      return;
    }
    if (m.action === "eat") {
      const food = foods[selected] ? selected : 105;
      if (
        !survivalLike(p.record.mode) ||
        !foods[food] ||
        !p.survival.count(food) ||
        p.survival.hunger >= 20
      )
        throw Error("Je kunt dit niet eten.");
      if (!p.eatUntil) {
        p.eatUntil = this.tick + 26;
        p.eatId = food;
      }
      return;
    }
    if (m.action === "attack") {
      if (p.cooldown > 0) return;
      const eye = p.physics.position.clone().add(new Vector3(0, 1.5, 0)),
        dir = new Vector3(0, 0, -1).applyEuler(
          new Euler(p.controller.pitch, p.controller.yaw, 0, "YXZ"),
        );
      const candidates = this.mobs.mobs
        .filter((m) => m.state !== "Dead")
        .map((m) => ({ m, v: new Vector3(m.x, m.y + 0.9, m.z).sub(eye) }))
        .filter(({ m, v }) => {
          const d = v.dot(dir);
          return (
            d > 0 &&
            d < 3.5 &&
            v.clone().addScaledVector(dir, -d).length() < 0.8 &&
            this.mobs.lineOfSight(
              this.world,
              { x: eye.x, y: eye.y - 1, z: eye.z },
              m,
            )
          );
        })
        .sort((a, b) => a.v.lengthSq() - b.v.lengthSq());
      const mob = candidates[0]?.m;
      if (this.config.pvpEnabled) {
        const target = [...this.players.values()]
          .filter((t) => t !== p && !t.dead && survivalLike(t.record.mode))
          .map((t) => ({
            t,
            v: t.physics.position
              .clone()
              .add(new Vector3(0, 0.9, 0))
              .sub(eye),
          }))
          .filter(({ t, v }) => {
            const d = v.dot(dir);
            return (
              d > 0 &&
              d < 3.5 &&
              v.clone().addScaledVector(dir, -d).length() < 0.7 &&
              this.mobs.lineOfSight(
                this.world,
                { x: eye.x, y: eye.y - 1, z: eye.z },
                t.physics.position,
              )
            );
          })
          .sort((a, b) => a.v.lengthSq() - b.v.lengthSq())[0];
        if (
          target &&
          (!mob || target.v.lengthSq() < candidates[0].v.lengthSq())
        ) {
          if (
            target.t.survival.damage(
              p.record.mode === "creative"
                ? 20
                : p.survival.attackDamage(
                    selected,
                    !p.physics.grounded && p.physics.velocity.y < 0,
                  ),
            )
          ) {
            const knock = target.t.physics.position
              .clone()
              .sub(p.physics.position)
              .setY(0)
              .normalize();
            target.t.physics.knockback.copy(knock).multiplyScalar(5);
            target.t.physics.velocity.y = 3;
            if (survivalLike(p.record.mode)) p.survival.useTool(selected);
            p.cooldown = tools[selected]?.cooldown ?? 0.5;
            p.action = 1;
          }
          return;
        }
      }
      if (mob) {
        const knock = new Vector3(mob.x, 0, mob.z)
          .sub(new Vector3(eye.x, 0, eye.z))
          .normalize();
        if (
          this.mobs.hurt(
            mob,
            p.record.mode === "creative"
              ? 20
              : p.survival.attackDamage(
                  selected,
                  !p.physics.grounded && p.physics.velocity.y < 0,
                ),
            [knock.x, knock.z],
          )
        ) {
          if (survivalLike(p.record.mode)) p.survival.useTool(selected);
          p.action = 1;
          p.cooldown = tools[selected]?.cooldown ?? 0.5;
        }
      }
      return;
    }
    if (p.cooldown > 0) return;
    if ((m.action === "use" || m.action === "place") && selected === 116) {
      if (
        p.record.mode === "creative" ||
        (p.survival.count(116) > 0 && p.survival.consume(115))
      ) {
        this.shoot(
          p.record.id,
          p.physics.position
            .clone()
            .add(new Vector3(0, 1.5, 0))
            .toArray(),
          new Vector3(0, 0, -1).applyEuler(
            new Euler(p.controller.pitch, p.controller.yaw, 0, "YXZ"),
          ),
          20,
        );
        p.cooldown = 0.7;
        if (survivalLike(p.record.mode)) p.survival.useTool(116);
      }
      return;
    }
    const h = this.look(p);
    if (!h || !p.chunks.has(keyOf(h.x, h.z)))
      throw Error("Blok buiten bereik of chunk nog niet geladen.");
    const id = this.world.get(h.x, h.y, h.z),
      key = `${h.x},${h.y},${h.z}`;
    if (m.action === "mine") {
      if (
        p.record.mode === "adventure" ||
        (id === 16 && p.record.mode !== "creative")
      )
        return;
      if (p.record.mode === "creative") {
        this.breakBlock(p, h);
        p.cooldown = 0.16;
      } else {
        if (p.mineKey !== key) {
          p.mineKey = key;
          p.mineProgress = 0;
        }
        p.mineUntil = this.tick + 6;
      }
      return;
    }
    if (m.action === "use" || m.action === "place") {
      if (!p.physics.sneaking) {
        if (this.interactions.toggle(h.x, h.y, h.z)) {
          p.cooldown = 0.2;
          return;
        }
        if (id === 63) {
          p.record.spawnpoint = [h.x + 0.5, h.y + 1, h.z + 0.5];
          if (Math.sin((this.data.day ?? 0) / 180 + 1) < 0)
            this.data.day =
              (Math.floor(((this.data.day ?? 0) / 180 + 1) / (Math.PI * 2)) +
                1) *
              Math.PI *
              360;
          return;
        }
        if ([19, 20, 62].includes(id)) {
          if (id === 62) this.interactions.prepareChest(h.x, h.y, h.z);
          p.container = key;
          p.send({
            type: "open",
            key,
            kind: id === 19 ? "table" : id === 20 ? "furnace" : "chest",
            containers: this.nearbyContainers(p),
          });
          return;
        }
      }
      if (p.record.mode === "adventure") return;
      const { x, y, z } = placementPosition(this.world, h);
      if (
        tools[selected]?.kind === "hoe" &&
        (p.record.mode === "creative" || p.survival.count(selected) > 0) &&
        this.interactions.till(h.x, h.y, h.z)
      ) {
        if (survivalLike(p.record.mode)) p.survival.useTool(selected);
        return;
      }
      if (
        selected === 117 &&
        (p.record.mode === "creative" || p.survival.count(selected) > 0) &&
        this.interactions.plant(x, y, z)
      ) {
        if (survivalLike(p.record.mode)) p.survival.consume(selected);
        return;
      }
      if (
        !blocks[selected] ||
        (selected === 16 && survivalLike(p.record.mode)) ||
        (survivalLike(p.record.mode) && !p.survival.count(selected))
      )
        throw Error("Geen blok in dit slot.");
      if (
        block(selected).solid &&
        [...this.players.values()].some(
          (other) =>
            other.record.mode !== "spectator" &&
            other.physics.intersects(x, y, z),
        )
      )
        throw Error("Er staat een speler in de weg.");
      if (
        this.interactions.place(
          selected,
          x,
          y,
          z,
          Math.round(p.controller.yaw / (Math.PI / 2)),
          h.normal,
          (bx, by, bz) =>
            [...this.players.values()].some(
              (other) =>
                other.record.mode !== "spectator" &&
                other.physics.intersects(bx, by, bz),
            ),
        )
      ) {
        if (survivalLike(p.record.mode)) p.survival.consume(selected);
        p.action = 1;
        p.cooldown = 0.18;
      }
    }
  }
  breakBlock(p: ServerPlayer, h: VoxelHit) {
    const id = this.world.get(h.x, h.y, h.z);
    if (!id || (id === 16 && p.record.mode !== "creative")) return;
    if (!this.world.set(h.x, h.y, h.z, 0)) return;
    this.interactions.removeDoor(h.x, h.y, h.z, id);
    delete this.world.states[`${h.x},${h.y},${h.z}`];
    this.entities.break(`${h.x},${h.y},${h.z}`, (i, n, meta) => {
      if (this.data.rules!.doTileDrops)
        this.drop(i, n, [h.x + 0.5, h.y + 0.5, h.z + 0.5], meta);
    });
    if (survivalLike(p.record.mode)) {
      const tool = p.record.hotbar[p.selected];
      if (this.data.rules!.doTileDrops) {
        this.drop(p.survival.dropFor(id, tool), 1, [
          h.x + 0.5,
          h.y + 0.5,
          h.z + 0.5,
        ]);
        if (id === 52) this.drop(117, 2, [h.x + 0.5, h.y + 0.5, h.z + 0.5]);
        if ([12, 15, 52].includes(id))
          this.orbs.push({
            id: randomUUID(),
            amount: id === 15 ? 5 : 1,
            position: [h.x + 0.5, h.y + 0.5, h.z + 0.5],
            age: 0,
          });
      }
      p.survival.useTool(tool);
      p.survival.exhaust(0.2);
    }
    p.action = 1;
    p.mineProgress = 0;
    p.mineKey = "";
  }
  drop(
    id: number,
    count: number,
    position: number[],
    metadata: Partial<SavedDrop> = {},
  ) {
    if (!id || count <= 0) return;
    while (count > 0) {
      const n = Math.min(stackLimit(id), count);
      this.drops.push({
        ...metadata,
        id,
        count: n,
        position: [...position],
        entityId: randomUUID(),
        age: 0,
      });
      count -= n;
    }
  }
  shoot(owner: string, from: number[], dir: Vector3, speed: number) {
    if (this.arrows.length >= 128) return;
    this.arrows.push({
      id: randomUUID(),
      owner,
      x: from[0],
      y: from[1],
      z: from[2],
      vx: dir.x * speed,
      vy: dir.y * speed,
      vz: dir.z * speed,
      age: 0,
      stuck: false,
    });
  }
  explode(m: Mob) {
    for (const p of this.players.values())
      if (
        survivalLike(p.record.mode) &&
        p.physics.position.distanceTo(new Vector3(m.x, m.y, m.z)) < 5 &&
        this.mobs.lineOfSight(this.world, m, p.physics.position)
      )
        p.survival.damage(
          Math.max(
            1,
            12 - p.physics.position.distanceTo(new Vector3(m.x, m.y, m.z)) * 2,
          ),
        );
    if (!this.data.rules!.mobGriefing) return;
    for (let y = -2; y <= 2; y++)
      for (let x = -3; x <= 3; x++)
        for (let z = -3; z <= 3; z++)
          if (x * x + y * y + z * z < 9) {
            const wx = Math.floor(m.x) + x,
              wy = Math.floor(m.y) + y,
              wz = Math.floor(m.z) + z,
              id = this.world.get(wx, wy, wz);
            if (![0, 16, 24, 11].includes(id)) {
              this.world.set(wx, wy, wz, 0);
              this.entities.break(`${wx},${wy},${wz}`, (i, n, meta) => {
                if (this.data.rules!.doTileDrops)
                  this.drop(i, n, [wx + 0.5, wy + 0.5, wz + 0.5], meta);
              });
            }
          }
  }
  sendChunk(p: ServerPlayer, key: string, full = false) {
    const [cx, cz] = key.split(",").map(Number),
      changes = [...this.world.chunkChanges(cx, cz)].map((c) => [
        c.x - cx * 16,
        c.y,
        c.z - cz * 16,
        c.id,
      ]);
    const states = Object.fromEntries(
      Object.entries(this.world.states).filter(([k]) => {
        const [x, , z] = k.split(",").map(Number);
        return keyOf(x, z) === key;
      }),
    );
    p.send({
      type: "chunk",
      checksum: chunkChecksum(this.world.ensure(cx, cz)),
      blocks: full ? Array.from(this.world.ensure(cx, cz)) : undefined,
      key,
      revision: this.revisions.get(key) ?? 0,
      changes,
      states,
    });
    p.chunks.add(key);
  }
  subscriptions(p: ServerPlayer) {
    const cx = Math.floor(p.physics.position.x / 16),
      cz = Math.floor(p.physics.position.z / 16),
      r = this.config.viewDistance;
    for (const key of p.chunks) {
      const [x, z] = key.split(",").map(Number);
      if (Math.abs(x - cx) > r || Math.abs(z - cz) > r) p.chunks.delete(key);
    }
    p.chunkQueue = p.chunkQueue.filter((key) => {
      const [x, z] = key.split(",").map(Number);
      return Math.abs(x - cx) <= r && Math.abs(z - cz) <= r;
    });
    const desired: string[] = [];
    for (let z = cz - r; z <= cz + r; z++)
      for (let x = cx - r; x <= cx + r; x++) {
        const k = `${x},${z}`;
        if (!p.chunks.has(k)) desired.push(k);
      }
    desired.sort((a, b) => {
      const [x, z] = a.split(",").map(Number),
        [u, v] = b.split(",").map(Number);
      return (x - cx) ** 2 + (z - cz) ** 2 - (u - cx) ** 2 - (v - cz) ** 2;
    });
    for (const key of desired.slice(0, Math.min(2, this.chunkBudget))) {
      this.sendChunk(p, key);
      this.chunkBudget--;
    }
  }
  step() {
    const start = performance.now();
    this.tick++;
    this.chunkBudget = 4;
    const rules = this.data.rules!,
      active = [...this.players.values()];
    this.mobs.doMobLoot = rules.doMobLoot;
    this.mobs.doMobSpawning = rules.doMobSpawning;
    const targets = active.filter(
      (p) => !p.dead && survivalLike(p.record.mode),
    );
    this.mobs.targetable = targets.length > 0;
    for (const p of active) {
      p.cooldown = Math.max(0, p.cooldown - STEP);
      p.action = Math.max(0, p.action - STEP * 4);
      p.survival.naturalRegeneration = rules.naturalRegeneration;
      p.survival.difficulty = rules.difficulty;
      if (p.dead) continue;
      const input = p.queued.shift();
      if (input) {
        p.ack = input.seq;
        p.controller.keys = new Set(input.keys);
        p.controller.yaw = input.yaw;
        p.controller.pitch = input.pitch;
        p.physics.flying =
          p.record.mode === "spectator" ||
          (p.record.mode === "creative" && input.flying);
      } else if (Date.now() - p.lastInput > 300) p.controller.clear();
      p.physics.swimming =
        this.world.get(
          p.physics.position.x,
          p.physics.position.y + 0.7,
          p.physics.position.z,
        ) === 11;
      p.physics.climbing =
        this.world.get(
          p.physics.position.x,
          p.physics.position.y + 0.5,
          p.physics.position.z,
        ) === 64;
      p.controller.canSprint =
        !survivalLike(p.record.mode) || p.survival.hunger > 6;
      p.controller.update(p.physics, STEP);
      if (p.physics.position.y < -20 && p.record.mode !== "spectator") {
        p.physics.position.fromArray(p.record.spawnpoint);
        p.physics.velocity.set(0, 0, 0);
        p.survival.resetFall();
      }
      if (
        p.mineUntil >= this.tick &&
        p.mineKey &&
        p.record.mode === "survival"
      ) {
        const h = this.look(p);
        if (h && `${h.x},${h.y},${h.z}` === p.mineKey) {
          p.mineProgress +=
            STEP /
            p.survival.miningTime(
              this.world.get(h.x, h.y, h.z),
              p.record.hotbar[p.selected],
            );
          p.action = 0.5;
          if (p.mineProgress >= 1) this.breakBlock(p, h);
        } else {
          p.mineKey = "";
          p.mineProgress = 0;
        }
      }
      if (p.eatUntil && this.tick >= p.eatUntil) {
        p.survival.eat(p.eatId);
        p.eatUntil = 0;
      }
      if (p.eatUntil) p.action = 0.6;
      if (survivalLike(p.record.mode)) {
        const pos = p.physics.position;
        p.survival.tick(
          STEP,
          pos.y,
          p.physics.grounded,
          p.physics.swimming,
          Math.hypot(p.physics.velocity.x, p.physics.velocity.z) > 1,
          p.controller.keys.has("ControlLeft"),
          {
            submerged: this.world.get(pos.x, pos.y + 1.5, pos.z) === 11,
            lava: this.world.get(pos.x, pos.y + 0.2, pos.z) === 23,
            fire: this.world.get(pos.x, pos.y + 0.2, pos.z) === 66,
          },
        );
        if (p.survival.health <= 0) this.death(p);
      }
    }
    // Tick each block entity once, even where players' simulation areas overlap.
    if (active.length) {
      const centers = active.map((p) => p.physics.position),
        center = centers[this.tick % centers.length];
      this.entities.tick(
        STEP,
        this.world,
        center,
        this.config.simulationDistance * 16,
        rules.randomTickSpeed,
        centers,
      );
      this.fire.tick(
        STEP,
        rules.doFireTick,
        center,
        this.config.simulationDistance * 16,
        centers,
      );
      const focus = active[this.mobSpawnIndex++ % active.length];
      this.mobs.update(
        this.world,
        STEP,
        focus.physics.position,
        Math.sin((this.data.day ?? 0) / 180 + 1) < 0,
        rules.difficulty === "peaceful",
        targets.map((p) => p.physics.position),
        centers,
      );
    }
    this.updateItems();
    this.updateArrows();
    if (rules.doDaylightCycle)
      this.data.day =
        (this.data.day ?? 0) + (STEP * Math.PI * 360) / rules.dayLength;
    this.data.weather ??= { kind: "clear", remaining: 180, cycle: 0 };
    if (rules.doWeatherCycle && (this.data.weather.remaining -= STEP) <= 0) {
      const w = this.data.weather;
      w.cycle++;
      const roll = this.world.generator.random(w.cycle, 53, 718);
      w.kind = roll < 0.55 ? "clear" : roll < 0.88 ? "rain" : "thunder";
      w.remaining = 120 + this.world.generator.random(w.cycle, 71, 718) * 180;
    }
    for (const delta of this.deltas) {
      delta.state =
        this.world.states[
          `${delta.change.x},${delta.change.y},${delta.change.z}`
        ];
      for (const p of active) if (p.chunks.has(delta.key)) p.send(delta);
    }
    this.deltas = [];
    const streamingOrder = [
      ...active.slice(this.tick % Math.max(1, active.length)),
      ...active.slice(0, this.tick % Math.max(1, active.length)),
    ];
    for (const p of streamingOrder) {
      this.subscriptions(p);
      if (this.tick % 2 === 0) {
        const pos = p.physics.position,
          r = this.config.simulationDistance * 16;
        const nearby = (v: { x: number; z: number }) =>
          Math.hypot(v.x - pos.x, v.z - pos.z) < r;
        p.send({
          type: "snapshot",
          tick: this.tick,
          self: this.self(p),
          players: active
            .filter((t) => t !== p && nearby(t.physics.position))
            .map((t) => this.snapshotPlayer(t)),
          mobs: this.mobs.serialize().filter(nearby),
          drops: this.drops.filter((d) =>
            nearby({ x: d.position[0], z: d.position[2] }),
          ),
          xpOrbs: this.orbs.filter((o) =>
            nearby({ x: o.position[0], z: o.position[2] }),
          ),
          arrows: this.arrows.filter(nearby),
          day: this.data.day ?? 0,
          weather: this.data.weather,
          rules,
          containers: p.container ? this.nearbyContainers(p) : undefined,
          tickMs: this.tickMs,
        });
      }
    }
    if (++this.saveClock >= this.config.autosaveIntervalSeconds / STEP) {
      this.saveClock = 0;
      void this.save().catch((e) => {
        console.error("Autosave mislukt:", e);
        this.broadcast({
          type: "error",
          message: "Serveropslag mislukt; meld dit aan de host.",
        });
      });
    }
    if (this.tick % 100 === 0) {
      for (const key of this.world.chunks.keys()) {
        const [cx, cz] = key.split(",").map(Number);
        if (
          !active.some(
            (p) =>
              Math.abs(cx - Math.floor(p.physics.position.x / 16)) <=
                this.config.viewDistance + 2 &&
              Math.abs(cz - Math.floor(p.physics.position.z / 16)) <=
                this.config.viewDistance + 2,
          )
        )
          this.world.chunks.delete(key);
      }
      this.lighting.trim();
      for (const key of this.world.dirty) this.world.dirty.delete(key);
    }
    this.tickMs = performance.now() - start;
  }
  nearbyContainers(p: ServerPlayer) {
    const key = p.container!;
    return {
      chests: this.entities.data.chests[key]
        ? { [key]: this.entities.data.chests[key] }
        : {},
      furnaces: this.entities.data.furnaces[key]
        ? { [key]: this.entities.data.furnaces[key] }
        : {},
      crops: {},
    };
  }
  death(p: ServerPlayer) {
    p.dead = true;
    p.controller.clear();
    p.queued = [];
    if (!this.data.rules!.keepInventory) {
      for (const stack of p.survival.allStacks())
        this.drop(
          stack.id,
          stack.count,
          p.physics.position
            .clone()
            .add(new Vector3(0, 0.8, 0))
            .toArray(),
          {
            durability: stack.durability,
            enchantments: stack.enchantments,
          },
        );
      p.survival.clearInventory();
      p.survival.durability = {};
      p.survival.enchantments = {};
      p.survival.xp = 0;
      p.survival.equipment = 0;
    }
  }
  updateItems() {
    for (const d of this.drops) {
      d.age += STEP;
      if (d.age > 0.5)
        for (const p of this.players.values())
          if (
            !p.dead &&
            survivalLike(p.record.mode) &&
            p.physics.position
              .clone()
              .add(new Vector3(0, 0.7, 0))
              .distanceTo(new Vector3().fromArray(d.position)) < 1.8
          ) {
            const n = p.survival.addStack({ ...d });
            if (n < d.count) {
            }
            d.count = n;
            if (!n) break;
          }
      const [x, y, z] = d.position;
      if (!this.world.solid(x, y - 0.2, z)) d.position[1] -= 0.15;
    }
    this.drops = this.drops.filter((d) => d.count > 0 && d.age < 300);
    for (const o of this.orbs) {
      o.age += STEP;
      const p = this.nearest(
        { x: o.position[0], y: o.position[1], z: o.position[2] },
        true,
      );
      if (
        p &&
        p.physics.position.distanceTo(new Vector3().fromArray(o.position)) < 2
      ) {
        p.survival.addXP(o.amount);
        o.amount = 0;
      }
    }
    this.orbs = this.orbs.filter((o) => o.age < 300 && o.amount > 0);
  }
  updateArrows() {
    for (const a of this.arrows) {
      a.age += STEP;
      if (a.stuck) {
        if (this.records.has(a.owner) && a.age > 1)
          for (const p of this.players.values())
            if (
              !p.dead &&
              survivalLike(p.record.mode) &&
              p.physics.position.distanceTo(new Vector3(a.x, a.y, a.z)) < 1.5 &&
              p.survival.add(115) === 0
            ) {
              a.age = 31;
              break;
            }
        continue;
      }
      a.vy -= STEP * 10;
      const steps = Math.max(
        1,
        Math.ceil((Math.hypot(a.vx, a.vy, a.vz) * STEP) / 0.15),
      );
      for (let i = 0; i < steps && !a.stuck && a.age < 30; i++) {
        a.x += (a.vx * STEP) / steps;
        a.y += (a.vy * STEP) / steps;
        a.z += (a.vz * STEP) / steps;
        if (this.world.solid(a.x, a.y, a.z)) {
          a.stuck = true;
          break;
        }
        if (this.records.has(a.owner)) {
          for (const m of this.mobs.mobs)
            if (
              m.state !== "Dead" &&
              Math.hypot(a.x - m.x, a.z - m.z) < 0.5 &&
              a.y > m.y &&
              a.y < m.y + 1.7
            ) {
              this.mobs.hurt(m, 6, [a.vx / 20, a.vz / 20]);
              a.age = 31;
              break;
            }
        }
        for (const p of this.players.values())
          if (
            p.record.id !== a.owner &&
            survivalLike(p.record.mode) &&
            (!this.records.has(a.owner) || this.config.pvpEnabled) &&
            Math.hypot(a.x - p.physics.position.x, a.z - p.physics.position.z) <
              0.4 &&
            a.y > p.physics.position.y &&
            a.y < p.physics.position.y + p.physics.height
          ) {
            p.survival.damage(4);
            a.age = 31;
            break;
          }
      }
    }
    this.arrows = this.arrows.filter((a) => a.age < 30);
  }
  async save() {
    for (const p of this.players.values()) this.capturePlayer(p);
    await this.persistence.save({
      schemaVersion: 2,
      serverId: this.serverId,
      world: {
        ...this.data,
        updated: Date.now(),
        changes: [...this.world.changes.values()],
        blockStates: structuredClone(this.world.states),
        blockEntities: this.entities.serialize(),
        mobs: this.mobs.serialize(),
        fireState: { ...this.fire.ages },
      },
      players: [...this.records.values()],
      operators: [...this.operators],
      revisions: Object.fromEntries(this.revisions),
      drops: this.drops,
      xpOrbs: this.orbs,
    });
  }
  dispose() {
    this.fire.dispose();
    this.world.dispose();
  }
}
