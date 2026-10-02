import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ArtifactStore } from "../../application/ports/artifact-store";

export class FilesystemArtifactStore implements ArtifactStore {
  constructor(private readonly directory = resolve(/* turbopackIgnore: true */ process.env.A2A_ARTIFACT_DATA_DIR || join(process.cwd(), ".data", "artifacts"))) {}
  private location(organizationId: string, digest: string) {
    if (!/^[0-9a-f-]{36}$/i.test(organizationId) || !/^[0-9a-f]{64}$/.test(digest)) throw new Error("Invalid artifact identity.");
    return join(this.directory, organizationId, digest);
  }
  async put(organizationId: string, bytes: Uint8Array) {
    if (bytes.byteLength > 16 * 1024 * 1024) throw new Error("Artifact exceeds the 16 MB persistence limit.");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const path = this.location(organizationId, digest);
    await mkdir(join(this.directory, organizationId), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes, { flag: "wx" });
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }); }
    return { objectKey: `${organizationId}/${digest}`, digest, sizeBytes: bytes.byteLength };
  }
  async get(organizationId: string, digest: string) {
    try { return await readFile(this.location(organizationId, digest)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
}
