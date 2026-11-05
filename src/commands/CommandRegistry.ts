import { parseCommand } from "./CommandParser";
import { gameModes, parseGameMode, type GameMode } from "../player/GameModes";
import { itemCatalog } from "../inventory/InventoryCatalog";
import { entityRegistry } from "../entities/EntityRegistry";
import { mobBlocked, type MobSystem } from "../entities/MobSystem";
import {
  gamerules,
  type GameruleName,
  type Gamerules,
} from "../world/Gamerules";
import type { Survival } from "../inventory/Survival";
import type { World } from "../world/World";

export interface CommandContext {
  playerName: string;
  position: { x: number; y: number; z: number };
  yaw: number;
  inventory: Survival;
  world: World;
  mobs: MobSystem;
  rules: Gamerules;
  setMode: (mode: GameMode) => void;
  setRule: (name: GameruleName, value: boolean | number) => void;
  hasPermission: (permission: string) => boolean;
}
export interface CommandDefinition {
  name: string;
  aliases?: string[];
  arguments: string[];
  help: string;
  permission: string;
  validate: (args: string[]) => void;
  execute: (
    args: string[],
    context: CommandContext,
  ) => { message: string; changed?: boolean };
  autocomplete: (args: string[], context: CommandContext) => string[];
}
export interface CommandResult {
  ok: boolean;
  message: string;
  changed?: boolean;
}
function arity(args: string[], min: number, max: number, usage: string) {
  if (args.length < min || args.length > max)
    throw new Error("Gebruik: " + usage);
}
export function coordinate(value: string, origin: number) {
  const relative = value.startsWith("~"),
    text = relative ? value.slice(1) : value;
  if (
    (text && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) ||
    (!relative && !text)
  )
    throw new Error("Ongeldige coördinaat: " + value);
  const number = (relative ? origin : 0) + (text ? Number(text) : 0);
  if (!Number.isFinite(number) || Math.abs(number) > 30000000)
    throw new Error("Coördinaat buiten de wereldgrenzen.");
  return number;
}
export class CommandRegistry {
  private definitions = new Map<string, CommandDefinition>();
  constructor() {
    this.register({
      name: "gamemode",
      aliases: ["gm"],
      arguments: ["mode"],
      permission: "command.gamemode",
      help: "/gamemode <survival|creative|adventure|spectator> [speler] · multiplayer: Admin voor andere spelers",
      validate: (a) => arity(a, 1, 1, "/gamemode <mode>"),
      execute: (a, c) => {
        const mode = parseGameMode(a[0]);
        c.setMode(mode);
        return {
          message: "Gamemode gewijzigd naar " + mode + ".",
          changed: true,
        };
      },
      autocomplete: () => [...gameModes, "0", "1", "2", "3"],
    });
    this.register({
      name: "give",
      arguments: ["[target]", "item", "[amount]"],
      permission: "command.give",
      help: "/give [@s|Player] <item> [amount]",
      validate: (a) => arity(a, 1, 3, "/give [@s|Player] <item> [amount]"),
      execute: (input, c) => {
        const a = [...input];
        if (a[0] === "@s" || a[0].toLowerCase() === c.playerName.toLowerCase())
          a.shift();
        else if (a.length === 3 || a[0].startsWith("@"))
          throw new Error("Onbekende speler: " + a[0]);
        arity(a, 1, 2, "/give [@s|Player] <item> [amount]");
        const item = itemCatalog.resolve(a[0]);
        if (!item) throw new Error("Onbekend item: " + a[0]);
        const text = a[1] ?? "1",
          amount = Number(text);
        if (
          !/^[1-9]\d*$/.test(text) ||
          !Number.isSafeInteger(amount) ||
          amount > 2147483647
        )
          throw new Error(
            "Aantal moet een geheel getal tussen 1 en 2147483647 zijn.",
          );
        const left = c.inventory.add(item.id, amount),
          added = amount - left;
        if (!added) throw new Error("Inventory is vol; geen items toegevoegd.");
        return {
          message: `${added} × ${item.key} ontvangen.${left ? ` Inventory vol: ${left} niet toegevoegd.` : ""}`,
          changed: true,
        };
      },
      autocomplete: (a, c) => {
        const target =
            a[0] === "@s" || a[0]?.toLowerCase() === c.playerName.toLowerCase(),
          index = a.length - 1;
        if (!index)
          return [
            "@s",
            c.playerName,
            ...itemCatalog.ids(),
            ...itemCatalog.ids().map((id) => "minecraft:" + id),
          ];
        return index === (target ? 1 : 0)
          ? [
              ...itemCatalog.ids(),
              ...itemCatalog.ids().map((id) => "minecraft:" + id),
            ]
          : ["1", "16", "32", "64"];
      },
    });
    this.register({
      name: "summon",
      arguments: ["entity", "[x y z]"],
      permission: "command.summon",
      help: "/summon <entity> [x y z]",
      validate: (a) => {
        if (a.length !== 1 && a.length !== 4)
          throw new Error("Gebruik: /summon <entity> [x y z]");
      },
      execute: (a, c) => {
        const kind = entityRegistry.resolve(a[0]);
        if (!kind) throw new Error("Onbekende entity: " + a[0]);
        const p = c.position;
        const x =
          a.length === 4 ? coordinate(a[1], p.x) : p.x - Math.sin(c.yaw) * 2;
        let y = a.length === 4 ? coordinate(a[2], p.y) : p.y;
        const z =
          a.length === 4 ? coordinate(a[3], p.z) : p.z - Math.cos(c.yaw) * 2;
        if (y < 1 || y + 1.4 >= c.world.height)
          throw new Error("Spawnhoogte ligt buiten de wereld.");
        let lift = 0;
        while (
          mobBlocked(c.world, x, y, z) &&
          lift++ < 4 &&
          y + 2.4 < c.world.height
        )
          y++;
        if (mobBlocked(c.world, x, y, z))
          throw new Error("Geen vrije spawnruimte op deze locatie.");
        const mob = c.mobs.spawn(kind, x, y, z);
        if (!mob) throw new Error("Moblimiet bereikt; geen entity gespawnd.");
        return {
          message: `${a[0]} gespawnd op ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}.`,
          changed: true,
        };
      },
      autocomplete: (a) =>
        a.length <= 1
          ? [
              ...entityRegistry.ids(),
              ...entityRegistry.ids().map((id) => "minecraft:" + id),
            ]
          : a.length <= 4
            ? ["~", "~1", "0"]
            : [],
    });
    this.register({
      name: "gamerule",
      arguments: ["[rule]", "[value]"],
      permission: "command.gamerule",
      help: "/gamerule [rule] [value]",
      validate: (a) => arity(a, 0, 2, "/gamerule [rule] [value]"),
      execute: (a, c) => {
        if (!a.length)
          return {
            message: gamerules
              .names()
              .map((name) => `${name} = ${c.rules[name]}`)
              .join("\n"),
          };
        const rule = gamerules.get(a[0]);
        if (!rule) throw new Error("Onbekende gamerule: " + a[0]);
        if (a.length === 1)
          return { message: `${rule.name} = ${c.rules[rule.name]}` };
        const value = gamerules.parse(rule.name, a[1]);
        c.setRule(rule.name, value);
        return { message: `${rule.name} = ${value}`, changed: true };
      },
      autocomplete: (a) =>
        a.length <= 1
          ? gamerules.names()
          : a.length === 2
            ? gamerules.get(a[0])?.type === "boolean"
              ? ["true", "false"]
              : gamerules.get(a[0])
                ? ["0", "3", "10", "100"]
                : []
            : [],
    });
    this.register({
      name: "help",
      aliases: ["?"],
      arguments: ["[command]"],
      permission: "command.help",
      help: "/help [command]",
      validate: (a) => arity(a, 0, 1, "/help [command]"),
      execute: (a, c) => {
        if (a.length) {
          const def = this.definitions.get(a[0]);
          if (!def || !c.hasPermission(def.permission))
            throw new Error("Onbekend command: " + a[0]);
          return { message: def.help };
        }
        return {
          message: [...new Set(this.definitions.values())]
            .filter((d) => c.hasPermission(d.permission))
            .map((d) => d.help)
            .join("\n"),
        };
      },
      autocomplete: () => [...this.definitions.keys()],
    });
  }
  register(definition: CommandDefinition) {
    for (const name of [definition.name, ...(definition.aliases ?? [])]) {
      if (this.definitions.has(name))
        throw new Error("Dubbel command: " + name);
      this.definitions.set(name, definition);
    }
  }
  execute(line: string, context: CommandContext): CommandResult {
    try {
      const tokens = parseCommand(line).map((t) => t.value),
        name = tokens.shift() ?? "",
        def = this.definitions.get(name);
      if (!def)
        throw new Error("Onbekend command: /" + name + ". Gebruik /help.");
      if (!context.hasPermission(def.permission))
        throw new Error("Geen toestemming voor /" + name + ".");
      def.validate(tokens);
      return { ok: true, ...def.execute(tokens, context) };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Command mislukt.",
      };
    }
  }
  autocomplete(line: string, context: CommandContext): string[] {
    if (!line.startsWith("/")) return [];
    try {
      const tokens = parseCommand(line, true),
        trailing = /\s$/.test(line);
      if (trailing)
        tokens.push({ value: "", start: line.length, end: line.length });
      const token = tokens.at(-1) ?? { value: "", start: 1, end: 1 };
      const options =
        tokens.length <= 1
          ? [...this.definitions.keys()].filter((name) =>
              context.hasPermission(this.definitions.get(name)!.permission),
            )
          : (this.definitions.get(tokens[0].value)?.autocomplete(
              tokens.slice(1).map((t) => t.value),
              context,
            ) ?? []);
      return [...new Set(options)]
        .filter((value) => value.startsWith(token.value))
        .map((value) => line.slice(0, token.start) + value + " ");
    } catch {
      return [];
    }
  }
}
