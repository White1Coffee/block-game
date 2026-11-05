import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from "./NetworkProtocol";
import { GENERATOR_VERSION } from "../world/WorldGenerator";
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
    return (await response.json()) as ServerStatus;
  }
  private identities(): Record<string, string> {
    try {
      return JSON.parse(
        localStorage.getItem("whitebrick-lan-identities") ?? "{}",
      );
    } catch {
      return {};
    }
  }
  async connect() {
    this.stopped = false;
    this.status = await NetworkClient.status();
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
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          type: "hello",
          protocol: PROTOCOL_VERSION,
          generator: GENERATOR_VERSION,
          name: this.name,
          token: this.identities()[this.status!.serverId],
        }),
      );
    ws.onmessage = (event) => {
      try {
        if (
          typeof event.data !== "string" ||
          event.data.length > 2 * 1024 * 1024
        )
          throw Error("Serverbericht te groot.");
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === "welcome") {
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
        }
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
      return true;
    }
    return false;
  }
  close() {
    this.stopped = true;
    this.connected = false;
    clearTimeout(this.timer);
    clearTimeout(this.skinTimer);
    clearInterval(this.pingTimer);
    this.socket?.close(1000, "Speler vertrekt.");
  }
}
