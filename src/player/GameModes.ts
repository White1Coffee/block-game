import type { PlayerPhysics } from "./PlayerPhysics";
import type { Survival } from "../inventory/Survival";
export type GameMode = "survival" | "creative" | "adventure" | "spectator";
export const gameModes: GameMode[] = [
  "survival",
  "creative",
  "adventure",
  "spectator",
];
export const survivalLike = (mode: GameMode) =>
  mode === "survival" || mode === "adventure";
export function parseGameMode(value: string): GameMode {
  const mode = /^[0-3]$/.test(value) ? gameModes[Number(value)] : value;
  if (!gameModes.includes(mode as GameMode))
    throw new Error(
      "Gamemode moet survival, creative, adventure of spectator zijn (of 0–3).",
    );
  return mode as GameMode;
}
export function configureGameMode(
  mode: GameMode,
  player: PlayerPhysics,
  survival: Survival,
) {
  player.noclip = mode === "spectator";
  player.flying =
    mode === "spectator" || (mode === "creative" && player.flying);
  player.velocity.set(0, 0, 0);
  player.knockback.set(0, 0, 0);
  player.sneaking = false;
  player.swimming = false;
  player.climbing = false;
  player.grounded = false;
  survival.resetFall();
  if (!player.noclip) {
    player.position.y = Math.max(1, player.position.y);
    let steps = 0;
    while (player.collides(player.position) && steps++ < 256)
      player.position.y += 1;
  }
}
