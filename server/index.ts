import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { createInterface } from "node:readline";
import { GameServer } from "./GameServer";
import { loadConfig, validateConfig } from "./ServerConfig";
import { skinMiddleware } from "./skin-service.mjs";
const loaded = await loadConfig();
const config = validateConfig({
  ...loaded,
  ...(process.env.PORT ? { port: Number(process.env.PORT) } : {}),
});
const runtime = await GameServer.create(
    config,
    process.env.WHITEBRICK_DATA_ROOT,
  ),
  root = resolve("dist"),
  skin = skinMiddleware();
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};
const http = createServer((req, res) => {
  void runtime.api(req, res, () => {
    void skin(req, res, async () => {
      try {
        const pathname = decodeURIComponent(
            new URL(req.url ?? "/", "http://host").pathname,
          ),
          file = resolve(
            root,
            "." + (pathname === "/" ? "/index.html" : pathname),
          );
        if (!file.startsWith(root + sep)) {
          res.writeHead(403).end();
          return;
        }
        const bytes = await readFile(file);
        res.setHeader(
          "Content-Type",
          types[extname(file)] ?? "application/octet-stream",
        );
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "no-cache");
        res.end(bytes);
      } catch {
        res.writeHead(404).end("Niet gevonden");
      }
    });
  });
});
runtime.attach(http);
http.on("error", (e) => {
  console.error(
    (e as NodeJS.ErrnoException).code === "EADDRINUSE"
      ? `Poort ${config.port} is bezet. Stop de andere server of wijzig server/config.json.`
      : e,
  );
  void runtime.close(false).finally(() => process.exit(1));
});
http.listen(config.port, config.host, () => runtime.print(config.port));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    await runtime.close();
    http.close();
    console.log("Wereld opgeslagen. Server gestopt.");
    process.exit(0);
  } catch (e) {
    console.error("Stoppen/opslaan mislukt:", e);
    process.exit(1);
  }
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
const consoleInput = createInterface({ input: process.stdin });
consoleInput.on("line", (line) => {
  const [command, id] = line.trim().split(/\s+/);
  try {
    if (command === "stop") void stop();
    else if (command === "players")
      for (const p of runtime.game.players.values())
        console.log(p.record.name, p.record.id, runtime.game.self(p).role);
    else if (command === "op" || command === "deop") {
      runtime.game.op(id, command === "op");
      void runtime.game.save().catch(console.error);
    } else if (command === "save")
      void runtime.game
        .save()
        .then(() => console.log("Opgeslagen."), console.error);
    else
      console.log("players | op <player-id> | deop <player-id> | save | stop");
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
  }
});
