export type SkinVariant = "classic" | "slim";
export type Rect = [number, number, number, number];
/** Java skin net: Three.js +X,-X,+Y,-Y,+Z,-Z; top-left image coordinates. */
export function skinRects(
  u: number,
  v: number,
  w: number,
  h: number,
  d: number,
): Rect[] {
  return [
    [u + d + w, v + d, d, h],
    [u, v + d, d, h],
    [u + d, v, w, d],
    [u + d + w, v, w, d],
    [u + d, v + d, w, h],
    [u + 2 * d + w, v + d, w, h],
  ];
}
export function validateSkinSize(width: number, height: number) {
  if (width !== 64 || ![32, 64].includes(height))
    throw new Error("Gebruik een PNG-skin van exact 64×64 of 64×32 pixels.");
}
export function normalizeSkinPixels(
  width: number,
  height: number,
  pixels: Uint8ClampedArray,
) {
  validateSkinSize(width, height);
  if (pixels.length !== width * height * 4)
    throw new Error("Onvolledige skinpixels.");
  const output = new Uint8ClampedArray(64 * 64 * 4);
  output.set(pixels);
  if (height === 32) {
    // Older skins reuse mirrored right limbs for the left limbs. Mirror each face,
    // including swapping the inner and outer sides, rather than the entire UV net.
    for (const [su, sv, du, dv] of [
      [0, 16, 16, 48],
      [40, 16, 32, 48],
    ]) {
      const source = skinRects(su, sv, 4, 12, 4),
        dest = skinRects(du, dv, 4, 12, 4);
      for (let face = 0; face < 6; face++) {
        const [sx, sy, sw, sh] = source[face === 0 ? 1 : face === 1 ? 0 : face];
        const [dx, dy] = dest[face];
        for (let y = 0; y < sh; y++)
          for (let x = 0; x < sw; x++) {
            const from = ((sy + y) * 64 + sx + sw - 1 - x) * 4,
              to = ((dy + y) * 64 + dx + x) * 4;
            output.set(pixels.subarray(from, from + 4), to);
          }
      }
    }
    let opaqueHat = true;
    for (let y = 0; y < 32; y++)
      for (let x = 32; x < 64; x++)
        if (pixels[(y * 64 + x) * 4 + 3] < 128) opaqueHat = false;
    if (opaqueHat)
      for (let y = 0; y < 32; y++)
        for (let x = 32; x < 64; x++) output[(y * 64 + x) * 4 + 3] = 0;
  }
  return output;
}
