import { CanvasTexture, NearestFilter, SRGBColorSpace } from "three";
import { normalizeSkinPixels, type SkinVariant } from "./SkinFormat";
export interface SkinRecord {
  png: string;
  model: SkinVariant;
  layers: boolean;
  name: string;
}
export function defaultSkin() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#b68d65";
  ctx.fillRect(0, 0, 32, 16);
  ctx.fillRect(40, 16, 16, 16);
  ctx.fillRect(32, 48, 16, 16);
  ctx.fillStyle = "#284e43";
  ctx.fillRect(16, 16, 24, 16);
  ctx.fillRect(40, 20, 16, 7);
  ctx.fillRect(32, 52, 16, 7);
  ctx.fillStyle = "#35434d";
  ctx.fillRect(0, 16, 16, 16);
  ctx.fillRect(16, 48, 16, 16);
  ctx.fillStyle = "#27342d";
  ctx.fillRect(0, 28, 16, 4);
  ctx.fillRect(16, 60, 16, 4);
  ctx.fillStyle = "#533f2c";
  ctx.fillRect(0, 0, 32, 8);
  ctx.fillRect(0, 8, 8, 4);
  ctx.fillRect(16, 8, 16, 4);
  ctx.fillStyle = "#e4ecbc";
  ctx.fillRect(9, 10, 2, 1);
  ctx.fillRect(13, 10, 2, 1);
  ctx.fillStyle = "#25392e";
  ctx.fillRect(10, 10, 1, 1);
  ctx.fillRect(13, 10, 1, 1);
  ctx.fillStyle = "#77533a";
  ctx.fillRect(11, 13, 2, 1);
  ctx.fillStyle = "#b4c178";
  ctx.fillRect(20, 23, 8, 1);
  ctx.fillRect(23, 20, 1, 12);
  ctx.fillStyle = "#e9d49b";
  ctx.fillRect(43, 10, 2, 2); // original small hat badge
  return {
    png: c.toDataURL(),
    model: "classic" as const,
    layers: true,
    name: "WhiteBrick Ranger",
  };
}
export async function loadSkin(source: Blob | string) {
  let url: string;
  if (source instanceof Blob) {
    if (source.size > 1024 * 1024)
      throw new Error("De PNG mag maximaal 1 MB zijn.");
    const signature = new Uint8Array(await source.slice(0, 8).arrayBuffer());
    if (signature.join(",") !== "137,80,78,71,13,10,26,10")
      throw new Error("Dit bestand is geen PNG.");
    url = URL.createObjectURL(source);
  } else url = source;
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const raw = document.createElement("canvas");
    raw.width = image.width;
    raw.height = image.height;
    const rctx = raw.getContext("2d")!;
    rctx.drawImage(image, 0, 0);
    const pixels = normalizeSkinPixels(
      image.width,
      image.height,
      rctx.getImageData(0, 0, image.width, image.height).data,
    );
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    canvas.getContext("2d")!.putImageData(new ImageData(pixels, 64, 64), 0, 0);
    return canvas;
  } catch (e) {
    throw new Error(
      e instanceof Error && e.message.includes("pixels")
        ? e.message
        : "Ongeldige skin. Gebruik een PNG van 64×64 of 64×32 pixels.",
    );
  } finally {
    if (source instanceof Blob) URL.revokeObjectURL(url);
  }
}
export function skinTexture(canvas: HTMLCanvasElement) {
  const t = new CanvasTexture(canvas);
  t.magFilter = t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = SRGBColorSpace;
  return t;
}
export class SkinManager {
  record: SkinRecord = defaultSkin();
  async restore() {
    try {
      const saved = localStorage.getItem("wildbrick-skin");
      if (saved) {
        const record = JSON.parse(saved);
        if (
          !["classic", "slim"].includes(record.model) ||
          typeof record.png !== "string" ||
          !record.png.startsWith("data:image/png;base64,")
        )
          throw new Error();
        const c = await loadSkin(record.png);
        this.record = { ...record, png: c.toDataURL() };
      }
    } catch {
      this.record = defaultSkin();
    }
    return loadSkin(this.record.png);
  }
  save(record: SkinRecord) {
    localStorage.setItem("wildbrick-skin", JSON.stringify(record));
    this.record = { ...record };
  }
  async lookup(username: string): Promise<SkinRecord> {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username))
      throw new Error("Gebruik 3–16 letters, cijfers of underscores.");
    const response = await fetch(`/api/skin/${encodeURIComponent(username)}`, {
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json().catch(() => {
      throw new Error(
        "Skinproxy niet beschikbaar. Start npm run dev of npm run server.",
      );
    });
    if (!response.ok) throw new Error(data.error || "Skin ophalen mislukt.");
    const canvas = await loadSkin(data.png);
    return {
      png: canvas.toDataURL(),
      model: data.model === "slim" ? "slim" : "classic",
      layers: true,
      name: data.name,
    };
  }
}
