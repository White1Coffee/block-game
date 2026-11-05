import type { World } from "../world/World";
import { EventBus } from "../core/EventBus";
export type MobKind =
  | "cow"
  | "pig"
  | "sheep"
  | "chicken"
  | "hollow"
  | "bonewalker"
  | "burster"
  | "crawler";
export type MobState =
  | "Idle"
  | "Wander"
  | "Investigate"
  | "Chase"
  | "Attack"
  | "Flee"
  | "Dead";
export interface Mob {
  id: string;
  kind: MobKind;
  state: MobState;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  health: number;
  timer: number;
  cooldown: number;
  hurt: number;
  target?: [number, number];
  path?: [number, number][];
  pathTimer: number;
  age: number;
  fuse: number;
}
export const mobDefinitions: Record<
  MobKind,
  {
    health: number;
    hostile: boolean;
    speed: number;
    damage: number;
    loot: [number, number][];
    xp: number;
  }
> = {
  cow: {
    health: 10,
    hostile: false,
    speed: 1,
    damage: 0,
    loot: [
      [121, 2],
      [127, 1],
    ],
    xp: 3,
  },
  pig: {
    health: 10,
    hostile: false,
    speed: 1.1,
    damage: 0,
    loot: [[123, 2]],
    xp: 3,
  },
  sheep: {
    health: 8,
    hostile: false,
    speed: 1,
    damage: 0,
    loot: [[39, 2]],
    xp: 3,
  },
  chicken: {
    health: 4,
    hostile: false,
    speed: 1.3,
    damage: 0,
    loot: [
      [125, 1],
      [128, 2],
    ],
    xp: 2,
  },
  hollow: {
    health: 20,
    hostile: true,
    speed: 1.5,
    damage: 3,
    loot: [[105, 1]],
    xp: 5,
  },
  bonewalker: {
    health: 16,
    hostile: true,
    speed: 1.3,
    damage: 3,
    loot: [
      [129, 2],
      [115, 3],
    ],
    xp: 6,
  },
  burster: {
    health: 16,
    hostile: true,
    speed: 1.5,
    damage: 6,
    loot: [[130, 2]],
    xp: 5,
  },
  crawler: {
    health: 14,
    hostile: true,
    speed: 2,
    damage: 2,
    loot: [[114, 2]],
    xp: 5,
  },
};
export function mobBlocked(
  world: Pick<World, "solid">,
  x: number,
  y: number,
  z: number,
  height = 1.4,
) {
  for (let by = Math.floor(y + 0.01); by <= Math.floor(y + height - 0.01); by++)
    for (let bx = Math.floor(x - 0.32); bx <= Math.floor(x + 0.32); bx++)
      for (let bz = Math.floor(z - 0.32); bz <= Math.floor(z + 0.32); bz++)
        if (world.solid(bx, by, bz)) return true;
  return false;
}
/** Bounded A*: one-block steps, no diagonal corner cutting, maximum 96 visits. */
export function findPath(
  world: Pick<World, "solid">,
  start: [number, number, number],
  goal: [number, number, number],
): [number, number][] {
  const nodes = [
      {
        x: Math.floor(start[0]),
        y: Math.floor(start[1]),
        z: Math.floor(start[2]),
        g: 0,
        parent: -1,
      },
    ],
    open = [0],
    visited = new Set<string>();
  let best = 0,
    bestD = Infinity;
  for (let iteration = 0; iteration < 96 && open.length; iteration++) {
    open.sort(
      (a, b) =>
        nodes[a].g +
        Math.abs(nodes[a].x - goal[0]) +
        Math.abs(nodes[a].z - goal[2]) -
        nodes[b].g -
        Math.abs(nodes[b].x - goal[0]) -
        Math.abs(nodes[b].z - goal[2]),
    );
    const index = open.shift()!,
      node = nodes[index],
      key = `${node.x},${node.z}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const distance = Math.hypot(node.x - goal[0], node.z - goal[2]);
    if (distance < bestD) {
      bestD = distance;
      best = index;
    }
    if (distance < 1.5) break;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const x = node.x + dx,
        z = node.z + dz;
      if (visited.has(`${x},${z}`)) continue;
      let y = node.y;
      for (const dy of [0, 1, -1]) {
        const ny = node.y + dy;
        if (
          world.solid(x, ny - 1, z) &&
          !mobBlocked(world, x + 0.5, ny, z + 0.5)
        ) {
          y = ny;
          break;
        }
      }
      if (!world.solid(x, y - 1, z) || mobBlocked(world, x + 0.5, y, z + 0.5))
        continue;
      nodes.push({ x, y, z, g: node.g + 1, parent: index });
      open.push(nodes.length - 1);
    }
  }
  const path: [number, number][] = [];
  while (best > 0) {
    const n = nodes[best];
    path.unshift([n.x + 0.5, n.z + 0.5]);
    best = n.parent;
  }
  return path.slice(0, 24);
}
export interface MobHooks {
  damage: (amount: number, source: Mob, knock: [number, number]) => void;
  shoot: (mob: Mob) => void;
  explode: (mob: Mob) => void;
  drop: (id: number, count: number, p: number[]) => void;
  xp: (amount: number, p: number[]) => void;
  light: (x: number, y: number, z: number) => number;
  sound: (kind: MobKind) => void;
}
export class MobSystem {
  readonly mobs: Mob[] = [];
  readonly events = new EventBus<{
    type: "spawn" | "damage" | "death";
    id: string;
    amount?: number;
  }>();
  maxMobs = 24;
  doMobSpawning = true;
  doMobLoot = true;
  targetable = true;
  allowNaturalHostiles = true;
  simulationDistance = 48;
  private accumulator = 0;
  private spawnClock = 0;
  private serial = 0;
  constructor(private hooks: MobHooks) {}
  spawn(kind: MobKind, x: number, y: number, z: number) {
    if (this.mobs.length >= this.maxMobs) return null;
    const mob: Mob = {
      id: crypto.randomUUID(),
      kind,
      state: "Idle",
      x,
      y,
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: 0,
      health: mobDefinitions[kind].health,
      timer: 1,
      cooldown: 0,
      hurt: 0,
      pathTimer: 0,
      age: 0,
      fuse: 0,
    };
    this.mobs.push(mob);
    this.events.emit({ type: "spawn", id: mob.id });
    return mob;
  }
  restore(mobs: Mob[] = []) {
    this.mobs.splice(0);
    this.mobs.push(...structuredClone(mobs).slice(0, 128));
  }
  hurt(mob: Mob, amount: number, knock: [number, number]) {
    if (mob.state === "Dead" || mob.hurt > 0) return false;
    mob.health -= amount;
    mob.hurt = 0.4;
    mob.vx = knock[0] * 4;
    mob.vz = knock[1] * 4;
    mob.vy = 3;
    mob.state = mobDefinitions[mob.kind].hostile ? "Chase" : "Flee";
    mob.timer = 3;
    this.events.emit({ type: "damage", id: mob.id, amount });
    if (mob.health <= 0) {
      mob.state = "Dead";
      mob.timer = 0.7;
      if (this.doMobLoot)
        for (const [id, n] of mobDefinitions[mob.kind].loot)
          this.hooks.drop(id, n, [mob.x, mob.y + 0.5, mob.z]);
      if (this.doMobLoot)
        this.hooks.xp(mobDefinitions[mob.kind].xp, [mob.x, mob.y + 0.6, mob.z]);
      this.events.emit({ type: "death", id: mob.id });
    }
    return true;
  }
  update(
    world: World,
    dt: number,
    player: { x: number; y: number; z: number },
    night: boolean,
    peaceful: boolean,
    targets?: { x: number; y: number; z: number }[],
    observers?: { x: number; y: number; z: number }[],
  ) {
    this.accumulator += dt;
    if (this.accumulator < 0.1) return;
    dt = this.accumulator;
    this.accumulator = 0;
    if (this.mobs.length > this.maxMobs) this.mobs.splice(this.maxMobs);
    this.spawnClock = this.doMobSpawning ? this.spawnClock + dt : 0;
    if (this.spawnClock > 4 && this.mobs.length < this.maxMobs) {
      this.spawnClock = 0;
      const serial = ++this.serial,
        angle = world.generator.random(serial, 7, 314) * Math.PI * 2,
        radius = 12 + world.generator.random(serial, 9, 314) * 18,
        x = Math.floor(player.x + Math.cos(angle) * radius) + 0.5,
        z = Math.floor(player.z + Math.sin(angle) * radius) + 0.5;
      let y = world.generator.height(x, z) + 1;
      if (player.y < y - 5) {
        y = Math.floor(player.y);
        for (let dy = 0; dy < 5; dy++) if (!world.solid(x, y - 1, z)) y--;
      }
      const biome = world.generator.biome(x, z),
        hostile =
          this.allowNaturalHostiles &&
          !peaceful &&
          this.hooks.light(x, y, z) < 8;
      const kinds: MobKind[] = hostile
        ? ["hollow", "bonewalker", "burster", "crawler"]
        : biome.includes("Woestijn") ||
            biome === "Badlands" ||
            biome.includes("Oceaan")
          ? []
          : biome.includes("Sneeuw") || biome === "Taiga"
            ? ["sheep"]
            : ["cow", "pig", "sheep", "chicken"];
      if (
        !hostile &&
        this.mobs.filter((m) => !mobDefinitions[m.kind].hostile).length >=
          Math.max(1, Math.floor(this.maxMobs * 0.55))
      )
        kinds.length = 0;
      if (
        kinds.length &&
        world.solid(x, y - 1, z) &&
        !mobBlocked(world, x, y, z)
      )
        this.spawn(kinds[serial % kinds.length], x, y, z);
    }
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      if (targets?.length)
        player = targets.reduce((closest, target) =>
          Math.hypot(target.x - this.mobs[i].x, target.z - this.mobs[i].z) <
          Math.hypot(closest.x - this.mobs[i].x, closest.z - this.mobs[i].z)
            ? target
            : closest,
        );
      const m = this.mobs[i],
        def = mobDefinitions[m.kind],
        distance = Math.hypot(m.x - player.x, m.z - player.z);
      const simulationDistance = observers?.length
        ? Math.min(...observers.map((p) => Math.hypot(m.x - p.x, m.z - p.z)))
        : distance;
      m.age += dt;
      if (
        simulationDistance > 96 ||
        (peaceful && def.hostile) ||
        (m.state === "Dead" && (m.timer -= dt) <= 0)
      ) {
        this.mobs.splice(i, 1);
        continue;
      }
      if (simulationDistance > this.simulationDistance || m.state === "Dead")
        continue;
      m.cooldown = Math.max(0, m.cooldown - dt);
      m.hurt = Math.max(0, m.hurt - dt);
      m.timer -= dt;
      m.pathTimer -= dt;
      const visible =
        this.targetable &&
        distance < 20 &&
        Math.abs(m.y - player.y) < 8 &&
        this.lineOfSight(world, m, player);
      if (def.hostile && visible) {
        m.state =
          distance < (m.kind === "bonewalker" ? 10 : 1.6) ? "Attack" : "Chase";
        m.target = [player.x, player.z];
      } else if (def.hostile && ["Chase", "Attack"].includes(m.state)) {
        m.state = "Investigate";
        m.timer = 2;
      }
      if (m.state === "Attack" && visible && m.cooldown === 0) {
        if (m.kind === "bonewalker") {
          this.hooks.shoot(m);
          m.cooldown = 2;
        } else if (m.kind === "burster") {
          m.fuse += dt;
          if (m.fuse > 1.5) {
            this.hooks.explode(m);
            m.state = "Dead";
            m.timer = 0.4;
          }
        } else {
          this.hooks.damage(def.damage, m, [
            (player.x - m.x) / Math.max(distance, 0.1),
            (player.z - m.z) / Math.max(distance, 0.1),
          ]);
          m.cooldown = 1;
        }
      } else if (m.kind === "burster" && distance > 3) m.fuse = 0;
      if (m.timer <= 0 && !["Chase", "Attack"].includes(m.state)) {
        m.state = m.state === "Idle" ? "Wander" : "Idle";
        m.timer = 2 + world.generator.random(Math.floor(m.age), i, 71) * 4;
        const angle =
          world.generator.random(Math.floor(m.age), i, 73) * Math.PI * 2;
        m.target = [m.x + Math.cos(angle) * 5, m.z + Math.sin(angle) * 5];
        this.hooks.sound(m.kind);
      }
      let dx = 0,
        dz = 0;
      if (m.state === "Flee") {
        dx = m.x - player.x;
        dz = m.z - player.z;
      } else if (
        ["Chase", "Investigate", "Wander"].includes(m.state) &&
        m.target
      ) {
        if (m.pathTimer <= 0) {
          m.path = findPath(
            world,
            [m.x, m.y, m.z],
            [m.target[0], player.y, m.target[1]],
          );
          m.pathTimer = 0.8 + i * 0.02;
        }
        const target = m.path?.[0] ?? m.target;
        dx = target[0] - m.x;
        dz = target[1] - m.z;
        if (Math.hypot(dx, dz) < 0.4) m.path?.shift();
      }
      const length = Math.hypot(dx, dz);
      if (length > 0.05) {
        dx = (dx / length) * def.speed * (m.state === "Flee" ? 2 : 1);
        dz = (dz / length) * def.speed * (m.state === "Flee" ? 2 : 1);
        m.yaw = Math.atan2(dx, dz);
      }
      if (m.hurt > 0) {
        dx += m.vx;
        dz += m.vz;
      }
      for (const axis of ["x", "z"] as const) {
        const amount = (axis === "x" ? dx : dz) * dt,
          next = m[axis] + amount;
        if (
          !mobBlocked(
            world,
            axis === "x" ? next : m.x,
            m.y,
            axis === "z" ? next : m.z,
          )
        )
          m[axis] = next;
        else if (
          !mobBlocked(
            world,
            axis === "x" ? next : m.x,
            m.y + 1,
            axis === "z" ? next : m.z,
          ) &&
          world.solid(axis === "x" ? next : m.x, m.y, axis === "z" ? next : m.z)
        ) {
          m.y += 1;
          m[axis] = next;
        }
      }
      m.vy = Math.max(-12, m.vy - dt * 20);
      const steps = Math.max(1, Math.ceil(Math.abs(m.vy * dt) / 0.2));
      for (let step = 0; step < steps; step++) {
        const ny = m.y + (m.vy * dt) / steps;
        if (!mobBlocked(world, m.x, ny, m.z)) m.y = ny;
        else {
          m.vy = 0;
          break;
        }
      }
    }
  }
  lineOfSight(
    world: Pick<World, "solid">,
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
  ) {
    const distance = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z),
      steps = Math.ceil(distance / 0.2);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (
        world.solid(
          from.x + (to.x - from.x) * t,
          from.y + 1 + (to.y - from.y) * t,
          from.z + (to.z - from.z) * t,
        )
      )
        return false;
    }
    return true;
  }
  serialize() {
    return structuredClone(this.mobs);
  }
}
