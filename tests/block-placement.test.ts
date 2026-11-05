import { expect, it } from "vitest";
import { World } from "../src/world/World";
import { BlockEntities } from "../src/world/BlockEntities";
import {
  BlockInteractionSystem,
  placementPosition,
} from "../src/world/BlockInteractionSystem";
import { PlayerPhysics } from "../src/player/PlayerPhysics";
import { raycast } from "../src/blocks/BlockInteraction";

it("places and breaks across chunk borders, without overwriting solid blocks", () => {
  const w = new World("placement");
  const interactions = new BlockInteractionSystem(w, new BlockEntities());
  for (const x of [-1, 0, 15, 16]) {
    w.set(x, 75, 0, 0);
    expect(interactions.place(9, x, 75, 0, 0)).toBe(true);
    expect(interactions.place(3, x, 75, 0, 0)).toBe(false);
    expect(w.get(x, 75, 0)).toBe(9);
    expect(w.set(x, 75, 0, 0)).toBe(true);
  }
  expect(w.dirty.has("-1,0")).toBe(true);
  expect(w.dirty.has("1,0")).toBe(true);
  w.dispose();
});

it("rejects both door halves before mutation if either overlaps a player", () => {
  const w = new World("placement");
  const interactions = new BlockInteractionSystem(w, new BlockEntities());
  w.set(0, 74, 0, 0);
  w.set(0, 75, 0, 0);
  const p = new PlayerPhysics(w);
  p.position.set(0.5, 75, 0.5);
  expect(
    interactions.place(58, 0, 74, 0, 0, [0, 1, 0], (x, y, z) =>
      p.intersects(x, y, z),
    ),
  ).toBe(false);
  expect(w.get(0, 74, 0)).toBe(0);
  expect(w.get(0, 75, 0)).toBe(0);
  w.dispose();
});

it("replaces vegetation and water but targets the adjacent face of a solid block", () => {
  const w = new World("placement");
  const interactions = new BlockInteractionSystem(w, new BlockEntities());
  const hit = {
    x: 0,
    y: 75,
    z: 0,
    normal: [0, 1, 0] as [number, number, number],
    distance: 2,
  };
  w.set(0, 75, 0, 22);
  expect(placementPosition(w, hit)).toEqual({ x: 0, y: 75, z: 0 });
  expect(interactions.place(9, 0, 75, 0, 0)).toBe(true);
  expect(placementPosition(w, hit)).toEqual({ x: 0, y: 76, z: 0 });
  w.set(0, 75, 0, 11);
  expect(interactions.place(0, 0, 75, 0, 0)).toBe(false);
  expect(interactions.place(999, 0, 75, 0, 0)).toBe(false);
  expect(w.get(0, 75, 0)).toBe(11);
  expect(interactions.place(9, 0, 75, 0, 0)).toBe(true);
  w.dispose();
});

it("measures reach in blocks regardless of direction magnitude and rejects invalid rays", () => {
  const w = { get: (x: number) => (x === 3 ? 3 : 0) };
  const eye = { x: 0.5, y: 1.8, z: 0.5 };
  expect(raycast(w, eye, { x: 10, y: 0, z: 0 }, 2)).toBeNull();
  expect(raycast(w, eye, { x: 10, y: 0, z: 0 }, 3)?.distance).toBe(2.5);
  expect(raycast(w, eye, { x: NaN, y: 0, z: 0 })).toBeNull();
  expect(raycast(w, eye, { x: 1, y: 0, z: 0 }, Infinity)).toBeNull();
});
