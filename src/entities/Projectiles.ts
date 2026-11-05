import {
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  PointsMaterial,
  Vector3,
  type Scene,
} from "three";
import type { World } from "../world/World";
import type { Mob } from "./MobSystem";
export interface Projectile {
  id: string;
  owner: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  stuck: boolean;
}
export class Projectiles {
  readonly arrows: Projectile[] = [];
  private geometry = new BufferGeometry();
  private mesh: Points;
  private positions = new Float32Array(128 * 3);
  constructor(scene: Scene) {
    this.geometry.setAttribute(
      "position",
      new Float32BufferAttribute(this.positions, 3),
    );
    this.geometry.setDrawRange(0, 0);
    this.mesh = new Points(
      this.geometry,
      new PointsMaterial({ color: "#e7d2a5", size: 0.13 }),
    );
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  shoot(
    owner: string,
    from: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    speed = 20,
  ) {
    if (this.arrows.length >= 128) return false;
    this.arrows.push({
      id: crypto.randomUUID(),
      owner,
      ...from,
      vx: dir.x * speed,
      vy: dir.y * speed,
      vz: dir.z * speed,
      age: 0,
      stuck: false,
    });
    return true;
  }
  update(
    dt: number,
    world: World,
    player: { x: number; y: number; z: number },
    mobs: Mob[],
    damagePlayer: (n: number) => void,
    damageMob: (m: Mob, n: number, dir: [number, number]) => void,
    pickup: () => boolean,
  ) {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.age += dt;
      let remove = a.age > 30;
      if (a.stuck) {
        if (
          a.owner === "player" &&
          a.age > 1 &&
          Math.hypot(a.x - player.x, a.y - player.y, a.z - player.z) < 1.5 &&
          pickup()
        )
          remove = true;
      } else {
        a.vy -= dt * 10;
        const steps = Math.max(
          1,
          Math.ceil((Math.hypot(a.vx, a.vy, a.vz) * dt) / 0.15),
        );
        for (let s = 0; s < steps && !a.stuck && !remove; s++) {
          a.x += (a.vx * dt) / steps;
          a.y += (a.vy * dt) / steps;
          a.z += (a.vz * dt) / steps;
          if (world.solid(a.x, a.y, a.z)) {
            a.stuck = true;
            break;
          }
          if (
            a.owner !== "player" &&
            Math.hypot(a.x - player.x, a.z - player.z) < 0.4 &&
            a.y > player.y &&
            a.y < player.y + 1.8
          ) {
            damagePlayer(4);
            remove = true;
          }
          if (a.owner === "player")
            for (const m of mobs)
              if (
                m.state !== "Dead" &&
                Math.hypot(a.x - m.x, a.z - m.z) < 0.5 &&
                a.y > m.y &&
                a.y < m.y + 1.7
              ) {
                damageMob(m, 6, [a.vx / 20, a.vz / 20]);
                remove = true;
                break;
              }
        }
      }
      if (remove) this.arrows.splice(i, 1);
    }
    this.render();
  }
  render() {
    const attribute = this.geometry.getAttribute("position");
    this.arrows.forEach((a, i) => attribute.setXYZ(i, a.x, a.y, a.z));
    attribute.needsUpdate = true;
    this.geometry.setDrawRange(0, this.arrows.length);
  }
  clear() {
    this.arrows.length = 0;
    this.geometry.setDrawRange(0, 0);
  }
}
