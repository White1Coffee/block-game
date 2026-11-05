import type { BlockChange } from "../world/World";
import type { GameMode, SurvivalSave } from "../inventory/Survival";
import type { SavedDrop } from "../inventory/DropSystem";
import type { WorldRules } from "./SaveMigration";
import { migrateSave } from "./SaveMigration";
import type { BlockEntitySave } from "../world/BlockEntities";
import type { Mob } from "../entities/MobSystem";
import type { XPOrb } from "../entities/ExperienceOrbs";
import type { WeatherSave } from "../environment/WeatherSystem";
export interface WorldSave {
  id: string;
  name: string;
  seed: string;
  version: number;
  updated: number;
  position: number[];
  rotation: number[];
  hotbar: number[];
  changes: BlockChange[];
  flying: boolean;
  mode?: GameMode;
  survival?: SurvivalSave;
  durability?: Record<number, number>;
  drops?: SavedDrop[];
  height?: number;
  day?: number;
  cameraMode?: number;
  playerId?: string;
  playerName?: string;
  backupOf?: string;
  fireState?: Record<string, number>;
  schemaVersion?: number;
  rules?: WorldRules;
  spawnpoint?: number[];
  blockEntities?: BlockEntitySave;
  blockStates?: Record<
    string,
    { rotation: number; open?: boolean; wall?: boolean; lit?: boolean }
  >;
  mobs?: Mob[];
  xpOrbs?: XPOrb[];
  weather?: WeatherSave;
}
export class WorldStorage {
  private db?: Promise<IDBDatabase>;
  private open() {
    return (this.db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open("wildbrick", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("worlds", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.db = undefined;
        reject(request.error);
      };
    }));
  }
  async list(): Promise<WorldSave[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction("worlds").objectStore("worlds").getAll();
      req.onsuccess = () =>
        resolve(
          (req.result as WorldSave[])
            .filter((save) => !save.backupOf)
            .map(migrateSave)
            .sort((a, b) => b.updated - a.updated),
        );
      req.onerror = () => reject(req.error);
    });
  }
  async save(save: WorldSave) {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction("worlds", "readwrite");
      const store = tx.objectStore("worlds");
      const previous = store.get(save.id);
      previous.onsuccess = () => {
        try {
          const old = previous.result as WorldSave | undefined;
          if (old && (old.schemaVersion ?? 0) < 5) {
            const versioned = store.get(
              "backup-v" + (old.schemaVersion ?? 0) + ":" + save.id,
            );
            versioned.onsuccess = () => {
              try {
                if (!versioned.result)
                  store.put({
                    ...old,
                    id: "backup-v" + (old.schemaVersion ?? 0) + ":" + save.id,
                    backupOf: save.id,
                  });
              } catch (e) {
                reject(e);
                tx.abort();
              }
            };
            const backup = store.get("backup:" + save.id);
            backup.onsuccess = () => {
              try {
                if (!backup.result)
                  store.put({
                    ...old,
                    id: "backup:" + save.id,
                    backupOf: save.id,
                  });
              } catch (error) {
                reject(error);
                tx.abort();
              }
            };
          }
          store.put(save);
        } catch (error) {
          // Quota/security errors may be thrown synchronously inside request callbacks.
          reject(error);
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async delete(id: string) {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction("worlds", "readwrite");
      tx.objectStore("worlds").delete(id);
      tx.objectStore("worlds").delete("backup:" + id);
      const backups = tx.objectStore("worlds").getAll();
      backups.onsuccess = () => {
        for (const record of backups.result as WorldSave[])
          if (record.backupOf === id)
            tx.objectStore("worlds").delete(record.id);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async export(id: string, backup = false): Promise<string> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db
        .transaction("worlds")
        .objectStore("worlds")
        .get((backup ? "backup:" : "") + id);
      request.onsuccess = () =>
        request.result
          ? resolve(JSON.stringify(request.result, null, 2))
          : reject(
              new Error("Geen opgeslagen wereld of migratieback-up gevonden."),
            );
      request.onerror = () => reject(request.error);
    });
  }
}
