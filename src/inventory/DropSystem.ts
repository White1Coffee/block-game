import {
  InstancedMesh,
  BoxGeometry,
  MeshLambertMaterial,
  Matrix4,
  Color,
  Vector3,
  DynamicDrawUsage,
  type Scene,
} from "three";
import { block } from "../blocks/BlockRegistry";
import { stackLimit } from "./ItemRegistry";
export interface SavedDrop {
  id: number;
  count: number;
  position: number[];
  age: number;
  entityId?: string;
  durability?: number;
  enchantments?: Record<string, number>;
}
export class DropSystem {
  private mesh = new InstancedMesh(
    new BoxGeometry(0.2, 0.2, 0.2),
    new MeshLambertMaterial({ color: 0xffffff }),
    128,
  );
  private entries: { data: SavedDrop; position: Vector3; vy: number }[] = [];
  private matrix = new Matrix4();
  private color = new Color();
  constructor(scene: Scene) {
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    scene.add(this.mesh);
  }
  spawn(
    id: number,
    count: number,
    position: number[],
    age = 0,
    entityId: string = crypto.randomUUID(),
    metadata: Pick<SavedDrop, "durability" | "enchantments"> = {},
  ) {
    if (!id || count <= 0) return;
    const p = new Vector3().fromArray(position);
    for (const e of this.entries)
      if (
        e.data.id === id &&
        e.position.distanceToSquared(p) < 1 &&
        e.data.count < stackLimit(id)
      ) {
        const moved = Math.min(count, stackLimit(id) - e.data.count);
        e.data.count += moved;
        e.data.age = Math.min(e.data.age, age);
        count -= moved;
        if (count === 0) return;
      }
    while (count > 0 && this.entries.length < 128) {
      const n = Math.min(count, stackLimit(id));
      this.entries.push({
        data: {
          id,
          count: n,
          position: [...position],
          age,
          entityId,
          durability: metadata.durability,
          enchantments: metadata.enchantments
            ? { ...metadata.enchantments }
            : undefined,
        },
        position: p.clone(),
        vy: 1.5,
      });
      count -= n;
      entityId = crypto.randomUUID();
    }
  }
  update(
    world: WorldLike,
    player: Vector3,
    dt: number,
    collect: (id: number, n: number, data: SavedDrop) => number,
  ) {
    const target = player.clone().add(new Vector3(0, 0.7, 0));
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      e.data.age += dt;
      if (e.data.age > 300) {
        this.entries.splice(i, 1);
        continue;
      }
      if (e.position.distanceToSquared(player) > 128 * 128) continue;
      e.vy = Math.max(-8, e.vy - dt * 12);
      const steps = Math.max(1, Math.ceil(Math.abs(e.vy * dt) / 0.15));
      for (let s = 0; s < steps; s++) {
        const next = e.position.y + (e.vy * dt) / steps;
        if (!world.solid(e.position.x, next - 0.1, e.position.z))
          e.position.y = next;
        else {
          e.vy = Math.abs(e.vy) > 0.8 ? -e.vy * 0.25 : 0;
          break;
        }
      }
      if (e.data.age > 0.5 && e.position.distanceTo(target) < 1.8)
        e.data.count = collect(e.data.id, e.data.count, e.data);
      if (e.data.count <= 0 || e.data.age > 300) this.entries.splice(i, 1);
    }
    this.mesh.count = this.entries.length;
    this.entries.forEach((e, i) => {
      this.matrix
        .makeRotationY(e.data.age)
        .setPosition(
          e.position.x,
          e.position.y + Math.sin(e.data.age * 3) * 0.035,
          e.position.z,
        );
      this.mesh.setMatrixAt(i, this.matrix);
      this.color.set(
        e.data.id < 100
          ? block(e.data.id).color
          : e.data.id === 105
            ? "#9b477d"
            : "#c5ae7d",
      );
      this.mesh.setColorAt(i, this.color);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  serialize() {
    return this.entries.map((e) => ({
      ...e.data,
      position: e.position.toArray(),
    }));
  }
  restore(drops: SavedDrop[]) {
    this.clear();
    for (const d of drops)
      this.spawn(d.id, d.count, d.position, d.age, d.entityId, d);
  }
  clear() {
    this.entries = [];
    this.mesh.count = 0;
  }
  dispose() {
    this.clear();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshLambertMaterial).dispose();
    this.mesh.removeFromParent();
  }
}
interface WorldLike {
  solid: (x: number, y: number, z: number) => boolean;
}
