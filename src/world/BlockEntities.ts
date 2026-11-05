import type { World } from "./World";
import type { Survival } from "../inventory/Survival";
import { tools, stackLimit } from "../inventory/ItemRegistry";
import { compatible } from "../inventory/SlotInventory";
export interface Stack {
  id: number;
  count: number;
  durability?: number;
  enchantments?: Record<string, number>;
}
export interface Furnace {
  input: Stack | null;
  fuel: Stack | null;
  output: Stack | null;
  burn: number;
  burnMax: number;
  progress: number;
  xp: number;
}
export interface BlockEntitySave {
  chests: Record<string, (Stack | null)[]>;
  furnaces: Record<string, Furnace>;
  crops: Record<string, { age: number; stage: number }>;
}
export const smelting: Record<
  number,
  { output: number; count: number; xp: number }
> = {
  13: { output: 111, count: 1, xp: 2 },
  14: { output: 112, count: 1, xp: 3 },
  5: { output: 10, count: 1, xp: 1 },
  2: { output: 18, count: 1, xp: 1 },
  3: { output: 43, count: 1, xp: 1 },
  121: { output: 122, count: 1, xp: 1 },
  123: { output: 124, count: 1, xp: 1 },
  125: { output: 126, count: 1, xp: 1 },
};
const fuels: Record<number, number> = {
  110: 80,
  12: 80,
  7: 15,
  9: 15,
  27: 15,
  29: 15,
  31: 15,
  32: 15,
  103: 5,
  33: 15,
  35: 15,
  37: 15,
  68: 15,
  69: 15,
  70: 15,
};
export const isFuel = (id: number) => !!fuels[id];
export class BlockEntities {
  private cropClock = 0;
  data: BlockEntitySave = { chests: {}, furnaces: {}, crops: {} };
  restore(data?: BlockEntitySave) {
    this.data = data
      ? structuredClone(data)
      : { chests: {}, furnaces: {}, crops: {} };
  }
  chest(key: string) {
    return (this.data.chests[key] ??= Array(27).fill(null));
  }
  furnace(key: string) {
    return (this.data.furnaces[key] ??= {
      input: null,
      fuel: null,
      output: null,
      burn: 0,
      burnMax: 0,
      progress: 0,
      xp: 0,
    });
  }
  transferTo(
    s: Survival,
    slots: (Stack | null)[],
    index: number,
    id: number,
    count = 1,
  ) {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= slots.length ||
      !s.count(id) ||
      !Number.isSafeInteger(count) ||
      count <= 0
    )
      return false;
    const slot = slots[index];
    const model = s.getInventory(),
      source =
        model.state.slots[s.selectedSlot]?.id === id
          ? model.state.slots[s.selectedSlot]
          : model.state.slots.find((stack) => stack?.id === id),
      durability = source?.durability,
      enchantments = source?.enchantments;
    if (
      !source ||
      count > source.count ||
      (slot && !compatible(slot, source)) ||
      (slot?.count ?? 0) + count > stackLimit(id) ||
      !s.consume(id, count)
    )
      return false;
    slots[index] = {
      id,
      count: (slot?.count ?? 0) + count,
      durability,
      enchantments: enchantments ? { ...enchantments } : undefined,
    };
    if (!s.count(id)) {
      delete s.durability[id];
      delete s.enchantments[id];
    }
    return true;
  }
  transferFrom(s: Survival, slots: (Stack | null)[], index: number) {
    const slot = slots[index];
    if (!slot) return false;
    const left = s.addStack(slot);
    const taken = slot.count - left;
    if (!taken) return false;
    slots[index] = left ? { ...slot, count: left } : null;
    return true;
  }
  tick(
    dt: number,
    world: World,
    player: { x: number; z: number },
    distance = 48,
    randomTickSpeed = 3,
    centers?: { x: number; z: number }[],
  ) {
    const near = (x: number, z: number) =>
      (centers ?? [player]).some(
        (p) => Math.hypot(x - p.x, z - p.z) <= distance,
      );
    for (const [key, f] of Object.entries(this.data.furnaces)) {
      const [x, , z] = key.split(",").map(Number);
      if (!near(x, z)) continue;
      f.burn = Math.max(0, f.burn - dt);
      const recipe = f.input ? smelting[f.input.id] : undefined;
      const can =
        recipe &&
        (!f.output ||
          (f.output.id === recipe.output &&
            f.output.count + recipe.count <= 64));
      if (can && f.burn === 0 && f.fuel && fuels[f.fuel.id]) {
        f.burnMax = f.burn = fuels[f.fuel.id];
        if (--f.fuel.count === 0) f.fuel = null;
      }
      if (can && f.burn > 0) {
        f.progress += dt;
        if (f.progress >= 8) {
          f.progress -= 8;
          f.output = {
            id: recipe!.output,
            count: (f.output?.count ?? 0) + recipe!.count,
          };
          if (--f.input!.count === 0) f.input = null;
          f.xp += recipe!.xp;
        }
      } else if (!can) f.progress = 0;
    }
    this.cropClock += dt;
    if (this.cropClock < 1) return;
    const growthDt = this.cropClock;
    this.cropClock = 0;
    for (const [key, crop] of Object.entries(this.data.crops)) {
      const [x, y, z] = key.split(",").map(Number);
      if (!near(x, z)) continue;
      const id = world.get(x, y, z);
      if (![51, 52, 67].includes(id)) {
        delete this.data.crops[key];
        continue;
      }
      let wet = false;
      for (let dx = -4; dx <= 4 && !wet; dx++)
        for (let dz = -4; dz <= 4; dz++)
          if (world.get(x + dx, y - 1, z + dz) === 11) wet = true;
      crop.age += (growthDt * (wet ? 3 : 1) * randomTickSpeed) / 3;
      while (crop.age >= 40 && crop.stage < 2) {
        crop.age -= 40;
        crop.stage++;
        world.set(x, y, z, crop.stage === 2 ? 52 : 67);
      }
    }
  }
  break(key: string, drop: (id: number, n: number, meta?: Stack) => void) {
    for (const slot of this.data.chests[key] ?? [])
      if (slot) drop(slot.id, slot.count, slot);
    const f = this.data.furnaces[key];
    if (f)
      for (const slot of [f.input, f.fuel, f.output])
        if (slot) drop(slot.id, slot.count, slot);
    delete this.data.chests[key];
    delete this.data.furnaces[key];
    delete this.data.crops[key];
  }
  serialize() {
    return structuredClone(this.data);
  }
}
