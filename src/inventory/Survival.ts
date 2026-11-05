import { block } from "../blocks/BlockRegistry";
import { EventBus } from "../core/EventBus";
export type { GameMode } from "../player/GameModes";
import {
  SlotInventory,
  type InventoryState,
  type ItemStack,
} from "./SlotInventory";
export interface SurvivalSave {
  health: number;
  hunger: number;
  items: Record<number, number>;
  slotInventory?: InventoryState;
  saturation?: number;
  air?: number;
  xp?: number;
  equipment?: number;
  enchantments?: Record<number, Record<string, number>>;
}
export { tools, extras } from "./ItemRegistry";
import { tools, extras, foods, stackLimit, enchantments } from "./ItemRegistry";
export interface Recipe {
  name: string;
  input: Record<number, number>;
  output: [number, number];
  station?: number;
}
export const recipes: Recipe[] = [
  { name: "4 eikenplanken", input: { 7: 1 }, output: [9, 4] },
  { name: "4 stokken", input: { 9: 2 }, output: [103, 4] },
  { name: "Werkbank", input: { 9: 4 }, output: [19, 1] },
  { name: "Oven", input: { 4: 8 }, output: [20, 1], station: 19 },
  {
    name: "Houten pikhouweel",
    input: { 9: 3, 103: 2 },
    output: [100, 1],
    station: 19,
  },
  {
    name: "Stenen pikhouweel",
    input: { 4: 3, 103: 2 },
    output: [101, 1],
    station: 19,
  },
  {
    name: "Houten bijl",
    input: { 9: 3, 103: 2 },
    output: [102, 1],
    station: 19,
  },
  {
    name: "Houten schep",
    input: { 9: 1, 103: 2 },
    output: [104, 1],
    station: 19,
  },
  {
    name: "Glas smelten",
    input: { 5: 1, 12: 1 },
    output: [10, 1],
    station: 20,
  },
  {
    name: "Baksteen bakken",
    input: { 2: 4, 12: 1 },
    output: [18, 4],
    station: 20,
  },
];
export class Survival {
  readonly inventoryEvents = new EventBus<{
    type: "inventory";
    changes: Record<number, number>;
  }>();
  slotInventory?: InventoryState;
  private inventoryModel = new SlotInventory();
  private inventorySnapshot?: InventoryState;
  private inventorySignature = "";
  selectedSlot = 0;
  private metadataSignature = "";
  getInventory() {
    if (this.slotInventory && this.slotInventory !== this.inventorySnapshot) {
      this.inventoryModel.restore(this.slotInventory);
      this.metadataSignature = JSON.stringify([
        this.durability,
        this.enchantments,
      ]);
      this.commitInventory();
    } else if (JSON.stringify(this.items) !== this.inventorySignature) {
      this.inventoryModel.migrate(
        this.items,
        this.durability,
        this.enchantments,
      );
      this.commitInventory();
    }
    const metadata = JSON.stringify([this.durability, this.enchantments]);
    if (metadata !== this.metadataSignature) {
      for (const [key, value] of Object.entries(this.durability)) {
        const stack =
          this.inventoryModel.state.slots[this.selectedSlot]?.id === Number(key)
            ? this.inventoryModel.state.slots[this.selectedSlot]
            : this.inventoryModel.state.slots.find(
                (s) => s?.id === Number(key),
              );
        if (stack) stack.durability = value;
      }
      for (const [key, value] of Object.entries(this.enchantments)) {
        const stack =
          this.inventoryModel.state.slots[this.selectedSlot]?.id === Number(key)
            ? this.inventoryModel.state.slots[this.selectedSlot]
            : this.inventoryModel.state.slots.find(
                (s) => s?.id === Number(key),
              );
        if (stack) stack.enchantments = structuredClone(value);
      }
      this.metadataSignature = metadata;
      this.commitInventory();
    }
    return this.inventoryModel;
  }
  commitInventory() {
    this.items = this.inventoryModel.totals();
    this.slotInventory = this.inventoryModel.snapshot();
    this.inventorySnapshot = this.slotInventory;
    this.inventorySignature = JSON.stringify(this.items);
    const durability: Record<number, number> = {},
      enchantments: Record<number, Record<string, number>> = {};
    for (const stack of [
      ...this.inventoryModel.state.slots,
      this.inventoryModel.state.slots[this.selectedSlot],
    ])
      if (stack) {
        if (stack.durability !== undefined)
          durability[stack.id] = stack.durability;
        if (stack.enchantments)
          enchantments[stack.id] = { ...stack.enchantments };
      }
    this.durability = durability;
    this.enchantments = enchantments;
    this.metadataSignature = JSON.stringify([durability, enchantments]);
  }
  hotbarItems() {
    return this.getInventory()
      .state.slots.slice(0, 9)
      .map((s) => s?.id ?? 0);
  }
  clearInventory() {
    this.inventoryModel.state = {
      slots: Array(36).fill(null),
      cursor: null,
      craft: Array(9).fill(null),
      revision: this.inventoryModel.state.revision + 1,
    };
    this.commitInventory();
  }
  initializeHotbar(preferred: number[], creative = false) {
    const model = this.getInventory();
    if (creative && Object.keys(this.items).length === 0) {
      for (let i = 0; i < 9; i++)
        if (preferred[i])
          model.state.slots[i] = {
            id: preferred[i],
            count: stackLimit(preferred[i]),
          };
    } else {
      for (let i = 0; i < 9; i++) {
        const id = preferred[i];
        if (!id || model.state.slots[i]?.id === id) continue;
        const from = model.state.slots.findIndex(
          (s, j) => j >= i && s?.id === id,
        );
        if (from >= 0)
          [model.state.slots[i], model.state.slots[from]] = [
            model.state.slots[from],
            model.state.slots[i],
          ];
      }
    }
    this.commitInventory();
  }
  addStack(stack: ItemStack) {
    const model = this.getInventory(),
      left = model.add(stack);
    this.commitInventory();
    return left;
  }
  takeStacks(id: number, count: number) {
    const model = this.getInventory(),
      stacks = model.take(id, count, this.selectedSlot);
    if (stacks) this.commitInventory();
    return stacks;
  }
  allStacks() {
    const state = this.getInventory().state;
    return [...state.slots, state.cursor, ...state.craft]
      .filter((s): s is ItemStack => !!s)
      .map((s) => structuredClone(s));
  }
  transact(required: Record<number, number>, output: [number, number]) {
    const model = this.getInventory(),
      before = model.snapshot();
    for (const [id, n] of Object.entries(required))
      if (!model.take(Number(id), n)) {
        model.restore(before);
        return false;
      }
    if (model.add({ id: output[0], count: output[1] }) > 0) {
      model.restore(before);
      return false;
    }
    this.commitInventory();
    this.inventoryEvents.emit({ type: "inventory", changes: {} });
    return true;
  }
  health = 20;
  hunger = 20;
  items: Record<number, number> = {};
  durability: Record<number, number> = {};
  private fallStart: number | null = null;
  private clock = 0;
  private hungerClock = 0;
  saturation = 5;
  air = 10;
  xp = 0;
  equipment = 0;
  invulnerable = 0;
  hurt = 0;
  burning = 0;
  enchantments: Record<number, Record<string, number>> = {};
  private airDamage = 0;
  difficulty: "peaceful" | "easy" | "normal" | "hard" = "normal";
  naturalRegeneration = true;
  resetFall() {
    this.fallStart = null;
  }
  damage(amount: number, source = "enemy") {
    if (this.health <= 0 || this.invulnerable > 0 || amount <= 0) return false;
    const protection = this.enchantments[this.equipment]?.protection ?? 0;
    this.health = Math.max(
      0,
      this.health -
        Math.max(
          0.5,
          amount *
            (1 -
              Math.min(0.8, protection * 0.12 + (this.equipment ? 0.18 : 0))),
        ),
    );
    this.invulnerable = 0.6;
    this.hurt = 0.4;
    return true;
  }
  exhaust(amount: number) {
    this.hungerClock += Math.max(0, amount);
  }
  addXP(amount: number) {
    this.xp += Math.max(0, Math.floor(amount));
  }
  get level() {
    return Math.floor(Math.sqrt(this.xp / 7));
  }
  get levelProgress() {
    const level = this.level;
    return (
      (this.xp - level * level * 7) /
      ((level + 1) * (level + 1) * 7 - level * level * 7)
    );
  }
  constructor(saved?: SurvivalSave, durability?: Record<number, number>) {
    if (saved) {
      this.saturation = saved.saturation ?? 5;
      this.air = saved.air ?? 10;
      this.xp = saved.xp ?? 0;
      this.equipment = saved.equipment ?? 0;
      this.enchantments = saved.enchantments ?? {};
      this.health = Math.max(0, Math.min(20, saved.health));
      this.hunger = Math.max(0, Math.min(20, saved.hunger));
      for (const [id, n] of Object.entries(saved.items))
        if (Number.isInteger(n) && n > 0) this.items[Number(id)] = n;
    }
    this.durability = { ...durability };
    this.slotInventory = saved?.slotInventory;
    this.getInventory();
  }
  count(id: number) {
    this.getInventory();
    return this.items[id] ?? 0;
  }
  add(id: number, count = 1) {
    if (
      !Number.isSafeInteger(count) ||
      count <= 0 ||
      id <= 0 ||
      (!extras[id] && block(id).id === 0)
    )
      return Math.max(0, count);
    const left = this.addStack({ id, count });
    if (left < count)
      this.inventoryEvents.emit({
        type: "inventory",
        changes: { [id]: count - left },
      });
    return left;
  }
  consume(id: number, count = 1) {
    const taken = this.takeStacks(id, count);
    if (!taken) return false;
    if (id === this.equipment && !this.count(id)) this.equipment = 0;
    this.inventoryEvents.emit({ type: "inventory", changes: { [id]: -count } });
    return true;
  }
  canCraft(recipe: Recipe, near: (id: number) => boolean) {
    return (
      (!recipe.station || near(recipe.station)) &&
      Object.entries(recipe.input).every(
        ([id, n]) => this.count(Number(id)) >= n,
      )
    );
  }
  craft(recipe: Recipe, near: (id: number) => boolean) {
    if (!this.canCraft(recipe, near)) return false;
    return this.transact(recipe.input, recipe.output);
  }
  private toolStack(id: number) {
    const slots = this.getInventory().state.slots;
    return slots[this.selectedSlot]?.id === id
      ? slots[this.selectedSlot]
      : slots.find((s) => s?.id === id);
  }
  miningTime(id: number, toolId: number) {
    const kind = block(id).tool;
    return (
      block(id).miningTime /
      (tools[toolId]?.kind === kind && this.count(toolId) > 0
        ? tools[toolId].speed +
          (this.toolStack(toolId)?.enchantments?.efficiency ?? 0) ** 2
        : 1)
    );
  }
  useTool(id: number) {
    const tool = tools[id];
    if (!tool || !this.count(id)) return;
    const model = this.getInventory(),
      stack =
        model.state.slots[this.selectedSlot]?.id === id
          ? model.state.slots[this.selectedSlot]
          : model.state.slots.find((s) => s?.id === id);
    if (!stack) return;
    const enchant = stack.enchantments;
    if (Math.random() > 1 / (1 + (enchant?.unbreaking ?? 0))) return;
    const remaining = (stack.durability ?? tool.durability) - 1;
    if (remaining <= 0) {
      const index = model.state.slots.indexOf(stack);
      model.state.slots[index] = null;
      delete this.durability[id];
    } else {
      stack.durability = remaining;
      this.durability[id] = remaining;
    }
    this.commitInventory();
  }
  dropFor(id: number, toolId: number) {
    if (id === 3)
      return tools[toolId]?.kind === "pick" && this.count(toolId) > 0 ? 4 : 0;
    if ([12, 13, 14, 15].includes(id))
      return this.count(toolId) > 0 &&
        tools[toolId]?.kind === "pick" &&
        tools[toolId].tier >=
          ({ 12: 1, 13: 2, 14: 3, 15: 3 } as Record<number, number>)[id]
        ? (({ 12: 110, 15: 113 } as Record<number, number>)[id] ?? id)
        : 0;
    if (id === 24)
      return tools[toolId]?.tier >= 4 && this.count(toolId) > 0 ? 24 : 0;
    return id === 1
      ? 2
      : id === 22
        ? 117
        : id === 59
          ? 58
          : id === 61
            ? 58
            : id === 47
              ? 46
              : id === 60
                ? 58
                : id === 52
                  ? 118
                  : id === 51 || id === 67
                    ? 117
                    : id;
  }
  attackDamage(id: number, critical = false) {
    return (
      ((this.count(id) > 0 ? tools[id]?.damage : 0) ?? 1) *
        (critical ? 1.5 : 1) +
      (this.toolStack(id)?.enchantments?.sharpness ?? 0) * 1.25
    );
  }
  enchant(id: number, key: keyof typeof enchantments) {
    const def = enchantments[key],
      current = this.toolStack(id)?.enchantments?.[key] ?? 0;
    if (
      !this.count(id) ||
      this.level < def.cost ||
      current >= def.max ||
      (key === "protection" && id !== 131) ||
      (key !== "protection" && !tools[id])
    )
      return false;
    this.xp = 7 * (this.level - def.cost) ** 2;
    this.enchantments[id] = {
      ...this.toolStack(id)?.enchantments,
      [key]: current + 1,
    };
    const stack = this.toolStack(id);
    if (stack) {
      stack.enchantments = { ...stack.enchantments, [key]: current + 1 };
      this.commitInventory();
    }
    return true;
  }
  eat(id = 105) {
    const food = foods[id];
    if (!food || this.hunger >= 20 || !this.consume(id)) return false;
    this.hunger = Math.min(20, this.hunger + food.hunger);
    this.saturation = Math.min(this.hunger, this.saturation + food.saturation);
    return true;
  }
  tick(
    dt: number,
    y: number,
    grounded: boolean,
    water: boolean,
    moving: boolean,
    sprinting: boolean,
    environment: { submerged?: boolean; lava?: boolean; fire?: boolean } = {},
  ) {
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.hurt = Math.max(0, this.hurt - dt);
    this.air = environment.submerged
      ? Math.max(0, this.air - dt)
      : Math.min(10, this.air + dt * 3);
    this.airDamage += dt;
    if (this.airDamage >= 1) {
      this.airDamage = 0;
      if (this.air === 0) this.damage(2, "drowning");
      if (environment.lava) this.damage(4, "lava");
      else if (environment.fire || this.burning > 0) this.damage(1, "fire");
    }
    if (environment.lava || environment.fire) this.burning = 5;
    this.burning = Math.max(0, this.burning - dt);
    if (water) this.burning = 0;
    if (!grounded && !water) {
      if (this.fallStart === null) this.fallStart = y;
      this.fallStart = Math.max(this.fallStart, y);
    } else {
      if (this.fallStart !== null && !water)
        this.damage(Math.max(0, Math.floor(this.fallStart - y - 3)), "fall");
      this.fallStart = null;
    }
    this.hungerClock += dt * (moving ? (sprinting ? 2 : 1) : 0.15);
    if (this.hungerClock > 20) {
      this.hungerClock = 0;
      if (this.saturation > 0)
        this.saturation = Math.max(0, this.saturation - 1);
      else this.hunger = Math.max(0, this.hunger - 1);
    }
    this.clock += dt;
    if (this.clock > 4) {
      this.clock = 0;
      if (this.hunger === 0) {
        const floor =
          this.difficulty === "peaceful"
            ? 20
            : this.difficulty === "easy"
              ? 10
              : this.difficulty === "normal"
                ? 1
                : 0;
        if (this.health > floor) this.damage(1, "starvation");
      } else if (
        this.naturalRegeneration &&
        this.hunger >= 16 &&
        this.health < 20
      ) {
        this.health = Math.min(20, this.health + 1);
        if (this.saturation > 0)
          this.saturation = Math.max(0, this.saturation - 0.5);
        else this.hunger = Math.max(0, this.hunger - 0.5);
      }
    }
  }
  serialize(): SurvivalSave {
    this.getInventory();
    return {
      slotInventory: this.inventoryModel.snapshot(),
      health: this.health,
      hunger: this.hunger,
      items: { ...this.items },
      saturation: this.saturation,
      air: this.air,
      xp: this.xp,
      equipment: this.equipment,
      enchantments: structuredClone(this.enchantments),
    };
  }
}
