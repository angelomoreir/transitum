import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "",
      JWT_SECRET: "test-secret-key-for-vitest-only-0123456",
      WEB_BASE_URL: "http://localhost:5173",
    },
  },
});
