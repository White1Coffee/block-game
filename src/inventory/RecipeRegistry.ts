import { TOOL_IDS } from "./ItemRegistry";
import type { Survival } from "./Survival";
export interface GridRecipe {
  id: string;
  name: string;
  pattern?: number[][];
  shapeless?: number[];
  output: [number, number];
}
export const gridRecipes: GridRecipe[] = [];
const add = (
  id: string,
  name: string,
  pattern: number[][],
  output: [number, number],
) => gridRecipes.push({ id, name, pattern, output });
for (const [log, plank] of [
  [7, 9],
  [27, 31],
  [29, 32],
  [33, 68],
  [35, 69],
  [37, 70],
]) {
  gridRecipes.push({
    id: `planks-${log}`,
    name: "Planken",
    shapeless: [log],
    output: [plank, 4],
  });
  add(`sticks-${plank}`, "Stokken", [[plank], [plank]], [103, 4]);
  add(
    `table-${plank}`,
    "Werkbank",
    [
      [plank, plank],
      [plank, plank],
    ],
    [19, 1],
  );
}
add(
  "furnace",
  "Oven",
  [
    [4, 4, 4],
    [4, 0, 4],
    [4, 4, 4],
  ],
  [20, 1],
);
add(
  "chest",
  "Kist",
  [
    [9, 9, 9],
    [9, 0, 9],
    [9, 9, 9],
  ],
  [62, 1],
);
add("torch", "Fakkels", [[110], [103]], [65, 4]);
for (const [tier, material] of [9, 4, 111, 112, 113].entries()) {
  const id = TOOL_IDS[tier];
  add(
    `pick-${tier}`,
    "Pikhouweel",
    [
      [material, material, material],
      [0, 103, 0],
      [0, 103, 0],
    ],
    [id[0], 1],
  );
  add(
    `axe-${tier}`,
    "Bijl",
    [
      [material, material],
      [material, 103],
      [0, 103],
    ],
    [id[1], 1],
  );
  add(`shovel-${tier}`, "Schep", [[material], [103], [103]], [id[2], 1]);
  add(
    `hoe-${tier}`,
    "Schoffel",
    [
      [material, material],
      [0, 103],
      [0, 103],
    ],
    [id[3], 1],
  );
  add(`sword-${tier}`, "Zwaard", [[material], [material], [103]], [id[4], 1]);
}
add(
  "door",
  "Deur",
  [
    [9, 9],
    [9, 9],
    [9, 9],
  ],
  [58, 3],
);
add(
  "ladder",
  "Ladder",
  [
    [103, 0, 103],
    [103, 103, 103],
    [103, 0, 103],
  ],
  [64, 3],
);
add(
  "bed",
  "Bed",
  [
    [39, 39, 39],
    [9, 9, 9],
  ],
  [63, 1],
);
add("bread", "Brood", [[118, 118, 118]], [119, 1]);
add(
  "bow",
  "Boog",
  [
    [0, 103, 114],
    [103, 0, 114],
    [0, 103, 114],
  ],
  [116, 1],
);
gridRecipes.push({
  id: "arrows",
  name: "Pijlen",
  shapeless: [6, 103, 128],
  output: [115, 4],
});
add(
  "armor",
  "Borstplaat",
  [
    [111, 0, 111],
    [111, 111, 111],
    [111, 111, 111],
  ],
  [131, 1],
);
add(
  "fence",
  "Hek",
  [
    [9, 103, 9],
    [9, 103, 9],
  ],
  [45, 3],
);
add(
  "gate",
  "Hekpoort",
  [
    [103, 9, 103],
    [103, 9, 103],
  ],
  [46, 1],
);
add("slab", "Platen", [[9, 9, 9]], [49, 6]);
add(
  "stairs",
  "Trappen",
  [
    [9, 0, 0],
    [9, 9, 0],
    [9, 9, 9],
  ],
  [48, 4],
);
add(
  "bookshelf",
  "Boekenkast",
  [
    [9, 9, 9],
    [132, 132, 132],
    [9, 9, 9],
  ],
  [44, 1],
);
function trim(grid: number[][]) {
  const points = grid.flatMap((row, y) =>
    row.flatMap((id, x) => (id ? [{ x, y }] : [])),
  );
  if (!points.length) return [];
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y),
    left = Math.min(...xs),
    right = Math.max(...xs),
    top = Math.min(...ys),
    bottom = Math.max(...ys);
  return grid.slice(top, bottom + 1).map((row) => row.slice(left, right + 1));
}
export function matchRecipe(grid: number[], size: number) {
  const matrix = trim(
    Array.from({ length: size }, (_, y) =>
      grid.slice(y * size, y * size + size),
    ),
  );
  const flat = grid.filter(Boolean).sort((a, b) => a - b);
  return gridRecipes.find((r) => {
    if (r.shapeless)
      return (
        JSON.stringify([...r.shapeless].sort((a, b) => a - b)) ===
        JSON.stringify(flat)
      );
    const pattern = r.pattern!;
    return (
      JSON.stringify(matrix) === JSON.stringify(pattern) ||
      JSON.stringify(matrix.map((row) => [...row].reverse())) ===
        JSON.stringify(pattern)
    );
  });
}
export function craftGrid(
  s: Survival,
  grid: number[],
  size: number,
  repeat = false,
) {
  const recipe = matchRecipe(grid, size);
  if (!recipe) return 0;
  const required: Record<number, number> = {};
  grid
    .filter(Boolean)
    .forEach((id) => (required[id] = (required[id] ?? 0) + 1));
  let done = 0;
  for (let i = 0; i < (repeat ? 64 : 1); i++) {
    if (
      !Object.entries(required).every(
        ([id, count]) => s.count(Number(id)) >= count,
      )
    )
      break;
    if (!s.transact(required, recipe.output)) break;
    done++;
  }
  return done;
}
