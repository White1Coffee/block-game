import { Vector3 } from "three";
import type { PlayerPhysics } from "./PlayerPhysics";
export class PlayerController {
  keys = new Set<string>();
  yaw = 0;
  pitch = 0;
  sensitivity = 0.002;
  canSprint = true;
  bindings: Record<string, string> = {
    KeyW: "KeyW",
    KeyA: "KeyA",
    KeyS: "KeyS",
    KeyD: "KeyD",
    Space: "Space",
    ShiftLeft: "ShiftLeft",
    ControlLeft: "ControlLeft",
    KeyE: "KeyE",
    F5: "F5",
    KeyF: "KeyF",
  };
  resolve(code: string) {
    if (code === "ShiftRight") code = "ShiftLeft";
    if (code === "ControlRight") code = "ControlLeft";
    return (
      Object.keys(this.bindings).find(
        (action) => this.bindings[action] === code,
      ) ?? (Object.keys(this.bindings).includes(code) ? "Unbound" : code)
    );
  }
  private lastJump = -Infinity;
  clear() {
    this.keys.clear();
    this.lastJump = -Infinity;
  }
  look(dx: number, dy: number) {
    this.yaw -= dx * this.sensitivity;
    this.pitch = Math.max(
      -1.55,
      Math.min(1.55, this.pitch - dy * this.sensitivity),
    );
  }
  keyDown(
    code: string,
    player: PlayerPhysics,
    time: number,
    allowFlight = true,
  ) {
    this.keys.add(code);
    if (code === "Space") {
      if (allowFlight && time - this.lastJump < 300) {
        player.flying = !player.flying;
        player.velocity.y = 0;
        this.lastJump = -Infinity;
      } else this.lastJump = time;
    }
  }
  update(player: PlayerPhysics, dt: number) {
    const k = this.keys;
    let x = Number(k.has("KeyD")) - Number(k.has("KeyA")),
      z = Number(k.has("KeyS")) - Number(k.has("KeyW"));
    const length = Math.hypot(x, z);
    if (length > 0) {
      x /= length;
      z /= length;
    }
    player.sneaking = k.has("ShiftLeft") || k.has("ShiftRight");
    if (!player.sneaking && player.collides(player.position))
      player.sneaking = true;
    const sprint =
      this.canSprint && (k.has("ControlLeft") || k.has("ControlRight"));
    const speed = player.flying
      ? sprint
        ? 16
        : 9
      : player.sneaking
        ? 1.7
        : sprint
          ? 7
          : 4.4;
    const move = new Vector3(
      (x * Math.cos(this.yaw) + z * Math.sin(this.yaw)) * speed,
      player.flying
        ? (Number(k.has("Space")) - Number(player.sneaking)) * speed
        : 0,
      (-x * Math.sin(this.yaw) + z * Math.cos(this.yaw)) * speed,
    );
    player.step(dt, move, k.has("Space"));
  }
}
