import {
  assetUploadUrlResponseSchema,
  filePurposeSchema,
  ownerOnlyFilePurposes,
  privateAudioPurposes,
  uploadedFileSchema,
} from "@orbit/shared";
import type {
  AssetUploadUrlRequest,
  AssetUploadUrlResponse,
  CompleteAssetUploadRequest,
  FilePurpose,
  UploadedFile,
} from "@orbit/shared";
import { StoragePort } from "@orbit/storage";
import { createHash, randomUUID } from "crypto";
import type { Readable } from "node:stream";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ProjectsService } from "../projects/projects.service";
import { ProjectAssetEntity } from "./project-asset.entity";

export const STORAGE_PORT = Symbol("STORAGE_PORT");
export const UPLOAD_PROXY_ORIGIN = Symbol("UPLOAD_PROXY_ORIGIN");

const uploadUrlExpiresInSeconds = 15 * 60;
const maximumPrivateAudioReadUrlExpiresInSeconds = 15 * 60;
const assetContentCacheControl = "private, no-cache";
const publicAssetContentPurposes = new Set<FilePurpose>([
  "thumbnail",
  "pptx-import",
  "reference-material",
  "export-result",
  "report-result",
  "rehearsal-slide-snapshot",
  "design-asset",
]);

@Injectable()
export class FilesService {
  private readonly localStorageEndpoint = (
    process.env.S3_ENDPOINT ?? "http://localhost:9000"
  ).replace(/\/+$/, "");
  private readonly localStorageBucket = process.env.S3_BUCKET ?? "orbit-local";

  constructor(
    @InjectRepository(ProjectAssetEntity)
    private readonly assetsRepository: Repository<ProjectAssetEntity>,
    private readonly projectsService: ProjectsService,
    @Inject(STORAGE_PORT)
    private readonly storage: StoragePort,
    @Optional()
    @Inject(UPLOAD_PROXY_ORIGIN)
    private readonly uploadProxyOrigin: string | null = null,
  ) {}

  async createUploadUrl(
    projectId: string,
    input: AssetUploadUrlRequest,
    requestOrigin?: string | null,
    storageKeyOverride?: string,
  ): Promise<AssetUploadUrlResponse> {
    const project = await this.projectsService.getAccessibleProject(projectId);
    const fileId = `file_${randomUUID()}`;
    const storageKey =
      storageKeyOverride ??
      this.createStorageKey(project.projectId, fileId, input.originalName);
    const uploadUrl = await this.createUploadTarget({
      projectId: project.projectId,
      fileId,
      key: storageKey,
      contentType: input.mimeType,
      expiresInSeconds: uploadUrlExpiresInSeconds,
      requestOrigin,
    });

    const asset = this.assetsRepository.create({
      fileId,
      projectId: project.projectId,
      storageKey,
      originalName: input.originalName,
      mimeType: input.mimeType,
      size: input.size,
      url: this.uploadProxyOrigin
        ? this.createAssetAccessUrl(project.projectId, fileId, requestOrigin)
        : uploadUrl.url,
      purpose: input.purpose,
      status: "pending",
      createdAt: new Date(),
      uploadedAt: null,
    });

    await this.assetsRepository.save(asset);

    return assetUploadUrlResponseSchema.parse({
      fileId,
      projectId: project.projectId,
      uploadUrl: uploadUrl.url,
      method: uploadUrl.method,
      headers: uploadUrl.headers,
      expiresAt: uploadUrl.expiresAt,
      purpose: input.purpose,
    });
  }

  async createRehearsalAudioUploadUrl(
    projectId: string,
    input: AssetUploadUrlRequest,
    rehearsal: { runId: string; createdAt: Date },
  ): Promise<AssetUploadUrlResponse> {
    const extension = rehearsalAudioExtension(input.mimeType);
    const date = formatAsiaSeoulDate(rehearsal.createdAt);
    const storageKey = `rehearsals/${date}/${projectId}/${rehearsal.runId}/audio.${extension}`;
    return this.createUploadUrl(projectId, input, undefined, storageKey);
  }

