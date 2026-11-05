import {
  SkinManager,
  defaultSkin,
  loadSkin,
  skinTexture,
  type SkinRecord,
} from "../player/skins/SkinManager";
import { SkinPreview } from "../player/skins/SkinPreview";
export function characterMenu(
  host: HTMLElement,
  manager: SkinManager,
  onApply: (record: SkinRecord, canvas: HTMLCanvasElement) => void,
  onBack: () => void,
  toast: (s: string) => void,
) {
  host.innerHTML = `<section class="card wide character-card"><div class="eyebrow">CHARACTER → SKINS</div><h1>Jouw gezicht. Jouw avontuur.</h1><div class="character-layout"><div><div id="skin-preview" aria-label="Sleep om je personage te draaien. Scroll om te zoomen."></div><p class="preview-help">Sleep om te draaien · Scroll om te zoomen</p></div><div><label>PNG-SKIN <input id="skin-upload" type="file" accept="image/png"></label><p>64×64 modern of 64×32 legacy. Alleen publieke Java-skins; geen login nodig.</p><form id="username-form"><label>MINECRAFT USERNAME<input id="username" maxlength="16" placeholder="Bijvoorbeeld Notch" autocomplete="off"></label><button type="submit" id="lookup">Skin ophalen</button></form><label>MODEL<select id="skin-model"><option value="classic">Classic · 4 pixelarmen</option><option value="slim">Slim · 3 pixelarmen</option></select></label><label class="check"><input type="checkbox" id="skin-layers"> Tweede lagen tonen</label><p id="skin-status" role="status"></p><button id="apply-skin" class="primary">Skin opslaan & toepassen ✓</button><button id="reset-skin">Originele skin herstellen</button></div></div><button id="character-back" class="subtle">← Terug</button></section>`;
  const preview = new SkinPreview(host.querySelector("#skin-preview")!);
  let draft = { ...manager.record };
  let texture: ReturnType<typeof skinTexture> | undefined;
  let disposed = false;
  let revision = 0;
  const model = host.querySelector<HTMLSelectElement>("#skin-model")!,
    layers = host.querySelector<HTMLInputElement>("#skin-layers")!,
    status = host.querySelector<HTMLElement>("#skin-status")!;
  const render = async () => {
    const current = ++revision;
    try {
      const canvas = await loadSkin(draft.png);
      if (disposed || current !== revision) return;
      const next = skinTexture(canvas);
      preview.set(next, draft.model, draft.layers);
      texture?.dispose();
      texture = next;
      model.value = draft.model;
      layers.checked = draft.layers;
      status.textContent = draft.name;
    } catch (e) {
      status.textContent = String(e);
    }
  };
  void render();
  model.onchange = () => {
    draft.model = model.value === "slim" ? "slim" : "classic";
    void render();
  };
  layers.onchange = () => {
    draft.layers = layers.checked;
    void render();
  };
  host.querySelector<HTMLInputElement>("#skin-upload")!.onchange = async (
    e,
  ) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const canvas = await loadSkin(file);
      if (disposed) return;
      draft = { ...draft, png: canvas.toDataURL(), name: file.name };
      await render();
    } catch (e) {
      status.textContent = (e as Error).message;
    }
  };
  host.querySelector<HTMLFormElement>("#username-form")!.onsubmit = async (
    e,
  ) => {
    e.preventDefault();
    const button = host.querySelector<HTMLButtonElement>("#lookup")!;
    button.disabled = true;
    status.textContent = "Publieke skin ophalen…";
    try {
      const record = await manager.lookup(
        host.querySelector<HTMLInputElement>("#username")!.value.trim(),
      );
      if (!disposed) {
        draft = record;
        await render();
      }
    } catch (e) {
      if (!disposed) status.textContent = (e as Error).message;
    } finally {
      if (!disposed) button.disabled = false;
    }
  };
  host.querySelector<HTMLButtonElement>("#apply-skin")!.onclick = async () => {
    try {
      const canvas = await loadSkin(draft.png);
      if (disposed) return;
      manager.save(draft);
      onApply(draft, canvas);
      toast("Skin opgeslagen en toegepast.");
    } catch (e) {
      status.textContent = `Opslaan mislukt: ${(e as Error).message}`;
    }
  };
  host.querySelector<HTMLButtonElement>("#reset-skin")!.onclick = () => {
    draft = defaultSkin();
    void render();
  };
  host.querySelector<HTMLButtonElement>("#character-back")!.onclick = onBack;
  return () => {
    disposed = true;
    preview.dispose();
    texture?.dispose();
  };
}
