import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { env } from "../env.js";

/**
 * Interface de armazenamento de documentos.
 * Produção: implementar driver S3-compatível (MinIO/AWS) — ver STORAGE_DIR env.
 */
export interface StorageDriver {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

class LocalStorage implements StorageDriver {
  constructor(private root: string) {}

  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root))) {
      throw new Error("storage key inválida");
    }
    return p;
  }

  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  get(key: string) {
    return readFile(this.resolve(key));
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

export function createStorage(): StorageDriver {
  const dir =
    env.NODE_ENV === "test"
      ? path.join(tmpdir(), `blujay-storage-${process.pid}-${Math.random().toString(36).slice(2)}`)
      : env.STORAGE_DIR;
  return new LocalStorage(dir);
}
