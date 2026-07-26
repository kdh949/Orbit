import { loadOrbitConfig } from "@orbit/config";
import type {
  EnqueueDesignImageGenerationJobInput,
} from "@orbit/job-queue";
import {
  createDesignImageGenerationResponseSchema,
  designImageGenerationJobPayloadSchema,
  type CreateDesignImageGenerationRequest,
  type CreateDesignImageGenerationResponse,
  type Deck,
  type DesignImageReferenceAttachment,
  type SelectedDesignImageReference,
  type Slide,
} from "@orbit/shared/deck";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { DecksService } from "../decks/decks.service";
import { FilesService } from "../files/files.service";
import { JobsService } from "../jobs/jobs.service";
import { serializeLogError } from "../logging";

export const DESIGN_IMAGE_GENERATION_ENQUEUE_JOB =
  "DESIGN_IMAGE_GENERATION_ENQUEUE_JOB";

export type DesignImageGenerationEnqueueJob = (
  input: EnqueueDesignImageGenerationJobInput,
) => Promise<void>;

const designImageReferenceMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

@Injectable()
export class DesignImageGenerationService {
  constructor(
    private readonly decksService: DecksService,
    private readonly jobsService: JobsService,
    private readonly filesService: FilesService,
    @Inject(DESIGN_IMAGE_GENERATION_ENQUEUE_JOB)
    private readonly enqueueImageGeneration: DesignImageGenerationEnqueueJob,
    @InjectPinoLogger(DesignImageGenerationService.name)
    private readonly logger: PinoLogger,
  ) {}

  async create(
    projectId: string,
    userId: string,
    request: CreateDesignImageGenerationRequest,
  ): Promise<CreateDesignImageGenerationResponse> {
    const current = await this.decksService.getDeck(projectId);
    if (current.deck.deckId !== request.deckId) {
      throw new BadRequestException("Design image deckId does not match project deck.");
    }
    if (current.deck.version !== request.baseVersion) {
      throw new ConflictException("Design image baseVersion is stale.");
    }
    const slide = current.deck.slides.find(
      (candidate) => candidate.slideId === request.slideId,
    );
    if (!slide) {
      throw new BadRequestException("Design image slide does not exist.");
    }
    const selectedImageReference = await this.resolveSelectedImageReference(
      projectId,
      request.selectedImageReference,
      slide,
    );
    const referenceImages = await this.resolveReferenceImages(
      projectId,
      request.referenceImages ?? [],
    );

    const queuedJob = await this.jobsService.create({
      projectId,
      type: "design-image-generation",
      payload: nullSafePayload(request),
    });
    const payload = designImageGenerationJobPayloadSchema.parse({
      jobId: queuedJob.jobId,
      projectId,
      userId,
      deckId: request.deckId,
      slideId: request.slideId,
      baseVersion: request.baseVersion,
      prompt: request.prompt,
      aspectRatio: resolveAspectRatio(current.deck),
      slideContext: buildSlideContext(current.deck, request.slideId),
      ...(selectedImageReference ? { selectedImageReference } : {}),
      referenceImages,
    });

    try {
      const config = loadOrbitConfig(process.env, { service: "api" });
      await this.enqueueImageGeneration({
        ...payload,
        driver: config.JOB_QUEUE_DRIVER,
        redisUrl: config.REDIS_URL,
      });
      this.logger.info(
        {
          event: "design_image.generation.queued",
          jobId: queuedJob.jobId,
          projectId,
          deckId: request.deckId,
          slideId: request.slideId,
          aspectRatio: payload.aspectRatio,
        },
        "Design image generation job enqueued.",
      );
    } catch (error) {
      await this.jobsService.update(queuedJob.jobId, {
        status: "failed",
        progress: 0,
        message: "Image generation enqueue failed.",
        error: {
          code: "DESIGN_IMAGE_GENERATION_ENQUEUE_FAILED",
          message: "Image generation could not be queued.",
        },
      });
      this.logger.error(
        {
          event: "design_image.generation.enqueue_failed",
          jobId: queuedJob.jobId,
          projectId,
          error: serializeLogError(error),
        },
        "Design image generation enqueue failed.",
      );
      throw error;
    }

    return createDesignImageGenerationResponseSchema.parse({ job: queuedJob });
  }

