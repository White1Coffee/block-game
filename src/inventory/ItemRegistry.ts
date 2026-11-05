export type ToolKind = "pick" | "axe" | "shovel" | "hoe" | "sword" | "bow";
export interface Tool {
  name: string;
  speed: number;
  kind: ToolKind;
  durability: number;
  tier: number;
  damage: number;
  cooldown: number;
}
export const tools: Record<number, Tool> = {};
export const extras: Record<number, string> = {
  103: "Stok",
  105: "Bosbessen",
  110: "Steenkool",
  111: "IJzerstaaf",
  112: "Goudstaaf",
  113: "Diamant",
  114: "Draad",
  115: "Pijl",
  116: "Boog",
  117: "Zaden",
  118: "Tarwe",
  119: "Brood",
  120: "Appel",
  121: "Rauw rundvlees",
  122: "Gebakken rundvlees",
  123: "Rauw varkensvlees",
  124: "Gebakken varkensvlees",
  125: "Rauwe kip",
  126: "Gebakken kip",
  127: "Leer",
  128: "Veer",
  129: "Bot",
  130: "Kruit",
  131: "IJzeren borstplaat",
  132: "Boek",
};
const ids = [
  [100, 102, 104, 200, 201],
  [101, 202, 203, 204, 205],
  [206, 207, 208, 209, 210],
  [211, 212, 213, 214, 215],
  [216, 217, 218, 219, 220],
];
const tiers = [
  ["Houten", 2, 60, 1],
  ["Stenen", 4, 132, 2],
  ["IJzeren", 6, 251, 3],
  ["Gouden", 12, 33, 1],
  ["Diamanten", 8, 1562, 4],
] as const;
const kinds: ToolKind[] = ["pick", "axe", "shovel", "hoe", "sword"];
const names = ["pikhouweel", "bijl", "schep", "schoffel", "zwaard"];
tiers.forEach(([name, speed, durability, tier], t) =>
  kinds.forEach((kind, k) => {
    const id = ids[t][k];
    tools[id] = {
      name: `${name} ${names[k]}`,
      speed,
      kind,
      durability,
      tier,
      damage: (kind === "sword" ? 4 : kind === "axe" ? 5 : 2) + tier,
      cooldown: kind === "axe" ? 1 : kind === "sword" ? 0.6 : 0.8,
    };
    extras[id] = tools[id].name;
  }),
);
export const TOOL_IDS = ids;
tools[116] = {
  name: "Boog",
  speed: 1,
  kind: "bow",
  durability: 385,
  tier: 1,
  damage: 1,
  cooldown: 0.7,
};
export const foods: Record<number, { hunger: number; saturation: number }> = {
  105: { hunger: 5, saturation: 2 },
  119: { hunger: 5, saturation: 6 },
  120: { hunger: 4, saturation: 2.4 },
  121: { hunger: 3, saturation: 1.8 },
  122: { hunger: 8, saturation: 12.8 },
  123: { hunger: 3, saturation: 1.8 },
  124: { hunger: 8, saturation: 12.8 },
  125: { hunger: 2, saturation: 1.2 },
  126: { hunger: 6, saturation: 7.2 },
};
export const stackLimit = (id: number) =>
  tools[id] || [116, 131].includes(id) ? 1 : 64;
export const enchantments = {
  efficiency: { name: "Efficiency", max: 5, cost: 3 },
  sharpness: { name: "Sharpness", max: 5, cost: 3 },
  unbreaking: { name: "Unbreaking", max: 3, cost: 3 },
  protection: { name: "Protection", max: 4, cost: 3 },
};
