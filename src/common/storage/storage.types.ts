export type StorageNamespace = 'avatars' | 'releases';
export type StoredObject = { objectKey: string; sizeBytes: number; contentType: string; fileName: string };
export type PutObjectInput = { namespace: StorageNamespace; fileName: string; contentType: string; buffer: Buffer };

export abstract class ObjectStorage {
  abstract put(input: PutObjectInput): Promise<StoredObject>;
  abstract remove(objectKey: string): Promise<void>;
  abstract downloadUrl(objectKey: string, fileName?: string): Promise<string>;
  abstract resolvePath(objectKey: string): Promise<string | null>;
}
