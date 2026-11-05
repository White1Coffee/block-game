import { block } from "../blocks/BlockRegistry";
import type { World } from "./World";
export class VoxelLighting {
  private cache = new Map<string, { sky: Uint8Array; light: Uint8Array }>();
  readonly sources = new Map<string, [number, number, number][]>();
  constructor(private world: World) {
    world.events.subscribe(({ change }) => {
      const cx = Math.floor(change.x / 16),
        cz = Math.floor(change.z / 16);
      this.invalidate(cx, cz);
    });
  }
  invalidate(cx: number, cz: number) {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const key = this.world.key(cx + dx, cz + dz);
        this.cache.delete(key);
        this.sources.delete(key);
        this.world.dirty.add(key);
      }
  }
  ensure(cx: number, cz: number) {
    const key = this.world.key(cx, cz);
    if (this.cache.has(key)) return;
    const height = this.world.height,
      data = this.world.ensure(cx, cz),
      sky = new Uint8Array(data.length),
      light = new Uint8Array(data.length),
      queue: number[] = [],
      sunQueue: number[] = [],
      sources: [number, number, number][] = [];
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        let sun = 15;
        let bottom = -1;
        for (let y = height - 1; y >= 0; y--) {
          const i = x + z * 16 + y * 256,
            id = data[i],
            b = block(id);
          if (id !== 0 && !b.transparent && b.shape === "cube") sun = 0;
          else if (id !== 0 && b.shape === "cube")
            sun = Math.max(0, sun - (id === 11 ? 2 : 1));
          sky[i] = sun;
          if (sun) bottom = i;
          if (b.emission) {
            light[i] = b.emission;
            queue.push(i);
            sources.push([cx * 16 + x + 0.5, y + 0.5, cz * 16 + z + 0.5]);
          }
        }
        if (bottom >= 0) sunQueue.push(bottom);
      }
    for (let y = 0; y < height; y++)
      for (let z = 0; z < 16; z++)
        for (let x = 0; x < 16; x++) {
          const i = x + z * 16 + y * 256;
          if (x === 0 || x === 15 || z === 0 || z === 15) {
            for (const [dx, dz] of [
              [-1, 0],
              [1, 0],
              [0, -1],
              [0, 1],
            ])
              if (x + dx < 0 || x + dx > 15 || z + dz < 0 || z + dz > 15) {
                const wx = cx * 16 + x + dx,
                  wz = cz * 16 + z + dz,
                  adj = this.world.get(wx, y, wz),
                  neighbor = this.cache.get(
                    this.world.key(Math.floor(wx / 16), Math.floor(wz / 16)),
                  ),
                  nx = ((wx % 16) + 16) % 16,
                  nz = ((wz % 16) + 16) % 16;
                const value =
                  Math.max(
                    block(adj).emission,
                    neighbor?.light[nx + nz * 16 + y * 256] ?? 0,
                  ) - 1;
                if (
                  value > light[i] &&
                  (data[i] === 0 || block(data[i]).transparent)
                ) {
                  light[i] = value;
                  queue.push(i);
                }
              }
          }
        }
    for (let head = 0; head < sunQueue.length; head++) {
      const i = sunQueue[head],
        level = sky[i] - 1;
      if (level <= 0) continue;
      const y = Math.floor(i / 256),
        z = Math.floor((i % 256) / 16),
        x = i % 16;
      for (const [dx, dy, dz] of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ]) {
        const nx = x + dx,
          ny = y + dy,
          nz = z + dz;
        if (nx < 0 || nx > 15 || nz < 0 || nz > 15 || ny < 0 || ny >= height)
          continue;
        const ni = nx + nz * 16 + ny * 256,
          b = block(data[ni]);
        if (
          level > sky[ni] &&
          (data[ni] === 0 || b.transparent || b.shape !== "cube")
        ) {
          sky[ni] = level;
          sunQueue.push(ni);
        }
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head],
        level = light[i] - 1;
      if (level <= 0) continue;
      const y = Math.floor(i / 256),
        z = Math.floor((i % 256) / 16),
        x = i % 16;
      for (const [dx, dy, dz] of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ]) {
        const nx = x + dx,
          ny = y + dy,
          nz = z + dz;
        if (nx < 0 || nx > 15 || nz < 0 || nz > 15 || ny < 0 || ny >= height)
          continue;
        const ni = nx + nz * 16 + ny * 256,
          b = block(data[ni]);
        if (
          level > light[ni] &&
          (data[ni] === 0 || b.transparent || b.shape !== "cube")
        ) {
          light[ni] = level;
          queue.push(ni);
        }
      }
    }
    this.cache.set(key, { sky, light });
    this.sources.set(key, sources);
  }
  sample(x: number, y: number, z: number) {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (y >= this.world.height) return { sky: 15, light: 0 };
    if (y < 0) return { sky: 0, light: 0 };
    const cx = Math.floor(x / 16),
      cz = Math.floor(z / 16),
      entry = this.cache.get(this.world.key(cx, cz));
    if (!entry)
      return {
        sky: y > this.world.generator.height(x, z) ? 15 : 0,
        light: block(this.world.get(x, y, z)).emission,
      };
    const i = x - cx * 16 + (z - cz * 16) * 16 + y * 256;
    return { sky: entry.sky[i], light: entry.light[i] };
  }
  level(x: number, y: number, z: number, night: boolean) {
    this.ensure(Math.floor(x / 16), Math.floor(z / 16));
    const v = this.sample(x, y, z);
    return Math.max(night ? v.sky * 0.2 : v.sky, v.light);
  }
  trim() {
    for (const key of this.cache.keys())
      if (!this.world.chunks.has(key)) {
        this.cache.delete(key);
        this.sources.delete(key);
      }
  }
}
