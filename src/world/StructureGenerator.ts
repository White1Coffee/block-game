import type { WorldGenerator } from "./WorldGenerator";
export type StructureKind = "hut" | "ruin" | "dungeon" | "mine" | "village";
export interface StructureAnchor {
  kind: StructureKind;
  x: number;
  z: number;
  y: number;
}
export function structureAnchors(
  g: WorldGenerator,
  cx: number,
  cz: number,
): StructureAnchor[] {
  const result: StructureAnchor[] = [];
  for (
    let gz = Math.floor((cz * 16 - 24) / 96);
    gz <= Math.floor((cz * 16 + 40) / 96);
    gz++
  )
    for (
      let gx = Math.floor((cx * 16 - 24) / 96);
      gx <= Math.floor((cx * 16 + 40) / 96);
      gx++
    ) {
      if (g.random(gx, gz, 1901) > 0.64) continue;
      const x = gx * 96 + 24 + Math.floor(g.random(gx, gz, 1902) * 32),
        z = gz * 96 + 24 + Math.floor(g.random(gx, gz, 1903) * 32);
      const kind = (["hut", "ruin", "dungeon", "mine", "village"] as const)[
        Math.floor(g.random(gx, gz, 1904) * 5)
      ];
      result.push({ kind, x, z, y: g.height(x, z) + 1 });
    }
  return result;
}
/** All nearby anchors are evaluated independently by every intersecting chunk. */
export function generateStructures(
  g: WorldGenerator,
  cx: number,
  cz: number,
  put: (x: number, y: number, z: number, id: number) => void,
) {
  const set = (x: number, y: number, z: number, id: number) =>
    put(x - cx * 16, y, z - cz * 16, id);
  const hut = (x: number, y: number, z: number) => {
    for (let dz = -3; dz <= 3; dz++)
      for (let dx = -3; dx <= 3; dx++) {
        for (let fy = Math.min(y - 1, g.height(x + dx, z + dz)); fy < y; fy++)
          set(x + dx, fy, z + dz, 4);
        for (let dy = 0; dy <= 4; dy++) {
          const wall = Math.abs(dx) === 3 || Math.abs(dz) === 3;
          set(
            x + dx,
            y + dy,
            z + dz,
            dy === 4
              ? 9
              : wall
                ? Math.abs(dx) === 3 && Math.abs(dz) === 3
                  ? 7
                  : dy === 2 && (dx === 0 || dz === 0)
                    ? 10
                    : 9
                : 0,
          );
        }
      }
    set(x, y, z + 3, 58);
    set(x, y + 1, z + 3, 59);
    set(x - 2, y, z - 2, 62);
    set(x + 1, y, z - 2, 63);
    set(x - 2, y + 2, z - 1, 65);
  };
  for (const a of structureAnchors(g, cx, cz)) {
    if (a.y <= 29 && a.kind !== "mine" && a.kind !== "dungeon") continue;
    if (a.kind === "hut") hut(a.x, a.y, a.z);
    if (a.kind === "village") {
      for (const [dx, dz] of [
        [-9, 0],
        [9, 0],
        [0, 10],
      ])
        hut(a.x + dx, g.height(a.x + dx, a.z + dz) + 1, a.z + dz);
      for (let dz = -5; dz <= 10; dz++)
        for (let dx = -9; dx <= 9; dx++)
          if (Math.abs(dx) < 2 || Math.abs(dz) < 2)
            set(a.x + dx, g.height(a.x + dx, a.z + dz), a.z + dz, 6);
    }
    if (a.kind === "ruin")
      for (let dy = 0; dy < 4; dy++)
        for (let dz = -4; dz <= 4; dz++)
          for (let dx = -4; dx <= 4; dx++)
            if (
              (Math.abs(dx) === 4 || Math.abs(dz) === 4) &&
              g.random(a.x + dx, a.z + dz, dy * 31) > 0.25 + dy * 0.12
            )
              set(a.x + dx, a.y + dy, a.z + dz, dy === 0 ? 26 : 42);
    if (a.kind === "dungeon") {
      const y = Math.max(5, a.y - 18);
      for (let dy = -1; dy <= 4; dy++)
        for (let dz = -4; dz <= 4; dz++)
          for (let dx = -4; dx <= 4; dx++)
            set(
              a.x + dx,
              y + dy,
              a.z + dz,
              dy === -1 || dy === 4 || Math.abs(dx) === 4 || Math.abs(dz) === 4
                ? g.random(a.x + dx, a.z + dz, dy) > 0.7
                  ? 26
                  : 42
                : 0,
            );
      set(a.x - 3, y, a.z - 3, 62);
      set(a.x + 3, y, a.z + 3, 62);
      set(a.x, y + 2, a.z, 54);
      for (let dz = 4; dz <= 7; dz++)
        for (let dy = 0; dy < 3; dy++) set(a.x, y + dy, a.z + dz, 0);
    }
    if (a.kind === "mine") {
      const y = Math.max(6, a.y - 14);
      for (let dx = -20; dx <= 20; dx++)
        for (let dz = -2; dz <= 2; dz++)
          for (let dy = 0; dy < 3; dy++)
            set(
              a.x + dx,
              y + dy,
              a.z + dz,
              dx % 5 === 0 && (Math.abs(dz) === 2 || dy === 2) ? 7 : 0,
            );
      set(a.x - 16, y, a.z + 1, 62);
    }
  }
}
