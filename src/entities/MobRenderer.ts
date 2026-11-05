import {
  Group,
  Mesh,
  BoxGeometry,
  MeshLambertMaterial,
  Color,
  type Scene,
} from "three";
import { mobDefinitions, type Mob } from "./MobSystem";
export class MobRenderer {
  private roots = new Map<
    string,
    { group: Group; legs: Mesh[]; health: Mesh }
  >();
  private cube = new BoxGeometry(1, 1, 1);
  private materials = new Map<string, MeshLambertMaterial>();
  constructor(private scene: Scene) {}
  private material(color: string) {
    let m = this.materials.get(color);
    if (!m) {
      m = new MeshLambertMaterial({ color });
      this.materials.set(color, m);
    }
    return m;
  }
  private create(mob: Mob) {
    const group = new Group(),
      legs: Mesh[] = [];
    const colors = {
      cow: "#86674f",
      pig: "#ce8a87",
      sheep: "#d6d1bd",
      chicken: "#e1d7b1",
      hollow: "#63876b",
      bonewalker: "#c2baa0",
      burster: "#8b9864",
      crawler: "#564c54",
    };
    const color = colors[mob.kind],
      passive = !mobDefinitions[mob.kind].hostile;
    const part = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      c = color,
    ) => {
      const mesh = new Mesh(this.cube, this.material(c));
      mesh.position.set(x, y, z);
      mesh.scale.set(w, h, d);
      mesh.castShadow = true;
      group.add(mesh);
      return mesh;
    };
    if (passive) {
      const chicken = mob.kind === "chicken";
      part(
        0,
        0.65,
        0,
        chicken ? 0.4 : 0.8,
        chicken ? 0.4 : 0.65,
        chicken ? 0.45 : 1.1,
      );
      part(0, chicken ? 0.95 : 0.95, chicken ? 0.25 : 0.65, 0.4, 0.45, 0.4);
      for (const x of [-1, 1])
        for (const z of chicken ? [0] : [-1, 1])
          legs.push(
            part(
              x * (chicken ? 0.12 : 0.26),
              0.23,
              z * 0.35,
              0.15,
              0.46,
              0.15,
              chicken ? "#bd9b50" : color,
            ),
          );
      if (mob.kind === "cow") {
        part(-0.16, 1.23, 0.68, 0.1, 0.2, 0.1, "#d3c3a3");
        part(0.16, 1.23, 0.68, 0.1, 0.2, 0.1, "#d3c3a3");
        part(-0.2, 0.65, 0.16, 0.28, 0.2, 0.3, "#eee6d6");
      }
      if (chicken) part(0, 0.95, 0.5, 0.2, 0.12, 0.15, "#d3a24d");
    } else if (mob.kind === "crawler") {
      part(0, 0.35, 0, 0.65, 0.4, 0.8);
      part(0, 0.4, 0.55, 0.5, 0.35, 0.4);
      for (let i = 0; i < 4; i++)
        for (const side of [-1, 1]) {
          const leg = part(
            side * 0.55,
            0.25,
            (i - 1.5) * 0.25,
            0.65,
            0.12,
            0.12,
          );
          leg.rotation.z = side * 0.25;
          legs.push(leg);
        }
    } else {
      part(0, 0.95, 0, 0.55, 0.65, 0.3);
      part(0, 1.5, 0.04, 0.5, 0.5, 0.5);
      for (const side of [-1, 1]) {
        legs.push(part(side * 0.16, 0.35, 0, 0.22, 0.7, 0.24));
        if (mob.kind !== "burster") {
          const arm = part(side * 0.4, 0.95, 0.2, 0.18, 0.65, 0.18);
          arm.rotation.x = -0.7;
        }
      }
    }
    part(
      -0.11,
      passive ? 0.99 : mob.kind === "crawler" ? 0.46 : 1.55,
      passive ? 0.86 : mob.kind === "crawler" ? 0.77 : 0.3,
      0.07,
      0.07,
      0.025,
      "#211f24",
    );
    part(
      0.11,
      passive ? 0.99 : mob.kind === "crawler" ? 0.46 : 1.55,
      passive ? 0.86 : mob.kind === "crawler" ? 0.77 : 0.3,
      0.07,
      0.07,
      0.025,
      "#211f24",
    );
    const health = part(0, 2, 0, 0.7, 0.05, 0.02, "#b55349");
    health.visible = false;
    this.scene.add(group);
    const entry = { group, legs, health };
    this.roots.set(mob.id, entry);
    return entry;
  }
  update(mobs: Mob[], time: number) {
    const ids = new Set(mobs.map((m) => m.id));
    for (const [id, entry] of this.roots)
      if (!ids.has(id)) {
        entry.group.removeFromParent();
        this.roots.delete(id);
      }
    for (const mob of mobs) {
      const entry = this.roots.get(mob.id) ?? this.create(mob);
      entry.group.position.set(mob.x, mob.y, mob.z);
      entry.group.rotation.set(
        0,
        mob.yaw,
        mob.state === "Dead"
          ? (Math.min(1, (0.7 - mob.timer) * 3) * Math.PI) / 2
          : 0,
      );
      entry.group.scale.setScalar(
        mob.kind === "burster" && mob.fuse > 0
          ? 1 + Math.sin(time * 25) * 0.1
          : mob.hurt > 0
            ? 1.05
            : 1,
      );
      entry.legs.forEach(
        (leg, i) =>
          (leg.rotation.x = ["Wander", "Chase", "Flee"].includes(mob.state)
            ? Math.sin(time * 8 + (i % 2) * Math.PI) * 0.5
            : Math.sin(time * 2) * 0.025),
      );
      entry.health.visible =
        mob.health < mobDefinitions[mob.kind].health && mob.state !== "Dead";
      entry.health.scale.x =
        0.7 * Math.max(0, mob.health / mobDefinitions[mob.kind].health);
    }
  }
  clear() {
    for (const e of this.roots.values()) e.group.removeFromParent();
    this.roots.clear();
  }
}
