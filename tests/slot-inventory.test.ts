import { describe, it, expect } from "vitest";
import { Survival } from "../src/inventory/Survival";
import {
  inventoryAction,
  type InventoryContext,
  type InventoryAction,
} from "../src/inventory/InventoryTransactions";
import { SlotInventory, type ItemStack } from "../src/inventory/SlotInventory";
import { inventoryContext } from "../src/inventory/InventoryContext";
import { BlockEntities } from "../src/world/BlockEntities";
const base = (): InventoryContext => ({ creative: false, size: 2 });
const click = (
  area: "inventory" | "craft" | "container" | "output",
  index: number,
  button: 0 | 2 = 0,
  shift = false,
): InventoryAction => ({ kind: "click", area, index, button, shift });
const total = (s: Survival, c?: InventoryContext) =>
  [...s.allStacks(), ...(c?.container ?? [])].reduce(
    (sum, stack) => sum + (stack?.count ?? 0),
    0,
  );
describe("physical player inventory", () => {
  it("puts a picked creative item into exactly the chosen slot without changing the selected hotbar slot", () => {
    const s = new Survival();
    s.selectedSlot = 2;
    s.initializeHotbar([1, 2, 3], true);
    const original = s.getInventory().snapshot().slots[2];
    const c = { ...base(), creative: true };
    inventoryAction(
      s,
      { kind: "creative", item: 113, button: 0, shift: false },
      c,
    );
    expect(s.getInventory().state.slots[2]).toEqual(original);
    inventoryAction(s, click("inventory", 24), c);
    expect(s.getInventory().state.slots[24]).toEqual({ id: 113, count: 64 });
    expect(s.getInventory().state.slots[2]).toEqual(original);
  });
  it("has 27 backpack slots, 9 hotbar slots and keeps empty hotbar slots empty", () => {
    const s = new Survival();
    expect(s.getInventory().state.slots).toHaveLength(36);
    expect(s.hotbarItems()).toEqual(Array(9).fill(0));
    s.add(3, 5);
    inventoryAction(
      s,
      {
        kind: "move",
        from: "inventory",
        index: 0,
        to: "inventory",
        target: 30,
      },
      base(),
    );
    expect(s.hotbarItems()[0]).toBe(0);
    expect(s.getInventory().state.slots[30]?.count).toBe(5);
  });
  it("picks up, swaps and merges real stacks and splits odd stacks with right click", () => {
    const s = new Survival();
    s.add(3, 9);
    s.add(2, 5);
    const c = base();
    inventoryAction(s, click("inventory", 0, 2), c);
    expect(s.getInventory().state.cursor?.count).toBe(5);
    expect(s.getInventory().state.slots[0]?.count).toBe(4);
    inventoryAction(s, click("inventory", 10, 2), c);
    expect(s.getInventory().state.slots[10]?.count).toBe(1);
    expect(s.getInventory().state.cursor?.count).toBe(4);
    inventoryAction(s, click("inventory", 1), c);
    expect(s.getInventory().state.cursor?.id).toBe(2);
    inventoryAction(s, click("inventory", 11), c);
    expect(s.count(3)).toBe(9);
    expect(s.count(2)).toBe(5);
  });
  it("shift-transfers and number-key swaps respect the chosen physical slots", () => {
    const s = new Survival();
    s.add(9, 64);
    inventoryAction(s, click("inventory", 0, 0, true), base());
    expect(s.getInventory().state.slots[9]?.id).toBe(9);
    expect(s.hotbarItems()[0]).toBe(0);
    inventoryAction(
      s,
      { kind: "hotbar", area: "inventory", index: 9, hotbar: 7 },
      base(),
    );
    expect(s.hotbarItems()[7]).toBe(9);
    expect(s.getInventory().state.slots[9]).toBeNull();
  });
  it("auto-pickups and /give-style additions fill free/compatible stacks rather than overwriting a selected slot", () => {
    const s = new Survival();
    s.add(3, 12);
    s.selectedSlot = 0;
    s.add(113, 128);
    expect(s.getInventory().state.slots[0]).toEqual({ id: 3, count: 12 });
    expect(s.getInventory().state.slots[1]?.count).toBe(64);
    expect(s.getInventory().state.slots[2]?.count).toBe(64);
  });
  it("persists layout, cursor, crafting inputs and metadata through save/load", () => {
    const s = new Survival();
    s.addStack({
      id: 100,
      count: 1,
      durability: 12,
      enchantments: { efficiency: 2 },
    });
    s.add(7, 4);
    inventoryAction(
      s,
      {
        kind: "move",
        from: "inventory",
        index: 0,
        to: "inventory",
        target: 35,
      },
      base(),
    );
    inventoryAction(s, click("inventory", 1, 2), base());
    inventoryAction(s, click("craft", 0, 2), base());
    const state = s.serialize(),
      restored = new Survival(JSON.parse(JSON.stringify(state)), s.durability);
    expect(restored.serialize()).toEqual(state);
    expect(restored.getInventory().state.slots[35]?.durability).toBe(12);
  });
  it("migrates old aggregate saves and hotbar preferences without duplicating any stock", () => {
    const s = new Survival(
      { health: 20, hunger: 20, items: { 3: 128, 7: 4, 100: 1 } },
      { 100: 15 },
    );
    s.initializeHotbar([100, 7, 3]);
    expect(s.hotbarItems().slice(0, 3)).toEqual([100, 7, 3]);
    expect(s.count(3)).toBe(128);
    expect(s.count(7)).toBe(4);
    expect(s.allStacks().reduce((n, s) => n + s.count, 0)).toBe(133);
  });
  it("keeps the durability and enchantments of two identical tools independent", () => {
    const s = new Survival();
    s.addStack({
      id: 100,
      count: 1,
      durability: 9,
      enchantments: { efficiency: 2 },
    });
    s.addStack({ id: 100, count: 1, durability: 50 });
    s.selectedSlot = 0;
    s.useTool(100);
    expect(s.getInventory().state.slots[0]?.durability).toBe(8);
    expect(s.getInventory().state.slots[1]?.durability).toBe(50);
    s.selectedSlot = 1;
    expect(s.miningTime(3, 100)).toBeGreaterThan(
      (() => {
        s.selectedSlot = 0;
        return s.miningTime(3, 100);
      })(),
    );
  });
  it("rejects invalid and forbidden moves without losing cursor or stack state", () => {
    const s = new Survival();
    s.add(113, 64);
    const before = s.serialize();
    for (const a of [
      click("inventory", 36),
      click("container", 0),
      { kind: "hotbar", area: "inventory", index: 0, hotbar: 9 },
      { kind: "creative", item: 113, button: 0, shift: false },
    ] as InventoryAction[])
      expect(() => inventoryAction(s, a, base())).toThrow();
    expect(s.serialize()).toEqual(before);
  });
  it("conserves every item across randomized splits, swaps, moves and shift-clicks", () => {
    const s = new Survival();
    s.add(3, 180);
    s.add(7, 95);
    s.add(113, 64);
    const c = base(),
      before = total(s);
    let seed = 42;
    const rand = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    for (let i = 0; i < 1000; i++) {
      inventoryAction(
        s,
        click("inventory", rand(36), rand(2) ? 0 : 2, rand(10) === 0),
        c,
      );
      expect(total(s)).toBe(before);
      for (const stack of s.getInventory().state.slots)
        if (stack) expect(stack.count).toBeLessThanOrEqual(64);
    }
  });
});
describe("actual crafting and shared containers", () => {
  it("consumes ingredients placed in a 2x2 grid and puts output at the cursor for explicit placement", () => {
    const s = new Survival();
    s.add(7, 2);
    const c = base();
    inventoryAction(s, click("inventory", 0), c);
    inventoryAction(s, click("craft", 0, 2), c);
    inventoryAction(s, click("inventory", 4), c);
    expect(s.count(7)).toBe(1);
    inventoryAction(s, click("output", 0), c);
    expect(s.getInventory().state.craft[0]).toBeNull();
    expect(s.getInventory().state.cursor).toEqual({ id: 9, count: 4 });
    expect(s.hotbarItems()[0]).toBe(0);
    inventoryAction(s, click("inventory", 17), c);
    expect(s.getInventory().state.slots[17]).toEqual({ id: 9, count: 4 });
  });
  it("recipe autofill transfers actual ingredients and rejects shortages atomically", () => {
    const s = new Survival();
    const c = base();
    s.add(9, 3);
    const before = s.serialize();
    expect(() =>
      inventoryAction(s, { kind: "recipe", recipe: "table" }, c),
    ).toThrow();
    expect(s.serialize()).toEqual(before);
    s.add(9, 1);
    const table = requireRecipeId("table");
    inventoryAction(s, { kind: "recipe", recipe: table }, c);
    expect(s.count(9)).toBe(0);
    inventoryAction(s, click("output", 0, 0, true), c);
    expect(s.count(19)).toBe(1);
  });
  it("returns escrow safely on close and explicitly drops only the overflow", () => {
    const s = new Survival();
    s.add(3, 2304);
    const model = s.getInventory();
    model.state.cursor = { id: 113, count: 7 };
    model.state.craft[0] = { id: 7, count: 1 };
    s.commitInventory();
    const dropped: ItemStack[] = [];
    inventoryAction(
      s,
      { kind: "close" },
      { ...base(), drop: (stack) => dropped.push(stack) },
    );
    expect(dropped.map((s) => [s.id, s.count])).toEqual([
      [7, 1],
      [113, 7],
    ]);
    expect(s.getInventory().state.cursor).toBeNull();
    expect(s.count(3)).toBe(2304);
  });
  it("never duplicates shared chest stock between two players", () => {
    const a = new Survival(),
      b = new Survival(),
      container: (ItemStack | null)[] = [
        { id: 113, count: 64 },
        ...Array(26).fill(null),
      ],
      c = { ...base(), container };
    inventoryAction(a, click("container", 0), c);
    inventoryAction(b, click("container", 0), c);
    expect(a.getInventory().state.cursor?.count).toBe(64);
    expect(b.getInventory().state.cursor).toBeNull();
    expect(total(a) + total(b)).toBe(64);
  });
  it("does not award furnace XP for a rolled-back output drag or allow inserting into output", () => {
    const s = new Survival(),
      entities = new BlockEntities(),
      f = entities.furnace("0,1,0");
    f.output = { id: 111, count: 2 };
    f.xp = 5;
    s.add(3, 64);
    let awarded = 0;
    const c = inventoryContext(
      s,
      false,
      { kind: "furnace", key: "0,1,0" },
      entities,
      () => {},
    );
    c.onOutput = (i) => {
      if (i === 2) awarded += 5;
    };
    expect(() =>
      inventoryAction(
        s,
        {
          kind: "move",
          from: "container",
          index: 2,
          to: "inventory",
          target: 0,
        },
        c,
      ),
    ).toThrow();
    expect(awarded).toBe(0);
    expect(c.container![2]?.count).toBe(2);
    inventoryAction(s, click("container", 2), c);
    expect(awarded).toBe(5);
  });
});
import { gridRecipes } from "../src/inventory/RecipeRegistry";
function requireRecipeId(fragment: string) {
  const r = gridRecipes.find((r) => r.output[0] === 19 && fragment === "table");
  if (!r) throw Error("Recipe missing");
  return r.id;
}

