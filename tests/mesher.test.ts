import { describe, expect, it } from "vitest";
import { Mesh, MeshBasicMaterial, type Group } from "three";
import { meshChunk, disposeChunk } from "../src/rendering/ChunkMesher";
import { World } from "../src/world/World";
import { WORLD_HEIGHT } from "../src/world/WorldGenerator";

function emptyWorld() {
  const world = new World("meshing");
  for (let z = -1; z <= 1; z++) {
    for (let x = -1; x <= 1; x++) {
      world.chunks.set(world.key(x, z), new Uint8Array(256 * WORLD_HEIGHT));
    }
  }
  return world;
}
const indexCount = (group: Group) =>
  group.children.reduce(
    (n, mesh) => n + (mesh as Mesh).geometry.index!.count,
    0,
  );

describe("chunk face culling", () => {
  it("emits six faces for one block and removes shared opaque faces", () => {
    const world = emptyWorld();
    const materials = [new MeshBasicMaterial(), new MeshBasicMaterial()];
    world.set(4, 4, 4, 3);
    const single = meshChunk(world, 0, 0, materials);
    expect(indexCount(single)).toBe(36);
    world.set(5, 4, 4, 3);
    const adjacent = meshChunk(world, 0, 0, materials);
    expect(indexCount(adjacent)).toBe(60);
    disposeChunk(single);
    disposeChunk(adjacent);
    materials.forEach((m) => m.dispose());
  });
  it("also removes shared faces at a chunk boundary", () => {
    const world = emptyWorld();
    const materials = [new MeshBasicMaterial(), new MeshBasicMaterial()];
    world.set(15, 4, 4, 3);
    world.set(16, 4, 4, 3);
    const left = meshChunk(world, 0, 0, materials);
    const right = meshChunk(world, 1, 0, materials);
    expect(indexCount(left)).toBe(30);
    expect(indexCount(right)).toBe(30);
    disposeChunk(left);
    disposeChunk(right);
    materials.forEach((m) => m.dispose());
  });
});
