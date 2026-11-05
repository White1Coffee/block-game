import type { World } from "./World";
import type { BlockEntities } from "./BlockEntities";
import { block } from "../blocks/BlockRegistry";
import type { VoxelHit } from "../blocks/BlockInteraction";

export const replaceable = (id: number) =>
  [0, 11, 21, 22, 23, 53, 66].includes(id);
export function placementPosition(world: Pick<World, "get">, hit: VoxelHit) {
  const replaceTarget = replaceable(world.get(hit.x, hit.y, hit.z));
  return {
    x: hit.x + (replaceTarget ? 0 : hit.normal[0]),
    y: hit.y + (replaceTarget ? 0 : hit.normal[1]),
    z: hit.z + (replaceTarget ? 0 : hit.normal[2]),
  };
}
export class BlockInteractionSystem {
  constructor(
    private world: World,
    private entities: BlockEntities,
  ) {}
  toggle(x: number, y: number, z: number) {
    let id = this.world.get(x, y, z);
    if ([59, 61].includes(id)) {
      y--;
      id = this.world.get(x, y, z);
    }
    if ([58, 60].includes(id)) {
      this.world.set(x, y, z, id === 58 ? 60 : 58);
      this.world.set(x, y + 1, z, id === 58 ? 61 : 59);
      return true;
    }
    if ([46, 47].includes(id)) {
      this.world.set(x, y, z, id === 46 ? 47 : 46);
      return true;
    }
    return false;
  }
  place(
    id: number,
    x: number,
    y: number,
    z: number,
    rotation: number,
    face: [number, number, number] = [0, 1, 0],
    occupied: (x: number, y: number, z: number) => boolean = () => false,
  ) {
    if (id === 0 || block(id).id !== id) return false;
    if (
      y < 1 ||
      y >= this.world.height ||
      !replaceable(this.world.get(x, y, z))
    )
      return false;
    if (
      id === 58 &&
      (y + 1 >= this.world.height || !replaceable(this.world.get(x, y + 1, z)))
    )
      return false;
    if ([59, 60, 61, 47, 52, 67].includes(id)) return false;
    if (
      block(id).solid &&
      (occupied(x, y, z) || (id === 58 && occupied(x, y + 1, z)))
    )
      return false;
    if ([64, 65].includes(id) && face[1] < 0) return false;
    const wall = [64, 65].includes(id) && face[1] === 0;
    if (wall)
      rotation = -Math.round(Math.atan2(face[0], face[2]) / (Math.PI / 2));
    if (!this.world.set(x, y, z, id)) return false;
    this.world.states[`${x},${y},${z}`] = { rotation, wall };
    if (id === 58) {
      this.world.set(x, y + 1, z, 59);
      this.world.states[`${x},${y + 1},${z}`] = { rotation };
    }
    return true;
  }
  removeDoor(x: number, y: number, z: number, id: number) {
    if (id === 58 || id === 60) this.world.set(x, y + 1, z, 0);
    if (id === 59 || id === 61) this.world.set(x, y - 1, z, 0);
  }
  prepareChest(x: number, y: number, z: number) {
    const key = `${x},${y},${z}`;
    if (this.entities.data.chests[key]) return;
    const chest = this.entities.chest(key);
    if (this.world.version >= 3 && !this.world.changes.has(key)) {
      const loot = [110, 111, 105, 115, 117, 132, 113];
      for (let i = 0; i < 5; i++)
        chest[i] = {
          id: loot[
            Math.floor(this.world.generator.random(x + i, z, 901) * loot.length)
          ],
          count: 1 + Math.floor(this.world.generator.random(x, z + i, 902) * 4),
        };
    }
  }
  till(x: number, y: number, z: number) {
    if (
      ![1, 2].includes(this.world.get(x, y, z)) ||
      ![0, 21, 22].includes(this.world.get(x, y + 1, z))
    )
      return false;
    this.world.set(x, y + 1, z, 0);
    return this.world.set(x, y, z, 50);
  }
  plant(x: number, y: number, z: number) {
    if (this.world.get(x, y - 1, z) !== 50 || this.world.get(x, y, z) !== 0)
      return false;
    this.world.set(x, y, z, 51);
    this.entities.data.crops[`${x},${y},${z}`] = { age: 0, stage: 0 };
    return true;
  }
}
