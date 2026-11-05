export interface BlockDefinition {
  id: number;
  name: string;
  color: string;
  solid: boolean;
  transparent: boolean;
  miningTime: number;
  textures: { top: number; bottom: number; sides: number };
  drop: number;
  shape:
    | "cube"
    | "plant"
    | "slab"
    | "stairs"
    | "fence"
    | "gate"
    | "door"
    | "ladder"
    | "torch"
    | "bed"
    | "snow"
    | "chest";
  emission: number;
  tool: "pick" | "axe" | "shovel" | "hand";
  pattern: "noise" | "grass" | "log" | "planks" | "bricks" | "ore" | "glass";
}
const definitions: [string, string, BlockDefinition["pattern"]][] = [
  ["Lucht", "#ffffff", "noise"],
  ["Gras", "#6fa848", "grass"],
  ["Aarde", "#886043", "noise"],
  ["Steen", "#858a8b", "noise"],
  ["Keien", "#737d7a", "bricks"],
  ["Zand", "#dec991", "noise"],
  ["Grind", "#96918a", "noise"],
  ["Eikenstam", "#806044", "log"],
  ["Eikenblad", "#4b833d", "noise"],
  ["Eikenplanken", "#b28b57", "planks"],
  ["Glas", "#c4e3df", "glass"],
  ["Water", "#428fc0", "noise"],
  ["Steenkoolerts", "#535956", "ore"],
  ["IJzererts", "#b9a08a", "ore"],
  ["Gouderts", "#cda64b", "ore"],
  ["Diamanterts", "#53c6c1", "ore"],
  ["Bodemsteen", "#414747", "noise"],
  ["Sneeuw", "#e4f0ee", "noise"],
  ["Baksteen", "#ad6250", "bricks"],
  ["Werkbank", "#a47a4c", "planks"],
  ["Oven", "#606965", "bricks"],
  ["Veldbloem", "#ddba62", "noise"],
  ["Hoog gras", "#729b46", "noise"],
  ["Lava", "#e77528", "noise"],
  ["Obsidiaan", "#342b44", "noise"],
  ["Klei", "#a2a8b1", "noise"],
  ["Mos", "#668849", "noise"],
  ["Berkenstam", "#d8d5bd", "log"],
  ["Berkenblad", "#7eac51", "noise"],
  ["Sparrenstam", "#65513b", "log"],
  ["Sparrenblad", "#315b45", "noise"],
  ["Berkenplanken", "#d2c897", "planks"],
  ["Sparrenplanken", "#846b49", "planks"],
  ["Donkere stam", "#40382b", "log"],
  ["Donker blad", "#375638", "noise"],
  ["Junglestam", "#947354", "log"],
  ["Jungleblad", "#398341", "noise"],
  ["Acaciastam", "#a26e4a", "log"],
  ["Acaciablad", "#93a443", "noise"],
  ["Witte wol", "#e5dfd1", "noise"],
  ["Rode wol", "#b64945", "noise"],
  ["Blauwe wol", "#4f69a1", "noise"],
  ["Steenbaksteen", "#858b89", "bricks"],
  ["Gladde steen", "#a1a8a6", "noise"],
  ["Boekenkast", "#977448", "planks"],
  ["Hek", "#ac8653", "planks"],
  ["Hekpoort", "#b18b58", "planks"],
  ["Open hekpoort", "#b18b58", "planks"],
  ["Trap", "#b18b58", "planks"],
  ["Halve plaat", "#b18b58", "planks"],
  ["Landbouwgrond", "#76503a", "noise"],
  ["Jong gewas", "#70a042", "noise"],
  ["Rijpe tarwe", "#c9b454", "noise"],
  ["Paddenstoel", "#b46552", "noise"],
  ["Gloedsteen", "#edce79", "ore"],
  ["IJs", "#a0c7dc", "glass"],
  ["Pakijs", "#97b6ce", "noise"],
  ["Sneeuwlaag", "#e8eeed", "noise"],
  ["Deur", "#bc935e", "planks"],
  ["Deur boven", "#bc935e", "planks"],
  ["Open deur", "#bc935e", "planks"],
  ["Open deur boven", "#bc935e", "planks"],
  ["Kist", "#b18447", "planks"],
  ["Bed", "#ae544c", "planks"],
  ["Ladder", "#b88e58", "planks"],
  ["Fakkel", "#f7cb69", "log"],
  ["Vuur", "#eaa23f", "noise"],
  ["Groeiend gewas", "#a8b14b", "noise"],
  ["Donkere planken", "#50432f", "planks"],
  ["Jungleplanken", "#a7815b", "planks"],
  ["Acaciaplanken", "#bd7e55", "planks"],
  ["Diepsteen", "#4c5359", "noise"],
];
export const blocks: BlockDefinition[] = definitions.map(
  ([name, color, pattern], id) => ({
    id,
    name,
    color,
    pattern,
    solid: ![0, 11, 21, 22, 23, 47, 51, 52, 53, 64, 65, 66, 67].includes(id),
    transparent: [
      0, 8, 10, 11, 21, 22, 23, 28, 30, 34, 36, 38, 45, 46, 47, 48, 49, 51, 52,
      53, 55, 57, 58, 59, 60, 61, 63, 64, 65, 66, 67,
    ].includes(id),
    shape: ([21, 22, 51, 52, 53, 66, 67].includes(id)
      ? "plant"
      : id === 62
        ? "chest"
        : id === 49
          ? "slab"
          : id === 48
            ? "stairs"
            : id === 45
              ? "fence"
              : [46, 47].includes(id)
                ? "gate"
                : [58, 59, 60, 61].includes(id)
                  ? "door"
                  : id === 64
                    ? "ladder"
                    : id === 65
                      ? "torch"
                      : id === 63
                        ? "bed"
                        : id === 57
                          ? "snow"
                          : "cube") as BlockDefinition["shape"],
    emission: id === 65 ? 14 : id === 54 || id === 23 || id === 66 ? 15 : 0,
    tool: ([1, 2, 5, 6, 17, 25, 26, 50, 57].includes(id)
      ? "shovel"
      : pattern === "log" || pattern === "planks"
        ? "axe"
        : [
              3, 4, 12, 13, 14, 15, 16, 20, 24, 42, 43, 44, 54, 55, 56, 71,
            ].includes(id)
          ? "pick"
          : "hand") as BlockDefinition["tool"],
    miningTime:
      id === 24
        ? 50
        : id === 16
          ? Infinity
          : [3, 4, 12, 13, 14, 15, 20, 42, 43, 54, 56, 71].includes(id)
            ? 2.4
            : pattern === "log" || pattern === "planks"
              ? 1.5
              : [8, 21, 22, 28, 30, 34, 36, 38, 51, 52, 53, 66, 67].includes(id)
                ? 0.25
                : 0.65,
    textures: {
      top: id === 1 ? 127 : id,
      bottom: id === 1 ? 2 : id,
      sides: id,
    },
    drop: id === 1 ? 2 : id === 3 ? 4 : id,
  }),
);
export const block = (id: number) => blocks[id] ?? blocks[0];
export const INITIAL_HOTBAR = [1, 2, 3, 4, 9, 7, 8, 10, 18];
export type BlockBox = [number, number, number, number, number, number];
export function blockBoxes(
  id: number,
  rotation = 0,
  open = false,
  wall = false,
): BlockBox[] {
  let boxes: BlockBox[];
  switch (block(id).shape) {
    case "slab":
      boxes = [[0, 0, 0, 1, 0.5, 1]];
      break;
    case "stairs":
      boxes = [
        [0, 0, 0, 1, 0.5, 1],
        [0, 0.5, 0.5, 1, 1, 1],
      ];
      break;
    case "fence":
      boxes = [
        [0.375, 0, 0.375, 0.625, 1.5, 0.625],
        [0, 0.4, 0.43, 1, 0.6, 0.57],
        [0, 0.9, 0.43, 1, 1.1, 0.57],
      ];
      break;
    case "gate":
      boxes =
        id === 47 ? [[0, 0, 0, 0.18, 1.2, 1]] : [[0, 0, 0.4, 1, 1.2, 0.6]];
      break;
    case "door":
      boxes = id >= 60 ? [[0, 0, 0, 0.1875, 1, 1]] : [[0, 0, 0, 1, 1, 0.1875]];
      break;
    case "ladder":
      boxes = [[0, 0, 0, 1, 1, 0.1]];
      break;
    case "torch":
      boxes = wall
        ? [[0.4, 0.15, 0, 0.6, 0.9, 0.2]]
        : [[0.4, 0, 0.4, 0.6, 0.8, 0.6]];
      break;
    case "chest":
      boxes = open ? [[0, 0, 0, 1, 0.72, 1]] : [[0, 0, 0, 1, 1, 1]];
      break;
    case "bed":
      boxes = [[0, 0, 0, 1, 0.55, 1]];
      break;
    case "snow":
      boxes = [[0, 0, 0, 1, 0.125, 1]];
      break;
    default:
      boxes = [[0, 0, 0, 1, 1, 1]];
  }
  for (let i = 0; i < ((rotation % 4) + 4) % 4; i++)
    boxes = boxes.map(([x, y, z, a, b, c]) => [1 - c, y, x, 1 - z, b, a]);
  return boxes;
}
