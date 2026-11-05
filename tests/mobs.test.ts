import { describe, it, expect } from "vitest";
import {
  MobSystem,
  findPath,
  mobBlocked,
  type MobHooks,
} from "../src/entities/MobSystem";
const hooks = (): MobHooks => ({
  damage: () => {},
  shoot: () => {},
  explode: () => {},
  drop: () => {},
  xp: () => {},
  light: () => 15,
  sound: () => {},
});
describe("mobs and combat", () => {
  it("stops attacks when a wall breaks line of sight", () => {
    let damage = 0;
    const h = hooks();
    h.damage = () => {
      damage++;
    };
    const mobs = new MobSystem(h),
      m = mobs.spawn("hollow", 0.5, 1, 0.5)!;
    m.state = "Attack";
    m.timer = 100;
    const w = {
      solid: (x: number, y: number) => y < 1 || Math.floor(x) === 1,
      generator: { random: () => 0.5 },
    } as any;
    mobs.update(w, 0.1, { x: 2.5, y: 1, z: 0.5 }, true, false);
    expect(damage).toBe(0);
    expect(m.state).toBe("Investigate");
  });
  it("paths around walls without entering solid voxels", () => {
    const world = {
      solid: (x: number, y: number, z: number) =>
        y < 1 || (x === 2 && z >= -2 && z <= 2 && y < 4),
    };
    const path = findPath(world, [0.5, 1, 0.5], [4.5, 1, 0.5]);
    expect(path.length).toBeGreaterThan(2);
    expect(path.some(([x, z]) => Math.abs(z) > 2)).toBe(true);
    expect(path.every(([x, z]) => !mobBlocked(world, x, 1, z))).toBe(true);
  });
  it("prevents attacks through walls and pays loot only once", () => {
    const loot: number[] = [];
    const h = hooks();
    h.drop = (id: number) => {
      loot.push(id);
    };
    const mobs = new MobSystem(h),
      m = mobs.spawn("cow", 0, 1, 0)!;
    expect(
      mobs.lineOfSight({ solid: () => true } as any, m, { x: 3, y: 1, z: 0 }),
    ).toBe(false);
    expect(mobs.hurt(m, 20, [1, 0])).toBe(true);
    expect(mobs.hurt(m, 20, [1, 0])).toBe(false);
    expect(loot).toEqual([121, 127]);
  });
  it("enforces spawn limits and preserves serializable identities", () => {
    const mobs = new MobSystem(hooks());
    mobs.maxMobs = 1;
    mobs.spawn("pig", 0, 1, 0);
    expect(mobs.spawn("cow", 1, 1, 1)).toBeNull();
    const saved = mobs.serialize(),
      restored = new MobSystem(hooks());
    restored.restore(saved);
    expect(restored.mobs[0].id).toBe(saved[0].id);
  });
});
