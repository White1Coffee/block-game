import { describe, it, expect } from "vitest";
import { World } from "../src/world/World";
import { WorldGenerator } from "../src/world/WorldGenerator";
import { BlockEntities } from "../src/world/BlockEntities";
import { BlockInteractionSystem } from "../src/world/BlockInteractionSystem";
import { VoxelLighting } from "../src/world/VoxelLighting";
import { PlayerPhysics } from "../src/player/PlayerPhysics";
import { Vector3,Scene } from "three";
import { ChestAnimator } from '../src/rendering/ChestAnimator';
describe("expansion world state", () => {
  it('animates a chest lid closing rather than hiding it immediately',()=>{const world=new World('lid'),scene=new Scene(),animator=new ChestAnimator(scene);animator.update(world,'1,2,3',.5);const root=scene.children[0];const open=root.rotation.x;animator.update(world,null,.016);expect(root.visible).toBe(true);expect(Math.abs(root.rotation.x)).toBeLessThan(Math.abs(open));expect(Math.abs(root.rotation.x)).toBeGreaterThan(0);});
  it("steps up stairs without tunneling through a full block", () => {
    const w = new World("stairs");
    w.chunks.set("0,0", new Uint8Array(80 * 256));
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) w.chunks.get("0,0")![x + z * 16] = 3;
    w.set(4, 1, 5, 48);
    const p = new PlayerPhysics(w);
    p.position.set(4.5, 1, 4);
    let highest = 1;
    for (let i = 0; i < 60; i++) {
      p.step(1 / 60, new Vector3(0, 0, 4), false);
      highest = Math.max(highest, p.position.y);
    }
    expect(highest).toBeGreaterThan(1.99);
    expect(p.position.z).toBeGreaterThan(6);
  });
  it("generates repeatable structures on both sides of a chunk boundary", () => {
    const g = new WorldGenerator("structure", 80, 3);
    g.height = () => 32;
    g.random = (_x, _z, salt) =>
      salt === 1901
        ? 0.1
        : salt === 1902
          ? 0.7
          : salt === 1903
            ? 0.4
            : salt === 1904
              ? 0.1
              : 0.5;
    const left = g.generate(2, 2),
      right = g.generate(3, 2);
    expect(left[13 + 4 * 16 + 37 * 256]).toBe(9);
    expect(right[1 + 4 * 16 + 37 * 256]).toBe(9);
    expect(g.generate(2, 2)).toEqual(left);
  });
  it("places and toggles two-block doors atomically", () => {
    const w = new World("door"),
      entities = new BlockEntities(),
      interactions = new BlockInteractionSystem(w, entities);
    expect(interactions.place(58, 4, 65, 4, 0)).toBe(true);
    expect(w.get(4, 66, 4)).toBe(59);
    expect(interactions.toggle(4, 66, 4)).toBe(true);
    expect(w.get(4, 65, 4)).toBe(60);
    interactions.removeDoor(4, 66, 4, 61);
    expect(w.get(4, 65, 4)).toBe(0);
    w.set(4, 66, 4, 3);
    expect(interactions.place(58, 4, 65, 4, 0)).toBe(false);
  });
  it("collides with slab height instead of a full cube", () => {
    const w = new World("slab");
    w.chunks.set("0,0", new Uint8Array(80 * 256));
    w.set(4, 4, 4, 49);
    const p = new PlayerPhysics(w);
    p.position.set(4.5, 6, 4.5);
    for (let i = 0; i < 120; i++) p.step(1 / 60, new Vector3(), false);
    expect(p.position.y).toBeCloseTo(4.5, 2);
  });
  it("grows planted crops and preserves growth state", () => {
    const w = new World("farm"),
      entities = new BlockEntities(),
      interactions = new BlockInteractionSystem(w, entities);
    w.set(4, 60, 4, 2);
    expect(interactions.till(4, 60, 4)).toBe(true);
    expect(interactions.plant(4, 61, 4)).toBe(true);
    entities.tick(41, w, { x: 4, z: 4 });
    expect(w.get(4, 61, 4)).toBe(67);
    entities.tick(41, w, { x: 4, z: 4 });
    expect(w.get(4, 61, 4)).toBe(52);
    expect(entities.serialize().crops["4,61,4"].stage).toBe(2);
  });
  it("propagates emitted light and invalidates edits", () => {
    const w = new World("light");
    for (let z = -1; z <= 1; z++)
      for (let x = -1; x <= 1; x++)
        w.chunks.set(w.key(x, z), new Uint8Array(80 * 256));
    const light = new VoxelLighting(w);
    w.set(8, 8, 8, 65);
    light.ensure(0, 0);
    expect(light.sample(9, 8, 8).light).toBe(13);
    w.set(8, 8, 8, 0);
    light.ensure(0, 0);
    expect(light.sample(9, 8, 8).light).toBe(0);
  });
});
