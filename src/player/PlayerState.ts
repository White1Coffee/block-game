import type { SkinVariant } from "./skins/SkinFormat";
import type { GameMode } from "../inventory/Survival";
/** Serializable player snapshot; no renderer or network dependency. */
export interface PlayerState {
  id: string;
  position: [number, number, number];
  rotation: [number, number];
  mode: GameMode;
  flying: boolean;
  sneaking: boolean;
  skin: { png: string; model: SkinVariant; layers: boolean };
}
