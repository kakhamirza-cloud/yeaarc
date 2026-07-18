import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  server: {
    port: 5174,
    open: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        mint: resolve(root, "mint.html"),
      },
    },
  },
});
