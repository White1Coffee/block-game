import {
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  PointsMaterial,
  Vector3,
  type Scene,
} from "three";
import type { World } from "../world/World";
export interface WeatherSave {
  kind: "clear" | "rain" | "thunder";
  remaining: number;
  cycle: number;
}
export class WeatherSystem {
  state: WeatherSave = { kind: "clear", remaining: 180, cycle: 0 };
  particles = true;
  flash = 0;
  private geometry = new BufferGeometry();
  private mesh: Points;
  private age = 0;
  private positions = new Float32Array(384 * 3);
  constructor(scene: Scene) {
    this.geometry.setAttribute(
      "position",
      new Float32BufferAttribute(this.positions, 3),
    );
    this.mesh = new Points(
      this.geometry,
      new PointsMaterial({
        color: "#9bc4d3",
        size: 0.065,
        transparent: true,
        opacity: 0.6,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  restore(state?: WeatherSave) {
    this.state = state
      ? { ...state }
      : { kind: "clear", remaining: 180, cycle: 0 };
  }
  update(
    dt: number,
    world: World,
    player: Vector3,
    active: boolean,
    sound: (kind: "rain" | "thunder") => void,
    cycleEnabled = true,
  ) {
    this.age += dt;
    this.flash = Math.max(0, this.flash - dt * 3);
    if (active && cycleEnabled) {
      this.state.remaining -= dt;
      if (this.state.remaining <= 0) {
        this.state.cycle++;
        const roll = world.generator.random(this.state.cycle, 53, 718);
        this.state.kind =
          roll < 0.55 ? "clear" : roll < 0.88 ? "rain" : "thunder";
        this.state.remaining =
          120 + world.generator.random(this.state.cycle, 71, 718) * 180;
      }
    }
    const snow = ["Sneeuwvlakte", "Taiga", "Bevroren Oceaan"].includes(
      world.generator.biome(player.x, player.z),
    );
    this.mesh.visible = active && this.particles && this.state.kind !== "clear";
    if (this.state.kind === "clear") return;
    if (Math.floor(this.age) % 3 === 0 && this.age % 3 < dt) sound("rain");
    if (
      this.state.kind === "thunder" &&
      Math.floor(this.age) % 13 === 0 &&
      this.age % 13 < dt
    ) {
      this.flash = 1;
      sound("thunder");
    }
    const attr = this.geometry.getAttribute("position");
    for (let i = 0; i < 384; i++) {
      const x = player.x + ((i * 13.71) % 28) - 14,
        z = player.z + ((i * 7.33) % 28) - 14,
        y =
          player.y +
          ((((i * 0.391 - this.age * (snow ? 1.2 : 13)) % 18) + 18) % 18) -
          2;
      const covered = world.lighting?.sample(x, y, z).sky === 0;
      attr.setXYZ(i, x, covered ? player.y - 20 : y, z);
    }
    attr.needsUpdate = true;
    (this.mesh.material as PointsMaterial).color.set(
      snow ? "#e8f1f1" : "#8bb9ce",
    );
    (this.mesh.material as PointsMaterial).size = snow ? 0.12 : 0.065;
  }
  serialize() {
    return { ...this.state };
  }
}
