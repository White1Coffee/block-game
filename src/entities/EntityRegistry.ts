import { mobDefinitions, type MobKind } from "./MobSystem";
const aliases: Record<string, MobKind> = {
  zombie: "hollow",
  skeleton: "bonewalker",
  creeper: "burster",
  spider: "crawler",
};
/** Registry is derived from actual spawnable mob definitions, including future additions. */
export class EntityRegistry {
  resolve(name: string): MobKind | undefined {
    const key = normalizeEntityId(name);
    if (!key) return;
    const kind = aliases[key] ?? key;
    return Object.hasOwn(mobDefinitions, kind) ? (kind as MobKind) : undefined;
  }
  ids() {
    return [
      ...new Set([...Object.keys(mobDefinitions), ...Object.keys(aliases)]),
    ].sort();
  }
}
function normalizeEntityId(value: string) {
  const parts = value.toLowerCase().split(":");
  if (
    parts.length > 2 ||
    (parts.length === 2 && !["minecraft", "whitebrick"].includes(parts[0]))
  )
    return;
  return parts.at(-1);
}
export const entityRegistry = new EntityRegistry();
