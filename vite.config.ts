import { defineConfig } from "vite";
import { skinMiddleware } from "./server/skin-service.mjs";
import { GameServer } from "./server/GameServer";
import { loadConfig } from "./server/ServerConfig";

export default defineConfig({
  plugins: [
    {
      name: "whitebrick-lan-development",
      async configureServer(server) {
        if (!server.httpServer) return;
        const config = await loadConfig(),
          runtime = await GameServer.create(
            config,
            process.env.WHITEBRICK_DATA_ROOT,
          );
        let listening = false;
        runtime.attach(server.httpServer as import("node:http").Server);
        server.middlewares.use((req, res, next) => {
          void runtime.api(req, res, next);
        });
        server.httpServer.once("listening", () => {
          listening = true;
          const address = server.httpServer!.address();
          if (address && typeof address !== "string")
            runtime.print(address.port,false);
        });
        const close = server.close.bind(server);
        server.close = async () => {
          process.removeListener("SIGINT", stop);
          process.removeListener("SIGTERM", stop);
          await runtime.close(listening);
          await close();
        };
        const stop = () => {
          void server.close().then(
            () => process.exit(0),
            (error) => {
              console.error(error);
              process.exit(1);
            },
          );
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      },
    },
    {
      name: "wildbrick-skin-api",
      configureServer(server) {
        server.middlewares.use(skinMiddleware());
      },
      configurePreviewServer(server) {
        server.middlewares.use(skinMiddleware());
      },
    },
  ],
  server: { host: "0.0.0.0", port: 8800, strictPort: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { three: ["three"] },
      },
    },
  },
});
