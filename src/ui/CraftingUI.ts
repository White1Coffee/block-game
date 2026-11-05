import {
  matchRecipe,
  craftGrid,
  gridRecipes,
} from "../inventory/RecipeRegistry";
import type { Survival } from "../inventory/Survival";
export function craftingUI(
  host: HTMLElement,
  s: Survival,
  size: number,
  icons: string[],
  name: (id: number) => string,
  changed: (id: number) => void,
  request?: (grid: number[], size: number, repeat: boolean) => void,
) {
  let grid = Array(size * size).fill(0),
    selected = 0;
  const render = () => {
    const recipe = matchRecipe(grid, size);
    host.innerHTML = `<h2>${size}×${size} Crafting</h2><p>Selecteer een item hieronder en klik op een vak. Rechtsklik maakt een vak leeg. Shift-klik op het resultaat maakt zoveel mogelijk.</p><div class="craft-layout"><div class="craft-grid" style="grid-template-columns:repeat(${size},48px)">${grid.map((id, i) => `<button data-craft-slot="${i}" title="${name(id)}">${id ? `<img src="${icons[id]}" alt="${name(id)}">` : ""}</button>`).join("")}</div><span>→</span><button id="craft-output" ${recipe ? "" : "disabled"}>${recipe ? `<img src="${icons[recipe.output[0]]}" alt="${name(recipe.output[0])}"><small>${recipe.output[1]}</small>` : "—"}</button></div><p id="craft-message" role="status">${recipe ? name(recipe.output[0]) : "Geen passend recept"}</p><div class="craft-palette">${Object.keys(
      s.items,
    )
      .map(Number)
      .filter((id) => s.count(id) > 0)
      .map(
        (id) =>
          `<button data-craft-item="${id}" title="${name(id)}" class="${id === selected ? "chosen" : ""}"><img src="${icons[id]}" alt="${name(id)}"><small>${s.count(id)}</small></button>`,
      )
      .join(
        "",
      )}</div><details><summary>Receptenboek</summary><div class="recipes">${gridRecipes
      .filter(
        (r) =>
          !r.pattern ||
          (r.pattern.length <= size && r.pattern[0].length <= size),
      )
      .map(
        (r) =>
          `<button data-book="${r.id}">${name(r.output[0])} ×${r.output[1]}</button>`,
      )
      .join("")}</div></details>`;
    host.querySelectorAll<HTMLButtonElement>("[data-craft-item]").forEach(
      (b) =>
        (b.onclick = () => {
          selected = Number(b.dataset.craftItem);
          render();
        }),
    );
    host
      .querySelectorAll<HTMLButtonElement>("[data-craft-slot]")
      .forEach((b) => {
        b.onclick = () => {
          const slot = Number(b.dataset.craftSlot),
            used = grid.filter((id, i) => i !== slot && id === selected).length;
          if (s.count(selected) > used) grid[slot] = selected;
          render();
        };
        b.oncontextmenu = (e) => {
          e.preventDefault();
          grid[Number(b.dataset.craftSlot)] = 0;
          render();
        };
      });
    host.querySelector<HTMLButtonElement>("#craft-output")!.onclick = (e) => {
      const result = matchRecipe(grid, size);
      if (request && result) {
        request([...grid], size, (e as MouseEvent).shiftKey);
        changed(result.output[0]);
        return;
      }
      if (craftGrid(s, grid, size, (e as MouseEvent).shiftKey)) {
        changed(result!.output[0]);
        render();
      } else
        host.querySelector("#craft-message")!.textContent =
          "Te weinig ingrediënten of inventory vol.";
    };
    host.querySelectorAll<HTMLButtonElement>("[data-book]").forEach(
      (b) =>
        (b.onclick = () => {
          const r = gridRecipes.find((r) => r.id === b.dataset.book)!;
          grid = Array(size * size).fill(0);
          if (r.pattern)
            r.pattern.forEach((row, y) =>
              row.forEach((id, x) => (grid[y * size + x] = id)),
            );
          else r.shapeless!.forEach((id, i) => (grid[i] = id));
          render();
        }),
    );
  };
  render();
  let signature = JSON.stringify(s.items);
  return () => {
    const next = JSON.stringify(s.items);
    if (next !== signature) {
      signature = next;
      render();
    }
  };
}
