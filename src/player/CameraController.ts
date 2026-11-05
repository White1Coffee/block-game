import { Vector3, Euler, type PerspectiveCamera } from "three";
import { raycast } from "../blocks/BlockInteraction";
import type { World } from "../world/World";
import { block } from "../blocks/BlockRegistry";
import { playerEyeHeight } from "./PlayerPhysics";
export class CameraController {
  mode = 0;
  cycle() {
    this.mode = (this.mode + 1) % 3;
  }
  update(
    camera: PerspectiveCamera,
    world: World,
    position: Vector3,
    yaw: number,
    pitch: number,
    sneaking: boolean,
    noclip = false,
  ) {
    const eye = position
      .clone()
      .add(new Vector3(0, playerEyeHeight(sneaking), 0));
    const dir = new Vector3(0, 0, -1).applyEuler(
      new Euler(pitch, yaw, 0, "YXZ"),
    );
    camera.rotation.order = "YXZ";
    if (this.mode === 0) {
      camera.position.copy(eye);
      camera.rotation.set(pitch, yaw, 0);
      return;
    }
    const travel = dir.clone().multiplyScalar(this.mode === 1 ? -1 : 1);
    let distance = 4;
    for (const offset of noclip
      ? []
      : [
          new Vector3(),
          new Vector3(0.18, 0, 0),
          new Vector3(-0.18, 0, 0),
          new Vector3(0, 0.18, 0),
          new Vector3(0, -0.18, 0),
        ]) {
      const hit = raycast(
        {
          get: (x, y, z) => {
            const id = world.get(x, y, z);
            return block(id).solid ? id : 0;
          },
        },
        eye.clone().add(offset),
        travel,
        4.2,
      );
      if (hit)
        distance = Math.min(distance, Math.max(0.15, hit.distance - 0.25));
    }
    camera.position.copy(eye).addScaledVector(travel, distance);
    camera.lookAt(eye);
  }
}
