import {
  Group,
  Vector3,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  NearestFilter,
  Mesh,
  BoxGeometry,
  MeshLambertMaterial,
  type Scene,
} from "three";
import { PlayerModel } from "../player/models/PlayerModel";
import { SkinSyncManager } from "./SkinSyncManager";
import { block } from "../blocks/BlockRegistry";
import type { PlayerSnapshot } from "./NetworkProtocol";
type Remote = {
  group: Group;
  model?: PlayerModel;
  label: Sprite;
  held: Mesh;
  data: PlayerSnapshot;
  skinKey: string;
  target: Vector3;
  version: number;
};
export class RemotePlayerManager {
  private players = new Map<string, Remote>();
  private skins = new SkinSyncManager();
  private box = new BoxGeometry(0.22, 0.22, 0.22);
  private heldMaterial = new MeshLambertMaterial({ color: "#b2a17d" });
  constructor(private scene: Scene) {}
  get count() {
    return this.players.size;
  }
  update(snapshots: PlayerSnapshot[]) {
    const ids = new Set(snapshots.map((p) => p.id));
    for (const [id, p] of this.players) if (!ids.has(id)) this.remove(id);
    for (const data of snapshots) {
      let p = this.players.get(data.id);
      if (!p) {
        const group = new Group(),
          canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 40;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#10151bc0";
        ctx.fillRect(0, 0, 256, 40);
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.font = "22px monospace";
        ctx.fillText(data.name, 128, 28);
        const texture = new CanvasTexture(canvas);
        texture.magFilter = NearestFilter;
        const label = new Sprite(
          new SpriteMaterial({ map: texture, depthTest: true }),
        );
        label.scale.set(2.5, 0.4, 1);
        label.position.y = 2.2;
        const held = new Mesh(this.box, this.heldMaterial.clone());
        held.position.set(-0.5, 0.9, -0.3);
        group.add(label, held);
        group.position.fromArray(data.position);
        this.scene.add(group);
        p = {
          group,
          label,
          held,
          data,
          skinKey: "",
          target: new Vector3(),
          version: 0,
        };
        this.players.set(data.id, p);
      }
      p.data = data;
      p.target.fromArray(data.position);
      p.group.visible = data.mode !== "spectator";
      const key = JSON.stringify(data.skin ?? null);
      if (key !== p.skinKey) {
        p.skinKey = key;
        const version = ++p.version,
          remote = p;
        void this.skins
          .texture(data.skin)
          .then((texture) => {
            if (
              this.players.get(data.id) !== remote ||
              remote.version !== version
            )
              return;
            remote.model?.dispose();
            remote.model = new PlayerModel(
              texture,
              data.skin?.model ?? "classic",
              data.skin?.layers ?? true,
            );
            remote.group.add(remote.model);
          })
          .catch(() => {});
      }
      p.held.visible = data.held > 0;
      (p.held.material as MeshLambertMaterial).color.set(
        data.held < 100 ? block(data.held).color : "#b2a17d",
      );
    }
  }
  render(dt: number) {
    for (const p of this.players.values()) {
      if (p.group.position.distanceTo(p.target) > 8)
        p.group.position.copy(p.target);
      else p.group.position.lerp(p.target, 1 - Math.exp(-dt * 14));
      const desired = p.data.yaw + Math.PI,
        delta = Math.atan2(
          Math.sin(desired - p.group.rotation.y),
          Math.cos(desired - p.group.rotation.y),
        );
      p.group.rotation.y += delta * (1 - Math.exp(-dt * 12));
      const v = p.data.velocity;
      p.model?.animate(
        dt,
        Math.hypot(v[0], v[2]),
        v[1],
        p.data.grounded || p.data.flying,
        p.data.sneaking,
        p.data.action,
        p.data.pitch,
      );
      if (p.model) p.model.head.rotation.y = Math.max(-1, Math.min(1, delta));
      p.held.rotation.x = -p.data.action * 0.8;
    }
  }
  private remove(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    p.model?.dispose();
    p.label.material.map?.dispose();
    p.label.material.dispose();
    (p.held.material as MeshLambertMaterial).dispose();
    p.group.removeFromParent();
    this.players.delete(id);
  }
  clear() {
    for (const id of this.players.keys()) this.remove(id);
    this.skins.dispose();
  }
  dispose() {
    this.clear();
    this.skins.dispose();
    this.box.dispose();
    this.heldMaterial.dispose();
  }
}
