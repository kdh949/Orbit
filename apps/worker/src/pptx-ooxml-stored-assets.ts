import type { PptxOoxmlStoredAsset } from "@orbit/shared/deck";
import type { StoragePort } from "@orbit/storage";
import { createHash } from "node:crypto";
import type { EntityManager } from "typeorm";

const MAX_ASSET_COUNT = 2_000;
const MAX_TOTAL_ASSET_BYTES = 512 * 1024 * 1024;

export function createPptxOoxmlStoragePrefix(
  projectId: string,
  jobId: string,
): string {
  return `projects/${safeStorageSegment(projectId)}/jobs/${safeStorageSegment(
    jobId,
  )}/pptx-ooxml/`;
}

export async function verifyPptxOoxmlStoredAssets(
  storage: Pick<StoragePort, "headObject">,
  expectedPrefix: string,
  assets: PptxOoxmlStoredAsset[],
): Promise<void> {
  if (assets.length > MAX_ASSET_COUNT) {
    throw new Error(`OOXML asset count exceeds ${MAX_ASSET_COUNT}`);
  }

  const assetIds = new Set<string>();
  const storageKeys = new Set<string>();
  let totalBytes = 0;

  for (const asset of assets) {
    if (!asset.storageKey.startsWith(expectedPrefix)) {
      throw new Error(`OOXML asset storage prefix mismatch: ${asset.assetId}`);
    }
    if (assetIds.has(asset.assetId)) {
      throw new Error(`Duplicate OOXML asset id: ${asset.assetId}`);
    }
    if (storageKeys.has(asset.storageKey)) {
      throw new Error(`Duplicate OOXML asset storage key: ${asset.assetId}`);
    }
    assetIds.add(asset.assetId);
    storageKeys.add(asset.storageKey);
    totalBytes += asset.size;
    if (totalBytes > MAX_TOTAL_ASSET_BYTES) {
      throw new Error("OOXML asset manifest exceeds the total byte limit");
    }

    const stored = await storage.headObject(asset.storageKey);
    if (!stored) {
      throw new Error(`OOXML asset is missing from storage: ${asset.assetId}`);
    }
    if (stored.contentLength !== asset.size) {
      throw new Error(`OOXML asset size mismatch: ${asset.assetId}`);
    }
    if (stored.contentType !== asset.mimeType) {
      throw new Error(`OOXML asset MIME type mismatch: ${asset.assetId}`);
    }
    if (stored.metadata?.["orbit-sha256"] !== asset.sha256) {
      throw new Error(`OOXML asset digest mismatch: ${asset.assetId}`);
    }
  }
}

export function pptxOoxmlAssetFileId(
  projectId: string,
  storageKey: string,
): string {
  const digest = createHash("sha256")
    .update(`${projectId}\0${storageKey}`)
    .digest("hex")
    .slice(0, 32);
  return `file_ooxml_${digest}`;
}

export async function registerPptxOoxmlStoredAssets(
  manager: Pick<EntityManager, "query">,
  projectId: string,
  assets: PptxOoxmlStoredAsset[],
): Promise<void> {
  for (const asset of assets) {
    const fileId = pptxOoxmlAssetFileId(projectId, asset.storageKey);
    const rows = readQueryRows<{ file_id: string }>(
      await manager.query(
        `
          INSERT INTO project_assets (
            file_id, project_id, storage_key, original_name, mime_type, size, url,
            purpose, status, content_hash, created_at, uploaded_at, deleted_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            'design-asset', 'uploaded', $8, now(), now(), null
          )
          ON CONFLICT (file_id) DO UPDATE SET
            storage_key = EXCLUDED.storage_key,
            original_name = EXCLUDED.original_name,
            mime_type = EXCLUDED.mime_type,
            size = EXCLUDED.size,
            url = EXCLUDED.url,
            status = 'uploaded',
            content_hash = EXCLUDED.content_hash,
            uploaded_at = now(),
            deleted_at = null
          WHERE project_assets.project_id = EXCLUDED.project_id
          RETURNING file_id
        `,
        [
          fileId,
          projectId,
          asset.storageKey,
          safeStorageName(asset.fileName),
          asset.mimeType,
          asset.size,
          createAssetContentUrl(projectId, fileId),
          asset.sha256,
        ],
      ),
    );
    if (rows[0]?.file_id !== fileId) {
      throw new Error(`OOXML asset file id conflict: ${asset.assetId}`);
    }
  }
}

export function createPptxOoxmlAssetRefs(
  projectId: string,
  assets: PptxOoxmlStoredAsset[],
): { fileIds: Map<string, string>; urls: Map<string, string> } {
  const fileIds = new Map<string, string>();
  const urls = new Map<string, string>();
  for (const asset of assets) {
    const fileId = pptxOoxmlAssetFileId(projectId, asset.storageKey);
    fileIds.set(`asset:${asset.assetId}`, fileId);
    urls.set(`asset:${asset.assetId}`, createAssetContentUrl(projectId, fileId));
  }
  return { fileIds, urls };
}

function createAssetContentUrl(projectId: string, fileId: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(
    fileId,
  )}/content`;
}

function safeStorageName(fileName: string): string {
  return (fileName || "design-asset").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function safeStorageSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_") || "unknown";
}

function readQueryRows<T>(result: unknown): T[] {
  if (!Array.isArray(result)) {
    return [];
  }
  if (Array.isArray(result[0])) {
    return result[0] as T[];
  }
  return result as T[];
}
