import { describe, it, expect } from "vitest";
import { Vector3, Scene } from "three";
import {
  CommandRegistry,
  coordinate,
  type CommandContext,
} from "../src/commands/CommandRegistry";
import { parseCommand } from "../src/commands/CommandParser";
import { Survival } from "../src/inventory/Survival";
import { inventoryStacks, usedSlots } from "../src/inventory/InventoryStacks";
import { PlayerPhysics } from "../src/player/PlayerPhysics";
import { configureGameMode, type GameMode } from "../src/player/GameModes";
import { gamerules } from "../src/world/Gamerules";
import { MobSystem, type MobHooks } from "../src/entities/MobSystem";
import { World } from "../src/world/World";
import { migrateSave } from "../src/storage/SaveMigration";
import { ChatHistory } from "../src/ui/ChatHistory";
import { BlockEntities } from "../src/world/BlockEntities";
import { FireSystem } from "../src/world/FireSystem";
import { WeatherSystem } from "../src/environment/WeatherSystem";
import { Game } from "../src/core/Game";
import { BlockInteractionSystem } from "../src/world/BlockInteractionSystem";
const registry = new CommandRegistry();
function fixture() {
  const world = new World("commands", 80, 3),
    inventory = new Survival(),
    rules = gamerules.defaults();
  // Flat deterministic test ground, using the actual World block storage and events.
  world.chunks.set("0,0", new Uint8Array(16 * 16 * 80));
  world.chunks.get("0,0")!.fill(3, 0, 256);
  const loot: number[] = [],
    hooks: MobHooks = {
      damage: () => {},
      shoot: () => {},
      explode: () => {},
      drop: (id) => loot.push(id),
      xp: (n) => loot.push(-n),
      light: () => 15,
      sound: () => {},
    };
  const mobs = new MobSystem(hooks),
    player = new PlayerPhysics(world);
  player.position.set(8.5, 1, 8.5);
  let mode: GameMode = "creative";
  const context: CommandContext = {
    playerName: "Player",
    position: player.position,
    yaw: 0,
    inventory,
    world,
    mobs,
    rules,
    hasPermission: () => true,
    setMode: (m) => {
      mode = m;
      configureGameMode(m, player, inventory);
    },
    setRule: (name, value) => {
      (rules as unknown as Record<string, boolean | number>)[name] = value;
      inventory.naturalRegeneration = rules.naturalRegeneration;
      mobs.doMobSpawning = rules.doMobSpawning;
      mobs.doMobLoot = rules.doMobLoot;
    },
  };
  return {
    context,
    world,
    inventory,
    rules,
    mobs,
    player,
    loot,
    get mode() {
      return mode;
    },
    run: (line: string) => registry.execute(line, context),
  };
}
describe("command parser and registry", () => {
  it("lexes quoted arguments and rejects unterminated quotes or oversized input", () => {
    expect(parseCommand('/give "diamond" 64').map((t) => t.value)).toEqual([
      "give",
      "diamond",
      "64",
    ]);
    expect(() => parseCommand('/give "diamond')).toThrow();
    expect(() => parseCommand("x".repeat(1025))).toThrow();
  });
  it.each([
    "survival",
    "creative",
    "adventure",
    "spectator",
    "0",
    "1",
    "2",
    "3",
  ])("changes actual player physics for /gamemode %s", (mode) => {
    const f = fixture();
    expect(f.run("/gamemode " + mode).ok).toBe(true);
    const expected =
      ["survival", "creative", "adventure", "spectator"][Number(mode)] ?? mode;
    expect(f.mode).toBe(expected);
    expect(f.player.noclip).toBe(expected === "spectator");
    if (expected === "spectator") {
      f.player.step(1, new Vector3(0, -3, 0), false);
      expect(f.player.position.y).toBe(-2);
      expect(f.player.flying).toBe(true);
    } else expect(f.player.collides(new Vector3(8.5, 0, 8.5))).toBe(true);
  });
  it("resets fall tracking and ejects a spectator safely when returning to Survival", () => {
    const f = fixture();
    f.run("/gamemode spectator");
    f.player.position.y = 0;
    f.run("/gamemode survival");
    expect(f.player.position.y).toBe(1);
    expect(f.player.flying).toBe(false);
    f.inventory.tick(0.1, 1, true, false, false, false);
    expect(f.inventory.health).toBe(20);
  });
  it("gives real canonical items, namespace items and local player targets", () => {
    const f = fixture();
    for (const line of [
      "/give diamond 64",
      "/give minecraft:diamond 64",
      "/give @s stone 32",
      "/give Player iron_ingot 32",
      "/give oak_planks 64",
      "/give diamond_pickaxe 1",
    ])
      expect(f.run(line).ok, line).toBe(true);
    expect(f.inventory.count(113)).toBe(128);
    expect(f.inventory.count(3)).toBe(32);
    expect(f.inventory.count(111)).toBe(32);
    expect(f.inventory.count(216)).toBe(1);
    expect(
      inventoryStacks(f.inventory.items)
        .filter((s) => s.id === 113)
        .map((s) => s.count),
    ).toEqual([64, 64]);
    expect(new Survival(f.inventory.serialize()).count(113)).toBe(128);
  });
  it("handles partial and full inventory without creating more than 36 stacks", () => {
    const f = fixture();
    expect(f.run("/give diamond 2300").ok).toBe(true);
    expect(f.run("/give diamond 20").ok).toBe(true);
    expect(f.inventory.count(113)).toBe(2304);
    expect(usedSlots(f.inventory.items)).toBe(36);
    const before = f.inventory.serialize();
    expect(f.run("/give diamond").ok).toBe(false);
    expect(f.run("/give stone").ok).toBe(false);
    expect(f.inventory.serialize()).toEqual(before);
  });
  it.each([
    "/oops",
    "/gamemode invalid",
    "/gamemode creative extra",
    "/give missing 5",
    "/give diamond -1",
    "/give diamond 0",
    "/give diamond 1.5",
    "/give diamond NaN",
    "/give diamond 9999999999999999999",
    "/give @a diamond",
    "/give Someone diamond 2",
    "/summon missing",
    "/summon cow ~ ~",
    "/summon cow ~ nope ~",
    "/summon cow ~ -1 ~",
    "/gamerule missing true",
    "/gamerule keepInventory yes",
    "/gamerule randomTickSpeed -1",
    "/gamerule randomTickSpeed 1.5",
    "/gamerule randomTickSpeed 99999999",
  ])("rejects invalid input without mutation: %s", (line) => {
    const f = fixture(),
      before = JSON.stringify({
        inventory: f.inventory.serialize(),
        rules: f.rules,
      });
    expect(f.run(line).ok).toBe(false);
    expect(f.mobs.mobs).toHaveLength(0);
    expect(f.mode).toBe("creative");
    expect(
      JSON.stringify({ inventory: f.inventory.serialize(), rules: f.rules }),
    ).toBe(before);
  });
  it("spawns real mobs with unique IDs, aliases, absolute and relative positions", () => {
    const f = fixture();
    for (const line of [
      "/summon cow",
      "/summon minecraft:zombie",
      "/summon skeleton ~ ~1 ~",
      "/summon pig 3 1 4",
    ])
      expect(f.run(line).ok, line).toBe(true);
    expect(f.mobs.mobs.map((m) => m.kind)).toEqual([
      "cow",
      "hollow",
      "bonewalker",
      "pig",
    ]);
    expect(new Set(f.mobs.mobs.map((m) => m.id)).size).toBe(4);
    expect(f.mobs.mobs[2].y).toBe(2);
    expect(f.mobs.mobs[3].x).toBe(3);
    expect(f.run("/gamerule doMobSpawning false").ok).toBe(true);
    expect(f.run("/summon sheep").ok).toBe(true);
    f.mobs.update(f.world, 5, f.player.position, false, false);
    expect(f.mobs.mobs).toHaveLength(5);
  });
  it("validates blocked spawn positions and mob caps before reporting success", () => {
    const f = fixture();
    f.mobs.maxMobs = 0;
    expect(f.run("/summon cow").ok).toBe(false);
    f.mobs.maxMobs = 24;
    for (let y = 1; y < 10; y++) f.world.set(8, y, 8, 3);
    expect(f.run("/summon cow 8.5 1 8.5").ok).toBe(false);
    expect(f.mobs.mobs).toHaveLength(0);
  });
  it("lists, reads, validates, updates and preserves gamerules in migrated saves", () => {
    const f = fixture();
    for (const line of [
      "/gamerule keepInventory true",
      "/gamerule doDaylightCycle false",
      "/gamerule doMobSpawning false",
      "/gamerule randomTickSpeed 10",
    ])
      expect(f.run(line).ok).toBe(true);
    expect(f.run("/gamerule").ok).toBe(true);
    expect(f.run("/gamerule randomTickSpeed").changed).toBeUndefined();
    const saved = migrateSave({
      id: "old",
      version: 1,
      seed: "commands",
      rules: f.rules,
      changes: [{ x: 1, y: 1, z: 1, id: 9 }],
    } as any);
    const restored = migrateSave(JSON.parse(JSON.stringify(saved)));
    expect(restored.rules).toMatchObject({
      keepInventory: true,
      doDaylightCycle: false,
      doMobSpawning: false,
      randomTickSpeed: 10,
    });
    expect(restored.version).toBe(1);
    expect(restored.changes).toEqual(saved.changes);
  });
  it("checks command permissions before any state changes", () => {
    const f = fixture();
    f.context.hasPermission = () => false;
    expect(f.run("/give diamond").ok).toBe(false);
    expect(f.inventory.count(113)).toBe(0);
    expect(registry.autocomplete("/g", f.context)).toEqual([]);
  });
  it("autocompletes commands, targets, all registries, rules, values and coordinates", () => {
    const c = fixture().context;
    for (const [line, expected] of [
      ["/game", "/gamemode "],
      ["/gamemode spec", "/gamemode spectator "],
      ["/give @", "/give @s "],
      ["/give @s diamond_p", "/give @s diamond_pickaxe "],
      ["/give minecraft:di", "/give minecraft:diamond "],
      ["/summon zomb", "/summon zombie "],
      ["/summon cow ~ ", "/summon cow ~ ~ "],
      ["/gamerule doMobS", "/gamerule doMobSpawning "],
      ["/gamerule keepInventory f", "/gamerule keepInventory false "],
    ])
      expect(registry.autocomplete(line, c)).toContain(expected);
  });
  it("navigates history and restores drafts without duplicating consecutive entries", () => {
    const history = new ChatHistory();
    history.add("/give diamond 64");
    history.add("/gamemode creative");
    history.add("/gamemode creative");
    expect(history.entries).toHaveLength(2);
    expect(history.up("draft")).toBe("/gamemode creative");
    expect(history.up("")).toBe("/give diamond 64");
    expect(history.down()).toBe("/gamemode creative");
    expect(history.down()).toBe("draft");
  });
  it("parses relative and absolute coordinates strictly", () => {
    expect(coordinate("~1", 5)).toBe(6);
    expect(coordinate("~-1.5", 5)).toBe(3.5);
    expect(coordinate("~", 5)).toBe(5);
    expect(coordinate("1.5", 5)).toBe(1.5);
    expect(() => coordinate("Infinity", 0)).toThrow();
  });
});
describe("gamerules affect simulation", () => {
  it("disables natural regeneration without disabling other survival simulation", () => {
    const f = fixture();
    f.inventory.health = 10;
    f.run("/gamerule naturalRegeneration false");
    f.inventory.tick(5, 1, true, false, false, false);
    expect(f.inventory.health).toBe(10);
    f.run("/gamerule naturalRegeneration true");
    f.inventory.tick(5, 1, true, false, false, false);
    expect(f.inventory.health).toBe(11);
  });
  it("disables mob items and XP but still permits damage and death", () => {
    const f = fixture();
    f.run("/gamerule doMobLoot false");
    f.run("/summon cow");
    f.mobs.hurt(f.mobs.mobs[0], 100, [0, 0]);
    expect(f.mobs.mobs[0].state).toBe("Dead");
    expect(f.loot).toEqual([]);
    f.run("/gamerule doMobLoot true");
    f.run("/summon pig");
    f.mobs.hurt(f.mobs.mobs[1], 100, [0, 0]);
    expect(f.loot).toEqual([123, -3]);
  });
  it("scales crops with randomTickSpeed and leaves furnace processing active at zero", () => {
    const f = fixture(),
      entities = new BlockEntities();
    f.world.set(3, 1, 3, 51);
    entities.data.crops["3,1,3"] = { age: 0, stage: 0 };
    const oven = entities.furnace("4,1,4");
    oven.input = { id: 13, count: 1 };
    oven.fuel = { id: 110, count: 1 };
    entities.tick(40, f.world, f.player.position, 48, 0);
    expect(f.world.get(3, 1, 3)).toBe(51);
    expect(oven.output?.id).toBe(111);
    entities.tick(4, f.world, f.player.position, 48, 30);
    expect(f.world.get(3, 1, 3)).toBe(67);
  });
  it("freezes fire ages/spread and resumes deterministic cross-chunk updates", () => {
    const f = fixture();
    f.world.set(15, 1, 4, 66);
    f.world.set(16, 1, 4, 7);
    const fire = new FireSystem(f.world);
    for (let i = 0; i < 4; i++) fire.tick(1, false, f.player.position, 48);
    expect(f.world.get(16, 1, 4)).toBe(7);
    expect(fire.ages["15,1,4"]).toBe(0);
    for (let i = 0; i < 3; i++) fire.tick(1, true, f.player.position, 48);
    expect(f.world.get(16, 1, 4)).toBe(66);
    fire.dispose();
  });
  it("freezes weather transitions independently of precipitation rendering", () => {
    const f = fixture(),
      weather = new WeatherSystem(new Scene());
    weather.restore({ kind: "rain", remaining: 1, cycle: 2 });
    weather.update(2, f.world, f.player.position, true, () => {}, false);
    expect(weather.state.remaining).toBe(1);
    expect(weather.state.kind).toBe("rain");
    weather.update(2, f.world, f.player.position, true, () => {}, true);
    expect(weather.state.cycle).toBe(3);
  });
});
/** Exercise Game's real orchestration without constructing a WebGL renderer in Node. */
function gameplayFixture(mode: GameMode = "survival") {
  const f = fixture(),
    game = Object.create(Game.prototype) as any,
    drops: number[] = [],
    xp: number[] = [];
  const entities = new BlockEntities();
  Object.assign(game, {
    world: f.world,
    player: f.player,
    survival: f.inventory,
    saveData: { mode, rules: f.rules },
    input: { yaw: 0, pitch: 0 },
    hotbar: [2],
    selected: 0,
    blockEntities: entities,
    interactions: new BlockInteractionSystem(f.world, entities),
    drops: { spawn: (id: number) => drops.push(id) },
    xpOrbs: { spawn: (n: number) => xp.push(n) },
    mobs: f.mobs,
    audio: { play: () => {} },
    spawnParticles: () => {},
    updateHotbar: () => {},
    show: () => {},
    button: () => {},
    toast: () => {},
  });
  f.inventory.add(2, 10);
  return { ...f, game, entities, drops, xp };
}
describe("commands integrate with actual Game interactions", () => {
  it("Adventure forbids ordinary edits and still opens doors", () => {
    const f = gameplayFixture("adventure");
    f.world.set(8, 2, 6, 2);
    f.game.interact(false);
    expect(f.world.get(8, 2, 6)).toBe(2);
    f.game.interact(true);
    expect(f.world.get(8, 2, 7)).toBe(0);
    expect(f.inventory.count(2)).toBe(10);
    f.world.set(8, 2, 6, 58);
    f.world.set(8, 3, 6, 59);
    f.game.interact(true);
    expect(f.world.get(8, 2, 6)).toBe(60);
  });
  it("Spectator cannot edit blocks, target or attack mobs", () => {
    const f = gameplayFixture("spectator");
    f.world.set(8, 2, 6, 2);
    f.game.interact(false);
    f.game.interact(true);
    expect(f.world.get(8, 2, 6)).toBe(2);
    expect(f.world.get(8, 2, 7)).toBe(0);
    const cow = f.mobs.spawn("cow", 8.5, 1, 6.5)!;
    f.game.attack(cow);
    expect(cow.health).toBe(10);
    expect(f.game.targetMob()).toBeNull();
  });
  it.each([true, false])(
    "doTileDrops=%s gates block and container contents, while removing block entities",
    (enabled) => {
      const f = gameplayFixture();
      f.rules.doTileDrops = enabled;
      f.world.set(8, 2, 6, 62);
      f.entities.chest("8,2,6")[0] = { id: 111, count: 3 };
      f.game.interact(false);
      expect(f.world.get(8, 2, 6)).toBe(0);
      expect(f.entities.data.chests["8,2,6"]).toBeUndefined();
      expect(f.drops).toEqual(enabled ? [111, 62] : []);
    },
  );
  it("mobGriefing disables terrain damage while explosion damage remains real", () => {
    const f = gameplayFixture();
    const mob = f.mobs.spawn("burster", 8.5, 1, 8.5)!;
    f.world.set(8, 1, 8, 2);
    f.rules.mobGriefing = false;
    f.game.explode(mob);
    expect(f.world.get(8, 1, 8)).toBe(2);
    expect(f.inventory.health).toBeLessThan(20);
    f.rules.mobGriefing = true;
    f.game.explode(mob);
    expect(f.world.get(8, 1, 8)).toBe(0);
  });
  it.each([true, false])(
    "keepInventory=%s controls actual death inventory and XP loss",
    (keep) => {
      const f = gameplayFixture();
      f.rules.keepInventory = keep;
      f.inventory.xp = 20;
      f.game.die();
      expect(f.inventory.count(2)).toBe(keep ? 10 : 0);
      expect(f.inventory.xp).toBe(keep ? 20 : 0);
      expect(f.drops).toEqual(keep ? [] : [2]);
    },
  );
});
