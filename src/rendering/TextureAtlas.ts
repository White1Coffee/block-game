import { CanvasTexture, NearestFilter, SRGBColorSpace } from "three";
import { blocks } from "../blocks/BlockRegistry";
export const ATLAS_COLUMNS = 8,
  TILE_SIZE = 16,
  ATLAS_ROWS = 16;
export function createAtlas() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = ATLAS_ROWS * 16;
  const ctx = canvas.getContext("2d")!;
  let state = 7821;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (const id of [...blocks.map((b) => b.id), 127]) {
    const b = blocks[id === 127 ? 1 : id];
    const ox = (id % 8) * 16,
      oy = Math.floor(id / 8) * 16;
    ctx.fillStyle = b.color;
    ctx.fillRect(ox, oy, 16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        let color = b.color;
        let shade = random() * 0.28 - 0.14;
        if (b.pattern === "grass" && id !== 127)
          color = y < 3 + ((x * 7) % 3) ? "#6fa848" : "#886043";
        if (b.pattern === "log") shade += x % 4 === 0 ? -0.22 : 0;
        if (
          b.pattern === "planks" &&
          (y % 4 === 0 || (x + (Math.floor(y / 4) % 2) * 8) % 16 === 0)
        )
          shade = -0.25;
        if (
          b.pattern === "bricks" &&
          (y % 8 === 0 || (x + (Math.floor(y / 8) % 2) * 8) % 16 === 0)
        ) {
          color = "#b3b0a1";
          shade = 0;
        }
        if (b.pattern === "ore" && random() > 0.24) color = "#858a8b";
        ctx.fillStyle = color;
        ctx.fillRect(ox + x, oy + y, 1, 1);
        ctx.fillStyle =
          shade < 0 ? `rgba(0,0,0,${-shade})` : `rgba(255,255,255,${shade})`;
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    if (b.pattern === "glass") {
      ctx.clearRect(ox + 1, oy + 1, 14, 14);
      ctx.fillStyle = "#d7f4ed";
      for (let i = 3; i < 10; i++) ctx.fillRect(ox + i, oy + 14 - i, 1, 1);
    }
    if (id === 11) {
      ctx.fillStyle = "rgba(140,211,230,.45)";
      ctx.fillRect(ox + 2, oy + 4, 7, 1);
      ctx.fillRect(ox + 8, oy + 11, 5, 1);
    }
    if (b.shape === "plant") {
      ctx.clearRect(ox, oy, 16, 16);
      ctx.fillStyle = "#6b943e";
      ctx.fillRect(ox + 7, oy + 5, 2, 11);
      ctx.fillRect(ox + 4, oy + 10, 3, 2);
      ctx.fillRect(ox + 9, oy + 8, 3, 2);
      if ([21, 53, 66].includes(id)) {
        ctx.fillStyle = "#e3ae77";
        ctx.fillRect(ox + 5, oy + 2, 6, 5);
        ctx.fillStyle = "#f5e9af";
        ctx.fillRect(ox + 7, oy + 3, 2, 2);
      } else {
        ctx.fillRect(ox + 3, oy + 4, 1, 10);
        ctx.fillRect(ox + 11, oy + 2, 1, 12);
      }
    }
  }

  for (const id of [51, 67, 52]) {
    const ox = (id % 8) * 16,
      oy = Math.floor(id / 8) * 16,
      h = id === 51 ? 5 : id === 67 ? 10 : 14;
    ctx.clearRect(ox, oy, 16, 16);
    ctx.fillStyle = id === 52 ? "#d4b859" : "#70a04b";
    for (const x of [3, 7, 11]) {
      ctx.fillRect(ox + x, oy + 16 - h, 1, h);
      for (let j = 1; j < h - 1; j += 3) {
        ctx.fillRect(ox + x - 1, oy + 16 - j, 3, 1);
      }
    }
  }
  for (const id of [59, 61]) {
    const ox = (id % 8) * 16,
      oy = Math.floor(id / 8) * 16;
    ctx.clearRect(ox + 4, oy + 2, 8, 8);
    ctx.fillStyle = "#9b794b";
    ctx.fillRect(ox + 7, oy + 2, 2, 8);
    ctx.fillRect(ox + 4, oy + 6, 8, 1);
  }
  {
    const id = 62,
      ox = (id % 8) * 16,
      oy = Math.floor(id / 8) * 16;
    ctx.fillStyle = "#624a30";
    ctx.fillRect(ox, oy + 5, 16, 2);
    ctx.fillStyle = "#e0c476";
    ctx.fillRect(ox + 7, oy + 5, 2, 4);
  }
  const texture = new CanvasTexture(canvas);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = SRGBColorSpace;
  return { texture, canvas };
}
export function blockIcon(atlas: HTMLCanvasElement, id: number) {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 16;
  c.getContext("2d")!.drawImage(
    atlas,
    (id % 8) * 16,
    Math.floor(id / 8) * 16,
    16,
    16,
    0,
    0,
    16,
    16,
  );
  return c.toDataURL();
}
