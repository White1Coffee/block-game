import {
  mkdir,
  readFile,
  open,
  unlink,
  rename,
  copyFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
async function retryLocked(operation: () => Promise<unknown>) {
  for (let attempt = 0; ; attempt++) {
    try {
      await operation();
      return;
    } catch (e) {
      if (
        attempt >= 15 ||
        !["EPERM", "EBUSY", "EACCES"].includes(
          (e as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw e;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}
/** Serialized atomic replace; the previous successful save remains a recoverable backup. */
export class WorldPersistence<T> {
  private queue: Promise<void> = Promise.resolve();
  private recovered = false;
  private lock?: { nonce: string; handle: Awaited<ReturnType<typeof open>> };
  readonly directory: string;
  constructor(worldName: string, root = "server/data/worlds") {
    if (!/^[A-Za-z0-9_-]{1,48}$/.test(worldName))
      throw Error("Ongeldige wereldnaam.");
    this.directory = resolve(root, worldName);
  }
  async load(
    validate: (value: unknown) => boolean = () => true,
  ): Promise<T | undefined> {
    const parse = (text: string) => {
      const value: unknown = JSON.parse(text);
      if (!validate(value)) throw Error("Ongeldige savestructuur.");
      return value as T;
    };
    try {
      return parse(
        await readFile(resolve(this.directory, "world.json"), "utf8"),
      );
    } catch (e) {
      try {
        const data = parse(
          await readFile(resolve(this.directory, "world.backup.json"), "utf8"),
        );
        console.warn("Hoofdsave onleesbaar; back-up hersteld.");
        this.recovered = true;
        return data;
      } catch (backupError) {
        if (
          (e as NodeJS.ErrnoException).code === "ENOENT" &&
          (backupError as NodeJS.ErrnoException).code === "ENOENT"
        )
          return;
        throw Error(
          "Wereldsave en back-up zijn onleesbaar. Bestanden zijn behouden.",
        );
      }
    }
  }
  async backupBeforeMigration(label: string, value: T) {
    if (!/^[a-z0-9-]{1,48}$/.test(label)) throw Error("Ongeldig back-uplabel.");
    await mkdir(this.directory, { recursive: true });
    const file = resolve(this.directory, `world.before-${label}.json`);
    let handle;
    try {
      handle = await open(file, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
      throw error;
    }
    try {
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    } catch (error) {
      await handle.close();
      await unlink(file);
      throw error;
    }
    await handle.close();
  }
  async acquireLock() {
    await mkdir(this.directory, { recursive: true });
    const path = resolve(this.directory, "world.lock");
    const claim = async () => {
      const handle = await open(path, "wx"),
        nonce = randomUUID();
      await handle.writeFile(JSON.stringify({ pid: process.pid, nonce }));
      this.lock = { handle, nonce };
    };
    try {
      await claim();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const text = await readFile(path, "utf8");
      let owner: { pid: number };
      try {
        owner = JSON.parse(text);
      } catch {
        throw Error(
          "Wereldlock is onleesbaar. Stop alle WhiteBrick-servers voordat je world.lock verwijdert.",
        );
      }
      let alive = true;
      try {
        process.kill(owner.pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false;
      }
      if (alive)
        throw Error(
          "Deze multiplayerwereld wordt al door een ander serverproces gebruikt. Stop dat proces of kies een andere worldName.",
        );
      if ((await readFile(path, "utf8")) !== text)
        throw Error("Een andere server start deze wereld al.");
      await unlink(path);
      await claim();
    }
  }
  async releaseLock() {
    if (!this.lock) return;
    const { handle, nonce } = this.lock;
    this.lock = undefined;
    await handle.close();
    const path = resolve(this.directory, "world.lock");
    try {
      if (JSON.parse(await readFile(path, "utf8")).nonce === nonce)
        await unlink(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  save(value: T) {
    const json = JSON.stringify(value);
    const job = this.queue
      .catch(() => {})
      .then(async () => {
        await mkdir(this.directory, { recursive: true });
        const file = resolve(this.directory, "world.json"),
          tmp = resolve(this.directory, "world.tmp.json");
        const handle = await import("node:fs/promises").then((fs) =>
          fs.open(tmp, "w"),
        );
        try {
          await handle.writeFile(json);
          await handle.sync();
        } finally {
          await handle.close();
        }
        try {
          if (!this.recovered)
            await retryLocked(() =>
              copyFile(file, resolve(this.directory, "world.backup.json")),
            );
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        await retryLocked(() => rename(tmp, file));
        this.recovered = false;
      });
    this.queue = job;
    return job;
  }
}
