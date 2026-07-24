import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Project, demoIds } from "@orbit/shared";
import { StoragePort } from "@orbit/storage";
import { Readable } from "node:stream";
import { Repository } from "typeorm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectsService } from "../projects/projects.service";
import { FilesService } from "./files.service";
import { ProjectAssetEntity } from "./project-asset.entity";

type AssetFindOptions = {
  where: Partial<ProjectAssetEntity>;
};

const demoProject: Project = {
  projectId: "project_demo_created",
  workspaceId: demoIds.workspaceId,
  title: "Demo",
  createdBy: demoIds.userId,
  createdAt: "2026-06-27T01:00:00.000Z",
};

function createAssetRepository(initialAssets: ProjectAssetEntity[] = []) {
  const assets = [...initialAssets];

  const repository = {
    create(input: Partial<ProjectAssetEntity>): ProjectAssetEntity {
      return input as ProjectAssetEntity;
    },
    async save(asset: ProjectAssetEntity): Promise<ProjectAssetEntity> {
      const index = assets.findIndex((item) => item.fileId === asset.fileId);
      if (index >= 0) {
        assets[index] = asset;
      } else {
        assets.push(asset);
      }

      return asset;
    },
    async find(options: AssetFindOptions): Promise<ProjectAssetEntity[]> {
      return assets.filter(
        (asset) =>
          asset.projectId === options.where.projectId &&
          asset.status === options.where.status,
      );
    },
    async findOne(
      options: AssetFindOptions,
    ): Promise<ProjectAssetEntity | null> {
      return (
        assets.find((asset) => asset.fileId === options.where.fileId) ?? null
      );
    },
  };

  return {
    assets,
    repository: repository as unknown as Repository<ProjectAssetEntity>,
  };
}

function createStorage(overrides: Partial<StoragePort> = {}): StoragePort {
  return {
    putObject: vi.fn(async (input) => ({
      key: input.key,
      url: `http://localhost:9000/orbit-local/${input.key}`,
      contentType: input.contentType,
      purpose: input.purpose,
      size:
        typeof input.body === "string"
          ? input.body.length
          : input.body.byteLength,
    })),
    createUploadUrl: vi.fn(async (input) => ({
      key: input.key,
      url: `http://localhost:9000/orbit-local/${input.key}`,
      method: "PUT" as const,
      headers: {
        "content-type": input.contentType,
      },
      expiresAt: "2026-06-27T01:15:00.000Z",
    })),
    getObject: vi.fn(async () => ({
      body: new Uint8Array([1, 2, 3]),
      contentType: "application/octet-stream",
    })),
    getObjectStream: vi.fn(async () => ({
      body: Readable.from(Uint8Array.from([1, 2, 3])),
      contentLength: 3,
      contentType: "application/octet-stream",
    })),
    getSignedReadUrl: vi.fn(
      async (key) => `http://localhost:9000/orbit-local/${key}`,
    ),
    removeObject: vi.fn(async () => undefined),
    headObject: vi.fn(async () => ({
      contentLength: 1024,
      contentType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    })),
    ...overrides,
  };
}

function createService(
  projectsService: Partial<ProjectsService>,
  options: {
    uploadProxyOrigin?: string | null;
    storagePatch?: Partial<StoragePort>;
  } = {},
) {
  const { assets, repository } = createAssetRepository();
  const storage = createStorage(options.storagePatch);

  return {
    assets,
    repository,
    storage,
    service: new FilesService(
      repository,
      projectsService as ProjectsService,
      storage,
      options.uploadProxyOrigin,
    ),
  };
}

