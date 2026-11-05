import type { World } from "../world/World";
export interface VoxelHit {
  x: number;
  y: number;
  z: number;
  normal: [number, number, number];
  distance: number;
}
/** Amanatides & Woo voxel traversal. Independent of render meshes. */
export function raycast(
  world: Pick<World, "get">,
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  reach = 6,
): VoxelHit | null {
  let x = Math.floor(origin.x),
    y = Math.floor(origin.y),
    z = Math.floor(origin.z);
  const length = Math.hypot(dir.x, dir.y, dir.z);
  if (
    !Number.isFinite(length) ||
    !length ||
    !Number.isFinite(reach) ||
    reach < 0 ||
    ![origin.x, origin.y, origin.z].every(Number.isFinite)
  )
    return null;
  const dx = dir.x / length,
    dy = dir.y / length,
    dz = dir.z / length;
  const sx = Math.sign(dx),
    sy = Math.sign(dy),
    sz = Math.sign(dz),
    tx = dx === 0 ? Infinity : Math.abs(1 / dx),
    ty = dy === 0 ? Infinity : Math.abs(1 / dy),
    tz = dz === 0 ? Infinity : Math.abs(1 / dz);
  let mx = dx === 0 ? Infinity : ((dx > 0 ? x + 1 : x) - origin.x) / dx,
    my = dy === 0 ? Infinity : ((dy > 0 ? y + 1 : y) - origin.y) / dy,
    mz = dz === 0 ? Infinity : ((dz > 0 ? z + 1 : z) - origin.z) / dz,
    distance = 0;
  let normal: [number, number, number] = [0, 0, 0];
  if (!sx && !sy && !sz) return null;
  while (distance <= reach) {
    const id = world.get(x, y, z);
    if (id !== 0 && id !== 11 && id !== 23)
      return { x, y, z, normal, distance };
    if (mx < my && mx < mz) {
      x += sx;
      distance = mx;
      mx += tx;
      normal = [-sx, 0, 0];
    } else if (my < mz) {
      y += sy;
      distance = my;
      my += ty;
      normal = [0, -sy, 0];
    } else {
      z += sz;
      distance = mz;
      mz += tz;
      normal = [0, 0, -sz];
    }
  }
  return null;
}
