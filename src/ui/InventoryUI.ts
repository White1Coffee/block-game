import type { Survival } from "../inventory/Survival";
import type {
  InventoryAction,
  SlotArea,
} from "../inventory/InventoryTransactions";
import type { ItemStack } from "../inventory/SlotInventory";
import { itemCatalog } from "../inventory/InventoryCatalog";
import { gridRecipes, matchRecipe } from "../inventory/RecipeRegistry";
import { tools } from "../inventory/ItemRegistry";
export interface InventoryUIOptions {
  creative: boolean;
  size: 2 | 3;
  icons: string[];
  name: (id: number) => string;
  container?: () => {
    slots: (ItemStack | null)[];
    kind: "chest" | "furnace";
    progress?: number;
    burn?: number;
  };
  send: (action: InventoryAction) => void;
  close: () => void;
}
export function inventoryUI(
  host: HTMLElement,
  s: Survival,
  o: InventoryUIOptions,
) {
  host.innerHTML = `<section class="card inventory-card"><div class="eyebrow">${o.creative ? "CREATIVE" : "SURVIVAL"} INVENTORY</div><h1>Jouw uitrusting</h1><p class="inventory-help">Klik: oppakken / neerleggen · Rechtsklik: halve stack / één item · Shift-klik: snel verplaatsen · 1–9 boven een vak: wisselen met hotbar</p><div id="inventory-station"></div><div id="inventory-crafting"></div>${o.creative ? '<details class="creative-picker" open><summary>Creative items</summary><input id="item-search" placeholder="Zoek blokken of items" aria-label="Zoek items"><p>Kies een item en klik daarna zelf op het gewenste vak. Rechtsklik kiest één item.</p><div id="creative-items" class="block-grid"></div></details>' : ""}<h2>Rugzak</h2><div class="inventory-slots" id="backpack-slots"></div><h2>Hotbar</h2><div class="inventory-slots hotbar-inventory" id="inventory-hotbar"></div><div id="inventory-message" role="status"></div><details class="recipe-book"><summary>Receptenboek</summary><div class="recipes">${gridRecipes
    .filter(
      (r) =>
        !r.pattern ||
        (r.pattern.length <= o.size && r.pattern[0].length <= o.size),
    )
    .map(
      (r) =>
        `<button data-book="${r.id}">${o.name(r.output[0])} ×${r.output[1]}</button>`,
    )
    .join(
      "",
    )}</div></details><button id="back" class="subtle">Terug naar de wereld <kbd>E</kbd></button></section>`;
  const cursor = document.createElement("div");
  cursor.className = "inventory-cursor";
  cursor.hidden = true;
  document.body.append(cursor);
  let hovered: { area: SlotArea; index: number } | undefined,
    signature = "";
  type Slot = { area: SlotArea; index: number };
  let gesture:
    | {
        source: Slot;
        button: 0 | 2;
        shift: boolean;
        cursor: boolean;
        x: number;
        y: number;
        moved: boolean;
        targets: Slot[];
      }
    | undefined;
  let rightArmed = false;
  host.onpointerdown = (e) => {
    rightArmed = e.button === 2;
  };
  const img = (stack: ItemStack | null) =>
    stack
      ? `<img src="${o.icons[stack.id]}" alt="${o.name(stack.id)}"><small>${stack.count > 1 ? stack.count : ""}</small>${tools[stack.id] && stack.durability !== undefined ? `<progress max="${tools[stack.id].durability}" value="${stack.durability}"></progress>` : ""}`
      : "";
  const cell = (area: SlotArea, index: number, stack: ItemStack | null) =>
    `<button class="inventory-slot" data-area="${area}" data-index="${index}" data-item="${stack?.id ?? 0}" ${area === "craft" ? `data-craft-slot="${index}"` : area === "container" ? `data-container="${index}"` : area === "output" ? 'id="craft-output"' : ""} draggable="false" title="${stack ? o.name(stack.id) + (stack.durability !== undefined ? " · durability " + stack.durability : "") : "Leeg vak"}" aria-label="${stack ? o.name(stack.id) : "Leeg vak"} · ${area} ${index + 1}">${img(stack)}${area === "inventory" && index < 9 ? `<span class="slot-number">${index + 1}</span>` : ""}</button>`;
  const act = (action: InventoryAction) => {
    try {
      o.send(action);
    } catch (e) {
      host.querySelector("#inventory-message")!.textContent =
        e instanceof Error ? e.message : "Inventoryactie mislukt.";
    }
    refresh();
  };
  const bind = (parent: Element) =>
    parent.querySelectorAll<HTMLButtonElement>("[data-area]").forEach((b) => {
      const area = b.dataset.area as SlotArea,
        index = Number(b.dataset.index);
      b.onmouseenter = () => (hovered = { area, index });
      b.onmouseleave = () => {
        hovered = undefined;
      };
      b.onpointerdown = (e) => {
        if (e.button !== 0 && e.button !== 2) return;
        e.preventDefault();
        b.focus({ preventScroll: true });
        gesture = {
          source: { area, index },
          button: e.button,
          shift: e.shiftKey,
          cursor: !!s.getInventory().state.cursor,
          x: e.clientX,
          y: e.clientY,
          moved: false,
          targets: area === "output" ? [] : [{ area, index }],
        };
      };
      b.onclick = (e) => {
        e.preventDefault();
        if (e.detail === 0)
          act({ kind: "click", area, index, button: 0, shift: e.shiftKey });
      };
      b.oncontextmenu = (e) => {
        e.preventDefault();
        rightArmed = false;
      };
    });
  const refresh = () => {
    if (gesture) return;
    const state = s.getInventory().state,
      container = o.container?.(),
      next = JSON.stringify([state, container?.slots, container?.kind]);
    const progress = host.querySelector("[data-furnace-progress]");
    if (progress && container)
      progress.textContent = `Smelten ${Math.floor(((container.progress ?? 0) / 8) * 100)}% · Brandstof ${Math.ceil(container.burn ?? 0)}s`;
    if (next === signature) return;
    signature = next;
    host.querySelector("#backpack-slots")!.innerHTML = state.slots
      .slice(9)
      .map((stack, i) => cell("inventory", i + 9, stack))
      .join("");
    host.querySelector("#inventory-hotbar")!.innerHTML = state.slots
      .slice(0, 9)
      .map((stack, i) => cell("inventory", i, stack))
      .join("");
    const ids = state.craft.slice(0, o.size * o.size).map((s) => s?.id ?? 0),
      recipe = matchRecipe(ids, o.size);
    host.querySelector("#inventory-crafting")!.innerHTML = container
      ? ""
      : `<h2>${o.size}×${o.size} Crafting</h2><div class="craft-layout"><div class="inventory-craft-grid" style="grid-template-columns:repeat(${o.size},52px)">${state.craft
          .slice(0, o.size * o.size)
          .map((stack, i) => cell("craft", i, stack))
          .join(
            "",
          )}</div><span>→</span>${cell("output", 0, recipe ? { id: recipe.output[0], count: recipe.output[1] } : null)}</div>`;
    host.querySelector("#inventory-station")!.innerHTML = container
      ? `<h2>${container.kind === "chest" ? "Kist" : "Oven"}</h2>${container.kind === "furnace" ? `<p>Smelten ${Math.floor(((container.progress ?? 0) / 8) * 100)}% · Brandstof ${Math.ceil(container.burn ?? 0)}s</p>` : ""}<div class="inventory-slots ${container.kind === "furnace" ? "furnace-slots" : ""}">${container.slots.map((stack, i) => cell("container", i, stack)).join("")}</div>`
      : "";
    (host.querySelector(".recipe-book") as HTMLElement).hidden = !!container;
    bind(host);
    cursor.innerHTML = img(state.cursor);
    cursor.hidden = !state.cursor;
  };
  const move = (e: PointerEvent) => {
    cursor.style.left = e.clientX + 12 + "px";
    cursor.style.top = e.clientY + 12 + "px";
    if (!gesture) return;
    if (Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 4)
      gesture.moved = true;
    if (!gesture.cursor || gesture.shift || !gesture.moved) return;
    const button = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLButtonElement>("[data-area]");
    if (!button || !host.contains(button) || button.dataset.area === "output")
      return;
    const area = button.dataset.area as SlotArea,
      index = Number(button.dataset.index);
    if (!gesture.targets.some((t) => t.area === area && t.index === index)) {
      gesture.targets.push({ area, index });
    }
    for (const t of gesture.targets)
      host
        .querySelector(`[data-area="${t.area}"][data-index="${t.index}"]`)
        ?.classList.add("drag-target");
  };
  const cancel = () => {
    gesture = undefined;
    host
      .querySelectorAll(".drag-target")
      .forEach((el) => el.classList.remove("drag-target"));
    refresh();
  };
  const release = (e: PointerEvent) => {
    if (!gesture || e.button !== gesture.button) return;
    const g = gesture;
    gesture = undefined;
    host
      .querySelectorAll(".drag-target")
      .forEach((el) => el.classList.remove("drag-target"));
    const destination = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLButtonElement>("[data-area]");
    if (g.moved && g.cursor && !g.shift) {
      act({ kind: "distribute", slots: g.targets, button: g.button });
      return;
    }
    if (!destination || !host.contains(destination)) {
      refresh();
      return;
    }
    const area = destination.dataset.area as SlotArea,
      index = Number(destination.dataset.index);
    if (
      g.moved &&
      (g.source.area !== area || g.source.index !== index) &&
      !g.cursor
    ) {
      act({
        kind: "move",
        from: g.source.area,
        index: g.source.index,
        to: area,
        target: index,
      });
      return;
    }
    act({
      kind: "click",
      area: g.source.area,
      index: g.source.index,
      button: g.button,
      shift: g.shift,
    });
  };
  const key = (e: KeyboardEvent) => {
    if (e.code === "Escape") {
      cancel();
      return;
    }
    if (
      !hovered ||
      ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)
    )
      return;
    if (/^[1-9]$/.test(e.key)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      act({
        kind: "hotbar",
        area: hovered.area,
        index: hovered.index,
        hotbar: Number(e.key) - 1,
      });
    }
  };
  document.addEventListener("pointermove", move);
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", cancel);
  window.addEventListener("keydown", key, true);
  host.querySelector("#back")!.addEventListener("click", o.close);
  host
    .querySelectorAll<HTMLElement>("[data-book]")
    .forEach(
      (b) =>
        (b.onclick = () => act({ kind: "recipe", recipe: b.dataset.book! })),
    );
  if (o.creative) {
    const renderCatalog = () => {
      const query = host
        .querySelector<HTMLInputElement>("#item-search")!
        .value.toLowerCase();
      const list = host.querySelector("#creative-items")!;
      list.innerHTML = itemCatalog
        .all()
        .filter(
          (i) => i.key.includes(query) || i.name.toLowerCase().includes(query),
        )
        .map(
          (i) =>
            `<button class="block-choice" data-block="${i.id}" title="${i.name}"><img src="${o.icons[i.id]}" alt="${i.name}"><span>${i.name}</span></button>`,
        )
        .join("");
      list.querySelectorAll<HTMLElement>("[data-block]").forEach((b) => {
        b.onclick = (e) =>
          act({
            kind: "creative",
            item: Number(b.dataset.block),
            button: 0,
            shift: e.shiftKey,
          });
        b.oncontextmenu = (e) => {
          e.preventDefault();
          if (!rightArmed) return;
          rightArmed = false;
          act({
            kind: "creative",
            item: Number(b.dataset.block),
            button: 2,
            shift: e.shiftKey,
          });
        };
      });
    };
    host
      .querySelector("#item-search")!
      .addEventListener("input", renderCatalog);
    renderCatalog();
  }
  refresh();
  return {
    refresh,
    dispose: () => {
      document.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      host.onpointerdown = null;
      window.removeEventListener("keydown", key, true);
      cursor.remove();
    },
  };
}
