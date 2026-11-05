import { blocks } from "../blocks/BlockRegistry";
import { extras, TOOL_IDS, stackLimit } from "./ItemRegistry";
const blockKeys = [
  "air",
  "grass_block",
  "dirt",
  "stone",
  "cobblestone",
  "sand",
  "gravel",
  "oak_log",
  "oak_leaves",
  "oak_planks",
  "glass",
  "water",
  "coal_ore",
  "iron_ore",
  "gold_ore",
  "diamond_ore",
  "bedrock",
  "snow_block",
  "bricks",
  "crafting_table",
  "furnace",
  "flower",
  "tall_grass",
  "lava",
  "obsidian",
  "clay",
  "moss_block",
  "birch_log",
  "birch_leaves",
  "spruce_log",
  "spruce_leaves",
  "birch_planks",
  "spruce_planks",
  "dark_oak_log",
  "dark_oak_leaves",
  "jungle_log",
  "jungle_leaves",
  "acacia_log",
  "acacia_leaves",
  "white_wool",
  "red_wool",
  "blue_wool",
  "stone_bricks",
  "smooth_stone",
  "bookshelf",
  "oak_fence",
  "oak_fence_gate",
  "open_fence_gate",
  "oak_stairs",
  "oak_slab",
  "farmland",
  "wheat_seedling",
  "wheat_crop",
  "mushroom",
  "glowstone",
  "ice",
  "packed_ice",
  "snow",
  "oak_door",
  "door_upper",
  "open_door",
  "open_door_upper",
  "chest",
  "bed",
  "ladder",
  "torch",
  "fire",
  "growing_wheat",
  "dark_oak_planks",
  "jungle_planks",
  "acacia_planks",
  "deepslate",
];
const itemKeys: Record<number, string> = {
  103: "stick",
  105: "sweet_berries",
  110: "coal",
  111: "iron_ingot",
  112: "gold_ingot",
  113: "diamond",
  114: "string",
  115: "arrow",
  116: "bow",
  117: "wheat_seeds",
  118: "wheat",
  119: "bread",
  120: "apple",
  121: "beef",
  122: "cooked_beef",
  123: "porkchop",
  124: "cooked_porkchop",
  125: "chicken",
  126: "cooked_chicken",
  127: "leather",
  128: "feather",
  129: "bone",
  130: "gunpowder",
  131: "iron_chestplate",
  132: "book",
};
TOOL_IDS.forEach((ids, tier) =>
  ids.forEach(
    (id, kind) =>
      (itemKeys[id] =
        `${["wooden", "stone", "iron", "golden", "diamond"][tier]}_${["pickaxe", "axe", "shovel", "hoe", "sword"][kind]}`),
  ),
);
export interface CatalogItem {
  id: number;
  key: string;
  name: string;
  maxStack: number;
}
export class InventoryCatalog {
  all(): CatalogItem[] {
    return [
      ...blocks
        .filter((b) => b.id > 0)
        .map((b) => ({
          id: b.id,
          key: blockKeys[b.id] ?? slug(b.name),
          name: b.name,
          maxStack: stackLimit(b.id),
        })),
      ...Object.entries(extras).map(([id, name]) => ({
        id: Number(id),
        key: itemKeys[Number(id)] ?? slug(name),
        name,
        maxStack: stackLimit(Number(id)),
      })),
    ];
  }
  resolve(name: string) {
    const parts = name.toLowerCase().split(":");
    if (
      parts.length > 2 ||
      (parts.length === 2 && !["minecraft", "whitebrick"].includes(parts[0]))
    )
      return;
    const key = parts.at(-1);
    return this.all().find((item) => item.key === key);
  }
  ids() {
    return this.all()
      .map((item) => item.key)
      .sort();
  }
}
function slug(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}
export const itemCatalog = new InventoryCatalog();
