import type { Survival } from "./Survival";
import { smelting, isFuel, type BlockEntities } from "../world/BlockEntities";
import type { InventoryContext as Context } from "./InventoryTransactions";
import type { ItemStack } from "./SlotInventory";
export function inventoryContext(
  s: Survival,
  creative: boolean,
  station: { kind: "table" | "chest" | "furnace"; key: string } | null,
  entities: BlockEntities,
  drop: (stack: ItemStack) => void,
): Context {
  const f = station?.kind === "furnace" ? entities.furnace(station.key) : null;
  return {
    creative,
    size: station?.kind === "table" ? 3 : 2,
    container: f
      ? [f.input, f.fuel, f.output]
      : station?.kind === "chest"
        ? entities.chest(station.key)
        : undefined,
    canInsert: (index, stack) =>
      !f ||
      (index === 0 ? !!smelting[stack.id] : index === 1 && isFuel(stack.id)),
    onOutput: () => {},
    drop,
  };
}
