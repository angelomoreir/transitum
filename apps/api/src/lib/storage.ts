import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { env } from "../env.js";

/**
 * Interface de armazenamento de documentos.
 * Driver local em disco por omissão (`.data/storage`); driver S3/MinIO ativado
 * quando `S3_BUCKET` está definido (endpoint opcional para MinIO/compatíveis).
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

/**
 * Driver S3-compatível (AWS S3, MinIO, R2…). O SDK é carregado dinamicamente
 * para não pesar em ambientes sem S3 configurado.
 */
class S3Storage implements StorageDriver {
  private clientPromise: Promise<
    import("@aws-sdk/client-s3").S3Client
  > | null = null;

  constructor(private bucket: string) {}

  private client() {
    this.clientPromise ??= import("@aws-sdk/client-s3").then(
      ({ S3Client }) =>
        new S3Client({
          endpoint: env.S3_ENDPOINT || undefined,
          region: env.S3_REGION,
          forcePathStyle: !!env.S3_ENDPOINT, // MinIO exige path-style
          credentials: {
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          },
        }),
    );
    return this.clientPromise;
  }

  async put(key: string, data: Buffer) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.client()).send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data }),
    );
  }

  async get(key: string) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const res = await (await this.client()).send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async delete(key: string) {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.client()).send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

export function createStorage(): StorageDriver {
  if (env.S3_BUCKET) return new S3Storage(env.S3_BUCKET);
  const dir =
    env.NODE_ENV === "test"
      ? path.join(tmpdir(), `transitum-storage-${process.pid}-${Math.random().toString(36).slice(2)}`)
      : env.STORAGE_DIR;
  return new LocalStorage(dir);
}