describe("FilesService", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("opens public asset content as a stream with a stable private validator", async () => {
    const getObjectStream = vi.fn(async () => ({
      body: Readable.from(Uint8Array.from([1, 2, 3])),
      contentLength: 3,
      contentType: "image/png",
    }));
    const uploadedAt = new Date("2026-07-20T01:00:00.000Z");
    const { repository } = createAssetRepository([
      {
        fileId: "file_1",
        projectId: demoProject.projectId,
        storageKey: "projects/project_demo_created/assets/file_1-report.png",
        originalName: "report.png",
        mimeType: "image/png",
        size: 3,
        url: "/api/v1/projects/project_demo_created/assets/file_1/content",
        purpose: "reference-material",
        status: "uploaded",
        createdAt: uploadedAt,
        uploadedAt,
      } as ProjectAssetEntity,
    ]);
    const service = new FilesService(
      repository,
      {
        getAccessibleProject: vi.fn(async () => demoProject),
      } as unknown as ProjectsService,
      createStorage({ getObjectStream }),
      "http://localhost:5173",
    );

    const result = await service.openUploadedAssetContent(
      demoProject.projectId,
      "file_1",
    );

    expect(result).toMatchObject({
      status: "ok",
      cacheControl: "private, no-cache",
      contentLength: 3,
      contentType: "image/png",
      etag: expect.stringMatching(/^W\/"[A-Za-z0-9_-]+"$/),
    });
    expect(getObjectStream).toHaveBeenCalledWith(
      "projects/project_demo_created/assets/file_1-report.png",
    );
  });

  it("opens only image content with a companion-renderable purpose", async () => {
    const getObjectStream = vi.fn(async () => ({
      body: Readable.from(Uint8Array.from([1, 2, 3])),
      contentLength: 3,
      contentType: "image/svg+xml",
    }));
    const { repository } = createAssetRepository([
      {
        fileId: "file_companion_svg",
        projectId: demoProject.projectId,
        storageKey:
          "projects/project_demo_created/assets/file_companion_svg.svg",
        originalName: "diagram.svg",
        mimeType: "image/svg+xml",
        size: 3,
        url: "/api/v1/projects/project_demo_created/assets/file_companion_svg/content",
        purpose: "design-asset",
        status: "uploaded",
        createdAt: new Date("2026-07-20T01:00:00.000Z"),
        uploadedAt: new Date("2026-07-20T01:00:00.000Z"),
      } as ProjectAssetEntity,
    ]);
    const service = new FilesService(
      repository,
      {
        getAccessibleProject: vi.fn(async () => demoProject),
      } as unknown as ProjectsService,
      createStorage({ getObjectStream }),
    );

    await expect(
      service.openCompanionRenderableAssetContent(
        demoProject.projectId,
        "file_companion_svg",
      ),
    ).resolves.toMatchObject({
      status: "ok",
      contentType: "image/svg+xml",
    });
    expect(getObjectStream).toHaveBeenCalledOnce();
  });

  it.each([
    ["presentation-audio", "audio/webm"],
    ["report-result", "image/png"],
    ["design-asset", "application/pdf"],
  ] as const)(
    "hides %s %s content from the companion asset boundary",
    async (purpose, mimeType) => {
      const { repository } = createAssetRepository([
        {
          fileId: "file_companion_blocked",
          projectId: demoProject.projectId,
          storageKey:
            "projects/project_demo_created/assets/file_companion_blocked",
          originalName: "blocked",
          mimeType,
          size: 3,
          url: "/blocked",
          purpose,
          status: "uploaded",
          createdAt: new Date("2026-07-20T01:00:00.000Z"),
          uploadedAt: new Date("2026-07-20T01:00:00.000Z"),
        } as ProjectAssetEntity,
      ]);
      const storage = createStorage();
      const service = new FilesService(
        repository,
        {
          getAccessibleProject: vi.fn(async () => demoProject),
        } as unknown as ProjectsService,
        storage,
      );

      await expect(
        service.openCompanionRenderableAssetContent(
          demoProject.projectId,
          "file_companion_blocked",
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.getObjectStream).not.toHaveBeenCalled();
    },
  );

  it("returns not-modified without opening storage when the validator matches", async () => {
    const getObjectStream = vi.fn(async () => ({
      body: Readable.from(Uint8Array.from([1, 2, 3])),
      contentLength: 3,
      contentType: "image/png",
    }));
    const uploadedAt = new Date("2026-07-20T01:00:00.000Z");
    const asset = {
      fileId: "file_1",
      projectId: demoProject.projectId,
      storageKey: "projects/project_demo_created/assets/file_1-report.png",
      originalName: "report.png",
      mimeType: "image/png",
      size: 3,
      url: "/api/v1/projects/project_demo_created/assets/file_1/content",
      purpose: "reference-material",
      status: "uploaded",
      createdAt: uploadedAt,
      uploadedAt,
    } as ProjectAssetEntity;
    const { repository } = createAssetRepository([asset]);
    const service = new FilesService(
      repository,
      {
        getAccessibleProject: vi.fn(async () => demoProject),
      } as unknown as ProjectsService,
      createStorage({ getObjectStream }),
      "http://localhost:5173",
    );
    const first = await service.openUploadedAssetContent(
      demoProject.projectId,
      "file_1",
    );
    if (first.status !== "ok") throw new Error("expected streamed asset");
    getObjectStream.mockClear();

    const result = await service.openUploadedAssetContent(
      demoProject.projectId,
      "file_1",
      first.etag,
    );

    expect(result).toEqual({
      status: "not-modified",
      cacheControl: "private, no-cache",
      etag: first.etag,
    });
    expect(getObjectStream).not.toHaveBeenCalled();
  });

  it("creates a pending upload URL and completes it as uploaded metadata", async () => {
    const { assets, service } = createService({
      getAccessibleProject: vi.fn(async () => demoProject),
    });

    const upload = await service.createUploadUrl(demoProject.projectId, {
      originalName: "slides.pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      size: 1024,
      purpose: "pptx-import",
    });

    expect(upload.fileId).toMatch(/^file_/);
    expect(upload.projectId).toBe(demoProject.projectId);
    expect(upload.method).toBe("PUT");
    expect(assets).toHaveLength(1);
    expect(assets[0].status).toBe("pending");

    await expect(service.list(demoProject.projectId)).resolves.toEqual([]);

    const completed = await service.completeUpload(demoProject.projectId, {
      fileId: upload.fileId,
    });

    expect(completed).toMatchObject({
      fileId: upload.fileId,
      projectId: demoProject.projectId,
      originalName: "slides.pptx",
      purpose: "pptx-import",
    });
    expect(assets[0].status).toBe("uploaded");
    await expect(service.list(demoProject.projectId)).resolves.toEqual([
      completed,
    ]);
  });

  it("creates a rehearsal audio key from the Seoul run date", async () => {
    const { assets, service, storage } = createService({
      getAccessibleProject: vi.fn(async () => demoProject),
    });

    await service.createRehearsalAudioUploadUrl(
      demoProject.projectId,
      {
        originalName: "browser-recording.ogg",
        mimeType: "audio/ogg",
        size: 1024,
        purpose: "rehearsal-audio",
      },
      { runId: "run_123", createdAt: new Date("2026-07-15T15:30:00.000Z") },
    );

    expect(storage.createUploadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        key: `raw/rehearsals/2026-07-16/${demoProject.projectId}/run_123/audio.ogg`,
        contentType: "audio/ogg",
      }),
    );
    expect(assets[0]).toMatchObject({
      purpose: "rehearsal-audio",
      storageKey: `raw/rehearsals/2026-07-16/${demoProject.projectId}/run_123/audio.ogg`,
    });
  });

  it("creates generic private-audio uploads under the raw lifecycle prefix", async () => {
    const { assets, service, storage } = createService({
      getAccessibleProject: vi.fn(async () => demoProject),
    });

    await service.createUploadUrl(demoProject.projectId, {
      originalName: "focused-attempt.webm",
      mimeType: "audio/webm",
      size: 1024,
      purpose: "focused-practice-audio",
    });

    expect(storage.createUploadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringMatching(
          new RegExp(
            `^raw/projects/${demoProject.projectId}/assets/file_.+-focused-attempt\\.webm$`,
          ),
        ),
        purpose: "focused-practice-audio",
      }),
    );
    expect(assets[0].storageKey).toMatch(
      new RegExp(
        `^raw/projects/${demoProject.projectId}/assets/file_.+-focused-attempt\\.webm$`,
      ),
    );
  });

  it("hides private audio from generic complete, get, list, and content boundaries", async () => {
    const { repository } = createAssetRepository([
      {
        fileId: "file_private_1",
        projectId: demoProject.projectId,
        storageKey: "projects/project_demo_created/private/file_private_1.webm",
        originalName: "focused-attempt.webm",
        mimeType: "audio/webm",
        size: 1024,
        url: "internal://private-audio",
        purpose: "focused-practice-audio",
        status: "uploaded",
        createdAt: new Date(),
        uploadedAt: new Date(),
        deletedAt: null,
      } as ProjectAssetEntity,
    ]);
    const service = new FilesService(
      repository,
      {
        getAccessibleProject: vi.fn(async () => demoProject),
      } as unknown as ProjectsService,
      createStorage(),
    );

    await expect(service.list(demoProject.projectId)).resolves.toEqual([]);
    await expect(
      service.getUploadedAsset(demoProject.projectId, "file_private_1"),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.completeUpload(demoProject.projectId, {
        fileId: "file_private_1",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.readUploadedAssetContent(demoProject.projectId, "file_private_1"),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      service.getUploadedAsset(
        demoProject.projectId,
        "file_private_1",
        "focused-practice-audio",
      ),
    ).resolves.toMatchObject({ fileId: "file_private_1" });
  });

  it("creates a bounded read URL only through the private audio boundary", async () => {
    const { repository } = createAssetRepository([
      {
        fileId: "file_audio_1",
        projectId: demoProject.projectId,
        storageKey: "projects/project_demo_created/private/file_audio_1.webm",
        originalName: "rehearsal.webm",
        mimeType: "audio/webm",
        size: 1024,
        url: "internal://private-audio",
        purpose: "rehearsal-audio",
        status: "uploaded",
        createdAt: new Date(),
        uploadedAt: new Date(),
        deletedAt: null,
      } as ProjectAssetEntity,
    ]);
    const storage = createStorage();
    const service = new FilesService(
      repository,
      {
        getAccessibleProject: vi.fn(async () => demoProject),
      } as unknown as ProjectsService,
      storage,
    );

    await service.createPrivateAudioReadUrl(
      demoProject.projectId,
      "file_audio_1",
      "rehearsal-audio",
      300,
    );

    expect(storage.getSignedReadUrl).toHaveBeenCalledWith(
      "projects/project_demo_created/private/file_audio_1.webm",
      300,
    );
    await expect(
      service.createPrivateAudioReadUrl(
        demoProject.projectId,
        "file_audio_1",
        "thumbnail",
        300,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("stores a generated clip beside the rehearsal audio and reuses it", async () => {
    const storageKey =
      "rehearsals/2026-07-18/project_demo_created/run_123/audio.webm";
    const { repository } = createAssetRepository([
      {
        fileId: "file_audio_1",
        projectId: demoProject.projectId,
        storageKey,
        originalName: "rehearsal.webm",
        mimeType: "audio/webm",
        size: 1024,
        url: "internal://private-audio",
        purpose: "rehearsal-audio",
        status: "uploaded",
        createdAt: new Date(),
        uploadedAt: new Date(),
        deletedAt: null,
      } as ProjectAssetEntity,
    ]);
    const headObject = vi.fn(async () => null);
    const getObject = vi.fn(async () => ({
      body: new Uint8Array([1, 2, 3]),
      contentType: "audio/webm",
    }));
    const storage = createStorage({ headObject, getObject });
    const service = new FilesService(
      repository,
      {
        getAccessibleProject: vi.fn(async () => demoProject),
      } as unknown as ProjectsService,
      storage,
    );
    const createDerivative = vi.fn(async () => new Uint8Array([4, 5, 6]));

    const result = await service.getOrCreatePrivateAudioDerivative(
      demoProject.projectId,
      "file_audio_1",
      "rehearsal-audio",
      "volume-10000-12000.wav",
      createDerivative,
    );

    expect(result).toMatchObject({
      storageKey:
        "evidence/rehearsals/2026-07-18/project_demo_created/run_123/volume-10000-12000.wav",
      contentType: "audio/wav",
      created: true,
    });
    expect(createDerivative).toHaveBeenCalledWith({
      body: new Uint8Array([1, 2, 3]),
      contentType: "audio/webm",
    });
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        key: result.storageKey,
        body: new Uint8Array([4, 5, 6]),
        contentType: "audio/wav",
        purpose: "rehearsal-audio",
      }),
    );
  });
  it("hides rehearsal transcripts from generic asset boundaries", async () => {
    const { repository } = createAssetRepository([
      {
        fileId: "file_transcript_json",
        projectId: demoProject.projectId,
        storageKey:
          "rehearsals/2026-07-16/project_demo_created/run_123/transcript.json",
        originalName: "transcript.json",
        mimeType: "application/json",
        size: 1024,
        url: "internal://rehearsal-transcript-json",
        purpose: "rehearsal-transcript-json",
        status: "uploaded",
        createdAt: new Date(),
        uploadedAt: new Date(),
        deletedAt: null,
      } as ProjectAssetEntity,
    ]);
    const storage = createStorage();
    const service = new FilesService(
      repository,
      {
        getAccessibleProject: vi.fn(async () => demoProject),
      } as unknown as ProjectsService,
      storage,
    );

    await expect(service.list(demoProject.projectId)).resolves.toEqual([]);
    await expect(
      service.getUploadedAsset(demoProject.projectId, "file_transcript_json"),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.completeUpload(demoProject.projectId, {
        fileId: "file_transcript_json",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.readUploadedAssetContent(
        demoProject.projectId,
        "file_transcript_json",
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      service.getUploadedAsset(
        demoProject.projectId,
        "file_transcript_json",
        "rehearsal-transcript-json",
      ),
    ).resolves.toMatchObject({ fileId: "file_transcript_json" });
    await expect(
      service.readOwnerOnlyAssetContent(
        demoProject.projectId,
        "file_transcript_json",
        "rehearsal-transcript-json",
      ),
    ).resolves.toMatchObject({
      body: Buffer.from([1, 2, 3]),
      originalName: "transcript.json",
    });
    expect(storage.getObject).toHaveBeenCalledWith(
      "rehearsals/2026-07-16/project_demo_created/run_123/transcript.json",
    );
    expect(storage.getSignedReadUrl).not.toHaveBeenCalled();
  });

  it("uses the request origin for local upload proxy URLs", async () => {
    const { service } = createService(
      {
        getAccessibleProject: vi.fn(async () => demoProject),
      },
      {
        uploadProxyOrigin: "http://localhost:5173",
      },
    );

    const upload = await service.createUploadUrl(
      demoProject.projectId,
      {
        originalName: "diagram.png",
        mimeType: "image/png",
        size: 1024,
        purpose: "reference-material",
      },
      "http://127.0.0.1:5173",
    );

    expect(upload.uploadUrl).toContain(
      "http://127.0.0.1:5173/api/v1/projects/",
    );
  });

  it("falls back to the configured web origin when the request origin is absent", async () => {
    const { service } = createService(
      {
        getAccessibleProject: vi.fn(async () => demoProject),
      },
      {
        uploadProxyOrigin: "http://localhost:5173",
      },
    );

    const upload = await service.createUploadUrl(demoProject.projectId, {
      originalName: "diagram.png",
      mimeType: "image/png",
      size: 1024,
      purpose: "reference-material",
    });

    expect(upload.uploadUrl).toContain(
      "http://localhost:5173/api/v1/projects/",
    );
  });

  it("rejects complete requests for an asset outside the project boundary", async () => {
    const projectId = demoProject.projectId;
    const foreignProjectId = "project_foreign";
    const { repository } = createAssetRepository([
      {
        fileId: "file_1",
        projectId: foreignProjectId,
        storageKey: "projects/project_foreign/assets/file_1-report.pdf",
        originalName: "report.pdf",
        mimeType: "application/pdf",
        size: 1024,
        url: "http://localhost:9000/orbit-local/report.pdf",
        purpose: "reference-material",
        status: "pending",
        createdAt: new Date(),
        uploadedAt: null,
      } as ProjectAssetEntity,
    ]);
    const service = new FilesService(
      repository,
      {
        getAccessibleProject: vi.fn(async () => demoProject),
      } as unknown as ProjectsService,
      createStorage(),
    );

    await expect(
      service.completeUpload(projectId, { fileId: "file_1" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("keeps an asset pending when the uploaded object is missing in storage", async () => {
    const { assets, repository } = createAssetRepository([
      {
        fileId: "file_1",
        projectId: demoProject.projectId,
        storageKey: "projects/project_demo_created/assets/file_1-report.pdf",
        originalName: "report.pdf",
        mimeType: "application/pdf",
        size: 1024,
        url: "http://localhost:9000/orbit-local/report.pdf",
        purpose: "reference-material",
        status: "pending",
        createdAt: new Date(),
        uploadedAt: null,
      } as ProjectAssetEntity,
    ]);
    const service = new FilesService(
      repository,
      {
        getAccessibleProject: vi.fn(async () => demoProject),
      } as unknown as ProjectsService,
      createStorage({
        headObject: vi.fn(async () => null),
      }),
    );

    await expect(
      service.completeUpload(demoProject.projectId, { fileId: "file_1" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(assets[0].status).toBe("pending");
    expect(assets[0].uploadedAt).toBeNull();
  });

  it("keeps an asset pending when the uploaded object size mismatches metadata", async () => {
    const { assets, repository } = createAssetRepository([
      {
        fileId: "file_1",
        projectId: demoProject.projectId,
        storageKey: "projects/project_demo_created/assets/file_1-report.pdf",
        originalName: "report.pdf",
        mimeType: "application/pdf",
        size: 1024,
        url: "http://localhost:9000/orbit-local/report.pdf",
        purpose: "reference-material",
        status: "pending",
        createdAt: new Date(),
        uploadedAt: null,
      } as ProjectAssetEntity,
    ]);
    const service = new FilesService(
      repository,
      {
        getAccessibleProject: vi.fn(async () => demoProject),
      } as unknown as ProjectsService,
      createStorage({
        headObject: vi.fn(async () => ({
          contentLength: 2048,
          contentType: "application/pdf",
        })),
      }),
    );

    await expect(
      service.completeUpload(demoProject.projectId, { fileId: "file_1" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(assets[0].status).toBe("pending");
    expect(assets[0].uploadedAt).toBeNull();
  });

  it("keeps an asset pending when the uploaded object content-type mismatches metadata", async () => {
    const { assets, repository } = createAssetRepository([
      {
        fileId: "file_1",
        projectId: demoProject.projectId,
        storageKey: "projects/project_demo_created/assets/file_1-report.pdf",
        originalName: "report.pdf",
        mimeType: "application/pdf",
        size: 1024,
        url: "http://localhost:9000/orbit-local/report.pdf",
        purpose: "reference-material",
        status: "pending",
        createdAt: new Date(),
        uploadedAt: null,
      } as ProjectAssetEntity,
    ]);
    const service = new FilesService(
      repository,
      {
        getAccessibleProject: vi.fn(async () => demoProject),
      } as unknown as ProjectsService,
      createStorage({
        headObject: vi.fn(async () => ({
          contentLength: 1024,
          contentType: "audio/webm",
        })),
      }),
    );

    await expect(
      service.completeUpload(demoProject.projectId, { fileId: "file_1" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(assets[0].status).toBe("pending");
    expect(assets[0].uploadedAt).toBeNull();
  });

  it("stores uploaded proxy content in the project asset object", async () => {
    const { assets, repository } = createAssetRepository([
      {
        fileId: "file_1",
        projectId: demoProject.projectId,
        storageKey: "projects/project_demo_created/assets/file_1-report.pdf",
        originalName: "report.pdf",
        mimeType: "application/pdf",
        size: 4,
        url: "http://localhost:5173/api/v1/projects/project_demo_created/assets/file_1/content",
        purpose: "reference-material",
        status: "pending",
        createdAt: new Date(),
        uploadedAt: null,
      } as ProjectAssetEntity,
    ]);
    const storage = createStorage();
    const service = new FilesService(
      repository,
      {
        getAccessibleProject: vi.fn(async () => demoProject),
      } as unknown as ProjectsService,
      storage,
    );

    await service.storeUploadContent(
      demoProject.projectId,
      "file_1",
      Buffer.from("%PDF"),
    );

    expect(storage.putObject).toHaveBeenCalledWith({
      key: "projects/project_demo_created/assets/file_1-report.pdf",
      body: Buffer.from("%PDF"),
      contentType: "application/pdf",
      purpose: "reference-material",
    });
    expect(assets[0].url).toBe(
      "http://localhost:9000/orbit-local/projects/project_demo_created/assets/file_1-report.pdf",
    );
  });

  it("rejects local upload proxy writes for completed assets", async () => {
    const { repository } = createAssetRepository([
      {
        fileId: "file_1",
        projectId: demoProject.projectId,
        storageKey: "projects/project_demo_created/assets/file_1-report.pdf",
        originalName: "report.pdf",
        mimeType: "application/pdf",
        size: 4,
        url: "http://localhost:9000/orbit-local/report.pdf",
        purpose: "reference-material",
        status: "uploaded",
        createdAt: new Date(),
        uploadedAt: new Date(),
      } as ProjectAssetEntity,
    ]);
    const storage = createStorage();
    const service = new FilesService(
      repository,
      {
        getAccessibleProject: vi.fn(async () => demoProject),
      } as unknown as ProjectsService,
      storage,
    );

    await expect(
      service.storeUploadContent(
        demoProject.projectId,
        "file_1",
        Buffer.from("%PDF"),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("rejects local upload proxy writes when body size does not match metadata", async () => {
    const { repository } = createAssetRepository([
      {
        fileId: "file_1",
        projectId: demoProject.projectId,
        storageKey: "projects/project_demo_created/assets/file_1-report.pdf",
        originalName: "report.pdf",
        mimeType: "application/pdf",
        size: 4,
        url: "http://localhost:9000/orbit-local/report.pdf",
        purpose: "reference-material",
        status: "pending",
        createdAt: new Date(),
        uploadedAt: null,
      } as ProjectAssetEntity,
    ]);
    const storage = createStorage();
    const service = new FilesService(
      repository,
      {
        getAccessibleProject: vi.fn(async () => demoProject),
      } as unknown as ProjectsService,
      storage,
    );

    await expect(
      service.storeUploadContent(
        demoProject.projectId,
        "file_1",
        Buffer.from("too-large"),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("stores local uploaded proxy content with a same-origin read URL", async () => {
    const { assets, repository } = createAssetRepository([
      {
        fileId: "file_1",
        projectId: demoProject.projectId,
        storageKey: "projects/project_demo_created/assets/file_1-report.png",
        originalName: "report.png",
        mimeType: "image/png",
        size: 3,
        url: "http://localhost:5173/api/v1/projects/project_demo_created/assets/file_1/content",
        purpose: "reference-material",
        status: "pending",
        createdAt: new Date(),
        uploadedAt: null,
      } as ProjectAssetEntity,
    ]);
    const storage = createStorage();
    const service = new FilesService(
      repository,
      {
        getAccessibleProject: vi.fn(async () => demoProject),
      } as unknown as ProjectsService,
      storage,
      "http://localhost:5173",
    );

    await service.storeUploadContent(
      demoProject.projectId,
      "file_1",
      Buffer.from("png"),
    );

    expect(assets[0].url).toBe(
      "http://localhost:5173/api/v1/projects/project_demo_created/assets/file_1/content",
    );
  });

  it("reads uploaded asset content through the local proxy path", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    } as Response);

    const { repository } = createAssetRepository([
      {
        fileId: "file_1",
        projectId: demoProject.projectId,
        storageKey: "projects/project_demo_created/assets/file_1-report.png",
        originalName: "report.png",
        mimeType: "image/png",
        size: 3,
        url: "http://localhost:5173/api/v1/projects/project_demo_created/assets/file_1/content",
        purpose: "reference-material",
        status: "uploaded",
        createdAt: new Date(),
        uploadedAt: new Date(),
      } as ProjectAssetEntity,
    ]);
    const service = new FilesService(
      repository,
      {
        getAccessibleProject: vi.fn(async () => demoProject),
      } as unknown as ProjectsService,
      createStorage(),
      "http://localhost:5173",
    );

    const asset = await service.readUploadedAssetContent(
      demoProject.projectId,
      "file_1",
    );

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:9000/orbit-local/projects/project_demo_created/assets/file_1-report.png",
    );
    expect(asset.contentType).toBe("image/png");
    expect(Array.from(asset.body)).toEqual([1, 2, 3]);
  });

  it("rejects asset content reads for non-public purposes", async () => {
    const { repository } = createAssetRepository([
      {
        fileId: "file_audio_1",
        projectId: demoProject.projectId,
        storageKey:
          "projects/project_demo_created/assets/file_audio_1/rehearsal.webm",
        originalName: "rehearsal.webm",
        mimeType: "audio/webm",
        size: 1024,
        url: "http://localhost:9000/orbit-local/rehearsal.webm",
        purpose: "rehearsal-audio",
        status: "uploaded",
        createdAt: new Date(),
        uploadedAt: new Date(),
      } as ProjectAssetEntity,
    ]);
    const storage = createStorage();
    const service = new FilesService(
      repository,
      {
        getAccessibleProject: vi.fn(async () => demoProject),
      } as unknown as ProjectsService,
      storage,
    );

    await expect(
      service.readUploadedAssetContent(demoProject.projectId, "file_audio_1"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.getSignedReadUrl).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns not found when completing an unknown asset", async () => {
    const { service } = createService({
      getAccessibleProject: vi.fn(async () => demoProject),
    });

    await expect(
      service.completeUpload(demoProject.projectId, { fileId: "file_missing" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("returns uploaded rehearsal audio metadata for job starters", async () => {
    const { repository } = createAssetRepository([
      {
        fileId: "file_audio_1",
        projectId: demoProject.projectId,
        storageKey:
          "projects/project_demo_created/assets/file_audio_1/rehearsal.webm",
        originalName: "rehearsal.webm",
        mimeType: "audio/webm",
        size: 1024,
        url: "http://localhost:9000/orbit-local/rehearsal.webm",
        purpose: "rehearsal-audio",
        status: "uploaded",
        createdAt: new Date(),
        uploadedAt: new Date(),
      } as ProjectAssetEntity,
    ]);
    const service = new FilesService(
      repository,
      {
        getAccessibleProject: vi.fn(async () => demoProject),
      } as unknown as ProjectsService,
      createStorage(),
    );

    await expect(
      service.getUploadedAsset(
        demoProject.projectId,
        "file_audio_1",
        "rehearsal-audio",
      ),
    ).resolves.toMatchObject({
      fileId: "file_audio_1",
      purpose: "rehearsal-audio",
      status: "uploaded",
    });
  });

  it("deletes uploaded rehearsal audio object and marks metadata deleted", async () => {
    const { assets, repository } = createAssetRepository([
      {
        fileId: "file_audio_1",
        projectId: demoProject.projectId,
        storageKey:
          "projects/project_demo_created/assets/file_audio_1/rehearsal.webm",
        originalName: "rehearsal.webm",
        mimeType: "audio/webm",
        size: 1024,
        url: "http://localhost:9000/orbit-local/rehearsal.webm",
        purpose: "rehearsal-audio",
        status: "uploaded",
        createdAt: new Date(),
        uploadedAt: new Date(),
        deletedAt: null,
      } as ProjectAssetEntity,
    ]);
    const storage = createStorage();
    const service = new FilesService(
      repository,
      {
        getAccessibleProject: vi.fn(async () => demoProject),
      } as unknown as ProjectsService,
      storage,
    );

    const deletedAt = await service.deleteUploadedAsset(
      demoProject.projectId,
      "file_audio_1",
      "rehearsal-audio",
    );

    expect(storage.removeObject).toHaveBeenCalledWith(
      "projects/project_demo_created/assets/file_audio_1/rehearsal.webm",
    );
    expect(new Date(deletedAt).toISOString()).toBe(deletedAt);
    expect(assets[0]).toMatchObject({
      status: "deleted",
      deletedAt: expect.any(Date),
    });
  });

  it("rejects pending assets before starting asset-backed jobs", async () => {
    const { repository } = createAssetRepository([
      {
        fileId: "file_audio_1",
        projectId: demoProject.projectId,
        storageKey:
          "projects/project_demo_created/assets/file_audio_1/rehearsal.webm",
        originalName: "rehearsal.webm",
        mimeType: "audio/webm",
        size: 1024,
        url: "http://localhost:9000/orbit-local/rehearsal.webm",
        purpose: "rehearsal-audio",
        status: "pending",
        createdAt: new Date(),
        uploadedAt: null,
      } as ProjectAssetEntity,
    ]);
    const service = new FilesService(
      repository,
      {
        getAccessibleProject: vi.fn(async () => demoProject),
      } as unknown as ProjectsService,
      createStorage(),
    );

    await expect(
      service.getUploadedAsset(
        demoProject.projectId,
        "file_audio_1",
        "rehearsal-audio",
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
