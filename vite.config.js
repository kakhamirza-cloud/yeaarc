import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { viteGameApiPlugin } from "./scripts/vite-game-api-plugin.mjs";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [viteGameApiPlugin()],
  server: {
    port: 5174,
    open: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        mint: resolve(root, "mint.html"),
        game: resolve(root, "game.html"),
        "game-admin": resolve(root, "game-admin.html"),
        checker: resolve(root, "checker.html"),
        prediction: resolve(root, "prediction.html"),
        portfolio: resolve(root, "portfolio.html"),
        apply: resolve(root, "apply.html"),
        "apply-admin": resolve(root, "apply-admin.html"),
      },
    },
  },
});
