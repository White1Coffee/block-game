import { BlockEntities, smelting, type Stack } from "../world/BlockEntities";
import type { Survival } from "../inventory/Survival";
export function containerUI(
  host: HTMLElement,
  entities: BlockEntities,
  key: string,
  kind: "chest" | "furnace",
  s: Survival,
  icons: string[],
  name: (id: number) => string,
  changed: () => void,
  request?: (slot: number, item: number, count: number, take: boolean) => void,
) {
  let rightArmed = false;
  host.onpointerdown = (e) => {
    if (e.button === 2) rightArmed = true;
  };
  let selected =
    Object.keys(s.items)
      .map(Number)
      .find((id) => s.count(id) > 0) ?? 0;
  const render = () => {
    const f = kind === "furnace" ? entities.furnace(key) : null;
    const slots = f ? [f.input, f.fuel, f.output] : entities.chest(key);
    host.innerHTML = `<h2>${f ? "Oven" : "Kist"}</h2><p>Selecteer een item hieronder. Klik op een leeg vak om één item te plaatsen; rechtsklik om een stack toe te voegen. Klik een gevuld vak om op te pakken.</p>${f ? `<p id="furnace-progress">Smelten ${Math.floor((f.progress / 8) * 100)}% · Brandstof ${Math.ceil(f.burn)}s</p><progress max="8" value="${f.progress}"></progress>` : ""}<div class="container-slots">${slots.map((slot, i) => `<button data-container="${i}" title="${f ? ["Input", "Brandstof", "Output"][i] : "Opslag"}">${slot ? `<img src="${icons[slot.id]}" alt="${name(slot.id)}"><small>${slot.count}</small>` : f ? ["Input", "Fuel", "Output"][i] : ""}</button>`).join("")}</div><div class="craft-palette">${Object.keys(
      s.items,
    )
      .map(Number)
      .filter((id) => s.count(id) > 0)
      .map(
        (id) =>
          `<button data-container-item="${id}" title="${name(id)}" class="${id === selected ? "chosen" : ""}"><img src="${icons[id]}" alt="${name(id)}"><small>${s.count(id)}</small></button>`,
      )
      .join("")}</div>`;
    host.querySelectorAll<HTMLButtonElement>("[data-container-item]").forEach(
      (b) =>
        (b.onclick = () => {
          selected = Number(b.dataset.containerItem);
          render();
        }),
    );
    host
      .querySelectorAll<HTMLButtonElement>("[data-container]")
      .forEach((b) => {
        const transfer = (e: MouseEvent) => {
          e.preventDefault();
          if (e.button === 2) {
            if (!rightArmed) return;
            rightArmed = false;
          }
          const i = Number(b.dataset.container);
          if (request) {
            request(
              i,
              selected,
              e.button === 2
                ? Math.min(64 - (slots[i]?.count ?? 0), s.count(selected))
                : 1,
              !!slots[i] && e.button !== 2,
            );
            return;
          }
          if (f) {
            slots[0] = f.input;
            slots[1] = f.fuel;
            slots[2] = f.output;
          }
          if (slots[i] && e.button !== 2) {
            if (entities.transferFrom(s, slots, i) && f && i === 2) {
              s.addXP(f.xp);
              f.xp = 0;
            }
          } else if (!f || i !== 2) {
            if (f && i === 0 && !smelting[selected]) return;
            entities.transferTo(
              s,
              slots,
              i,
              selected,
              e.button === 2
                ? Math.min(64 - (slots[i]?.count ?? 0), s.count(selected))
                : 1,
            );
          }
          if (f) [f.input, f.fuel, f.output] = slots;
          changed();
          render();
        };
        b.onclick = transfer;
        b.oncontextmenu = transfer;
      });
  };
  render();
  let signature = "";
  return () => {
    if (request) {
      const f = kind === "furnace" ? entities.furnace(key) : null;
      const next = JSON.stringify([
        f ? [f.input, f.fuel, f.output] : entities.chest(key),
        s.items,
      ]);
      if (next !== signature) {
        signature = next;
        render();
      }
    }
    if (kind === "furnace") {
      const f = entities.furnace(key);
      const label = host.querySelector("#furnace-progress");
      if (label)
        label.textContent = `Smelten ${Math.floor((f.progress / 8) * 100)}% · Brandstof ${Math.ceil(f.burn)}s`;
      const progress = host.querySelector("progress");
      if (progress) progress.value = f.progress;
      const output = host.querySelector('[data-container="2"]');
      if (output && f.output)
        output.innerHTML = `<img src="${icons[f.output.id]}" alt="${name(f.output.id)}"><small>${f.output.count}</small>`;
    }
  };
}
