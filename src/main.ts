import "./styles/main.css";
import { Game } from "./core/Game";
const app = document.querySelector<HTMLElement>("#app")!;
// LAN HTTP origins are not secure contexts; getRandomValues remains available there.
if (!crypto.randomUUID)
  Object.defineProperty(crypto, "randomUUID", {
    value: () => {
      const b = crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 15) | 64;
      b[8] = (b[8] & 63) | 128;
      const hex = Array.from(b, (n) => n.toString(16).padStart(2, "0")).join(
        "",
      );
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  });
try {
  new Game(app);
} catch (error) {
  console.error(error);
  app.innerHTML =
    '<div class="fatal"><h1>WhiteBrick kon niet starten.</h1><p>Controleer of WebGL en hardwareversnelling in je browser zijn ingeschakeld en herlaad de pagina.</p></div>';
}
