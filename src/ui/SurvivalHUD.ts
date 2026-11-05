import type { Survival } from "../inventory/Survival";
export function survivalHUD(s: Survival) {
  const icons = (value: number, symbol: string, cls: string) =>
    Array.from(
      { length: 10 },
      (_, i) =>
        `<span class="${cls} ${value >= i * 2 + 2 ? "full" : value > i * 2 ? "half" : "empty"}">${symbol}</span>`,
    ).join("");
  return `<div class="survival-bars" aria-label="Health ${Math.ceil(s.health)}/20 Hunger ${Math.ceil(s.hunger)}/20"><div>${icons(s.health, "♥", "heart")}</div><div>${icons(s.hunger, "◆", "food-icon")}</div></div><span class="sr-only">♥ ${Math.ceil(s.health)} / 20 ◆ ${Math.ceil(s.hunger)} / 20</span>${s.air < 10 ? `<div class="air-meter">${"◉".repeat(Math.ceil(s.air))}</div>` : ""}${s.equipment ? `<div class="armor-meter">⬡ ${"▪".repeat(6)}</div>` : ""}<div class="experience"><span>${s.level}</span><div style="width:${s.levelProgress * 100}%"></div></div>`;
}
