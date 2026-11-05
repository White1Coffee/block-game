import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  type Material,
} from "three";
import { block, blockBoxes } from "../blocks/BlockRegistry";
import { ATLAS_ROWS } from "./TextureAtlas";
import { WORLD_HEIGHT } from "../world/WorldGenerator";
import type { World } from "../world/World";
const faces = [
  {
    n: [1, 0, 0],
    v: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
    light: 0.78,
  },
  {
    n: [-1, 0, 0],
    v: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
    light: 0.66,
  },
  {
    n: [0, 1, 0],
    v: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
    light: 1,
  },
  {
    n: [0, -1, 0],
    v: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
    light: 0.5,
  },
  {
    n: [0, 0, 1],
    v: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
    light: 0.85,
  },
  {
    n: [0, 0, -1],
    v: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
    light: 0.72,
  },
];
export function meshChunk(
  world: World,
  cx: number,
  cz: number,
  materials: Material[],
): Group {
  const group = new Group();
  group.position.set(cx * 16, 0, cz * 16);
  const buffers = [0, 1, 2].map(() => ({
    p: [] as number[],
    n: [] as number[],
    uv: [] as number[],
    c: [] as number[],
    indices: [] as number[],
    t: [] as number[],
  }));
  const data = world.ensure(cx, cz);
  world.lighting?.ensure(cx, cz);
  for (let y = 0; y < world.height; y++)
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const id = data[x + z * 16 + y * 256];
        if (!id) continue;
        const b = block(id),
          buf =
            buffers[
              [10, 11, 55].includes(id)
                ? 1
                : b.transparent || b.shape !== "cube"
                  ? 2
                  : 0
            ];
        if (b.shape === "plant") {
          for (const quad of [
            [
              [0, 0, 0],
              [1, 0, 1],
              [1, 1, 1],
              [0, 1, 0],
            ],
            [
              [1, 0, 0],
              [0, 0, 1],
              [0, 1, 1],
              [1, 1, 0],
            ],
          ]) {
            const start = buf.p.length / 3;
            quad.forEach((v, i) => {
              buf.p.push(x + v[0], y + v[1], z + v[2]);
              buf.n.push(0, 1, 0);
              buf.c.push(1, 1, 1);
              buf.t.push(block(id).emission / 15);
              const u = (id % 8) / 8,
                top = 1 - Math.floor(id / 8) / ATLAS_ROWS;
              buf.uv.push(
                u + (i === 1 || i === 2 ? 0.124 : 0.001),
                top - (i < 2 ? 1 / ATLAS_ROWS - 0.001 : 0.001),
              );
            });
            buf.indices.push(
              start,
              start + 1,
              start + 2,
              start,
              start + 2,
              start + 3,
            );
          }
          continue;
        }
        const state = world.states[`${cx * 16 + x},${y},${cz * 16 + z}`];
        for (const [a, bottom, c, d, top, e] of blockBoxes(
          id,
          state?.rotation ?? 0,
          state?.open ?? false,
          state?.wall ?? false,
        ))
          for (let f = 0; f < 6; f++) {
            const face = faces[f],
              adj = world.get(
                cx * 16 + x + face.n[0],
                y + face.n[1],
                cz * 16 + z + face.n[2],
              );
            if (
              b.shape === "cube" &&
              (adj === id ||
                (!block(adj).transparent && block(adj).shape === "cube"))
            )
              continue;
            const tile =
              f === 2
                ? b.textures.top
                : f === 3
                  ? b.textures.bottom
                  : b.textures.sides;
            const u = (tile % 8) / 8,
              v = 1 - Math.floor(tile / 8) / ATLAS_ROWS;
            const pad = 0.001;
            const uv = [
              [u + pad, v - 1 / ATLAS_ROWS + pad],
              [u + 0.125 - pad, v - 1 / ATLAS_ROWS + pad],
              [u + 0.125 - pad, v - pad],
              [u + pad, v - pad],
            ];
            const start = buf.p.length / 3;
            face.v.forEach((vertex, i) => {
              buf.p.push(
                x + a + vertex[0] * (d - a),
                y + bottom + vertex[1] * (top - bottom),
                z + c + vertex[2] * (e - c),
              );
              buf.n.push(...face.n);
              buf.uv.push(...uv[i]);
              const illumination = world.lighting?.sample(
                cx * 16 + x + face.n[0],
                y + face.n[1],
                cz * 16 + z + face.n[2],
              );
              const shade =
                illumination?.sky === undefined
                  ? 1
                  : 0.12 +
                    (0.88 * Math.max(illumination.sky, illumination.light)) /
                      15;
              buf.c.push(
                face.light * shade,
                face.light * shade,
                face.light * shade,
              );
              buf.t.push(Math.max(b.emission, illumination?.light ?? 0) / 15);
            });
            buf.indices.push(
              start,
              start + 1,
              start + 2,
              start,
              start + 2,
              start + 3,
            );
          }
      }
  buffers.forEach((b, i) => {
    if (!b.p.length) return;
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(b.p, 3));
    g.setAttribute("normal", new Float32BufferAttribute(b.n, 3));
    g.setAttribute("uv", new Float32BufferAttribute(b.uv, 2));
    g.setAttribute("color", new Float32BufferAttribute(b.c, 3));
    g.setAttribute("voxelLight", new Float32BufferAttribute(b.t, 1));
    g.setIndex(b.indices);
    g.computeBoundingSphere();
    const mesh = new Mesh(g, materials[i]);
    mesh.frustumCulled = true;
    mesh.castShadow = i !== 1;
    mesh.receiveShadow = true;
    group.add(mesh);
  });
  return group;
}
export function disposeChunk(group: Group) {
  group.traverse((o) => {
    if (o instanceof Mesh) o.geometry.dispose();
  });
  group.removeFromParent();
}
