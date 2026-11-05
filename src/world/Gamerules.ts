export interface Gamerules {
  keepInventory: boolean;
  doDaylightCycle: boolean;
  doWeatherCycle: boolean;
  doMobSpawning: boolean;
  doMobLoot: boolean;
  doTileDrops: boolean;
  doFireTick: boolean;
  mobGriefing: boolean;
  randomTickSpeed: number;
  naturalRegeneration: boolean;
}
export type GameruleName = keyof Gamerules;
type RuleDefinition = {
  name: GameruleName;
  type: "boolean" | "integer";
  default: boolean | number;
  help: string;
  min?: number;
  max?: number;
};
export const gameruleDefinitions: RuleDefinition[] = [
  {
    name: "keepInventory",
    type: "boolean",
    default: false,
    help: "Behoud inventory en XP na overlijden.",
  },
  {
    name: "doDaylightCycle",
    type: "boolean",
    default: true,
    help: "Laat de wereldtijd automatisch doorlopen.",
  },
  {
    name: "doWeatherCycle",
    type: "boolean",
    default: true,
    help: "Laat het weer automatisch veranderen.",
  },
  {
    name: "doMobSpawning",
    type: "boolean",
    default: true,
    help: "Natuurlijke mobspawns; /summon blijft beschikbaar.",
  },
  {
    name: "doMobLoot",
    type: "boolean",
    default: true,
    help: "Mobs geven items en XP na overlijden.",
  },
  {
    name: "doTileDrops",
    type: "boolean",
    default: true,
    help: "Gebroken blokken geven items en XP.",
  },
  {
    name: "doFireTick",
    type: "boolean",
    default: true,
    help: "Vuur veroudert, dooft en verspreidt zich.",
  },
  {
    name: "mobGriefing",
    type: "boolean",
    default: true,
    help: "Mobexplosies mogen terrein beschadigen.",
  },
  {
    name: "randomTickSpeed",
    type: "integer",
    default: 3,
    min: 0,
    max: 4096,
    help: "Snelheid van gewasgroei; 0 pauzeert groei.",
  },
  {
    name: "naturalRegeneration",
    type: "boolean",
    default: true,
    help: "Automatische healthregeneratie bij voldoende voedsel.",
  },
];
export class GameruleRegistry {
  private definitions = new Map(gameruleDefinitions.map((d) => [d.name, d]));
  names() {
    return [...this.definitions.keys()];
  }
  get(name: string) {
    return this.definitions.get(name as GameruleName);
  }
  defaults(): Gamerules {
    return Object.fromEntries(
      [...this.definitions.values()].map((d) => [d.name, d.default]),
    ) as unknown as Gamerules;
  }
  parse(name: string, value: string): boolean | number {
    const rule = this.get(name);
    if (!rule) throw new Error(`Onbekende gamerule: ${name}.`);
    if (rule.type === "boolean") {
      if (value !== "true" && value !== "false")
        throw new Error(`${name} verwacht true of false.`);
      return value === "true";
    }
    if (!/^(0|[1-9]\d*)$/.test(value))
      throw new Error(`${name} verwacht een geheel getal.`);
    const number = Number(value);
    if (
      !Number.isSafeInteger(number) ||
      number < rule.min! ||
      number > rule.max!
    )
      throw new Error(`${name} moet tussen ${rule.min} en ${rule.max} liggen.`);
    return number;
  }
  normalize(values: Partial<Gamerules> = {}): Gamerules {
    const result = this.defaults();
    for (const rule of this.definitions.values()) {
      const value = values[rule.name];
      if (value === undefined) continue;
      try {
        (result as unknown as Record<string, boolean | number>)[rule.name] =
          this.parse(rule.name, String(value));
      } catch {
        /* Invalid older data falls back to the documented default. */
      }
    }
    return result;
  }
}
export const gamerules = new GameruleRegistry();
