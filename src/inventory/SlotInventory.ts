import { block } from "../blocks/BlockRegistry";
import { extras, stackLimit } from "./ItemRegistry";
export interface ItemStack {
  id: number;
  count: number;
  durability?: number;
  enchantments?: Record<string, number>;
}
export interface InventoryState {
  slots: (ItemStack | null)[];
  cursor: ItemStack | null;
  craft: (ItemStack | null)[];
  revision: number;
}
export const validItem = (id: number) =>
  Number.isInteger(id) && id > 0 && !!(extras[id] || block(id).id);
export const cloneStack = (stack: ItemStack | null): ItemStack | null =>
  stack ? structuredClone(stack) : null;
export function compatible(a: ItemStack, b: ItemStack) {
  return (
    a.id === b.id &&
    a.durability === b.durability &&
    JSON.stringify(a.enchantments ?? {}) ===
      JSON.stringify(b.enchantments ?? {})
  );
}
export class SlotInventory {
  state: InventoryState = {
    slots: Array(36).fill(null),
    cursor: null,
    craft: Array(9).fill(null),
    revision: 0,
  };
  restore(saved: InventoryState) {
    const sanitize = (s: ItemStack | null) =>
      s && validItem(s.id) && Number.isSafeInteger(s.count) && s.count > 0
        ? { ...structuredClone(s), count: Math.min(stackLimit(s.id), s.count) }
        : null;
    this.state = {
      slots: Array.from({ length: 36 }, (_, i) =>
        sanitize(saved.slots?.[i] ?? null),
      ),
      cursor: sanitize(saved.cursor),
      craft: Array.from({ length: 9 }, (_, i) =>
        sanitize(saved.craft?.[i] ?? null),
      ),
      revision: Number.isSafeInteger(saved.revision) ? saved.revision : 0,
    };
  }
  snapshot() {
    return structuredClone(this.state);
  }
  totals(includeEscrow = false) {
    const result: Record<number, number> = {};
    for (const stack of [
      ...this.state.slots,
      ...(includeEscrow ? [this.state.cursor, ...this.state.craft] : []),
    ])
      if (stack) result[stack.id] = (result[stack.id] ?? 0) + stack.count;
    return result;
  }
  add(
    stack: ItemStack,
    indices: number[] = Array.from({ length: 36 }, (_, i) => i),
  ) {
    if (
      !validItem(stack.id) ||
      !Number.isSafeInteger(stack.count) ||
      stack.count <= 0
    )
      return stack.count;
    let left = stack.count;
    for (const index of indices) {
      const existing = this.state.slots[index];
      if (existing && compatible(existing, stack)) {
        const n = Math.min(left, stackLimit(stack.id) - existing.count);
        existing.count += n;
        left -= n;
      }
    }
    for (const index of indices) {
      if (!left) break;
      if (!this.state.slots[index]) {
        const n = Math.min(left, stackLimit(stack.id));
        this.state.slots[index] = { ...structuredClone(stack), count: n };
        left -= n;
      }
    }
    return left;
  }
  take(id: number, count: number, preferred = -1): ItemStack[] | undefined {
    if (
      !Number.isSafeInteger(count) ||
      count <= 0 ||
      this.state.slots.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0) <
        count
    )
      return;
    const taken: ItemStack[] = [];
    const indices = [
      ...(preferred >= 0 ? [preferred] : []),
      ...Array.from({ length: 36 }, (_, i) => i).filter((i) => i !== preferred),
    ];
    for (const index of indices) {
      const s = this.state.slots[index];
      if (!s || s.id !== id) continue;
      const n = Math.min(count, s.count);
      taken.push({ ...structuredClone(s), count: n });
      s.count -= n;
      count -= n;
      if (!s.count) this.state.slots[index] = null;
      if (!count) break;
    }
    return taken;
  }
  migrate(
    items: Record<number, number>,
    durability: Record<number, number> = {},
    enchantments: Record<number, Record<string, number>> = {},
  ) {
    this.state = {
      slots: Array(36).fill(null),
      cursor: null,
      craft: Array(9).fill(null),
      revision: this.state.revision + 1,
    };
    for (const [key, n] of Object.entries(items)) {
      const id = Number(key);
      if (validItem(id) && Number.isSafeInteger(n) && n > 0)
        this.add({
          id,
          count: n,
          durability: durability[id],
          enchantments: enchantments[id],
        });
    }
  }
}