describe("cursor drag distribution", () => {
  it("shares evenly, retains remainder and never duplicates repeated destinations", () => {
    const s = new Survival();
    s.add(3, 10);
    inventoryAction(s, click("inventory", 0), base());
    inventoryAction(
      s,
      {
        kind: "distribute",
        button: 0,
        slots: [9, 10, 11, 9].map((index) => ({
          area: "inventory" as const,
          index,
        })),
      },
      base(),
    );
    expect(
      [9, 10, 11].map((i) => s.getInventory().state.slots[i]?.count),
    ).toEqual([3, 3, 3]);
    expect(s.getInventory().state.cursor?.count).toBe(1);
    expect(total(s)).toBe(10);
  });
  it("right drag places one per distinct slot and skips incompatible stacks", () => {
    const s = new Survival();
    s.add(3, 5);
    s.add(2, 4);
    inventoryAction(s, click("inventory", 0), base());
    inventoryAction(
      s,
      {
        kind: "distribute",
        button: 2,
        slots: [9, 9, 1, 10].map((index) => ({
          area: "inventory" as const,
          index,
        })),
      },
      base(),
    );
    expect(s.getInventory().state.slots[9]?.count).toBe(1);
    expect(s.getInventory().state.slots[10]?.count).toBe(1);
    expect(s.getInventory().state.slots[1]).toEqual({ id: 2, count: 4 });
    expect(s.getInventory().state.cursor?.count).toBe(3);
    expect(total(s)).toBe(9);
  });
  it("rolls back the entire gesture when a destination is invalid", () => {
    const s = new Survival();
    s.add(3, 10);
    inventoryAction(s, click("inventory", 0), base());
    const before = s.getInventory().snapshot();
    expect(() =>
      inventoryAction(
        s,
        {
          kind: "distribute",
          button: 0,
          slots: [
            { area: "inventory", index: 9 },
            { area: "inventory", index: 99 },
          ],
        },
        base(),
      ),
    ).toThrow();
    expect(s.getInventory().snapshot()).toEqual(before);
  });
});
