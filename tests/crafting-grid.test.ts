import { describe, it, expect } from "vitest";
import { matchRecipe, craftGrid } from "../src/inventory/RecipeRegistry";
import { Survival } from "../src/inventory/Survival";
import { BlockEntities } from "../src/world/BlockEntities";
describe("real crafting grids", () => {
  it("matches offset/mirrored shaped recipes and shapeless recipes", () => {
    expect(matchRecipe([0, 0, 7, 0], 2)?.output).toEqual([9, 4]);
    expect(matchRecipe([9, 9, 9, 9], 2)?.output).toEqual([19, 1]);
    expect(matchRecipe([0, 9, 9, 0, 103, 9, 0, 103, 0], 3)?.output).toEqual([
      102, 1,
    ]);
    expect(matchRecipe([9, 9, 0, 0], 2)).toBeUndefined();
  });
  it("consumes exact ingredients without duplication or overflow", () => {
    const s = new Survival();
    s.add(7, 2);
    expect(craftGrid(s, [7, 0, 0, 0], 2, true)).toBe(2);
    expect(s.count(7)).toBe(0);
    expect(s.count(9)).toBe(8);
    expect(craftGrid(s, [7, 0, 0, 0], 2)).toBe(0);
    s.add(7, 2);
    s.add(9, 56);
    s.add(100, 34);
    expect(craftGrid(s, [7, 0, 0, 0], 2)).toBe(0);
    expect(s.count(7)).toBe(2);
  });
  it("requires correct mining tiers and tool ownership", () => {
    const s = new Survival();
    expect(s.dropFor(15, 206)).toBe(0);
    s.add(100);
    expect(s.dropFor(13, 100)).toBe(0);
    s.add(206);
    expect(s.dropFor(15, 206)).toBe(113);
  });
  it("smelts only with fuel, stores progress and transfers without duplication", () => {
    const entities = new BlockEntities(),
      s = new Survival();
    const f = entities.furnace("0,1,0");
    f.input = { id: 13, count: 2 };
    f.fuel = { id: 110, count: 1 };
    const world = { get: () => 0, set: () => true } as any;
    for (let i = 0; i < 16; i++) entities.tick(0.5, world, { x: 0, z: 0 });
    expect(f.output).toEqual({ id: 111, count: 1 });
    expect(f.input?.count).toBe(1);
    expect(f.fuel).toBeNull();
    expect(new BlockEntities().data.chests).toEqual({});
    const slots = [f.output];
    expect(entities.transferFrom(s, slots, 0)).toBe(true);
    expect(entities.transferFrom(s, slots, 0)).toBe(false);
    expect(s.count(111)).toBe(1);
    const restored = new BlockEntities();
    restored.restore(entities.serialize());
    expect(restored.furnace("0,1,0").burn).toBe(f.burn);
  });
});
