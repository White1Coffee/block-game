import { describe, it, expect } from "vitest";
import { Survival } from "../src/inventory/Survival";
import { migrateSave } from "../src/storage/SaveMigration";
describe("Survival damage", () => {
  it("provides damage immunity and correct drowning recovery", () => {
    const s = new Survival();
    expect(s.damage(3)).toBe(true);
    expect(s.damage(3)).toBe(false);
    expect(s.health).toBe(17);
    s.air = 0;
    s.tick(1, 1, true, true, false, false, { submerged: true });
    expect(s.health).toBe(15);
    s.tick(1, 1, true, false, false, false);
    expect(s.air).toBeGreaterThan(0);
  });
  it("handles lava/fire, difficulty and saturation", () => {
    const s = new Survival();
    s.tick(1, 1, true, false, false, false, { lava: true });
    expect(s.health).toBe(16);
    s.hunger = 0;
    s.health = 1;
    s.difficulty = "normal";
    s.burning = 0;
    s.tick(5, 1, true, false, false, false);
    expect(s.health).toBe(1);
    s.difficulty = "hard";
    s.tick(5, 1, true, false, false, false);
    expect(s.health).toBe(0);
  });
  it("migrates without changing terrain version or edits", () => {
    const old = {
      id: "old",
      version: 1,
      changes: [{ x: 1, y: 2, z: 3, id: 9 }],
      seed: "same",
      survival: { health: 13, hunger: 10, items: { 7: 4 } },
    } as any;
    const saved = migrateSave(old);
    expect(saved.version).toBe(1);
    expect(saved.changes).toEqual(old.changes);
    expect(saved.survival?.items).toEqual({ 7: 4 });
    expect(saved.rules?.keepInventory).toBe(false);
    expect(saved.schemaVersion).toBe(5);
  });
});
