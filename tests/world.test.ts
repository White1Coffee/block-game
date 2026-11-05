import { describe, it, expect, vi, afterEach } from "vitest";
import { World } from "../src/world/World";
import { WorldGenerator } from "../src/world/WorldGenerator";
import { raycast } from "../src/blocks/BlockInteraction";
afterEach(() => vi.unstubAllGlobals());
describe("generation versions and worker handoff", () => {
  it("uses the configured height and keeps v1 available alongside v2", () => {
    const a = new WorldGenerator("height", 64, 2),
      b = new WorldGenerator("height", 128, 2);
    expect(a.generate(0, 0)).toHaveLength(16 * 16 * 64);
    expect(b.generate(0, 0)).toHaveLength(16 * 16 * 128);
    expect(new WorldGenerator("same", 80, 1).generate(0, 0)).not.toEqual(
      new WorldGenerator("same", 80, 2).generate(0, 0),
    );
  });
  it("applies persisted edits to a worker result and falls back after errors", () => {
    let instance: any;
    class FakeWorker {
      onmessage: any;
      onerror: any;
      last: any;
      constructor() {
        instance = this;
      }
      postMessage(data: any) {
        this.last = data;
      }
      terminate() {}
    }
    vi.stubGlobal("Worker", FakeWorker);
    const w = new World("worker", 128, 2);
    w.restore([{ x: 32, y: 90, z: -1, id: 18 }]);
    w.prefetch(2, -1);
    expect(instance.last.height).toBe(128);
    instance.onmessage({
      data: { key: "2,-1", blocks: new Uint8Array(256 * 128) },
    });
    expect(w.get(32, 90, -1)).toBe(18);
    instance.onerror();
    expect(w.workerFailed).toBe(true);
    expect(w.get(2, 0, 2)).toBe(16);
    w.dispose();
  });
  it("publishes serializable block changes and supports unsubscribe", () => {
    const w = new World("events"),
      events: unknown[] = [];
    const unsubscribe = w.events.subscribe((event) => events.push(event));
    w.set(1, 60, 1, 9);
    unsubscribe();
    w.set(2, 60, 1, 9);
    expect(JSON.parse(JSON.stringify(events))).toEqual([
      { type: "block-changed", change: { x: 1, y: 60, z: 1, id: 9 } },
    ]);
  });
});
describe("seed-based terrain", () => {
  it("reproduces complete chunks, including negative coordinates", () => {
    const a = new WorldGenerator("test"),
      b = new WorldGenerator("test");
    expect(a.generate(-1, 2)).toEqual(b.generate(-1, 2));
    expect(a.generate(0, 0)).not.toEqual(
      new WorldGenerator("other").generate(0, 0),
    );
  });
  it("keeps a solid floor and bounded surface", () => {
    const g = new WorldGenerator("wildbrick");
    for (let x = -60; x < 60; x += 7) {
      expect(g.terrain(x, 0, 3)).toBe(16);
      expect(g.height(x, 3)).toBeGreaterThan(20);
      expect(g.height(x, 3)).toBeLessThan(70);
    }
  });
});
describe("chunk edits", () => {
  it("marks both sides of positive and negative chunk boundaries dirty", () => {
    const w = new World("test");
    w.set(16, 60, 2, 9);
    expect(w.dirty.has("0,0")).toBe(true);
    expect(w.dirty.has("1,0")).toBe(true);
    w.set(-1, 60, -1, 9);
    expect(w.dirty.has("-1,-1")).toBe(true);
    expect(w.dirty.has("0,-1")).toBe(true);
    expect(w.dirty.has("-1,0")).toBe(true);
  });
  it("restores edits after unloading chunks without expanding the save", () => {
    const w = new World("test");
    w.set(-1, 60, 0, 9);
    w.set(-1, 60, 0, 18);
    w.chunks.clear();
    expect(w.get(-1, 60, 0)).toBe(18);
    expect(w.changes.size).toBe(1);
    const loaded = new World("test");
    loaded.restore([...w.changes.values()]);
    expect(loaded.get(-1, 60, 0)).toBe(18);
    expect(w.set(0, 0, 0, 0)).toBe(false);
  });
});
describe("voxel raycast", () => {
  const world = {
    get: (x: number, y: number, z: number) =>
      x === 2 && y === 1 && z === 0 ? 3 : 0,
  };
  it("returns the hit block and the adjacent placement normal", () => {
    expect(
      raycast(world, { x: 0.5, y: 1.5, z: 0.5 }, { x: 1, y: 0, z: 0 }),
    ).toEqual({ x: 2, y: 1, z: 0, normal: [-1, 0, 0], distance: 1.5 });
  });
  it("respects reach and handles zero direction components", () => {
    expect(
      raycast(world, { x: 0.5, y: 1.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 1),
    ).toBeNull();
    expect(
      raycast(world, { x: 0.5, y: 1.5, z: 0.5 }, { x: 0, y: 0, z: 0 }),
    ).toBeNull();
  });
  it("traverses negative coordinates", () => {
    const hit = raycast(
      { get: (x) => (x === -2 ? 1 : 0) },
      { x: 0.5, y: 0.5, z: 0.5 },
      { x: -1, y: 0, z: 0 },
    );
    expect(hit?.x).toBe(-2);
    expect(hit?.normal).toEqual([1, 0, 0]);
  });
});
