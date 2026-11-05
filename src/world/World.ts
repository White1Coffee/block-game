import { block, blocks, blockBoxes } from "../blocks/BlockRegistry";
import { CHUNK_SIZE, WORLD_HEIGHT, WorldGenerator } from "./WorldGenerator";
import { EventBus } from "../core/EventBus";
import type { VoxelLighting } from "./VoxelLighting";
export interface BlockChange {
  x: number;
  y: number;
  z: number;
  id: number;
}
export class World {
  readonly generator: WorldGenerator;
  readonly chunks = new Map<string, Uint8Array>();
  readonly changes = new Map<string, BlockChange>();
  private changesByChunk = new Map<string, Map<string, BlockChange>>();
  readonly dirty = new Set<string>();
  states: Record<
    string,
    { rotation: number; open?: boolean; wall?: boolean; lit?: boolean }
  > = {};
  lighting?: VoxelLighting;
  collisionBoxes(x: number, y: number, z: number) {
    const id = this.get(x, y, z);
    return block(id).solid
      ? blockBoxes(id, this.states[`${x},${y},${z}`]?.rotation ?? 0).map(
          ([a, b, c, d, e, f]) => [a + x, b + y, c + z, d + x, e + y, f + z],
        )
      : [];
  }
  readonly events = new EventBus<{
    type: "block-changed";
    change: BlockChange;
  }>();
  onChange?: (change: BlockChange) => void;
  private worker?: Worker;
  private pending = new Set<string>();
  workerFailed = false;
  constructor(
    public readonly seed: string,
    public readonly height = WORLD_HEIGHT,
    public readonly version = 1,
  ) {
    this.generator = new WorldGenerator(seed, height, version);
  }
  prefetch(cx: number, cz: number) {
    const key = this.key(cx, cz);
    if (
      this.chunks.has(key) ||
      this.pending.has(key) ||
      this.pending.size > 12 ||
      typeof Worker === "undefined" ||
      this.workerFailed
    )
      return;
    if (!this.worker) {
      this.worker = new Worker(
        new URL("./GenerationWorker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker.onmessage = ({ data }) => {
        this.pending.delete(data.key);
        if (this.chunks.has(data.key)) return;
        const [x, z] = data.key.split(",").map(Number);
        const chunk = data.blocks as Uint8Array;
        for (const c of this.chunkChanges(x, z))
          chunk[c.x - x * 16 + (c.z - z * 16) * 16 + c.y * 256] = c.id;
        this.chunks.set(data.key, chunk);
      };
      this.worker.onerror = () => {
        this.workerFailed = true;
        this.worker?.terminate();
        this.worker = undefined;
        this.pending.clear();
      };
    }
    this.pending.add(key);
    this.worker.postMessage({
      key,
      cx,
      cz,
      seed: this.seed,
      height: this.height,
      version: this.version,
    });
  }
  dispose() {
    this.worker?.terminate();
    this.worker = undefined;
    this.pending.clear();
    this.chunks.clear();
    this.changes.clear();
    this.changesByChunk.clear();
    this.dirty.clear();
    this.states = {};
    this.events.clear();
  }
  key(cx: number, cz: number) {
    return `${cx},${cz}`;
  }
  ensure(cx: number, cz: number) {
    if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cz))
      throw Error("Ongeldige chunkcoördinaten.");
    const key = this.key(cx, cz);
    let data = this.chunks.get(key);
    if (!data) {
      data = this.generator.generate(cx, cz);
      for (const c of this.chunkChanges(cx, cz))
        data[c.x - cx * 16 + (c.z - cz * 16) * 16 + c.y * 256] = c.id;
      this.chunks.set(key, data);
    }
    return data;
  }
  get(x: number, y: number, z: number): number {
    if (![x, y, z].every(Number.isFinite)) return 0;
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (y < 0) return 16;
    if (y >= this.height) return 0;
    const cx = Math.floor(x / CHUNK_SIZE),
      cz = Math.floor(z / CHUNK_SIZE);
    return this.ensure(cx, cz)[x - cx * 16 + (z - cz * 16) * 16 + y * 256];
  }
  solid(x: number, y: number, z: number) {
    return block(this.get(x, y, z)).solid;
  }
  set(x: number, y: number, z: number, id: number) {
    if (![x, y, z].every(Number.isFinite)) return false;
    if (y < 1 || y >= this.height || !Number.isInteger(id) || !blocks[id])
      return false;
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    const cx = Math.floor(x / 16),
      cz = Math.floor(z / 16);
    if (this.get(x, y, z) === id) return false;
    this.ensure(cx, cz)[x - cx * 16 + (z - cz * 16) * 16 + y * 256] = id;
    const change = { x, y, z, id };
    if (id === 0) delete this.states[`${x},${y},${z}`];
    this.recordChange(change);
    this.dirty.add(this.key(cx, cz));
    if (x % 16 === 0) this.dirty.add(this.key(cx - 1, cz));
    if (((x % 16) + 16) % 16 === 15) this.dirty.add(this.key(cx + 1, cz));
    if (z % 16 === 0) this.dirty.add(this.key(cx, cz - 1));
    if (((z % 16) + 16) % 16 === 15) this.dirty.add(this.key(cx, cz + 1));
    this.onChange?.(change);
    this.events.emit({ type: "block-changed", change });
    return true;
  }
  restore(changes: BlockChange[]) {
    for (const c of changes)
      if (
        Number.isInteger(c.x) &&
        Number.isInteger(c.y) &&
        Number.isInteger(c.z) &&
        c.y > 0 &&
        c.y < this.height &&
        c.id >= 0 &&
        Number.isInteger(c.id) &&
        !!blocks[c.id]
      ) {
        this.recordChange(c);
        const cx = Math.floor(c.x / 16),
          cz = Math.floor(c.z / 16),
          data = this.chunks.get(this.key(cx, cz));
        if (data) data[c.x - cx * 16 + (c.z - cz * 16) * 16 + c.y * 256] = c.id;
      }
  }
  chunkChanges(cx: number, cz: number): Iterable<BlockChange> {
    return this.changesByChunk.get(this.key(cx, cz))?.values() ?? [];
  }
  replaceChunkChanges(cx: number, cz: number, changes: BlockChange[]) {
    const key = this.key(cx, cz);
    for (const entry of this.changesByChunk.get(key)?.keys() ?? [])
      this.changes.delete(entry);
    this.changesByChunk.delete(key);
    this.chunks.delete(key);
    this.restore(changes);
  }
  private recordChange(change: BlockChange) {
    const key = this.key(Math.floor(change.x / 16), Math.floor(change.z / 16)),
      position = `${change.x},${change.y},${change.z}`;
    let entries = this.changesByChunk.get(key);
    if (!entries) this.changesByChunk.set(key, (entries = new Map()));
    const copy = { ...change };
    entries.set(position, copy);
    this.changes.set(position, copy);
  }
}
