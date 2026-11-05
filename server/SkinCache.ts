import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PNG } from "pngjs";
export class SkinCache {
  constructor(private directory = resolve("server/data/skins")) {}
  async store(data: string) {
    if (
      !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data) ||
      data.length > 50000
    )
      throw Error("Skin is te groot of geen PNG.");
    const bytes = Buffer.from(data.slice(22), "base64");
    if (
      bytes.length < 33 ||
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.readUInt32BE(16) !== 64 ||
      ![32, 64].includes(bytes.readUInt32BE(20))
    )
      throw Error("Gebruik een 64×64 of 64×32 PNG-skin.");
    const png = PNG.sync.read(bytes, { checkCRC: true });
    if (png.width !== 64 || ![32, 64].includes(png.height))
      throw Error("Ongeldige skin.");
    const safe = PNG.sync.write(png),
      hash = createHash("sha256").update(safe).digest("hex");
    await mkdir(this.directory, { recursive: true });
    await writeFile(resolve(this.directory, hash + ".png"), safe);
    return hash;
  }
  async read(hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw Error("Ongeldige skinreferentie.");
    return readFile(resolve(this.directory, hash + ".png"));
  }
}