  private async resolveSelectedImageReference(
    projectId: string,
    reference: SelectedDesignImageReference | undefined,
    slide: Slide,
  ): Promise<SelectedDesignImageReference | undefined> {
    if (!reference) return undefined;
    if (reference.projectId !== projectId) {
      throw new BadRequestException("Selected image projectId does not match project.");
    }
    const element = slide.elements.find(
      (candidate) => candidate.elementId === reference.elementId,
    );
    if (!element || element.type !== "image") {
      throw new BadRequestException("Selected image reference must target an image element.");
    }
    if (element.props.src !== reference.src) {
      throw new BadRequestException("Selected image reference src does not match slide.");
    }
    const descriptor = parseProjectAssetDescriptor(element.props.src);
    if (
      !descriptor ||
      descriptor.projectId !== projectId ||
      descriptor.fileId !== reference.fileId
    ) {
      throw new BadRequestException("Selected image reference must be a project asset.");
    }
    const asset = await this.filesService.getUploadedAsset(projectId, reference.fileId);
    if (!designImageReferenceMimeTypes.has(asset.mimeType)) {
      throw new BadRequestException("Selected image reference must be an image asset.");
    }
    return {
      ...reference,
      alt: reference.alt || element.props.alt || asset.originalName,
    };
  }

  private async resolveReferenceImages(
    projectId: string,
    images: DesignImageReferenceAttachment[] = [],
  ): Promise<DesignImageReferenceAttachment[]> {
    const resolved = new Map<string, DesignImageReferenceAttachment>();
    for (const image of images) {
      const asset = await this.filesService.getUploadedAsset(
        projectId,
        image.fileId,
        "reference-material",
      );
      if (!designImageReferenceMimeTypes.has(asset.mimeType)) {
        throw new BadRequestException("Design image references must be image assets.");
      }
      resolved.set(asset.fileId, {
        fileId: asset.fileId,
        fileName: asset.originalName,
        mimeType: asset.mimeType as DesignImageReferenceAttachment["mimeType"],
      });
    }
    return [...resolved.values()];
  }
}

function nullSafePayload(request: CreateDesignImageGenerationRequest) {
  return {
    deckId: request.deckId,
    slideId: request.slideId,
    baseVersion: request.baseVersion,
    ...(request.selectedImageReference
      ? {
          selectedImageReference: {
            elementId: request.selectedImageReference.elementId,
            fileId: request.selectedImageReference.fileId,
            projectId: request.selectedImageReference.projectId,
          },
        }
      : {}),
    referenceImageFileIds: (request.referenceImages ?? []).map((image) => image.fileId),
  };
}

function parseProjectAssetDescriptor(src: string) {
  try {
    const url = new URL(src, "http://localhost");
    const proxyMatch = url.pathname.match(
      /^\/api\/v1\/projects\/([^/]+)\/assets\/([^/]+)\/content$/,
    );
    if (proxyMatch) {
      return {
        projectId: decodeURIComponent(proxyMatch[1]),
        fileId: decodeURIComponent(proxyMatch[2]),
      };
    }

    const nestedMinioMatch = url.pathname.match(
      /\/orbit-local\/projects\/([^/]+)\/assets\/([^/]+)\/[^/]+$/,
    );
    const flatUuidMinioMatch = url.pathname.match(
      /\/orbit-local\/projects\/([^/]+)\/assets\/(file_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})-[^/]+$/,
    );
    const flatLegacyMinioMatch = url.pathname.match(
      /\/orbit-local\/projects\/([^/]+)\/assets\/([^/]+?)-[^/]+$/,
    );
    const minioMatch =
      nestedMinioMatch ?? flatUuidMinioMatch ?? flatLegacyMinioMatch;
    if (!minioMatch) return null;
    return {
      projectId: decodeURIComponent(minioMatch[1]),
      fileId: decodeURIComponent(minioMatch[2]),
    };
  } catch {
    return null;
  }
}

function resolveAspectRatio(deck: Deck) {
  const ratio = deck.canvas.width / deck.canvas.height;
  if (ratio > 1.2) return "landscape" as const;
  if (ratio < 0.8) return "portrait" as const;
  return "square" as const;
}

function buildSlideContext(deck: Deck, slideId: string) {
  const slide = deck.slides.find((candidate) => candidate.slideId === slideId)!;
  return {
    title: [deck.title, slide.title].filter(Boolean).join(" — ").slice(0, 500),
    text: slide.elements
      .filter((element) => element.type === "text")
      .map((element) => element.props.text.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 20)
      .map((text) => text.slice(0, 1_000)),
    theme: {
      name: deck.theme.name,
      primaryColor: deck.theme.palette.primary,
      secondaryColor: deck.theme.palette.secondary,
      accentColor: deck.theme.accentColor,
      backgroundColor: deck.theme.backgroundColor,
    },
  };
}
