import { NetworkClient } from "./NetworkClient";
import {
  STEP,
  type ServerMessage,
  type MovementInput,
  type SelfSnapshot,
} from "./NetworkProtocol";
import type { PlayerController } from "../player/PlayerController";
import type { PlayerPhysics } from "../player/PlayerPhysics";
import type { GameMode } from "../player/GameModes";
import { Vector3 } from "three";
export class MultiplayerSession {
  readonly kind = "multiplayer";
  readonly network: NetworkClient;
  readonly revisions = new Map<string, number>();
  viewDistance = 4;
  readonly renderPosition = new Vector3();
  private pending: MovementInput[] = [];
  private seq = 0;
  private accumulator = 0;
  mode: GameMode = "creative";
  constructor(
    name: string,
    receive: (message: ServerMessage) => void,
    lost: (message: string, retry: boolean) => void,
  ) {
    this.network = new NetworkClient(
      name,
      (message) => {
        if (message.type === "welcome") {
          this.pending = [];
          this.seq = message.self.ack;
          this.accumulator = 0;
          this.revisions.clear();
          this.mode = message.self.mode;
          this.viewDistance = message.viewDistance;
        }
        receive(message);
      },
      lost,
    );
  }
  update(dt: number, input: PlayerController, player: PlayerPhysics) {
    if (!this.network.connected) return;
    this.accumulator = Math.min(0.2, this.accumulator + dt);
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP;
      const packet: MovementInput = {
        seq: ++this.seq,
        keys: [...input.keys].filter((key) =>
          [
            "KeyW",
            "KeyA",
            "KeyS",
            "KeyD",
            "Space",
            "ShiftLeft",
            "ShiftRight",
            "ControlLeft",
            "ControlRight",
          ].includes(key),
        ),
        yaw: input.yaw,
        pitch: input.pitch,
        flying: player.flying,
      };
      input.update(player, STEP);
      this.pending.push(packet);
      if (this.pending.length > 100) this.pending.shift();
      this.network.send({ type: "input", input: packet });
    }
    const target = player.position
      .clone()
      .addScaledVector(player.velocity, this.accumulator);
    if (this.renderPosition.distanceToSquared(target) > 64)
      this.renderPosition.copy(target);
    else this.renderPosition.lerp(target, 1 - Math.exp(-dt * 25));
  }
  reconcile(
    snapshot: SelfSnapshot,
    input: PlayerController,
    player: PlayerPhysics,
  ) {
    this.pending = this.pending.filter((p) => p.seq > snapshot.ack);
    this.mode = snapshot.mode;
    player.position.fromArray(snapshot.position);
    player.velocity.fromArray(snapshot.velocity);
    player.knockback.fromArray(snapshot.knockback);
    player.grounded = snapshot.grounded;
    player.sneaking = snapshot.sneaking;
    player.flying = snapshot.flying;
    player.noclip = snapshot.mode === "spectator";
    const keys = input.keys,
      yaw = input.yaw,
      pitch = input.pitch;
    for (const packet of this.pending) {
      input.keys = new Set(packet.keys);
      input.yaw = packet.yaw;
      input.pitch = packet.pitch;
      player.flying =
        snapshot.mode === "spectator" ||
        (snapshot.mode === "creative" && packet.flying);
      input.update(player, STEP);
    }
    input.keys = keys;
    input.yaw = yaw;
    input.pitch = pitch;
  }
  action(
    action:
      | "stop"
      | "mine"
      | "place"
      | "use"
      | "attack"
      | "eat"
      | "respawn"
      | "equip"
      | "enchant",
    item?: number,
    key?: string,
  ) {
    return this.network.send({
      type: "action",
      tx: crypto.randomUUID(),
      action,
      item,
      key,
    });
  }
  close() {
    this.network.close();
    this.pending = [];
    this.revisions.clear();
  }
}
