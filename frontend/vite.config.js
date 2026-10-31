import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const appVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "kinderkasse-version-file",
      apply: "build",
      generateBundle() {
        // The version is emitted from the SAME package.json as the bundle.
        // This prevents a mismatch between the visible UI and the server.
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: JSON.stringify({ version: appVersion }) + "\n",
        });
      },
    },
  ],
  define: { __KASSE_VERSION__: JSON.stringify(appVersion) },
  server: {
    proxy: {
      "/api": "http://localhost:3801",
      "/uploads": "http://localhost:3801",
    },
  },
});
