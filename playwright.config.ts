import { defineConfig, devices } from "@playwright/test";

const API_PORT = 3101;
const WEB_PORT = 5273;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    // A app deteta o idioma por navigator.language — os specs usam texto pt-PT
    locale: "pt-PT",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run dev -w @transitum/api",
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      timeout: 90_000,
      reuseExistingServer: false,
      env: {
        PORT: String(API_PORT),
        PGLITE_DIR: ".data/pglite-e2e",
        NODE_ENV: "test",
        DATABASE_URL: "",
        JWT_SECRET: "e2e-secret-key-playwright-only-01234567",
        WEB_BASE_URL: `http://localhost:${WEB_PORT}`,
        PLATFORM_ADMIN_EMAILS: "e2e-admin@transitum.dev",
      },
    },
    {
      command: "npm run dev -w @transitum/web",
      url: `http://localhost:${WEB_PORT}`,
      timeout: 90_000,
      reuseExistingServer: false,
      env: {
        WEB_PORT: String(WEB_PORT),
        API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}`,
      },
    },
  ],
});
