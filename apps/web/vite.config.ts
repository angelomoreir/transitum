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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Vendors estáveis em chunks próprios — mudam raramente e ficam em
          // cache do browser mesmo quando o código da app é atualizado.
          if (id.includes("node_modules")) {
            if (id.includes("react-dom") || id.includes("react-router") || /node_modules[\\/]react[\\/]/.test(id)) {
              return "react";
            }
            if (id.includes("i18next")) return "i18n";
            if (id.includes("leaflet")) return "leaflet";
            if (id.includes("lucide-react")) return "icons";
            if (id.includes("@radix-ui")) return "radix";
            if (id.includes("zod")) return "zod";
          }
          if (id.includes("packages/shared") || id.includes("packages\\shared")) {
            return "shared";
          }
        },
      },
    },
  },
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/docs": { target: apiTarget, changeOrigin: true },
    },
  },
});
