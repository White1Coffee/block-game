import { describe, it, expect } from "vitest";
import { Survival, recipes } from "../src/inventory/Survival";
describe("survival resources and crafting", () => {
  it("cannot create resources or craft without ingredients", () => {
    const s = new Survival();
    expect(s.consume(7)).toBe(false);
    expect(s.craft(recipes[0], () => true)).toBe(false);
    s.add(7, 1);
    expect(s.craft(recipes[0], () => true)).toBe(true);
    expect(s.count(7)).toBe(0);
    expect(s.count(9)).toBe(4);
  });
  it("requires a station and rejects output overflow without consuming input", () => {
    const s = new Survival();
    s.add(9, 20);
    s.add(103, 10);
    expect(s.craft(recipes[4], () => false)).toBe(false);
    expect(s.craft(recipes[4], () => true)).toBe(true);
    expect(s.count(100)).toBe(1);
    s.items = { 9: 64, 7: 2, 100: 34 };
    expect(s.craft(recipes[0], () => true)).toBe(false);
    expect(s.count(7)).toBe(2);
    expect(s.add(9, 1)).toBe(1);
  });
  it("requires tools for stone drops, accelerates mining and wears tools", () => {
    const s = new Survival();
    expect(s.dropFor(3, 0)).toBe(0);
    s.add(100);
    expect(s.dropFor(3, 100)).toBe(4);
    expect(s.miningTime(3, 100)).toBeLessThan(s.miningTime(3, 0));
    for (let i = 0; i < 60; i++) s.useTool(100);
    expect(s.count(100)).toBe(0);
  });
  it("applies fall damage only after landing and avoids damage in water", () => {
    const s = new Survival();
    s.tick(0.1, 20, false, false, false, false);
    s.tick(0.1, 10, true, false, false, false);
    expect(s.health).toBe(13);
    s.tick(0.1, 20, false, false, false, false);
    s.tick(0.1, 2, true, true, false, false);
    expect(s.health).toBe(13);
  });
  it("consumes food, restores hunger and persists counts", () => {
    const s = new Survival();
    s.hunger = 10;
    s.add(105, 2);
    expect(s.eat()).toBe(true);
    expect(s.hunger).toBe(15);
    expect(s.count(105)).toBe(1);
    expect(new Survival(s.serialize()).serialize()).toEqual(s.serialize());
  });
});
