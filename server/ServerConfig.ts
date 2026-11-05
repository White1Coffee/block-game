import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
export interface ServerConfig {
  serverName: string;
  host: string;
  port: number;
  maxPlayers: number;
  worldName: string;
  viewDistance: number;
  simulationDistance: number;
  pvpEnabled: boolean;
  allowCommands: boolean;
  autosaveIntervalSeconds: number;
  adminIds: string[];
  playerCommands: string[];
  seed: string;
  defaultMode: "creative" | "survival";
}
export const defaults: ServerConfig = {
  serverName: "WhiteBrick LAN",
  host: "0.0.0.0",
  port: 8800,
  maxPlayers: 8,
  worldName: "MultiplayerWorld",
  viewDistance: 4,
  simulationDistance: 3,
  pvpEnabled: false,
  allowCommands: true,
  autosaveIntervalSeconds: 60,
  adminIds: [],
  playerCommands: ["help"],
  seed: "WhiteBrick-LAN",
  defaultMode: "creative",
};
export function validateConfig(raw: unknown): ServerConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("Serverconfiguratie moet een JSON-object zijn.");
  const c = { ...defaults, ...raw } as ServerConfig;
  for (const [name, min, max] of [
    ["port", 1, 65535],
    ["maxPlayers", 1, 8],
    ["viewDistance", 2, 8],
    ["simulationDistance", 1, 8],
    ["autosaveIntervalSeconds", 5, 3600],
  ] as const)
    if (!Number.isInteger(c[name]) || c[name] < min || c[name] > max)
      throw Error(
        `${name} moet een geheel getal tussen ${min} en ${max} zijn.`,
      );
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(c.worldName))
    throw Error("worldName mag alleen letters, cijfers, - en _ bevatten.");
  if (
    typeof c.serverName !== "string" ||
    c.serverName.length < 1 ||
    c.serverName.length > 80 ||
    typeof c.seed !== "string" ||
    c.seed.length > 100
  )
    throw Error("Ongeldige servernaam of seed.");
  if (
    !["0.0.0.0", "127.0.0.1", "::"].includes(c.host) &&
    !/^\d{1,3}(\.\d{1,3}){3}$/.test(c.host)
  )
    throw Error("Ongeldig bindadres.");
  for (const name of ["pvpEnabled", "allowCommands"] as const)
    if (typeof c[name] !== "boolean")
      throw Error(name + " moet true/false zijn.");
  if (
    !["creative", "survival"].includes(c.defaultMode) ||
    !Array.isArray(c.adminIds) ||
    !c.adminIds.every(
      (id) => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id),
    ) ||
    !Array.isArray(c.playerCommands) ||
    !c.playerCommands.every((v) =>
      ["help", "give", "gamemode", "gamerule", "summon"].includes(v),
    )
  )
    throw Error("Ongeldige gamemode of permissionconfiguratie.");
  return c;
}
export async function loadConfig() {
  try {
    return validateConfig(
      JSON.parse(await readFile("server/config.json", "utf8")),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { ...defaults };
    throw e;
  }
}
export function lanAddresses(port: number) {
  return [
    ...new Set(
      Object.values(networkInterfaces()).flatMap((a) =>
        (a ?? [])
          .filter((i) => i.family === "IPv4" && !i.internal)
          .map((i) => `http://${i.address}:${port}`),
      ),
    ),
  ];
}
