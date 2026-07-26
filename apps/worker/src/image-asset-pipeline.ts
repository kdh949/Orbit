import type {
  GeneratedImageProvider,
  GeneratedImageReferenceImage,
  ImageAssetCandidate,
  OfficialImageProvider,
  PublicImageSearchProvider
} from "@orbit/ai";
import {
  designImageGenerationResultSchema,
  deckSchema,
  type DesignImageGenerationJobPayload,
  type Deck,
  type Slide,
} from "@orbit/shared/deck";
import type { StoragePort } from "@orbit/storage";
import { createHash, randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";

export type ImageAssetRuntime = {
  generated?: GeneratedImageProvider;
  official?: OfficialImageProvider;
  publicSearch?: PublicImageSearchProvider;
  maxPerDeck: number;
  maxPerUserPerDay: number;
};

export type ImageAssetScope = {
  userId: string;
};

export async function generateDesignImageAsset(
  dataSource: DataSource,
  storage: Pick<StoragePort, "putObject" | "getSignedReadUrl">,
  runtime: ImageAssetRuntime,
  payload: DesignImageGenerationJobPayload,
) {
  if (!runtime.generated) {
    throw new Error("Image generation provider is disabled");
  }
  const deterministicIdentity = `design-image:${payload.jobId}`;
  const deterministicFileId = stableImageAssetFileId(deterministicIdentity);
  if (
    (await remainingDailyBudget(
      dataSource,
      runtime,
      { userId: payload.userId },
      deterministicFileId,
    )) <= 0
  ) {
    throw new Error("Daily image generation limit exceeded");
  }

  const enrichedPrompt = buildDesignImagePrompt(payload);
  const referenceImages = await loadReferenceImages(dataSource, storage, payload);
  const asset = await retryImageRequest(
    () =>
      runtime.generated!.generate({
        prompt: enrichedPrompt,
        aspectRatio: payload.aspectRatio,
        ...(referenceImages.length ? { referenceImages } : {}),
        abortSignal: AbortSignal.timeout(120_000),
      }),
    1,
  );
  assertCandidate(asset, "ai-generated");
  const dimensions = imageDimensions(asset.body, asset.mimeType);
  if (!dimensions) throw new Error("Generated image dimensions are unavailable");
  const stored = await storeImageAsset(
    dataSource,
    storage,
    payload.projectId,
    { ...asset, generationPrompt: enrichedPrompt },
    { userId: payload.userId },
    deterministicIdentity,
  );

  return designImageGenerationResultSchema.parse({
    ...stored,
    projectId: payload.projectId,
    purpose: "design-asset",
    mimeType: asset.mimeType,
    width: dimensions.width,
    height: dimensions.height,
    prompt: payload.prompt,
    aspectRatio: payload.aspectRatio,
  });
}

async function loadReferenceImages(
  dataSource: DataSource,
  storage: Pick<StoragePort, "getSignedReadUrl">,
  payload: DesignImageGenerationJobPayload,
): Promise<GeneratedImageReferenceImage[]> {
  const loaded: GeneratedImageReferenceImage[] = [];
  const selectedReference = payload.selectedImageReference;
  if (selectedReference) {
    if (selectedReference.projectId !== payload.projectId) {
      throw new Error("Selected image project mismatch");
    }
    const rows = (await dataSource.query(
      `
        SELECT file_id, project_id, storage_key, original_name, mime_type, size
        FROM project_assets
        WHERE project_id = $1
          AND file_id = $2
          AND status = 'uploaded'
          AND mime_type IN ('image/png', 'image/jpeg', 'image/webp')
        LIMIT 1
      `,
      [payload.projectId, selectedReference.fileId],
    )) as StoredAssetRow[];
    const asset = rows[0];
    if (!asset) {
      throw new Error("Selected image reference asset is unavailable");
    }
    loaded.push(await readReferenceImage(storage, asset, "Selected image reference content is unavailable"));
  }

  const attachments = payload.referenceImages ?? [];
  if (attachments.length) {
    const fileIds = attachments.map((image) => image.fileId);
    const rows = (await dataSource.query(
      `
        SELECT file_id, project_id, storage_key, original_name, mime_type, size
        FROM project_assets
        WHERE project_id = $1
          AND file_id = ANY($2::text[])
          AND purpose = 'reference-material'
          AND status = 'uploaded'
          AND mime_type IN ('image/png', 'image/jpeg', 'image/webp')
      `,
      [payload.projectId, fileIds],
    )) as StoredAssetRow[];
    const rowsById = new Map(rows.map((row) => [row.file_id, row]));
    for (const fileId of fileIds) {
      const asset = rowsById.get(fileId);
      if (!asset) {
        throw new Error("Reference image asset is unavailable");
      }
      loaded.push(await readReferenceImage(storage, asset, "Reference image content is unavailable"));
    }
  }

  return loaded;
}

async function readReferenceImage(
  storage: Pick<StoragePort, "getSignedReadUrl">,
  asset: StoredAssetRow,
  unavailableMessage: string,
): Promise<GeneratedImageReferenceImage> {
  const response = await fetch(await storage.getSignedReadUrl(asset.storage_key), {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(unavailableMessage);
  }
  return {
    body: new Uint8Array(await response.arrayBuffer()),
    mimeType: asset.mime_type as GeneratedImageReferenceImage["mimeType"],
    fileName: asset.original_name,
    inputFidelity: "high",
  };
}

function buildDesignImagePrompt(payload: DesignImageGenerationJobPayload) {
  const context = payload.slideContext;
  const slideText = context.text.join(" · ");
  return [
    payload.prompt,
    context.title ? `Presentation context: ${context.title}.` : "",
    slideText ? `Visible slide text: ${slideText}.` : "",
    `Visual style: ${context.theme.name}; primary ${context.theme.primaryColor}; secondary ${context.theme.secondaryColor}; accent ${context.theme.accentColor}; background ${context.theme.backgroundColor}.`,
    "Create a presentation-ready image with no text, logo, or watermark.",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 4_000);
}

export type ImageAssetFallbackDiagnostic = {
  reasonCode:
    | "OPENAI_IMAGE_HTTP_ERROR"
    | "OPENAI_IMAGE_EMPTY_RESPONSE"
    | "OPENVERSE_SEARCH_HTTP_ERROR"
    | "OPENVERSE_NO_LICENSED_CANDIDATE"
    | "PUBLIC_IMAGE_DOWNLOAD_FAILED"
    | "OFFICIAL_IMAGE_UNAVAILABLE"
    | "IMAGE_ASSET_INVALID_SIZE"
    | "IMAGE_ASSET_INVALID_MIME"
    | "IMAGE_ASSET_RESOLUTION_TOO_LOW"
    | "IMAGE_STORAGE_FAILED"
    | "IMAGE_PROVIDER_UNAVAILABLE";
  name: string;
  provider: "openai" | "openverse" | "official-web" | "user-upload" | "storage";
  providerHttpStatus?: number;
  providerRequestId?: string;
};

type StoredAssetRow = {
  file_id: string;
  project_id: string;
  storage_key: string;
  original_name: string;
  mime_type: string;
  size: number;
};

export async function resolveDeckImageAssets(
  dataSource: DataSource,
  storage: Pick<StoragePort, "putObject"> &
    Partial<Pick<StoragePort, "getSignedReadUrl">>,
  deck: Deck,
  runtime: ImageAssetRuntime,
  scope: ImageAssetScope,
  onlySlideIds?: ReadonlySet<string>,
  officialAssetFileIds: readonly string[] = [],
  deterministicIdentity?: string,
  onFallback?: (diagnostic: ImageAssetFallbackDiagnostic) => void
): Promise<{ deck: Deck; warnings: string[] }> {
  const warnings: string[] = [];
  const candidates = deck.slides.filter(
    (slide) =>
      isResolvableImageSlide(slide) &&
      (onlySlideIds === undefined || onlySlideIds.has(slide.slideId))
  );
  if (candidates.length === 0) return { deck, warnings };
  const selected =
    runtime.maxPerDeck === 0
      ? candidates
      : candidates.slice(0, runtime.maxPerDeck);
  if (candidates.length > selected.length) {
    warnings.push(
      `Image asset limit retained placeholders on ${candidates.length - selected.length} slide(s).`
    );
  }

  const remaining = await remainingDailyBudget(dataSource, runtime, scope);
  const budgeted = selected.slice(0, remaining);
  if (selected.length > budgeted.length) {
    warnings.push("Daily image asset budget retained remaining placeholders.");
  }

  let resolvedDeck = deck;
  const uploadedOfficialAssets = await loadUploadedOfficialAssets(
    dataSource,
    deck.projectId,
    officialAssetFileIds
  );
  let uploadedOfficialAssetIndex = 0;
  const usedPublicAssetUrls = new Set(
    deck.slides.flatMap((slide) => {
      const sourceAssetUrl = slide.aiNotes?.visualPlan?.asset?.sourceAssetUrl;
      return sourceAssetUrl ? [sourceAssetUrl] : [];
    })
  );
  for (const slide of budgeted) {
    const policy = slide.aiNotes?.visualPlan?.imageSourcePolicy;
    if (
      policy !== "ai-generated" &&
      policy !== "official-assets" &&
      policy !== "public-assets"
    ) {
      continue;
    }
    const provider =
      policy === "ai-generated"
        ? runtime.generated
        : policy === "official-assets"
          ? runtime.official
          : runtime.publicSearch;
    const uploadedOfficialAsset =
      policy === "official-assets"
        ? uploadedOfficialAssets[uploadedOfficialAssetIndex]
        : undefined;
    if (uploadedOfficialAsset) uploadedOfficialAssetIndex += 1;
    if (!provider && !uploadedOfficialAsset) {
      warnings.push(`Image provider is disabled for ${policy}.`);
      emitImageFallback(onFallback, {
        reasonCode: "IMAGE_PROVIDER_UNAVAILABLE",
        name: "ImageProviderUnavailableError",
        provider: providerForPolicy(policy, Boolean(uploadedOfficialAsset)),
      });
      continue;
    }

    try {
      const prompt = imagePrompt(deck, slide);
      const asset = await retryImageRequest(
        async () => {
          const candidate =
            uploadedOfficialAsset
              ? await readUploadedOfficialAsset(storage, uploadedOfficialAsset)
              : policy === "ai-generated"
              ? await (provider as GeneratedImageProvider).generate({
                  prompt,
                  aspectRatio: imageAspectRatio(slide),
                  abortSignal: AbortSignal.timeout(60_000)
                })
              : policy === "official-assets"
                ? await (provider as OfficialImageProvider).fetch({
                    sourceUrls: officialSourceUrls(slide),
                    query: prompt,
                    abortSignal: AbortSignal.timeout(30_000)
                  })
                : await searchPublicImage(
                    provider as PublicImageSearchProvider,
                    publicImageQueries(deck, slide),
                    usedPublicAssetUrls
                  );
          assertCandidate(candidate, policy);
          return candidate;
        },
        1
      );
      const stored = await storeImageAsset(
        dataSource,
        storage,
        deck.projectId,
        asset,
        scope,
        deterministicIdentity
          ? `${deterministicIdentity}:${slide.slideId}`
          : undefined
      );
      resolvedDeck = replaceSlideImagePlaceholder(
        resolvedDeck,
        slide.slideId,
        stored.url,
        stored.fileId,
        asset
      );
      if (asset.sourceAssetUrl) {
        usedPublicAssetUrls.add(asset.sourceAssetUrl);
      }
    } catch (error) {
      emitImageFallback(
        onFallback,
        classifyImageAssetError(error, policy, Boolean(uploadedOfficialAsset))
      );
      warnings.push(
        `Image asset fallback retained for slide ${slide.order}: ${safeErrorMessage(error)}`
      );
    }
  }

  return { deck: deckSchema.parse(resolvedDeck), warnings };
}

function isResolvableImageSlide(slide: Slide) {
  const plan = slide.aiNotes?.visualPlan;
  return (
    plan?.imageNeeded === true &&
    ["ai-generated", "official-assets", "public-assets"].includes(
      plan.imageSourcePolicy
    ) &&
    slide.elements.some(
      (element) =>
        element.role === "media" &&
        element.elementId.endsWith("_media_placeholder")
    )
  );
}

async function remainingDailyBudget(
  dataSource: DataSource,
  runtime: ImageAssetRuntime,
  scope: ImageAssetScope,
  excludeFileId?: string,
) {
  if (runtime.maxPerUserPerDay === 0) return Number.POSITIVE_INFINITY;
  const rows = (await dataSource.query(
    `
      SELECT
        count(*) FILTER (WHERE generated_for_user_id = $1) AS user_count
      FROM project_assets
      WHERE created_at >= date_trunc('day', now())
        AND asset_provider IS NOT NULL
        AND ($2::text IS NULL OR file_id <> $2)
    `,
    [scope.userId, excludeFileId ?? null]
  )) as Array<{ user_count: string | number }>;
  return Math.max(
    0,
    runtime.maxPerUserPerDay - Number(rows[0]?.user_count ?? 0)
  );
}

async function retryImageRequest<T>(operation: () => Promise<T>, retries: number) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function assertCandidate(asset: ImageAssetCandidate, policy: string) {
  if (asset.body.byteLength === 0 || asset.body.byteLength > 12 * 1024 * 1024) {
    throw new Error("Image asset size is outside the allowed range");
  }
  if (!["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType)) {
    throw new Error(`Unsupported image MIME type: ${asset.mimeType}`);
  }
  if (policy === "public-assets" && (!asset.sourceUrl || !asset.license)) {
    throw new Error("Public image source and license are required");
  }
  if (
    policy === "official-assets" &&
    (asset.sourceAuthority !== "official" ||
      (asset.usageBasis !== "user-provided" &&
        (!asset.sourceUrl ||
          !asset.sourceAssetUrl ||
          asset.usageBasis !== "official-reference")))
  ) {
    throw new Error("Official image source provenance is required");
  }
  const dimensions = imageDimensions(asset.body, asset.mimeType);
  if (!dimensions || dimensions.width < 640 || dimensions.height < 360) {
    throw new Error("Image resolution must be at least 640x360");
  }
}

async function loadUploadedOfficialAssets(
  dataSource: DataSource,
  projectId: string,
  fileIds: readonly string[]
) {
  if (fileIds.length === 0) return [];
  const rows = (await dataSource.query(
    `
      SELECT file_id, project_id, storage_key, original_name, mime_type, size
      FROM project_assets
      WHERE project_id = $1
        AND file_id = ANY($2::text[])
        AND status = 'uploaded'
        AND mime_type IN ('image/png', 'image/jpeg', 'image/webp')
    `,
    [projectId, [...fileIds]]
  )) as StoredAssetRow[];
  const byId = new Map(rows.map((row) => [row.file_id, row]));
  return fileIds.flatMap((fileId) => {
    const row = byId.get(fileId);
    return row ? [row] : [];
  });
}

async function readUploadedOfficialAsset(
  storage: Partial<Pick<StoragePort, "getSignedReadUrl">>,
  asset: StoredAssetRow
): Promise<ImageAssetCandidate> {
  if (!storage.getSignedReadUrl) {
    throw new Error("Official upload storage reader is unavailable");
  }
  const response = await fetch(await storage.getSignedReadUrl(asset.storage_key), {
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error("Uploaded official image is unavailable");
  return {
    body: new Uint8Array(await response.arrayBuffer()),
    mimeType: asset.mime_type as ImageAssetCandidate["mimeType"],
    fileName: asset.original_name,
    provider: "user-upload",
    sourceAuthority: "official",
    usageBasis: "user-provided",
    checkedAt: new Date().toISOString()
  };
}

function imageDimensions(
  body: Uint8Array,
  mimeType: ImageAssetCandidate["mimeType"]
) {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  if (mimeType === "image/png" && body.byteLength >= 24) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mimeType === "image/jpeg") {
    let offset = 2;
    while (offset + 8 < body.byteLength) {
      if (body[offset] !== 0xff) break;
      const marker = body[offset + 1];
      const length = view.getUint16(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker)) {
        return {
          height: view.getUint16(offset + 5),
          width: view.getUint16(offset + 7)
        };
      }
      if (length < 2) break;
      offset += length + 2;
    }
  }
  if (
    mimeType === "image/webp" &&
    body.byteLength >= 30 &&
    String.fromCharCode(...body.slice(12, 16)) === "VP8X"
  ) {
    return {
      width: 1 + body[24] + (body[25] << 8) + (body[26] << 16),
      height: 1 + body[27] + (body[28] << 8) + (body[29] << 16)
    };
  }
  return null;
}

async function storeImageAsset(
  dataSource: DataSource,
  storage: Pick<StoragePort, "putObject">,
  projectId: string,
  asset: ImageAssetCandidate,
  scope: ImageAssetScope,
  deterministicIdentity?: string
) {
  const stableHash = deterministicIdentity
    ? stableImageAssetHash(deterministicIdentity)
    : undefined;
  const fileId = deterministicIdentity
    ? stableImageAssetFileId(deterministicIdentity)
    : `file_${randomUUID()}`;
  const originalName = safeStorageName(asset.fileName);
  const storageKey = stableHash
    ? `projects/${projectId}/ai-deck-assets/${stableHash}-${originalName}`
    : `projects/${projectId}/assets/${fileId}-${originalName}`;
  const url = createAssetContentUrl(projectId, fileId);
  try {
    await storage.putObject({
      key: storageKey,
      body: asset.body,
      contentType: asset.mimeType,
      purpose: "design-asset"
    });
    await dataSource.query(
    `
      INSERT INTO project_assets (
        file_id, project_id, storage_key, original_name, mime_type, size, url,
        purpose, status, created_at, uploaded_at, deleted_at,
        source_url, author, license, license_checked_at, asset_provider,
        generation_prompt, generated_for_user_id,
        source_asset_url, source_authority, usage_basis
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        'design-asset', 'uploaded', now(), now(), null,
        $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
      )
      ON CONFLICT (file_id) DO UPDATE
      SET storage_key = EXCLUDED.storage_key,
          original_name = EXCLUDED.original_name,
          mime_type = EXCLUDED.mime_type,
          size = EXCLUDED.size,
          url = EXCLUDED.url,
          source_url = EXCLUDED.source_url,
          author = EXCLUDED.author,
          license = EXCLUDED.license,
          license_checked_at = EXCLUDED.license_checked_at,
          asset_provider = EXCLUDED.asset_provider,
          generation_prompt = EXCLUDED.generation_prompt,
          generated_for_user_id = EXCLUDED.generated_for_user_id,
          source_asset_url = EXCLUDED.source_asset_url,
          source_authority = EXCLUDED.source_authority,
          usage_basis = EXCLUDED.usage_basis
      WHERE project_assets.project_id = EXCLUDED.project_id
    `,
    [
      fileId,
      projectId,
      storageKey,
      originalName,
      asset.mimeType,
      asset.body.byteLength,
      url,
      asset.sourceUrl ?? null,
      asset.author ?? null,
      asset.license ?? null,
      asset.checkedAt ? new Date(asset.checkedAt) : null,
      asset.provider,
      asset.generationPrompt ?? null,
      scope.userId,
      asset.sourceAssetUrl ?? null,
      asset.sourceAuthority ?? "unknown",
      asset.usageBasis ?? (asset.generationPrompt ? "generated" : null)
    ]
    );
  } catch (error) {
    throw new ImageAssetPipelineError(
      "IMAGE_STORAGE_FAILED",
      "storage",
      error
    );
  }
  return { fileId, url };
}

function stableImageAssetHash(identity: string) {
  return createHash("sha256").update(identity).digest("hex").slice(0, 32);
}

function stableImageAssetFileId(identity: string) {
  return `file_aideck_${stableImageAssetHash(identity)}`;
}

function replaceSlideImagePlaceholder(
  deck: Deck,
  slideId: string,
  url: string,
  fileId: string,
  asset: ImageAssetCandidate
): Deck {
  return {
    ...deck,
    slides: deck.slides.map((slide) => {
      if (slide.slideId !== slideId) return slide;
      const placeholder = slide.elements.find(
        (element) =>
          element.role === "media" &&
          element.elementId.endsWith("_media_placeholder")
      );
      if (!placeholder) return slide;
      const plan = slide.aiNotes?.visualPlan;
      const assetElementId = placeholder.elementId.replace(
        /_media_placeholder$/,
        "_media_asset"
      );
      const fit = imageFit(asset);
      const framing = imageFramingPreset(slide, placeholder);
      return {
        ...slide,
        animations: slide.animations.map((animation) =>
          animation.elementId === placeholder.elementId
            ? { ...animation, elementId: assetElementId }
            : animation
        ),
        elements: [
          ...slide.elements.filter(
            (element) =>
              element.elementId !== placeholder.elementId &&
              !element.elementId.endsWith("_media_caption")
          ),
          {
            ...placeholder,
            elementId: assetElementId,
            type: "image" as const,
            props: {
              src: url,
              alt: plan?.imageAlt ?? plan?.reason ?? slide.title,
              fit,
              focusX: fit === "contain" ? 0.5 : framing.focusX,
              focusY: fit === "contain" ? 0.5 : framing.focusY
            }
          }
        ],
        aiNotes: slide.aiNotes
          ? {
              ...slide.aiNotes,
              ...(slide.aiNotes.compositionPlan
                ? {
                    compositionPlan: {
                      ...slide.aiNotes.compositionPlan,
                      primaryFocalElementId:
                        slide.aiNotes.compositionPlan.primaryFocalElementId ===
                        placeholder.elementId
                          ? assetElementId
                          : slide.aiNotes.compositionPlan.primaryFocalElementId
                    }
                  }
                : {}),
              visualPlan: plan
                ? {
                    ...plan,
                    asset: {
                      fileId,
                      provider: asset.provider,
                      ...(asset.sourceUrl ? { sourceUrl: asset.sourceUrl } : {}),
                      ...(asset.sourceAssetUrl
                        ? { sourceAssetUrl: asset.sourceAssetUrl }
                        : {}),
                      ...(asset.sourceAuthority
                        ? { sourceAuthority: asset.sourceAuthority }
                        : {}),
                      ...(asset.usageBasis ? { usageBasis: asset.usageBasis } : {}),
                      ...(asset.author ? { author: asset.author } : {}),
                      ...(asset.license ? { license: asset.license } : {}),
                      ...(asset.checkedAt ? { checkedAt: asset.checkedAt } : {})
                    }
                  }
                : undefined
            }
          : undefined
      };
    })
  };
}

function imagePrompt(deck: Deck, slide: Slide) {
  const plan = slide.aiNotes?.visualPlan;
  const media = slide.elements.find((element) => element.role === "media");
  const aspectRatio = media
    ? Math.round((media.width / media.height) * 100) / 100
    : 1.5;
  const preset = imageFramingPreset(slide, media);
  const framing = `Designed for a ${aspectRatio}:1 frame. ${preset.prompt} No text, logo, watermark, or embedded typography.`;
  if (plan?.imagePrompt?.trim()) {
    return `${plan.imagePrompt.trim()}. ${framing}`;
  }
  const reason = plan?.reason ?? "support the key message";
  return `${deck.title}. ${slide.title}. ${reason}. ${framing}`;
}

function imageAspectRatio(
  slide: Slide
): "landscape" | "portrait" | "square" {
  const media = slide.elements.find((element) => element.role === "media");
  if (!media || media.height <= 0) return "landscape";
  const ratio = media.width / media.height;
  if (ratio >= 1.2) return "landscape";
  if (ratio <= 0.8) return "portrait";
  return "square";
}

function imageFramingPreset(
  slide: Slide,
  media: Slide["elements"][number] | undefined
) {
  const compositionId = slide.aiNotes?.compositionPlan?.compositionId;
  const assetRole = slide.aiNotes?.compositionPlan?.assetRole;
  if (
    compositionId === "hero-full-bleed" ||
    compositionId === "cover-immersive-background"
  ) {
    return {
      prompt:
        "Compose a wide environmental scene with layered depth and room for presentation cropping; avoid a centered cutout subject.",
      focusX: 0.5,
      focusY: 0.5
    };
  }
  if (compositionId === "editorial-media-band") {
    return {
      prompt:
        "Compose a wide horizontal scene with layered context; keep important details away from the top and bottom crop edges.",
      focusX: 0.5,
      focusY: 0.46
    };
  }
  if (assetRole === "evidence" || compositionId === "image-evidence") {
    return {
      prompt:
        "Show factual product, place, or real-world evidence in context; avoid infographics, diagrams, posters, UI mockups, or decorative text.",
      focusX: 0.5,
      focusY: 0.5
    };
  }
  if (
    compositionId === "hero-split" ||
    compositionId === "cover-visual-impact" ||
    compositionId === "cover-research-author" ||
    compositionId === "editorial-split"
  ) {
    const mediaOnRight = media
      ? media.x + media.width / 2 >= 1920 / 2
      : true;
    return {
      prompt: mediaOnRight
        ? "Place the primary person, product, or object on the right third, oriented toward the left-side text area; retain contextual depth."
        : "Place the primary person, product, or object on the left third, oriented toward the right-side text area; retain contextual depth.",
      focusX: mediaOnRight ? 0.68 : 0.32,
      focusY: 0.5
    };
  }
  return {
    prompt:
      "Compose a presentation-ready editorial scene with contextual depth and a clear focal hierarchy; avoid an isolated sticker-like illustration.",
    focusX: 0.5,
    focusY: 0.5
  };
}

function imageFit(asset: ImageAssetCandidate): "contain" | "cover" {
  const identity = `${asset.fileName} ${asset.sourceAssetUrl ?? ""}`;
  return /(?:^|[\W_])logo(?:[\W_]|$)/i.test(identity) ? "contain" : "cover";
}

async function searchPublicImage(
  provider: PublicImageSearchProvider,
  queries: string[],
  excludedSourceAssetUrls: ReadonlySet<string>
) {
  let lastError: unknown;
  for (const query of queries) {
    try {
      const candidate = await provider.search({
        query,
        excludeSourceAssetUrls: [...excludedSourceAssetUrls],
        abortSignal: AbortSignal.timeout(30_000)
      });
      assertCandidate(candidate, "public-assets");
      if (
        candidate.sourceAssetUrl &&
        excludedSourceAssetUrls.has(candidate.sourceAssetUrl)
      ) {
        throw new Error("Public image search returned an already used asset");
      }
      return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Public image search produced no query");
}

function publicImageQueries(deck: Deck, slide: Slide) {
  return [
    slide.aiNotes?.visualPlan?.imagePrompt ?? "",
    slide.aiNotes?.visualPlan?.imageAlt ?? "",
    slide.title,
    `${deck.title} ${slide.title}`
  ]
    .map((query) => query.replace(/\s+/g, " ").trim().slice(0, 120))
    .filter((query, index, values) => query && values.indexOf(query) === index);
}

function officialSourceUrls(slide: Slide) {
  return [
    ...new Set(
      (slide.aiNotes?.sourceLedger ?? [])
        .filter(
          (entry) =>
            entry.sourceType === "web" &&
            entry.authority === "official" &&
            entry.url
        )
        .map((entry) => entry.url as string)
    )
  ];
}

function safeStorageName(value: string) {
  return (value || "image-asset.png").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function createAssetContentUrl(projectId: string, fileId: string) {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(fileId)}/content`;
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Image provider failed";
}

function emitImageFallback(
  onFallback: ((diagnostic: ImageAssetFallbackDiagnostic) => void) | undefined,
  diagnostic: ImageAssetFallbackDiagnostic
): void {
  try {
    onFallback?.(diagnostic);
  } catch {
    // Diagnostic logging must not change image fallback behavior.
  }
}

export function classifyImageAssetError(
  error: unknown,
  policy: string,
  uploadedOfficialAsset = false
): ImageAssetFallbackDiagnostic {
  if (error instanceof ImageAssetPipelineError) {
    return {
      reasonCode: error.reasonCode,
      name: error.name,
      provider: error.provider,
      providerHttpStatus: safeHttpStatus(error.cause),
      providerRequestId: safeProviderRequestId(error.cause)
    };
  }
  const message = error instanceof Error ? error.message : "";
  const provider = providerForPolicy(policy, uploadedOfficialAsset);
  const reasonCode = message.startsWith(
    "OpenAI image generation failed with status"
  )
    ? "OPENAI_IMAGE_HTTP_ERROR"
    : message === "OpenAI image generation returned no image data"
      ? "OPENAI_IMAGE_EMPTY_RESPONSE"
      : message.startsWith("Openverse image search failed with status")
        ? "OPENVERSE_SEARCH_HTTP_ERROR"
        : message === "Openverse returned no licensed image candidate"
          ? "OPENVERSE_NO_LICENSED_CANDIDATE"
          : message.startsWith("Public image download failed with status")
            ? "PUBLIC_IMAGE_DOWNLOAD_FAILED"
            : message.includes("Official") || uploadedOfficialAsset
              ? "OFFICIAL_IMAGE_UNAVAILABLE"
              : message.includes("size") || message.includes("byte")
                ? "IMAGE_ASSET_INVALID_SIZE"
                : message.includes("MIME") || message.includes("content type")
                  ? "IMAGE_ASSET_INVALID_MIME"
                  : message.includes("resolution") ||
                      message.includes("640x360")
                    ? "IMAGE_ASSET_RESOLUTION_TOO_LOW"
                    : "IMAGE_PROVIDER_UNAVAILABLE";
  return {
    reasonCode,
    name: error instanceof Error ? error.name : "UnknownError",
    provider,
    providerHttpStatus: safeHttpStatus(error) ?? statusFromMessage(message),
    providerRequestId: safeProviderRequestId(error)
  };
}

class ImageAssetPipelineError extends Error {
  constructor(
    readonly reasonCode: "IMAGE_STORAGE_FAILED",
    readonly provider: "storage",
    override readonly cause: unknown
  ) {
    super("Image asset storage failed.");
    this.name = "ImageAssetPipelineError";
  }
}

function providerForPolicy(
  policy: string,
  uploadedOfficialAsset: boolean
): ImageAssetFallbackDiagnostic["provider"] {
  if (uploadedOfficialAsset) return "user-upload";
  if (policy === "ai-generated") return "openai";
  if (policy === "public-assets") return "openverse";
  return "official-web";
}

function safeHttpStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  for (const key of ["status", "statusCode", "httpStatus"]) {
    const value = error[key];
    if (typeof value === "number" && value >= 100 && value <= 599) return value;
  }
  return undefined;
}

function safeProviderRequestId(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  for (const key of ["requestId", "request_id"]) {
    const value = error[key];
    if (typeof value === "string" && value.length > 0 && value.length <= 256) {
      return value;
    }
  }
  return undefined;
}

function statusFromMessage(message: string): number | undefined {
  const match = /status (\d{3})(?:\D|$)/.exec(message);
  const status = Number(match?.[1]);
  return status >= 100 && status <= 599 ? status : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
