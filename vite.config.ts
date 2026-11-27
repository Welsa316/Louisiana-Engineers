import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const shared = fileURLToPath(new URL("./shared", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@shared": shared },
  },
  server: {
    // Agent worktrees and test output live in the project folder; changes
    // there must not reload the page being worked on.
    watch: { ignored: ["**/.claude/**", "**/test-results/**", "**/playwright-report/**"] },
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
