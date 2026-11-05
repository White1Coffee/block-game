import {
  BoxGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  DoubleSide,
  type Texture,
} from "three";
import { skinRects, type SkinVariant } from "../skins/SkinFormat";
export function skinBox(
  w: number,
  h: number,
  d: number,
  u: number,
  v: number,
  inflate = 0,
) {
  const geometry = new BoxGeometry(w + inflate, h + inflate, d + inflate),
    uv = geometry.getAttribute("uv"),
    rects = skinRects(u, v, w, h, d);
  rects.forEach(([x, y, rw, rh], face) => {
    const bottom = face === 3;
    const coords = bottom
      ? [
          [x, y + rh],
          [x + rw, y + rh],
          [x, y],
          [x + rw, y],
        ]
      : [
          [x, y],
          [x + rw, y],
          [x, y + rh],
          [x + rw, y + rh],
        ];
    coords.forEach(([a, b], i) => uv.setXY(face * 4 + i, a / 64, 1 - b / 64));
  });
  return geometry;
}
export class PlayerModel extends Group {
  readonly head = new Group();
  readonly torso = new Group();
  readonly rightArm = new Group();
  readonly leftArm = new Group();
  readonly rightLeg = new Group();
  readonly leftLeg = new Group();
  readonly overlays: Mesh[] = [];
  private materials: MeshLambertMaterial[];
  private phase = 0;
  constructor(
    texture: Texture,
    public variant: SkinVariant = "classic",
    layers = true,
  ) {
    super();
    this.name = "player";
    this.scale.setScalar(2 / 32);
    this.materials = [
      new MeshLambertMaterial({ map: texture, alphaTest: 0.01 }),
      new MeshLambertMaterial({
        map: texture,
        alphaTest: 0.01,
        transparent: true,
        side: DoubleSide,
      }),
    ];
    const aw = variant === "slim" ? 3 : 4;
    const part = (
      pivot: Group,
      x: number,
      y: number,
      w: number,
      h: number,
      d: number,
      u: number,
      v: number,
      ou: number,
      ov: number,
      cy: number,
      inflate = 0.5,
    ) => {
      pivot.position.set(x, y, 0);
      for (let layer = 0; layer < 2; layer++) {
        const mesh = new Mesh(
          skinBox(w, h, d, layer ? ou : u, layer ? ov : v, layer ? inflate : 0),
          this.materials[layer],
        );
        mesh.position.y = cy;
        mesh.castShadow = true;
        pivot.add(mesh);
        if (layer) {
          mesh.visible = layers;
          this.overlays.push(mesh);
        }
      }
      this.add(pivot);
    };
    part(this.head, 0, 24, 8, 8, 8, 0, 0, 32, 0, 4, 1);
    part(this.torso, 0, 24, 8, 12, 4, 16, 16, 16, 32, -6);
    part(this.rightArm, -4 - aw / 2, 22, aw, 12, 4, 40, 16, 40, 32, -4);
    part(this.leftArm, 4 + aw / 2, 22, aw, 12, 4, 32, 48, 48, 48, -4);
    part(this.rightLeg, -2, 12, 4, 12, 4, 0, 16, 0, 32, -6);
    part(this.leftLeg, 2, 12, 4, 12, 4, 16, 48, 0, 48, -6);
  }
  setLayers(visible: boolean) {
    this.overlays.forEach((o) => (o.visible = visible));
  }
  animate(
    dt: number,
    speed: number,
    vertical: number,
    grounded: boolean,
    sneak: boolean,
    swing: number,
    pitch: number,
  ) {
    this.phase += dt * (speed > 5 ? 12 : 8);
    const stride = Math.sin(this.phase) * Math.min(speed / 5, 1) * 0.72;
    const blend = 1 - Math.exp(-dt * 16);
    const targets = [stride, -stride, -stride, stride];
    [this.rightArm, this.leftArm, this.rightLeg, this.leftLeg].forEach(
      (part, i) => {
        let angle = targets[i];
        if (!grounded) {
          angle = i < 2 ? -0.15 : vertical > 0 ? -0.28 : 0.18;
        }
        if (i === 0 && swing > 0) angle = -Math.sin(swing * Math.PI) * 1.8;
        part.rotation.x += (angle - part.rotation.x) * blend;
      },
    );
    this.rightArm.rotation.z = -0.035 - Math.sin(this.phase * 0.4) * 0.025;
    this.leftArm.rotation.z = -this.rightArm.rotation.z;
    this.torso.rotation.x +=
      ((sneak ? 0.35 : 0) - this.torso.rotation.x) * blend;
    this.head.rotation.x = -Math.max(-1.2, Math.min(1.2, pitch));
    this.head.position.y = 24 - (sneak ? 3 : 0);
    this.torso.position.y = 24 - (sneak ? 3 : 0);
    this.rightArm.position.y = this.leftArm.position.y = 22 - (sneak ? 3 : 0);
  }
  createFirstPersonArm() {
    const arm = new Group(),
      width = this.variant === "slim" ? 3 : 4;
    for (let i = 0; i < 2; i++) {
      const mesh = new Mesh(
        skinBox(width, 12, 4, 40, i ? 32 : 16, i ? 0.5 : 0),
        this.materials[i],
      );
      mesh.scale.setScalar(0.035);
      mesh.rotation.set(-0.22, Math.PI + 0.25, -0.1);
      mesh.position.set(0.34, -0.32, -0.55);
      mesh.visible = i === 0 || this.overlays[0].visible;
      arm.add(mesh);
    }
    return arm;
  }
  dispose() {
    this.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    this.materials.forEach((m) => m.dispose());
    this.removeFromParent();
  }
}
