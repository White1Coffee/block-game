import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from "./NetworkProtocol";
import { GENERATOR_VERSION } from "../world/WorldGenerator";
import { validateServerMessage } from "./ServerValidation";
export interface ServerStatus {
  serverName: string;
  online: boolean;
  playerCount: number;
  maxPlayers: number;
  worldName: string;
  protocolVersion: number;
  serverId: string;
  tickMs: number;
}
export class NetworkClient {
  connected = false;
  ping = 0;
  private socket?: WebSocket;
  private stopped = false;
  private retries = 0;
  private timer?: number;
  private pingTimer?: number;
  private status?: ServerStatus;
  private skinTimer?: number;
  private lastSkin = -Infinity;
  private generation = 0;
  private worldHeight = 80;
  private retryTimer?: number;
  private pending = new Map<
    string,
    { message: ClientMessage; time: number; attempts: number }
  >();
  constructor(
    private name: string,
    private receive: (message: ServerMessage) => void,
    private lost: (message: string, retrying: boolean) => void,
  ) {}
  static async status() {
    const response = await fetch("/api/server/status", {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok)
      throw Error(
        "Geen LAN-server op dit adres. Start npm run start:lan of npm run dev.",
      );
    const status = await response.json();
    if (
      !status ||
      typeof status !== "object" ||
      typeof status.serverId !== "string" ||
      typeof status.serverName !== "string" ||
      typeof status.worldName !== "string" ||
      typeof status.online !== "boolean" ||
      ![status.playerCount, status.maxPlayers, status.protocolVersion].every(
        Number.isSafeInteger,
      )
    )
      throw Error("Ongeldige serverstatus.");
    return status as ServerStatus;
  }
  private identities(): Record<string, string> {
    try {
      const value = JSON.parse(
        localStorage.getItem("whitebrick-lan-identities") ?? "{}",
      );
      return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
    } catch {
      return {};
    }
  }
  async connect() {
    const generation = ++this.generation;
    this.stopped = false;
    const status = await NetworkClient.status();
    if (this.stopped || generation !== this.generation) return;
    this.status = status;
    if (!this.status.online) throw Error("De server wordt gestopt.");
    if (this.status.protocolVersion !== PROTOCOL_VERSION)
      throw Error("Serverversie verschilt. Herlaad de pagina.");
    this.open();
  }
  private open() {
    if (this.stopped || !this.status) return;
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws/whitebrick`,
    );
    this.socket = ws;
    ws.onopen = () => {
      if (this.socket !== ws || this.stopped) {
        ws.close();
        return;
      }
      ws.send(
        JSON.stringify({
          type: "hello",
          protocol: PROTOCOL_VERSION,
          generator: GENERATOR_VERSION,
          name: this.name,
          token: this.identities()[this.status!.serverId],
        }),
      );
    };
    ws.onmessage = (event) => {
      if (this.socket !== ws || this.stopped) return;
      try {
        if (
          typeof event.data !== "string" ||
          event.data.length > 2 * 1024 * 1024
        )
          throw Error("Serverbericht te groot.");
        const message = validateServerMessage(JSON.parse(event.data));
        if (message.type === "welcome") {
          this.worldHeight = message.world.height ?? 80;
          if (this.connected || message.serverId !== this.status!.serverId)
            throw Error("Onverwachte login.");
          if (message.token) {
            const tokens = this.identities();
            tokens[message.serverId] = message.token;
            try {
              localStorage.setItem(
                "whitebrick-lan-identities",
                JSON.stringify(tokens),
              );
            } catch {
              this.lost(
                "Identiteit kon niet lokaal worden bewaard. Browseropslag is vereist voor herverbinden.",
                false,
              );
              this.close();
              return;
            }
          }
          this.connected = true;
          this.retries = 0;
          clearInterval(this.pingTimer);
          this.pingTimer = window.setInterval(
            () => this.send({ type: "ping", time: performance.now() }),
            3000,
          );
          clearInterval(this.retryTimer);
          this.retryTimer = window.setInterval(() => {
            for (const entry of this.pending.values()) {
              if (performance.now() - entry.time < 1500) continue;
              if (entry.attempts >= 3) {
                ws.close(1011, "Acknowledgement ontbreekt.");
                break;
              }
              if (
                ws.readyState === WebSocket.OPEN &&
                ws.bufferedAmount < 131072
              ) {
                ws.send(JSON.stringify(entry.message));
                entry.time = performance.now();
                entry.attempts++;
              }
            }
          }, 500);
        }
        if (message.type === "ack") this.pending.delete(message.tx);
        if (
          message.type === "chunk" &&
          ((message.blocks &&
            message.blocks.length !== this.worldHeight * 256) ||
            message.changes.some((c) => c[1] >= this.worldHeight))
        )
          throw Error("Ongeldige chunkhoogte.");
        if (
          !this.connected &&
          !["welcome", "error", "shutdown"].includes(message.type)
        )
          throw Error("Bericht vóór aanmelden.");
        if (message.type === "pong")
          this.ping = Math.max(0, performance.now() - message.time);
        if (message.type === "shutdown") {
          this.stopped = true;
          this.connected = false;
          this.lost(message.message, false);
        }
        if (message.type === "error" && message.fatal) {
          if (!message.message.includes("actieve sessie")) this.stopped = true;
          this.lost(message.message, !this.stopped);
        }
        this.receive(message);
      } catch {
        this.lost("Ongeldig serverbericht ontvangen.", false);
        this.close();
      }
    };
    ws.onclose = () => {
      if (this.socket !== ws) return;
      this.connected = false;
      clearInterval(this.pingTimer);
      clearInterval(this.retryTimer);
      clearTimeout(this.skinTimer);
      this.pending.clear();
      if (this.stopped) return;
      const retry = this.retries++ < 12;
      this.lost(
        "Connection Lost — " +
          (retry ? "opnieuw verbinden…" : "server niet bereikbaar."),
        retry,
      );
      if (retry)
        this.timer = window.setTimeout(
          () => this.open(),
          Math.min(8000, 1000 * 2 ** Math.min(3, this.retries - 1)),
        );
    };
    ws.onerror = () => {};
  }
  send(message: ClientMessage) {
    const tx = "tx" in message ? message.tx : undefined;
    if (tx && !this.pending.has(tx) && this.pending.size >= 128) return false;
    if (message.type === "skin" && this.connected) {
      clearTimeout(this.skinTimer);
      const wait = 2200 - (performance.now() - this.lastSkin);
      if (wait > 0) {
        this.skinTimer = window.setTimeout(() => this.send(message), wait);
        return true;
      }
      this.lastSkin = performance.now();
    }
    if (
      this.connected &&
      this.socket?.readyState === WebSocket.OPEN &&
      this.socket.bufferedAmount < 131072
    ) {
      this.socket.send(JSON.stringify(message));
      if (tx && !this.pending.has(tx))
        this.pending.set(tx, {
          message: structuredClone(message),
          time: performance.now(),
          attempts: 0,
        });
      return true;
    }
    return false;
  }
  close() {
    this.generation++;
    this.stopped = true;
    this.connected = false;
    clearTimeout(this.timer);
    clearTimeout(this.skinTimer);
    clearInterval(this.pingTimer);
    clearInterval(this.retryTimer);
    this.pending.clear();
    this.socket?.close(1000, "Speler vertrekt.");
  }
}
