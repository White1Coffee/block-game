import { describe, it, expect } from "vitest";
import { Vector3 } from "three";
import { PlayerPhysics } from "../src/player/PlayerPhysics";
import { PlayerController } from "../src/player/PlayerController";
const ground = { solid: (_x: number, y: number, _z: number) => y < 1 };
describe("player physics", () => {
  it("uses an exact one-block-wide, two-block-high standing hitbox", () => {
    const p = new PlayerPhysics(ground);
    p.position.set(0.5, 1, 0.5);
    expect(p.height).toBe(2);
    expect(p.intersects(1, 1, 0)).toBe(false);
    expect(p.intersects(0, 3, 0)).toBe(false);
    p.position.x += 0.001;
    expect(p.intersects(1, 1, 0)).toBe(true);
    expect(p.intersects(0, 2, 0)).toBe(true);
  });
  it("walks through an exactly one-by-two tunnel without snagging its edges", () => {
    const p = new PlayerPhysics({
      solid: (x, y) => y < 1 || y >= 3 || x < 0 || x >= 1,
    });
    p.position.set(0.5, 1, 0.5);
    for (let i = 0; i < 120; i++) p.step(1 / 60, new Vector3(0, 0, 4), false);
    expect(p.position.x).toBe(0.5);
    expect(p.position.z).toBeGreaterThan(8);
    expect(p.position.y).toBeCloseTo(1, 3);
  });
  it("keeps sneaking under a low ceiling until there is standing room", () => {
    const p = new PlayerPhysics({
      solid: () => false,
      collisionBoxes: () => [[0, 2.5, 0, 1, 3, 1]],
    });
    const input = new PlayerController();
    p.position.set(0.5, 1, 0.5);
    p.sneaking = true;
    input.update(p, 1 / 60);
    expect(p.sneaking).toBe(true);
    expect(p.collides(p.position)).toBe(false);
  });
  it("lands on terrain and can jump", () => {
    const p = new PlayerPhysics(ground);
    p.position.set(0.5, 4, 0.5);
    for (let i = 0; i < 120; i++) p.step(1 / 60, new Vector3(), false);
    expect(p.position.y).toBeCloseTo(1, 3);
    expect(p.grounded).toBe(true);
    p.step(1 / 60, new Vector3(), true);
    expect(p.position.y).toBeGreaterThan(1);
    expect(p.velocity.y).toBeGreaterThan(0);
  });
  it("does not tunnel through a wall at high speed", () => {
    const p = new PlayerPhysics({
      solid: (x, y) => y < 1 || (x === 2 && y < 5),
    });
    p.position.set(0.5, 1, 0.5);
    p.step(0.1, new Vector3(100, 0, 0), false);
    expect(p.position.x).toBeLessThanOrEqual(1.501);
    expect(p.position.x).toBeGreaterThan(1.49);
  });
  it("flies without gravity, but keeps collisions", () => {
    const p = new PlayerPhysics(ground);
    p.position.set(0.5, 4, 0.5);
    p.flying = true;
    p.step(0.1, new Vector3(0, 9, 0), false);
    expect(p.position.y).toBeCloseTo(4.9);
    p.step(1, new Vector3(0, -20, 0), false);
    expect(p.position.y).toBeCloseTo(1, 3);
  });
  it("toggles creative flight on double space only", () => {
    const p = new PlayerPhysics(ground),
      input = new PlayerController();
    input.keyDown("Space", p, 100);
    expect(p.flying).toBe(false);
    input.keyDown("Space", p, 300);
    expect(p.flying).toBe(true);
    input.keyDown("Space", p, 900);
    expect(p.flying).toBe(true);
  });
  it("normalizes diagonal movement", () => {
    const p = new PlayerPhysics(ground),
      input = new PlayerController();
    p.position.set(0.5, 4, 0.5);
    p.flying = true;
    input.keys.add("KeyW");
    input.keys.add("KeyD");
    input.update(p, 0.1);
    expect(Math.hypot(p.velocity.x, p.velocity.z)).toBeCloseTo(9);
  });
  it("rejects placement overlapping the player", () => {
    const p = new PlayerPhysics(ground);
    p.position.set(0.5, 1, 0.5);
    expect(p.intersects(0, 1, 0)).toBe(true);
    expect(p.intersects(2, 1, 0)).toBe(false);
  });
});
