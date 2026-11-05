import { generateStructures } from "./StructureGenerator";
export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 80;
export const GENERATOR_VERSION = 3;
export function seedHash(seed: string): number {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
export class WorldGenerator {
  readonly seed: number;
  constructor(
    seed: string,
    public readonly heightLimit = WORLD_HEIGHT,
    public readonly version = 1,
  ) {
    this.seed = seedHash(seed);
  }
  random(x: number, z: number, salt = 0): number {
    let h =
      Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ this.seed ^ salt;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  noise(x: number, z: number, scale: number, salt = 0): number {
    x /= scale;
    z /= scale;
    const ix = Math.floor(x),
      iz = Math.floor(z);
    const fx = x - ix,
      fz = z - iz;
    const u = fx * fx * (3 - 2 * fx),
      v = fz * fz * (3 - 2 * fz);
    const a = this.random(ix, iz, salt),
      b = this.random(ix + 1, iz, salt),
      c = this.random(ix, iz + 1, salt),
      d = this.random(ix + 1, iz + 1, salt);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  }
  biome(x: number, z: number): string {
    const n = this.noise(x, z, 160, 72);
    if (this.version >= 3) {
      const biomes = [
        "Bevroren Oceaan",
        "Strand",
        "Moeras",
        "Woestijn",
        "Savanna",
        "Badlands",
        "Grasland",
        "Berkenbos",
        "Bos",
        "Donker Bos",
        "Taiga",
        "Jungle",
        "Bergen",
        "Sneeuwvlakte",
      ];
      return biomes[
        Math.max(0, Math.min(13, Math.floor(((n - 0.2) / 0.6) * 14)))
      ];
    }
    return n < 0.23
      ? "Woestijn"
      : n > 0.77
        ? "Sneeuwvlakte"
        : n > 0.62
          ? "Bergen"
          : n > 0.43
            ? "Bos"
            : "Grasland";
  }
  height(x: number, z: number): number {
    const mountain = this.biome(x, z) === "Bergen" ? 13 : 0;
    const base = Math.floor(
      23 +
        this.noise(x, z, 64) * 15 +
        this.noise(x, z, 19, 43) * 5 +
        mountain * this.noise(x, z, 24, 85),
    );
    if (this.version === 1) return Math.min(this.heightLimit - 9, base);
    const river = Math.abs(this.noise(x, z, 90, 517) - 0.5);
    const riverDepth = Math.max(0, 1 - river / 0.035) * 13;
    let height = Math.min(
      this.heightLimit - 9,
      Math.max(16, Math.floor(base - riverDepth)),
    );
    if (this.version >= 3) {
      const biome = this.biome(x, z);
      if (biome === "Bevroren Oceaan")
        height = 20 + Math.floor(this.noise(x, z, 20) * 4);
      if (biome === "Strand")
        height = 26 + Math.floor(this.noise(x, z, 20) * 3);
      if (biome === "Moeras")
        height = 26 + Math.floor(this.noise(x, z, 24) * 3);
      if (biome === "Badlands")
        height = 31 + Math.floor(this.noise(x, z, 30) * 4) * 4;
    }
    return Math.min(this.heightLimit - 10, height);
  }
  terrain(
    x: number,
    y: number,
    z: number,
    h = this.height(x, z),
    biome = this.biome(x, z),
  ): number {
    if (y < 0) return 16;
    if (y >= this.heightLimit) return 0;
    if (y === 0) return 16;
    if (this.version >= 3) {
      if (y > h) {
        if (y === 27 && biome === "Bevroren Oceaan") return 55;
        return y <= 27 ? 11 : 0;
      }
      if (y === h) {
        if (biome === "Strand" || biome === "Woestijn") return 5;
        if (biome === "Badlands") return 25;
        if (biome === "Moeras") return 26;
      }
      if (
        y > 2 &&
        y < h - 6 &&
        this.noise(x + y * 2.3, z - y * 1.7, 9, 175) > 0.69
      )
        return y < 7
          ? 23
          : y === 12 && this.noise(x, z, 18, 719) > 0.65
            ? 11
            : 0;
      const vein = this.random(
        Math.floor(x / 4) + Math.floor(y / 4) * 1009,
        Math.floor(z / 4),
        879,
      );
      if (y < h - 4 && vein > 0.94)
        return vein > 0.992 && y < 18
          ? 15
          : vein > 0.985 && y < 25
            ? 14
            : vein > 0.965
              ? 13
              : 12;
    }
    if (y > h) return y <= 27 ? 11 : 0;
    if (y === h)
      return biome === "Woestijn" || h <= 28
        ? this.version >= 2 && this.random(x, z, 778) < 0.13
          ? 6
          : 5
        : biome === "Sneeuwvlakte"
          ? 17
          : 1;
    if (y > h - 4) return biome === "Woestijn" || h <= 28 ? 5 : 2;
    if (
      y > 4 &&
      y < h - 5 &&
      this.noise(x + y * 1.6, z - y * 1.2, 12, 875) > 0.77
    )
      return 0;
    const ore = this.random(x + y * 125, z - y * 31, 69);
    return ore > 0.996 && y < 16
      ? 15
      : ore > 0.991 && y < 24
        ? 14
        : ore > 0.981
          ? 13
          : ore > 0.963
            ? 12
            : this.version >= 3 && y < 12
              ? 71
              : 3;
  }
  generate(cx: number, cz: number): Uint8Array {
    const data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * this.heightLimit);
    const put = (x: number, y: number, z: number, id: number) => {
      if (
        x >= 0 &&
        x < 16 &&
        z >= 0 &&
        z < 16 &&
        y >= 0 &&
        y < this.heightLimit
      )
        data[x + z * 16 + y * 256] = id;
    };
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const wx = cx * 16 + x,
          wz = cz * 16 + z,
          h = this.height(wx, wz),
          biome = this.biome(wx, wz);
        for (let y = 0; y < this.heightLimit; y++)
          put(x, y, z, this.terrain(wx, y, wz, h, biome));
      }
    // Include roots outside this chunk so trees are seamless across boundaries.
    for (let z = -2; z < 18; z++)
      for (let x = -2; x < 18; x++) {
        const wx = cx * 16 + x,
          wz = cz * 16 + z,
          h = this.height(wx, wz),
          biome = this.biome(wx, wz);
        if (
          h <= 28 ||
          !(
            this.version >= 3
              ? [
                  "Bos",
                  "Grasland",
                  "Berkenbos",
                  "Donker Bos",
                  "Taiga",
                  "Jungle",
                  "Savanna",
                  "Moeras",
                ]
              : ["Bos", "Grasland"]
          ).includes(biome) ||
          this.random(wx, wz, 192) >
            (biome === "Grasland" || biome === "Savanna" ? 0.003 : 0.018)
        )
          continue;
        for (let dy = 3; dy <= 6; dy++)
          for (let dz = -2; dz <= 2; dz++)
            for (let dx = -2; dx <= 2; dx++)
              if (Math.abs(dx) + Math.abs(dz) + (dy === 6 ? 1 : 0) < 4)
                put(
                  x + dx,
                  h + dy,
                  z + dz,
                  this.version >= 3
                    ? ((
                        {
                          Berkenbos: 28,
                          Taiga: 30,
                          "Donker Bos": 34,
                          Jungle: 36,
                          Savanna: 38,
                        } as Record<string, number>
                      )[biome] ?? 8)
                    : 8,
                );
        for (let dy = 1; dy <= 4; dy++)
          put(
            x,
            h + dy,
            z,
            this.version >= 3
              ? ((
                  {
                    Berkenbos: 27,
                    Taiga: 29,
                    "Donker Bos": 33,
                    Jungle: 35,
                    Savanna: 37,
                  } as Record<string, number>
                )[biome] ?? 7)
              : 7,
          );
      }
    if (this.version >= 2)
      for (let z = 0; z < 16; z++)
        for (let x = 0; x < 16; x++) {
          const h = this.height(cx * 16 + x, cz * 16 + z);
          if (
            data[x + z * 16 + h * 256] === 1 &&
            data[x + z * 16 + (h + 1) * 256] === 0
          ) {
            const plant = this.random(cx * 16 + x, cz * 16 + z, 1989);
            if (plant < 0.09) put(x, h + 1, z, plant < 0.016 ? 21 : 22);
          }
        }
    if (this.version >= 3) generateStructures(this, cx, cz, put);
    return data;
  }
}
