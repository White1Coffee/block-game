import type { WorldSave } from "./WorldStorage";
import { gamerules, type Gamerules } from "../world/Gamerules";
export interface WorldRules extends Gamerules {
  keepInventory: boolean;
  difficulty: "peaceful" | "easy" | "normal" | "hard";
  dayLength: number;
}
export const DEFAULT_RULES: WorldRules = {
  ...gamerules.defaults(),
  keepInventory: false,
  difficulty: "normal",
  dayLength: 1200,
};
/** Keep generator version and unknown fields intact; migrations never regenerate terrain. */
export function migrateSave(save: WorldSave): WorldSave {
  return {
    ...save,
    schemaVersion: 5,
    playerName: save.playerName ?? "Player",
    rules: {
      ...DEFAULT_RULES,
      ...save.rules,
      ...gamerules.normalize(save.rules),
    },
    spawnpoint: save.spawnpoint ?? [8.5, -1, 8.5],
    survival: save.survival
      ? {
          saturation: 5,
          air: 10,
          xp: 0,
          ...save.survival,
          items: { ...save.survival.items },
        }
      : undefined,
  };
}
