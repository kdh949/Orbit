import { createDemoDeck } from "@orbit/editor-core";
import { deckElementSchema } from "@orbit/shared/deck";
import { describe, expect, it, vi } from "vitest";
import type { DecksService } from "../decks/decks.service";
import type { FilesService } from "../files/files.service";
import type { JobsService } from "../jobs/jobs.service";
import { DesignImageGenerationService } from "./design-image-generation.service";

vi.mock("@orbit/config", () => ({
  loadOrbitConfig: () => ({ JOB_QUEUE_DRIVER: "bullmq", REDIS_URL: "redis://test" }),
}));

describe("DesignImageGenerationService", () => {
  it("queues a sanitized slide context without speaker notes", async () => {
    const deck = createDemoDeck();
    deck.slides[0]!.speakerNotes = "외부 provider에 보내면 안 되는 발표자 스크립트";
    const job = queuedJob(deck.projectId, "job_image_1");
    const enqueue = vi.fn(async () => undefined);
    const service = new DesignImageGenerationService(
      { getDeck: vi.fn(async () => ({ projectId: deck.projectId, deck, updatedAt: job.updatedAt })) } as unknown as DecksService,
      { create: vi.fn(async () => job), update: vi.fn() } as unknown as JobsService,
      { getUploadedAsset: vi.fn() } as unknown as FilesService,
      enqueue,
      { info: vi.fn(), error: vi.fn() } as never,
    );

    const response = await service.create(deck.projectId, "user_1", {
      prompt: "미래 도시의 친환경 교통",
      deckId: deck.deckId,
      slideId: deck.slides[0]!.slideId,
      baseVersion: deck.version,
      referenceImages: [],
    });

    expect(response.job.type).toBe("design-image-generation");
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "미래 도시의 친환경 교통",
        aspectRatio: "landscape",
        driver: "bullmq",
      }),
    );
    expect(JSON.stringify(enqueue.mock.calls[0])).not.toContain("발표자 스크립트");
  });

  it("rejects a stale baseVersion before creating a job", async () => {
    const deck = createDemoDeck();
    const jobs = { create: vi.fn() };
    const service = new DesignImageGenerationService(
      { getDeck: vi.fn(async () => ({ projectId: deck.projectId, deck, updatedAt: "2026-07-18T00:00:00.000Z" })) } as unknown as DecksService,
      jobs as unknown as JobsService,
      {} as FilesService,
      vi.fn(),
      { info: vi.fn(), error: vi.fn() } as never,
    );

    await expect(
      service.create(deck.projectId, "user_1", {
        prompt: "image",
        deckId: deck.deckId,
        slideId: deck.slides[0]!.slideId,
        baseVersion: deck.version + 1,
        referenceImages: [],
      }),
    ).rejects.toThrow("baseVersion is stale");
    expect(jobs.create).not.toHaveBeenCalled();
  });

  it("validates selected image references before queueing", async () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;
    slide.elements = [
      ...slide.elements,
      deckElementSchema.parse({
        elementId: "el_reference_image",
        type: "image",
        role: "media",
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        rotation: 0,
        opacity: 1,
        zIndex: 10,
        locked: false,
        visible: true,
        props: {
          src: `/api/v1/projects/${deck.projectId}/assets/file_reference/content`,
          alt: "reference",
          fit: "contain",
          focusX: 0.5,
          focusY: 0.5,
        },
      }),
    ];
    const job = queuedJob(deck.projectId, "job_image_selected");
    const enqueue = vi.fn(async () => undefined);
    const service = new DesignImageGenerationService(
      { getDeck: vi.fn(async () => ({ projectId: deck.projectId, deck, updatedAt: job.updatedAt })) } as unknown as DecksService,
      { create: vi.fn(async () => job), update: vi.fn() } as unknown as JobsService,
      {
        getUploadedAsset: vi.fn(async () => ({
          fileId: "file_reference",
          projectId: deck.projectId,
          originalName: "reference.png",
          mimeType: "image/png",
          status: "uploaded",
        })),
      } as unknown as FilesService,
      enqueue,
      { info: vi.fn(), error: vi.fn() } as never,
    );

    await service.create(deck.projectId, "user_1", {
      prompt: "이 이미지 스타일로 새 배경을 만들어줘",
      deckId: deck.deckId,
      slideId: slide.slideId,
      baseVersion: deck.version,
      selectedImageReference: {
        elementId: "el_reference_image",
        fileId: "file_reference",
        projectId: deck.projectId,
        src: `/api/v1/projects/${deck.projectId}/assets/file_reference/content`,
      },
      referenceImages: [],
    });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedImageReference: expect.objectContaining({
          fileId: "file_reference",
          elementId: "el_reference_image",
          alt: "reference",
        }),
      }),
    );
  });

  it("verifies image reference attachments before queueing", async () => {
    const deck = createDemoDeck();
    const job = queuedJob(deck.projectId, "job_image_reference");
    const enqueue = vi.fn(async () => undefined);
    const filesService = {
      getUploadedAsset: vi.fn(async () => ({
        fileId: "file_reference",
        projectId: deck.projectId,
        originalName: "reference.png",
        mimeType: "image/png",
        purpose: "reference-material",
        status: "uploaded",
      })),
    };
    const service = new DesignImageGenerationService(
      { getDeck: vi.fn(async () => ({ projectId: deck.projectId, deck, updatedAt: job.updatedAt })) } as unknown as DecksService,
      { create: vi.fn(async () => job), update: vi.fn() } as unknown as JobsService,
      filesService as unknown as FilesService,
      enqueue,
      { info: vi.fn(), error: vi.fn() } as never,
    );

    await service.create(deck.projectId, "user_1", {
      prompt: "첨부 이미지를 참고해서 생성",
      deckId: deck.deckId,
      slideId: deck.slides[0]!.slideId,
      baseVersion: deck.version,
      referenceImages: [
        {
          fileId: "file_reference",
          fileName: "client-name.png",
          mimeType: "image/png",
        },
      ],
    });

    expect(filesService.getUploadedAsset).toHaveBeenCalledWith(
      deck.projectId,
      "file_reference",
      "reference-material",
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImages: [
          {
            fileId: "file_reference",
            fileName: "reference.png",
            mimeType: "image/png",
          },
        ],
      }),
    );
  });
});

function queuedJob(projectId: string, jobId: string) {
  return {
    jobId,
    projectId,
    type: "design-image-generation" as const,
    status: "queued" as const,
    progress: 0,
    message: "queued",
    result: null,
    error: null,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  };
}
