import {
  loadSkin,
  defaultSkin,
  skinTexture,
} from "../player/skins/SkinManager";
import type { SkinReference } from "./NetworkProtocol";
import type { Texture } from "three";
export class SkinSyncManager {
  private cache = new Map<string, Promise<Texture>>();
  texture(skin?: SkinReference) {
    const key = skin?.hash ?? "default";
    let result = this.cache.get(key);
    if (!result) {
      result = loadSkin(
        skin ? `/api/multiplayer/skins/${skin.hash}.png` : defaultSkin().png,
      ).then(skinTexture);
      this.cache.set(key, result);
      result.catch(() => this.cache.delete(key));
    }
    return result;
  }
  dispose() {
    for (const value of this.cache.values())
      void value.then((t) => t.dispose()).catch(() => {});
    this.cache.clear();
  }
}
