import type { World } from "./World";
const flammable = new Set([
  7, 8, 9, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 44, 45,
  48, 49, 68, 69, 70,
]);
const neighbors = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
/** Bounded deterministic fire ticks. Disabling doFireTick freezes both spread and ages. */
export class FireSystem {
  ages: Record<string, number> = {};
  private clock = 0;
  private unsubscribe: () => void;
  constructor(
    private world: World,
    saved: Record<string, number> = {},
  ) {
    for (const change of world.changes.values())
      if (change.id === 66)
        this.ages[`${change.x},${change.y},${change.z}`] =
          saved[`${change.x},${change.y},${change.z}`] ?? 0;
    this.unsubscribe = world.events.subscribe(({ change: c }) => {
      const key = `${c.x},${c.y},${c.z}`;
      if (c.id === 66) this.ages[key] ??= 0;
      else delete this.ages[key];
    });
  }
  dispose() {
    this.unsubscribe();
  }
  tick(
    dt: number,
    enabled: boolean,
    player: { x: number; z: number },
    distance: number,
    centers?: { x: number; z: number }[],
  ) {
    if (!enabled) return;
    this.clock += dt;
    if (this.clock < 1) return;
    this.clock = 0;
    let visited = 0,
      edits = 0;
    for (const key of Object.keys(this.ages)) {
      const [x, y, z] = key.split(",").map(Number);
      if (
        !(centers ?? [player]).some(
          (p) => Math.hypot(x - p.x, z - p.z) <= distance,
        )
      )
        continue;
      if (++visited > 64 || edits >= 16) break;
      if (this.world.get(x, y, z) !== 66) {
        delete this.ages[key];
        continue;
      }
      const age = ++this.ages[key];
      if (age >= 12) {
        this.world.set(x, y, z, 0);
        edits++;
        continue;
      }
      if (age % 3 !== 0) continue;
      for (const [dx, dy, dz] of neighbors) {
        const bx = x + dx,
          by = y + dy,
          bz = z + dz;
        if (flammable.has(this.world.get(bx, by, bz))) {
          // Burn the fuel cell and replace it with fire; no automatic item drops.
          this.world.set(bx, by, bz, 66);
          edits++;
          break;
        }
      }
    }
  }
}
