import {
  InstancedMesh,
  OctahedronGeometry,
  MeshBasicMaterial,
  Matrix4,
  Vector3,
  type Scene,
} from "three";
export interface XPOrb {
  id: string;
  amount: number;
  position: number[];
  age: number;
}
export class ExperienceOrbs {
  private mesh = new InstancedMesh(
    new OctahedronGeometry(0.12),
    new MeshBasicMaterial({ color: "#9ddc4c" }),
    128,
  );
  private orbs: XPOrb[] = [];
  private matrix = new Matrix4();
  constructor(scene: Scene) {
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  spawn(amount: number, position: number[]) {
    if (this.orbs.length >= 128) {
      const first = this.orbs[0];
      first.amount += amount;
      return;
    }
    this.orbs.push({
      id: crypto.randomUUID(),
      amount,
      position: [...position],
      age: 0,
    });
  }
  update(dt: number, player: Vector3, collect: (n: number) => void) {
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.age += dt;
      const p = new Vector3().fromArray(o.position),
        target = player.clone().add(new Vector3(0, 0.8, 0)),
        d = p.distanceTo(target);
      if (d < 1) {
        collect(o.amount);
        this.orbs.splice(i, 1);
      } else if (o.age > 300) this.orbs.splice(i, 1);
      else if (d < 6) {
        p.lerp(target, Math.min(1, dt * 4));
        o.position = p.toArray();
      }
    }
    this.render();
  }
  render() {
    this.mesh.count = this.orbs.length;
    this.orbs.forEach((o, i) => {
      this.matrix
        .makeRotationY(o.age * 2)
        .setPosition(
          o.position[0],
          o.position[1] + Math.sin(o.age * 4) * 0.08,
          o.position[2],
        );
      this.mesh.setMatrixAt(i, this.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  serialize() {
    return structuredClone(this.orbs);
  }
  restore(orbs: XPOrb[] = []) {
    this.orbs = structuredClone(orbs).slice(0, 128);
  }
}
