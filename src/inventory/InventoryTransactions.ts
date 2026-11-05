import {
  compatible,
  cloneStack,
  validItem,
  type ItemStack,
} from "./SlotInventory";
import { stackLimit } from "./ItemRegistry";
import { matchRecipe, gridRecipes } from "./RecipeRegistry";
import type { Survival } from "./Survival";
export type SlotArea = "inventory" | "craft" | "container" | "output";
export type InventoryAction =
  | {
      kind: "distribute";
      slots: { area: SlotArea; index: number }[];
      button: 0 | 2;
    }
  | {
      kind: "click";
      area: SlotArea;
      index: number;
      button: 0 | 2;
      shift: boolean;
    }
  | {
      kind: "move";
      from: SlotArea;
      index: number;
      to: SlotArea;
      target: number;
    }
  | { kind: "hotbar"; area: SlotArea; index: number; hotbar: number }
  | { kind: "creative"; item: number; button: 0 | 2; shift: boolean }
  | { kind: "recipe"; recipe: string }
  | { kind: "close" };
export interface InventoryContext {
  creative: boolean;
  size: 2 | 3;
  container?: (ItemStack | null)[];
  canInsert?: (index: number, stack: ItemStack) => boolean;
  onOutput?: (index: number) => void;
  drop?: (stack: ItemStack) => void;
}
/** Shared atomic slot operations. The LAN server supplies the context and never accepts client stacks. */
export function inventoryAction(
  s: Survival,
  action: InventoryAction,
  c: InventoryContext,
) {
  const outputs = new Set<number>(),
    dropped: ItemStack[] = [];
  const model = s.getInventory(),
    before = model.snapshot(),
    containerBefore = c.container ? structuredClone(c.container) : undefined;
  const slots = (area: SlotArea) =>
    area === "inventory"
      ? model.state.slots
      : area === "craft"
        ? model.state.craft
        : area === "container" && c.container
          ? c.container
          : undefined;
  const allowed = (area: SlotArea, index: number, stack: ItemStack) =>
    area !== "container" || !c.canInsert || c.canInsert(index, stack);
  const check = (area: SlotArea, index: number) => {
    const array = slots(area);
    if (
      !array ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= (area === "craft" ? c.size * c.size : array.length)
    )
      throw Error("Ongeldig inventoryvak.");
    return array;
  };
  const craft = (shift: boolean) => {
    let done = 0;
    for (let i = 0; i < (shift ? 64 : 1); i++) {
      const ids = model.state.craft
          .slice(0, c.size * c.size)
          .map((s) => s?.id ?? 0),
        recipe = matchRecipe(ids, c.size);
      if (!recipe) break;
      const out: ItemStack = { id: recipe.output[0], count: recipe.output[1] };
      const candidate = model.snapshot();
      if (shift) {
        if (model.add(out) > 0) {
          model.restore(candidate);
          break;
        }
      } else {
        const cursor = model.state.cursor;
        if (
          cursor &&
          (!compatible(cursor, out) ||
            cursor.count + out.count > stackLimit(out.id))
        )
          break;
        model.state.cursor = cursor
          ? { ...cursor, count: cursor.count + out.count }
          : out;
      }
      for (let j = 0; j < ids.length; j++)
        if (ids[j]) {
          const stack = model.state.craft[j]!;
          if (--stack.count === 0) model.state.craft[j] = null;
        }
      done++;
    }
    return done > 0;
  };
  const click = (
    area: SlotArea,
    index: number,
    button: 0 | 2,
    shift: boolean,
  ) => {
    if (area === "output") {
      if (index !== 0 || !craft(shift))
        throw Error("Geen passend recept, ingrediënten of ruimte.");
      return;
    }
    const array = check(area, index),
      stack = array[index];
    if (shift) {
      if (!stack) return;
      let left = stack.count;
      if (area === "container" || area === "craft") left = model.add(stack);
      else if (c.container) {
        for (let j = 0; j < c.container.length; j++) {
          if (!allowed("container", j, stack)) continue;
          const target = c.container[j];
          if (target && compatible(target, stack)) {
            const n = Math.min(left, stackLimit(stack.id) - target.count);
            target.count += n;
            left -= n;
          }
        }
        for (let j = 0; j < c.container.length && left; j++)
          if (!c.container[j] && allowed("container", j, stack)) {
            const n = Math.min(left, stackLimit(stack.id));
            c.container[j] = { ...structuredClone(stack), count: n };
            left -= n;
          }
      } else
        left = model.add(
          stack,
          Array.from(
            { length: index < 9 ? 27 : 9 },
            (_, i) => i + (index < 9 ? 9 : 0),
          ),
        );
      array[index] = left ? { ...stack, count: left } : null;
      if (area === "container" && left < stack.count) outputs.add(index);
      return;
    }
    const cursor = model.state.cursor;
    if (!cursor) {
      if (!stack) return;
      const n = button === 2 ? Math.ceil(stack.count / 2) : stack.count;
      model.state.cursor = { ...structuredClone(stack), count: n };
      array[index] =
        stack.count === n ? null : { ...stack, count: stack.count - n };
      if (area === "container") outputs.add(index);
      return;
    }
    if (!allowed(area, index, cursor))
      throw Error("Dit item mag niet in dit vak.");
    if (!stack || compatible(stack, cursor)) {
      const n = Math.min(
        cursor.count,
        button === 2 ? 1 : cursor.count,
        stackLimit(cursor.id) - (stack?.count ?? 0),
      );
      if (n) {
        array[index] = {
          ...structuredClone(cursor),
          count: (stack?.count ?? 0) + n,
        };
        cursor.count -= n;
        if (!cursor.count) model.state.cursor = null;
      }
    } else if (button === 0) {
      array[index] = cloneStack(cursor);
      model.state.cursor = cloneStack(stack);
      if (area === "container") outputs.add(index);
    }
  };
  try {
    if (action.kind === "click")
      click(action.area, action.index, action.button, action.shift);
    else if (action.kind === "distribute") {
      if (
        !Array.isArray(action.slots) ||
        action.slots.length > 72 ||
        ![0, 2].includes(action.button)
      )
        throw Error("Ongeldige sleepactie.");
      const cursor = model.state.cursor;
      if (!cursor) throw Error("Pak eerst een stack op.");
      const seen = new Set<string>(),
        destinations: { array: (ItemStack | null)[]; index: number }[] = [];
      for (const slot of action.slots) {
        const array = check(slot.area, slot.index),
          key = slot.area + ":" + slot.index,
          existing = array[slot.index];
        if (seen.has(key)) continue;
        seen.add(key);
        if (
          allowed(slot.area, slot.index, cursor) &&
          (!existing || compatible(existing, cursor)) &&
          (existing?.count ?? 0) < stackLimit(cursor.id)
        )
          destinations.push({ array, index: slot.index });
      }
      const amount =
        action.button === 2
          ? 1
          : Math.floor(cursor.count / Math.max(1, destinations.length));
      for (const { array, index } of destinations) {
        const existing = array[index],
          n = Math.min(
            amount,
            cursor.count,
            stackLimit(cursor.id) - (existing?.count ?? 0),
          );
        if (n) {
          array[index] = {
            ...structuredClone(cursor),
            count: (existing?.count ?? 0) + n,
          };
          cursor.count -= n;
        }
      }
      if (!cursor.count) model.state.cursor = null;
    } else if (action.kind === "move") {
      if (model.state.cursor)
        throw Error("Leg eerst het item aan je cursor neer.");
      click(action.from, action.index, 0, false);
      click(action.to, action.target, 0, false);
      if (model.state.cursor) click(action.from, action.index, 0, false);
    } else if (action.kind === "hotbar") {
      if (
        !Number.isInteger(action.hotbar) ||
        action.hotbar < 0 ||
        action.hotbar > 8 ||
        action.area === "output"
      )
        throw Error("Ongeldig hotbarslot.");
      const array = check(action.area, action.index),
        a = array[action.index],
        b = model.state.slots[action.hotbar];
      if (b && !allowed(action.area, action.index, b))
        throw Error("Dit item mag niet in dit vak.");
      array[action.index] = cloneStack(b);
      model.state.slots[action.hotbar] = cloneStack(a);
      if (action.area === "container" && a) outputs.add(action.index);
    } else if (action.kind === "creative") {
      if (!c.creative || !validItem(action.item))
        throw Error("Creative itemkiezer is niet beschikbaar.");
      const stack = {
        id: action.item,
        count: action.button === 2 ? 1 : stackLimit(action.item),
      };
      if (action.shift) model.add(stack);
      else model.state.cursor = stack;
    } else if (action.kind === "recipe") {
      const recipe = gridRecipes.find((r) => r.id === action.recipe);
      if (!recipe) throw Error("Onbekend recept.");
      const pattern = recipe.pattern
        ? recipe.pattern.flatMap((row, y) =>
            row.map((id, x) => ({ id, index: y * c.size + x })),
          )
        : recipe.shapeless!.map((id, index) => ({ id, index }));
      if (
        recipe.pattern &&
        (recipe.pattern.length > c.size || recipe.pattern[0].length > c.size)
      )
        throw Error("Dit recept vereist een werkbank.");
      for (const stack of model.state.craft)
        if (stack && model.add(stack))
          throw Error("Maak eerst ruimte voor de crafting-ingrediënten.");
      model.state.craft.fill(null);
      for (const { id, index } of pattern)
        if (id) {
          const taken = model.take(id, 1);
          if (!taken) throw Error("Te weinig ingrediënten.");
          model.state.craft[index] = taken[0];
        }
    } else if (action.kind === "close") {
      for (let i = 0; i < model.state.craft.length; i++) {
        const stack = model.state.craft[i];
        if (stack) {
          const left = model.add(stack);
          if (left && !c.drop)
            throw Error("Geen ruimte om crafting-items terug te leggen.");
          if (left) dropped.push({ ...stack, count: left });
          model.state.craft[i] = null;
        }
      }
      const cursor = model.state.cursor;
      if (cursor) {
        const left = model.add(cursor);
        if (left && !c.drop)
          throw Error("Geen ruimte om cursoritem terug te leggen.");
        if (left) dropped.push({ ...cursor, count: left });
        model.state.cursor = null;
      }
    }
    model.state.revision++;
    s.commitInventory();
    for (const index of outputs) c.onOutput?.(index);
    for (const stack of dropped) c.drop?.(stack);
    return true;
  } catch (error) {
    model.restore(before);
    s.commitInventory();
    if (c.container && containerBefore)
      c.container.splice(0, c.container.length, ...containerBefore);
    throw error;
  }
}
