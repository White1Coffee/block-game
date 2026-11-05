import { describe, it, expect } from "vitest";
import { Survival } from "../src/inventory/Survival";
import { craftGrid } from "../src/inventory/RecipeRegistry";
import { DropSystem } from "../src/inventory/DropSystem";
import { Projectiles } from "../src/entities/Projectiles";
import { Scene, Vector3 } from "three";
describe("progression and entity safety", () => {
  it("does not multiply unstackable items when restoring older drop stacks", () => {
    const drops = new DropSystem(new Scene());
    drops.restore([
      {
        id: 100,
        count: 3,
        position: [0, 1, 0],
        age: 1,
        entityId: "legacy-drop",
        durability: 17,
      },
    ]);
    const records = drops.serialize();
    expect(records.reduce((sum, d) => sum + d.count, 0)).toBe(3);
    expect(new Set(records.map((d) => d.entityId)).size).toBe(3);
    expect(records.every((d) => d.durability === 17)).toBe(true);
    drops.dispose();
  });
  it("preserves tool wear/enchantments across chest transfers", async () => {
    const { BlockEntities } = await import("../src/world/BlockEntities");
    const s = new Survival(),
      entities = new BlockEntities(),
      slots = entities.chest("0,1,0");
    s.add(100);
    s.durability[100] = 17;
    s.enchantments[100] = { efficiency: 2 };
    expect(entities.transferTo(s, slots, 0, 100)).toBe(true);
    expect(s.count(100)).toBe(0);
    expect(entities.transferFrom(s, slots, 0)).toBe(true);
    expect(s.durability[100]).toBe(17);
    expect(s.enchantments[100].efficiency).toBe(2);
  });
  it("despawns far-away drops and restores metadata", () => {
    const drops = new DropSystem(new Scene());
    drops.spawn(100, 1, [1000, 2, 1000], 299, undefined, {
      durability: 9,
      enchantments: { efficiency: 1 },
    });
    const saved = drops.serialize();
    drops.restore(saved);
    expect(drops.serialize()[0].durability).toBe(9);
    drops.update({ solid: () => false }, new Vector3(), 2, (_id, n) => n);
    expect(drops.serialize()).toHaveLength(0);
    drops.dispose();
  });
  it("enchantments consume levels and affect mining and damage", () => {
    const s = new Survival();
    s.add(100);
    s.addXP(700);
    const time = s.miningTime(3, 100),
      xp = s.xp;
    expect(s.enchant(100, "efficiency")).toBe(true);
    expect(s.xp).toBeLessThan(xp);
    expect(s.miningTime(3, 100)).toBeLessThan(time);
    s.add(201);
    const hit = s.attackDamage(201);
    expect(s.enchant(201, "sharpness")).toBe(true);
    expect(s.attackDamage(201)).toBeGreaterThan(hit);
  });
  it("failed crafting is atomic and publishes no inventory event", () => {
    const s = new Survival();
    s.add(7, 2);
    s.add(9, 64);
    s.add(100, 34);
    const events: unknown[] = [];
    s.inventoryEvents.subscribe((e) => events.push(e));
    expect(craftGrid(s, [7, 0, 0, 0], 2)).toBe(0);
    expect(events).toHaveLength(0);
    expect(s.count(7)).toBe(2);
  });
  it("keeps full-inventory drops and merges compatible stacks", () => {
    const scene = new Scene(),
      drops = new DropSystem(scene);
    drops.spawn(2, 4, [0, 1, 0]);
    drops.spawn(2, 3, [0, 1, 0]);
    expect(drops.serialize()).toHaveLength(1);
    expect(drops.serialize()[0].count).toBe(7);
    drops.update(
      { solid: () => false },
      new Vector3(0, 1, 0),
      0.6,
      (_id, n) => n,
    );
    expect(drops.serialize()[0].count).toBe(7);
    drops.dispose();
  });
  it("substeps projectiles so a fast arrow cannot pass through a wall", () => {
    const p = new Projectiles(new Scene());
    p.shoot("player", { x: 0.5, y: 2, z: 0.5 }, { x: 1, y: 0, z: 0 }, 40);
    let damage = 0;
    p.update(
      0.1,
      { solid: (x: number) => Math.floor(x) === 1 } as any,
      { x: 9, y: 1, z: 1 },
      [],
      () => damage++,
      () => damage++,
      () => false,
    );
    expect(p.arrows[0].stuck).toBe(true);
    expect(p.arrows[0].x).toBeLessThan(2);
    expect(damage).toBe(0);
  });
});