  // local MinIO 모드에서 브라우저가 보낸 binary를 실제 storage object로 저장한다.
  async storeUploadContent(
    projectId: string,
    fileId: string,
    body: Uint8Array,
  ): Promise<void> {
    await this.projectsService.getAccessibleProject(projectId);

    const asset = await this.assetsRepository.findOne({
      where: { fileId },
    });

    if (!asset) {
      throw new NotFoundException(`Asset not found: ${fileId}`);
    }

    if (asset.projectId !== projectId) {
      throw new ForbiddenException("Project asset access denied");
    }

    if (asset.status !== "pending") {
      throw new BadRequestException("Asset upload is not pending.");
    }

    if (body.byteLength !== asset.size) {
      throw new BadRequestException(
        `Asset size mismatch: declared ${asset.size}, received ${body.byteLength}`,
      );
    }

    const object = await this.storage.putObject({
      key: asset.storageKey,
      body,
      contentType: asset.mimeType,
      purpose: filePurposeSchema.parse(asset.purpose),
    });

    asset.url = this.uploadProxyOrigin
      ? this.createAssetAccessUrl(asset.projectId, asset.fileId)
      : object.url;
    await this.assetsRepository.save(asset);
  }

  async completeUpload(
    projectId: string,
    input: CompleteAssetUploadRequest,
    expectedPurpose?: FilePurpose,
  ): Promise<UploadedFile> {
    await this.projectsService.getAccessibleProject(projectId);

    const asset = await this.assetsRepository.findOne({
      where: { fileId: input.fileId },
    });

    if (!asset) {
      throw new NotFoundException(`Asset not found: ${input.fileId}`);
    }

    if (asset.projectId !== projectId) {
      throw new ForbiddenException("Project asset access denied");
    }

    if (
      (expectedPurpose && asset.purpose !== expectedPurpose) ||
      (!expectedPurpose && ownerOnlyFilePurposes.has(asset.purpose))
    ) {
      throw new NotFoundException(`Asset not found: ${input.fileId}`);
    }

    if (asset.status === "deleted") {
      throw new NotFoundException(`Asset is deleted: ${input.fileId}`);
    }

    await this.verifyUploadedObject(asset);

    if (asset.status !== "uploaded") {
      asset.status = "uploaded";
      asset.uploadedAt = new Date();
      await this.assetsRepository.save(asset);
    }

    return this.toUploadedFile(asset);
  }

  async getUploadedAsset(
    projectId: string,
    fileId: string,
    purpose?: FilePurpose,
  ): Promise<ProjectAssetEntity> {
    await this.projectsService.getAccessibleProject(projectId);

    const asset = await this.assetsRepository.findOne({
      where: { fileId },
    });

    if (!asset) {
      throw new NotFoundException(`Asset not found: ${fileId}`);
    }

    if (asset.projectId !== projectId) {
      throw new ForbiddenException("Project asset access denied");
    }

    if (asset.status !== "uploaded") {
      throw new NotFoundException(`Asset is not uploaded: ${fileId}`);
    }

    if (purpose && asset.purpose !== purpose) {
      throw new ForbiddenException(`Asset purpose must be ${purpose}`);
    }

    if (!purpose && ownerOnlyFilePurposes.has(asset.purpose)) {
      throw new NotFoundException(`Asset not found: ${fileId}`);
    }

    return asset;
  }

  async getOrCreatePrivateAudioDerivative(
    projectId: string,
    fileId: string,
    purpose: FilePurpose,
    derivativeFileName: string,
    createDerivative: (source: {
      body: Uint8Array;
      contentType: string;
    }) => Promise<Uint8Array>,
  ): Promise<{
    body: Uint8Array;
    contentType: string;
    storageKey: string;
    created: boolean;
  }> {
    if (!privateAudioPurposes.has(purpose)) {
      throw new BadRequestException("Private audio purpose is required.");
    }
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(derivativeFileName)) {
      throw new BadRequestException(
        "Private audio derivative name is invalid.",
      );
    }

    const asset = await this.getUploadedAsset(projectId, fileId, purpose);
    const separatorIndex = asset.storageKey.lastIndexOf("/");
    const storageFolder =
      separatorIndex >= 0 ? asset.storageKey.slice(0, separatorIndex + 1) : "";
    const storageKey = `${storageFolder}${derivativeFileName}`;
    const existing = await this.storage.headObject(storageKey);
    if (existing) {
      const stored = await this.storage.getObject(storageKey);
      return { ...stored, storageKey, created: false };
    }

