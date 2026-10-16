import { rmSync } from "node:fs";
import path from "node:path";

/**
 * A BD PGlite usada nos e2e (apps/api/.data/pglite-e2e) é descartável —
 * acumular dados entre corridas tornava a suite progressivamente lenta
 * e flaky. Apaga-se antes de cada execução; as migrações recriam-na.
 */
export default function globalSetup() {
  const dir = path.resolve(__dirname, "../apps/api/.data/pglite-e2e");
  rmSync(dir, { recursive: true, force: true });
}
