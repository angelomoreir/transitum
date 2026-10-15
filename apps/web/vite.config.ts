import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const apiTarget = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3001";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/docs": { target: apiTarget, changeOrigin: true },
    },
  },
});