    const source = await this.storage.getObject(asset.storageKey);
    const body = await createDerivative(source);
    await this.storage.putObject({
      key: storageKey,
      body,
      contentType: "audio/wav",
      purpose,
    });
    return { body, contentType: "audio/wav", storageKey, created: true };
  }
  async createPrivateAudioReadUrl(
    projectId: string,
    fileId: string,
    purpose: FilePurpose,
    expiresInSeconds: number,
  ): Promise<string> {
    if (!privateAudioPurposes.has(purpose)) {
      throw new BadRequestException("Private audio purpose is required.");
    }
    if (
      !Number.isInteger(expiresInSeconds) ||
      expiresInSeconds < 1 ||
      expiresInSeconds > maximumPrivateAudioReadUrlExpiresInSeconds
    ) {
      throw new BadRequestException(
        "Private audio read URL expiry is invalid.",
      );
    }

    const asset = await this.getUploadedAsset(projectId, fileId, purpose);
    return this.storage.getSignedReadUrl(asset.storageKey, expiresInSeconds);
  }

  async isPrivateAudioAvailable(
    projectId: string,
    fileId: string,
    purpose: FilePurpose,
  ): Promise<boolean> {
    if (!privateAudioPurposes.has(purpose)) {
      throw new BadRequestException("Private audio purpose is required.");
    }

    try {
      const asset = await this.getUploadedAsset(projectId, fileId, purpose);
      return (await this.storage.headObject(asset.storageKey)) !== null;
    } catch (error) {
      if (error instanceof NotFoundException) return false;
      throw error;
    }
  }

  private async verifyUploadedObject(asset: ProjectAssetEntity): Promise<void> {
    const head = await this.storage.headObject(asset.storageKey);

    if (!head) {
      throw new NotFoundException(
        `Asset not found in storage: ${asset.fileId}`,
      );
    }

    if (head.contentLength !== asset.size) {
      throw new BadRequestException(
        `Asset size mismatch: declared ${asset.size}, stored ${head.contentLength}`,
      );
    }

    if (head.contentType !== asset.mimeType) {
      throw new BadRequestException(
        `Asset content-type mismatch: declared ${asset.mimeType}, stored ${head.contentType}`,
      );
    }
  }

  async deleteUploadedAsset(
    projectId: string,
    fileId: string,
    purpose?: FilePurpose,
  ): Promise<string> {
    await this.projectsService.getAccessibleProject(projectId);

    const asset = await this.assetsRepository.findOne({
      where: { fileId },
    });

    if (!asset) {
      throw new NotFoundException(`Asset not found: ${fileId}`);
    }

    if (asset.projectId !== projectId) {
      throw new ForbiddenException("Project asset access denied");
    }

    if (purpose && asset.purpose !== purpose) {
      throw new ForbiddenException(`Asset purpose must be ${purpose}`);
    }

    if (asset.status === "deleted") {
      if (!asset.deletedAt) {
        throw new NotFoundException(
          `Asset is deleted without deletion time: ${fileId}`,
        );
      }

      return asset.deletedAt.toISOString();
    }

    await this.storage.removeObject(asset.storageKey);

    const deletedAt = new Date();
    asset.status = "deleted";
    asset.deletedAt = deletedAt;
    await this.assetsRepository.save(asset);

    return deletedAt.toISOString();
  }

  async list(projectId: string): Promise<UploadedFile[]> {
    await this.projectsService.getAccessibleProject(projectId);

    const assets = await this.assetsRepository.find({
      where: { projectId, status: "uploaded" },
      order: { createdAt: "ASC" },
    });

    return assets
      .filter((asset) => !ownerOnlyFilePurposes.has(asset.purpose))
      .map((asset) => this.toUploadedFile(asset));
  }

  async readUploadedAssetContent(
    projectId: string,
    fileId: string,
    purpose?: FilePurpose,
  ): Promise<{ body: Buffer; contentType: string }> {
    const asset = await this.getUploadedAsset(projectId, fileId, purpose);
    const assetPurpose = filePurposeSchema.parse(asset.purpose);

    if (!publicAssetContentPurposes.has(assetPurpose)) {
      throw new NotFoundException(`Asset content unavailable: ${fileId}`);
    }

    const readUrl = this.uploadProxyOrigin
      ? this.createInternalObjectUrl(asset.storageKey)
      : await this.storage.getSignedReadUrl(asset.storageKey);

    const response = await fetch(readUrl);

    if (!response.ok) {
      throw new NotFoundException(`Asset content unavailable: ${fileId}`);
    }

    return {
      body: Buffer.from(await response.arrayBuffer()),
      contentType: asset.mimeType,
    };
  }

  async openUploadedAssetContent(
    projectId: string,
    fileId: string,
    ifNoneMatch?: string,
  ): Promise<
    | {
        status: "not-modified";
        cacheControl: string;
        etag: string;
      }
    | {
        status: "ok";
        body: Readable;
        cacheControl: string;
        contentLength: number;
        contentType: string;
        etag: string;
      }
  > {
    const asset = await this.getUploadedAsset(projectId, fileId);
    const assetPurpose = filePurposeSchema.parse(asset.purpose);

    if (!publicAssetContentPurposes.has(assetPurpose)) {
      throw new NotFoundException(`Asset content unavailable: ${fileId}`);
    }

    const etag = createAssetContentEtag(asset);
    if (matchesIfNoneMatch(ifNoneMatch, etag)) {
      return {
        status: "not-modified",
        cacheControl: assetContentCacheControl,
        etag,
      };
    }

    const stored = await this.storage.getObjectStream(asset.storageKey);
    return {
      status: "ok",
      body: stored.body,
      cacheControl: assetContentCacheControl,
      contentLength: stored.contentLength || asset.size,
      contentType: asset.mimeType,
      etag,
    };
  }

  private createStorageKey(
    projectId: string,
    fileId: string,
    originalName: string,
  ): string {
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
    return `projects/${projectId}/assets/${fileId}-${safeName}`;
  }

  // 환경에 따라 local API proxy URL 또는 S3 presigned URL을 선택한다.
  private async createUploadTarget(input: {
    projectId: string;
    fileId: string;
    key: string;
    contentType: string;
    expiresInSeconds: number;
    requestOrigin?: string | null;
  }) {
    if (this.uploadProxyOrigin) {
      return {
        key: input.key,
        url: this.createUploadProxyUrl(
          input.projectId,
          input.fileId,
          input.requestOrigin,
        ),
        method: "PUT" as const,
        headers: {
          "content-type": input.contentType,
        },
        expiresAt: new Date(
          Date.now() + input.expiresInSeconds * 1000,
        ).toISOString(),
      };
    }

    return this.storage.createUploadUrl(input);
  }

  // 브라우저 origin과 같은 host를 쓰는 API upload proxy URL을 만든다.
  private createUploadProxyUrl(
    projectId: string,
    fileId: string,
    requestOrigin?: string | null,
  ): string {
    const origin = (requestOrigin ?? this.uploadProxyOrigin ?? "").replace(
      /\/+$/,
      "",
    );
    return `${origin}/api/v1/projects/${encodeURIComponent(
      projectId,
    )}/assets/${encodeURIComponent(fileId)}/content`;
  }

  private createAssetAccessUrl(
    projectId: string,
    fileId: string,
    requestOrigin?: string | null,
  ) {
    return this.createUploadProxyUrl(projectId, fileId, requestOrigin);
  }

  private createInternalObjectUrl(storageKey: string) {
    const encodedKey = storageKey
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");

    return `${this.localStorageEndpoint}/${this.localStorageBucket}/${encodedKey}`;
  }

  private toUploadedFile(asset: ProjectAssetEntity): UploadedFile {
    return uploadedFileSchema.parse({
      fileId: asset.fileId,
      projectId: asset.projectId,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      size: asset.size,
      url: asset.url,
      purpose: asset.purpose,
      createdAt: asset.createdAt.toISOString(),
    });
  }
}

function createAssetContentEtag(asset: ProjectAssetEntity): string {
  const uploadedAt = (asset.uploadedAt ?? asset.createdAt).toISOString();
  const digest = createHash("sha256")
    .update(`${asset.fileId}:${asset.size}:${uploadedAt}`)
    .digest("base64url");
  return `W/"${digest}"`;
}

function matchesIfNoneMatch(
  ifNoneMatch: string | undefined,
  currentEtag: string,
): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === "*" || value === currentEtag);
}

function formatAsiaSeoulDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const readPart = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value;
  return `${readPart("year")}-${readPart("month")}-${readPart("day")}`;
}

function rehearsalAudioExtension(mimeType: string): string {
  const extensions: Record<string, string> = {
    "audio/webm": "webm",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/mp4": "m4a",
    "video/mp4": "m4a",
    "audio/ogg": "ogg",
    "audio/mp3": "mp3",
    "audio/mpeg": "mp3",
    "audio/mpga": "mp3",
    "audio/flac": "flac",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
  };
  return extensions[mimeType] ?? "webm";
}
