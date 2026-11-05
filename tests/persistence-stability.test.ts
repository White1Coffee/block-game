import { expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { WorldPersistence } from "../server/WorldPersistence";
import { ServerWorld } from "../server/ServerWorld";
import { defaults } from "../server/ServerConfig";
const root = async () => {
  await mkdir(".lan-test", { recursive: true });
  return mkdtemp(resolve(".lan-test", "stability-"));
};
it("acquires the world lock before reading any server world data", async () => {
  const load = WorldPersistence.prototype.load,
    dir = await root();
  let checked = false;
  const spy = vi
    .spyOn(WorldPersistence.prototype, "load")
    .mockImplementation(async function (
      this: WorldPersistence<unknown>,
      ...args
    ) {
      expect(
        JSON.parse(
          await readFile(resolve(this.directory, "world.lock"), "utf8"),
        ).pid,
      ).toBe(process.pid);
      checked = true;
      return load.apply(this, args);
    });
  let world: ServerWorld | undefined;
  try {
    world = await ServerWorld.open(defaults, dir, true);
    expect(checked).toBe(true);
    await expect(ServerWorld.open(defaults, dir, true)).rejects.toThrow(
      /ander serverproces/,
    );
  } finally {
    spy.mockRestore();
    world?.dispose();
    await world?.persistence.releaseLock();
  }
});
it("keeps immutable pre-migration backups and ignores interrupted temporary saves", async () => {
  const store = new WorldPersistence<{ version: number }>("safe", await root());
  await store.save({ version: 1 });
  await store.backupBeforeMigration("v1", { version: 1 });
  await store.save({ version: 2 });
  await store.backupBeforeMigration("v1", { version: 2 });
  await writeFile(resolve(store.directory, "world.tmp.json"), "{unfinished");
  expect(await store.load()).toEqual({ version: 2 });
  expect(
    JSON.parse(
      await readFile(resolve(store.directory, "world.before-v1.json"), "utf8"),
    ),
  ).toEqual({ version: 1 });
});
it("recovers a structurally invalid JSON save from the last valid backup", async () => {
  const store = new WorldPersistence<{ version: number }>("safe", await root());
  await store.save({ version: 1 });
  await store.save({ version: 2 });
  await writeFile(resolve(store.directory, "world.json"), "null");
  expect(
    await store.load((v) => !!v && typeof v === "object" && "version" in v),
  ).toEqual({ version: 1 });
});
it("takes independent snapshots of concurrent saves and writes the newest last", async () => {
  const store = new WorldPersistence<{ items: number[] }>("safe", await root());
  const data = { items: [1] };
  const first = store.save(data);
  data.items.push(2);
  const second = store.save(data);
  data.items.push(3);
  await Promise.all([first, second]);
  expect(await store.load()).toEqual({ items: [1, 2] });
  expect(
    JSON.parse(
      await readFile(resolve(store.directory, "world.backup.json"), "utf8"),
    ),
  ).toEqual({ items: [1] });
});
