export interface StoredObject { objectKey: string; digest: string; sizeBytes: number }
export interface ArtifactStore {
  put(organizationId: string, bytes: Uint8Array): Promise<StoredObject>;
  get(organizationId: string, digest: string): Promise<Uint8Array | undefined>;
}
