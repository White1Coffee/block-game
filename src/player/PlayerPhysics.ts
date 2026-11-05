import { Vector3 } from "three";
import type { World } from "../world/World";
export const PLAYER_RADIUS = 0.5,
  PLAYER_HEIGHT = 2;
export const playerEyeHeight = (sneaking: boolean) => (sneaking ? 1.42 : 1.8);
export class PlayerPhysics {
  position = new Vector3(8, 50, 8);
  velocity = new Vector3();
  knockback = new Vector3();
  grounded = false;
  flying = false;
  noclip = false;
  sneaking = false;
  swimming = false;
  climbing = false;
  get height() {
    return this.sneaking ? 1.5 : PLAYER_HEIGHT;
  }
  constructor(
    private world: Pick<World, "solid"> &
      Partial<Pick<World, "collisionBoxes">>,
  ) {}
  intersects(x: number, y: number, z: number) {
    return (
      this.position.x + PLAYER_RADIUS > x &&
      this.position.x - PLAYER_RADIUS < x + 1 &&
      this.position.y + this.height > y &&
      this.position.y < y + 1 &&
      this.position.z + PLAYER_RADIUS > z &&
      this.position.z - PLAYER_RADIUS < z + 1
    );
  }
  collides(p: Vector3) {
    if (this.noclip) return false;
    for (
      let y = Math.floor(p.y + 0.00001) - 1;
      y <= Math.floor(p.y + this.height - 0.00001);
      y++
    )
      for (
        let z = Math.floor(p.z - PLAYER_RADIUS + 0.00001);
        z <= Math.floor(p.z + PLAYER_RADIUS - 0.00001);
        z++
      )
        for (
          let x = Math.floor(p.x - PLAYER_RADIUS + 0.00001);
          x <= Math.floor(p.x + PLAYER_RADIUS - 0.00001);
          x++
        ) {
          if (this.world.collisionBoxes) {
            for (const [a, b, c, d, e, f] of this.world.collisionBoxes(x, y, z))
              if (
                p.x + PLAYER_RADIUS > a + 0.00001 &&
                p.x - PLAYER_RADIUS < d - 0.00001 &&
                p.y + this.height > b + 0.00001 &&
                p.y < e - 0.00001 &&
                p.z + PLAYER_RADIUS > c + 0.00001 &&
                p.z - PLAYER_RADIUS < f - 0.00001
              )
                return true;
          } else if (
            this.world.solid(x, y, z) &&
            y >= Math.floor(p.y + 0.00001)
          )
            return true;
        }
    return false;
  }
  step(dt: number, move: Vector3, jump: boolean) {
    if (this.noclip) {
      this.flying = true;
      this.grounded = false;
      this.velocity.copy(move);
      this.position.addScaledVector(move, dt);
      return;
    }
    this.velocity.x = move.x + this.knockback.x;
    this.velocity.z = move.z + this.knockback.z;
    this.knockback.multiplyScalar(Math.exp(-dt * 7));
    if (this.flying) this.velocity.y = move.y;
    else if (this.climbing) {
      this.velocity.y = this.sneaking ? -2 : move.z || move.x || jump ? 3 : 0;
    } else if (this.swimming) {
      this.velocity.y = jump ? 3 : Math.max(-3, this.velocity.y - 5 * dt);
    } else {
      if (jump && this.grounded) this.velocity.y = 8.2;
      this.velocity.y = Math.max(-35, this.velocity.y - 24 * dt);
    }
    const wasGrounded = this.grounded;
    const delta = this.velocity.clone().multiplyScalar(dt),
      steps = Math.max(1, Math.ceil(delta.length() / 0.18));
    delta.divideScalar(steps);
    this.grounded = false;
    for (let i = 0; i < steps; i++)
      for (const axis of ["x", "z", "y"] as const) {
        const amount = delta[axis];
        if (!amount) continue;
        const before = this.position[axis];
        this.position[axis] += amount;
        if (this.collides(this.position)) {
          if (axis !== "y" && wasGrounded && !this.flying) {
            const step = this.position.clone();
            step.y += 0.6;
            if (!this.collides(step)) {
              const support = step.clone();
              support.y -= 0.61;
              if (this.collides(support)) {
                this.position.copy(step);
                continue;
              }
            }
          }
          const sign = Math.sign(amount);
          let lo = 0,
            hi = Math.abs(amount);
          this.position[axis] = before;
          for (let j = 0; j < 10; j++) {
            const mid = (lo + hi) / 2;
            this.position[axis] = before + sign * mid;
            if (this.collides(this.position)) hi = mid;
            else lo = mid;
          }
          this.position[axis] = before + sign * lo;
          if (axis === "y" && amount < 0) this.grounded = true;
          this.velocity[axis] = 0;
          delta[axis] = 0;
        } else if (
          axis !== "y" &&
          this.sneaking &&
          !this.flying &&
          wasGrounded
        ) {
          const below = this.position.clone();
          below.y -= 0.15;
          if (!this.collides(below)) this.position[axis] = before;
        }
      }
  }
}
