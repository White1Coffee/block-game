import { describe, it, expect } from "vitest";
import {
  normalizeSkinPixels,
  skinRects,
  validateSkinSize,
} from "../src/player/skins/SkinFormat";
import { PlayerModel, skinBox } from "../src/player/models/PlayerModel";
import { Texture, Mesh, PerspectiveCamera, Vector3 } from "three";
import { CameraController } from "../src/player/CameraController";
describe("Java skin layouts", () => {
  it("accepts only the two Java PNG dimensions", () => {
    expect(() => validateSkinSize(64, 64)).not.toThrow();
    expect(() => validateSkinSize(64, 32)).not.toThrow();
    expect(() => validateSkinSize(128, 128)).toThrow();
    expect(() => validateSkinSize(63, 64)).toThrow();
  });
  it("preserves modern pixels and transparent overlays exactly", () => {
    const pixels = new Uint8ClampedArray(64 * 64 * 4);
    pixels[4 * 64 * 8 + 3] = 255;
    pixels[4 * (64 * 10 + 42) + 3] = 63;
    expect(normalizeSkinPixels(64, 64, pixels)).toEqual(pixels);
  });
  it("mirrors legacy limbs face by face, swaps sides and preserves hat alpha", () => {
    const pixels = new Uint8ClampedArray(64 * 32 * 4);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 64; x++) {
        const i = (y * 64 + x) * 4;
        pixels.set([x, y, 123, 255], i);
      }
    pixels[(10 * 64 + 42) * 4 + 3] = 0;
    const output = normalizeSkinPixels(64, 32, pixels);
    const at = (x: number, y: number) =>
      Array.from(output.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4));
    expect(at(20, 52)).toEqual([7, 20, 123, 255]);
    expect(at(16, 52)).toEqual([11, 20, 123, 255]);
    expect(at(40, 52)).toEqual([43, 20, 123, 255]);
    expect(at(42, 10)[3]).toBe(0);
    expect(at(20, 36)[3]).toBe(0);
  });
  it("maps all six faces to the correct pixel rectangles and UV direction", () => {
    expect(skinRects(0, 0, 8, 8, 8)).toEqual([
      [16, 8, 8, 8],
      [0, 8, 8, 8],
      [8, 0, 8, 8],
      [16, 0, 8, 8],
      [8, 8, 8, 8],
      [24, 8, 8, 8],
    ]);
    const g = skinBox(8, 8, 8, 0, 0),
      uv = g.getAttribute("uv");
    expect(uv.getX(16)).toBe(8 / 64);
    expect(uv.getY(16)).toBe(1 - 8 / 64);
    expect(uv.getY(18)).toBe(1 - 16 / 64);
    expect(uv.getY(12)).toBe(1 - 8 / 64);
    g.dispose();
  });
  it("builds the correct classic and slim widths with independent layers", () => {
    const texture = new Texture(),
      classic = new PlayerModel(texture, "classic"),
      slim = new PlayerModel(texture, "slim");
    expect(
      ((classic.rightArm.children[0] as Mesh).geometry as any).parameters.width,
    ).toBe(4);
    expect(
      ((slim.rightArm.children[0] as Mesh).geometry as any).parameters.width,
    ).toBe(3);
    expect(slim.overlays).toHaveLength(6);
    slim.setLayers(false);
    expect(slim.overlays.every((m) => !m.visible)).toBe(true);
    expect((slim.rightArm.children[0] as Mesh).visible).toBe(true);
    classic.dispose();
    slim.dispose();
    texture.dispose();
  });
});
describe("third person camera collision", () => {
  it("cycles the three views and keeps the camera in front of walls", () => {
    const control = new CameraController(),
      camera = new PerspectiveCamera();
    const world = { get: (x: number) => (Math.floor(x) === 2 ? 3 : 0) } as any;
    control.cycle();
    control.update(camera, world, new Vector3(0, 0, 0), Math.PI / 2, 0, false);
    expect(camera.position.x).toBeLessThan(2);
    control.cycle();
    expect(control.mode).toBe(2);
    control.cycle();
    expect(control.mode).toBe(0);
  });
});
