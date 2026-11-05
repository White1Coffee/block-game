import { stackLimit } from "./ItemRegistry";
export const INVENTORY_SLOTS = 36;
export interface InventoryStack {
  id: number;
  count: number;
}
export function usedSlots(items: Record<number, number>) {
  return Object.entries(items).reduce(
    (sum, [id, n]) => sum + Math.ceil(Math.max(0, n) / stackLimit(Number(id))),
    0,
  );
}
export function capacityFor(items: Record<number, number>, id: number) {
  const limit = stackLimit(id),
    count = items[id] ?? 0,
    partial = count % limit;
  return (
    Math.max(0, INVENTORY_SLOTS - usedSlots(items)) * limit +
    (partial ? limit - partial : 0)
  );
}
export function inventoryStacks(
  items: Record<number, number>,
): InventoryStack[] {
  const result: InventoryStack[] = [];
  for (const [key, count] of Object.entries(items)) {
    const id = Number(key),
      limit = stackLimit(id);
    for (let left = count; left > 0 && result.length < 256; left -= limit)
      result.push({ id, count: Math.min(left, limit) });
  }
  return result;
}
