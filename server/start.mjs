import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { skinMiddleware } from "./skin-service.mjs";
const root = resolve("dist"),
  api = skinMiddleware();
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
createServer(
  (req, res) =>
    void api(req, res, async () => {
      try {
        const pathname = decodeURIComponent(
          new URL(req.url, "http://localhost").pathname,
        );
        const path = resolve(
          root,
          "." + (pathname === "/" ? "/index.html" : pathname),
        );
        if (!path.startsWith(root + sep)) {
          res.writeHead(403).end();
          return;
        }
        const data = await readFile(path);
        res.setHeader(
          "Content-Type",
          types[extname(path)] ?? "application/octet-stream",
        );
        res.end(data);
      } catch {
        res.writeHead(404).end("Niet gevonden");
      }
    }),
).listen(Number(process.env.PORT) || 4173, "127.0.0.1", () =>
  console.log(
    `WhiteBrick: http://127.0.0.1:${Number(process.env.PORT) || 4173}`,
  ),
);
