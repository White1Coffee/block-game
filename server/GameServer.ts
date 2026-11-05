import type { Server, IncomingMessage, ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import {
  PROTOCOL_VERSION,
  validateClientMessage,
  type ServerMessage,
} from "../src/networking/NetworkProtocol";
import { GENERATOR_VERSION } from "../src/world/WorldGenerator";
import { ServerWorld, type ServerPlayer } from "./ServerWorld";
import { SkinCache } from "./SkinCache";
import { lanAddresses, type ServerConfig } from "./ServerConfig";
import { isHostAddress } from "./HostAddress";
export class GameServer {
  readonly sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 65536,
    perMessageDeflate: false,
  });
  readonly skins: SkinCache;
  private closing = false;
  private timer?: ReturnType<typeof setInterval>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private inflight = new Set<Promise<void>>();
  private clients = new Map<
    WebSocket,
    {
      player?: ServerPlayer;
      alive: boolean;
      tokens: number;
      last: number;
      chat: number;
      skin: number;
      joining: boolean;
      queue: Promise<void>;
      pending: number;
    }
  >();
  private upgrades = new Map<string, { time: number; count: number }>();
  constructor(
    readonly game: ServerWorld,
    readonly config: ServerConfig,
    skinDirectory?: string,
    private readonly hostAddressCheck: (
      address: string | undefined,
    ) => boolean = isHostAddress,
  ) {
    this.skins = new SkinCache(skinDirectory);
  }
  static async create(
    config: ServerConfig,
    root?: string,
    hostAddressCheck = isHostAddress,
  ) {
    const game = await ServerWorld.open(config, root, true);
    return new GameServer(
      game,
      config,
      root ? resolve(root, "_skins") : undefined,
      hostAddressCheck,
    );
  }
  attach(http: Server) {
    http.on("upgrade", (req, socket, head) => {
      try {
        if (
          new URL(req.url ?? "/", "http://host").pathname !== "/ws/whitebrick"
        ) {
          return;
        }
      } catch {
        socket.destroy();
        return;
      }
      const origin = req.headers.origin;
      let originAllowed = true;
      try {
        if (origin) originAllowed = new URL(origin).host === req.headers.host;
      } catch {
        originAllowed = false;
      }
      if (this.closing || this.clients.size >= 32 || !originAllowed) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      const address = req.socket.remoteAddress ?? "unknown",
        now = Date.now(),
        limit = this.upgrades.get(address);
      if (limit && now - limit.time < 60000 && limit.count >= 40) {
        socket.destroy();
        return;
      }
      this.upgrades.set(
        address,
        limit && now - limit.time < 60000
          ? { time: limit.time, count: limit.count + 1 }
          : { time: now, count: 1 },
      );
      this.sockets.handleUpgrade(req, socket, head, (ws) =>
        this.accept(ws, req.socket.remoteAddress),
      );
    });
    this.timer = setInterval(() => {
      try {
        this.game.step();
      } catch (e) {
        console.error("Server tick error:", e);
      }
    }, 50);
    this.heartbeat = setInterval(() => {
      for (const [ws, c] of this.clients) {
        if (!c.alive) {
          ws.terminate();
          continue;
        }
        c.alive = false;
        ws.ping();
      }
      const now = Date.now();
      for (const [ip, limit] of this.upgrades)
        if (now - limit.time > 60000) this.upgrades.delete(ip);
    }, 10000);
  }
  private send(ws: WebSocket, m: ServerMessage) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 2 * 1024 * 1024) {
      ws.close(1013, "Verbinding te traag; probeer opnieuw.");
      return;
    }
    ws.send(JSON.stringify(m));
  }
  private accept(ws: WebSocket, remoteAddress: string | undefined) {
    const c = {
      player: undefined as ServerPlayer | undefined,
      alive: true,
      tokens: 150,
      last: performance.now(),
      chat: -Infinity,
      skin: -Infinity,
      joining: false,
      queue: Promise.resolve(),
      pending: 0,
    };
    this.clients.set(ws, c);
    const deadline = setTimeout(() => {
      if (!c.player) ws.close(1008, "Aanmelden duurde te lang.");
    }, 10000);
    ws.on("error", () => {});
    ws.on("pong", () => {
      c.alive = true;
    });
    ws.on("message", (raw, binary) => {
      if (this.closing || ws.readyState !== WebSocket.OPEN) return;
      const now = performance.now();
      c.tokens = Math.min(150, c.tokens + (now - c.last) * 0.1);
      c.last = now;
      if (--c.tokens < 0 || c.pending >= 150) {
        ws.close(1008, "Te veel berichten.");
        return;
      }
      c.pending++;
      const job = c.queue
        .then(async () => {
          try {
            if (this.closing || ws.readyState !== WebSocket.OPEN) return;
            if (binary) throw Error("Alleen JSON-berichten zijn toegestaan.");
            const m = validateClientMessage(JSON.parse(raw.toString()));
            if (m.type === "hello") {
              if (c.player || c.joining) throw Error("Al aangemeld.");
              if (
                m.protocol !== PROTOCOL_VERSION ||
                m.generator !== GENERATOR_VERSION
              )
                throw Error("Client/serverversie verschilt. Herlaad de game.");
              c.joining = true;
              try {
                const joined = this.game.join(m.name, m.token, (message) => {
                  if (!c.joining) this.send(ws, message);
                });
                c.player = joined.player;
                c.player.hostAdmin = this.hostAddressCheck(remoteAddress);
                await this.game.save();
                if (
                  this.closing ||
                  ws.readyState !== WebSocket.OPEN ||
                  this.game.players.get(c.player.record.id) !== c.player
                )
                  return;
                this.send(ws, {
                  type: "welcome",
                  token: joined.token,
                  sessionId: c.player.sessionId,
                  serverId: this.game.serverId,
                  viewDistance: this.config.viewDistance,
                  world: this.game.welcomeWorld(),
                  self: this.game.self(c.player),
                });
                c.player.chunks.clear();
                c.joining = false;
                if (c.player.hostAdmin)
                  c.player.send({
                    type: "chat",
                    kind: "system",
                    text: "Je speelt op de servercomputer en bent automatisch Admin.",
                  });
                this.game.broadcast({
                  type: "chat",
                  kind: "system",
                  text: c.player.record.name + " is verbonden.",
                });
                console.log(
                  `Join: ${c.player.record.name} | ${c.player.record.id} | ${this.game.players.size}/${this.config.maxPlayers}`,
                );
              } catch (error) {
                if (
                  c.player &&
                  this.game.players.get(c.player.record.id) === c.player
                )
                  this.game.leave(c.player.record.id);
                c.player = undefined;
                throw error;
              } finally {
                c.joining = false;
              }
              return;
            }
            if (!c.player || c.joining) throw Error("Meld je eerst aan.");
            if (m.type === "skin") {
              if (now - c.skin < 2000) return;
              c.skin = now;
              const player = c.player;
              const hash = await this.skins.store(m.png);
              if (
                !this.closing &&
                ws.readyState === WebSocket.OPEN &&
                this.game.players.get(player.record.id) === player
              )
                player.record.skin = { hash, model: m.model, layers: m.layers };
              return;
            }
            if (m.type === "chat") {
              if (now - c.chat < 350)
                throw Error("Wacht even voor het volgende bericht.");
              c.chat = now;
            }
            this.game.handle(c.player, m);
          } catch (e) {
            const message =
              e instanceof Error ? e.message : "Netwerkbericht geweigerd.";
            this.send(ws, { type: "error", message, fatal: !c.player });
            if (!c.player) ws.close(1008, "Aanmelding geweigerd.");
          }
        })
        .finally(() => {
          c.pending--;
          this.inflight.delete(job);
        });
      c.queue = job;
      this.inflight.add(job);
    });
    ws.on("close", () => {
      clearTimeout(deadline);
      this.clients.delete(ws);
      if (c.player && this.game.players.get(c.player.record.id) === c.player) {
        this.game.leave(c.player.record.id);
        if (!this.closing)
          void this.game
            .save()
            .catch((e) => console.error("Opslaan na disconnect mislukt:", e));
      }
    });
  }
  async api(req: IncomingMessage, res: ServerResponse, next: () => void) {
    let path: string;
    try {
      path = decodeURIComponent(
        new URL(req.url ?? "/", "http://host").pathname,
      );
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (path === "/api/server/status") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(
        JSON.stringify({
          serverName: this.config.serverName,
          online: !this.closing,
          playerCount: this.game.players.size,
          maxPlayers: this.config.maxPlayers,
          worldName: this.config.worldName,
          protocolVersion: PROTOCOL_VERSION,
          generatorVersion: GENERATOR_VERSION,
          serverId: this.game.serverId,
          tickMs: this.game.tickMs,
        }),
      );
      return;
    }
    if (path.startsWith("/api/multiplayer/skins/")) {
      try {
        const hash = path
          .slice("/api/multiplayer/skins/".length)
          .replace(/\.png$/, "");
        const data = await this.skins.read(hash);
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.end(data);
      } catch {
        res.writeHead(404).end("Skin niet gevonden.");
      }
      return;
    }
    next();
  }
  print(port: number, consoleAvailable = true) {
    console.log(
      "\n----------------------------------------\n WHITEBRICK — LAN SERVER\n----------------------------------------\nServer status: ONLINE\nPort: " +
        port +
        "\nLocal URL: http://localhost:" +
        port +
        "\n" +
        lanAddresses(port)
          .map((url) => "Multiplayer LAN URL: " + url)
          .join("\n") +
        "\nPlayers: " +
        this.game.players.size +
        "/" +
        this.config.maxPlayers +
        "\nWorld: " +
        this.config.worldName +
        (consoleAvailable
          ? "\nConsole: players | op <player-id> | deop <player-id> | save | stop"
          : "\nDevelopment: beheerrechten via adminIds in server/config.json; CLI-console via npm run start:lan.") +
        "\n----------------------------------------",
    );
  }
  private shutdown?: Promise<void>;
  close(save = true) {
    return (this.shutdown ??= (async () => {
      this.closing = true;
      clearInterval(this.timer);
      clearInterval(this.heartbeat);
      await Promise.allSettled([...this.inflight]);
      this.game.broadcast({
        type: "shutdown",
        message: "De host stopt de server. Wereld wordt opgeslagen.",
      });
      let failure: unknown;
      try {
        if (save) await this.game.save();
      } catch (error) {
        failure = error;
      }
      for (const ws of this.clients.keys()) ws.close(1001, "Server gestopt.");
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          for (const ws of this.clients.keys()) ws.terminate();
          resolve();
        }, 750);
        this.sockets.close(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
      this.game.dispose();
      await this.game.persistence.releaseLock();
      if (failure) throw failure;
    })());
  }
}
