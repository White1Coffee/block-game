import {
  Group,
  Mesh,
  BoxGeometry,
  MeshLambertMaterial,
  type Scene,
} from "three";
import type { World } from "../world/World";
export class ChestAnimator {
  private root = new Group();
  private key: string | null = null;
  private openness = 0;
  constructor(scene: Scene) {
    const lid = new Mesh(
      new BoxGeometry(1, 0.25, 1),
      new MeshLambertMaterial({ color: "#b7894c" }),
    );
    lid.position.set(0.5, 0.125, 0.5);
    this.root.add(lid);
    this.root.visible = false;
    scene.add(this.root);
  }
  update(world: World, key: string | null, dt: number) {
    if (key !== this.key) {
      if (this.key) {
        const old = world.states[this.key];
        if (old) {
          old.open = false;
          const [x, , z] = this.key.split(",").map(Number);
          world.dirty.add(world.key(Math.floor(x / 16), Math.floor(z / 16)));
        }
      }
      this.key = key;
      if (key) {
        this.openness = 0;
        world.states[key] ??= { rotation: 0 };
        world.states[key].open = true;
        const [x, y, z] = key.split(",").map(Number);
        world.dirty.add(world.key(Math.floor(x / 16), Math.floor(z / 16)));
        this.root.position.set(x, y + 0.72, z);
      }
    }
    this.openness += (Number(!!key) - this.openness) * (1 - Math.exp(-dt * 9));
    this.root.visible = this.openness > 0.01;
    this.root.rotation.x = -this.openness * 1.2;
  }
}
