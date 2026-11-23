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
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
