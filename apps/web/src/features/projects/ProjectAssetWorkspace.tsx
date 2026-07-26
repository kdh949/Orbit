import { demoIds } from "@orbit/shared/common";
import { deckSchema, type Deck } from "@orbit/shared/deck";
import {
  allowedAssetMimeTypes,
  maxAssetUploadSizeBytes,
  type AssetUploadUrlRequest,
  type AssetUploadUrlResponse,
  type FilePurpose,
  type UploadedFile,
} from "@orbit/shared/files";
import {
  deleteProjectResponseSchema,
  projectListResponseSchema,
  projectPageResponseSchema,
  updateProjectPinResponseSchema,
  updateProjectTagsResponseSchema,
  type Project,
  type ProjectListItem,
  type ProjectPageRequest,
  type ProjectPageResponse,
} from "@orbit/shared/projects";

import { resolveRedesignPalette } from "../../styles/redesignPalette";

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
type AssetMimeType = (typeof allowedAssetMimeTypes)[number];

const defaultPurpose: FilePurpose = "pptx-import";
const assetMimeTypeSet = new Set<string>(allowedAssetMimeTypes);
const documentMimeByExtension: Record<string, AssetMimeType> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  png: "image/png",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  webp: "image/webp",
};

export class ProjectAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectAssetError";
  }
}

function getExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

export function resolveAssetMimeType(file: Pick<File, "name" | "type">) {
  if (assetMimeTypeSet.has(file.type)) {
    return file.type as AssetMimeType;
  }

  return documentMimeByExtension[getExtension(file.name)] ?? null;
}

export function getAssetValidationMessage(
  file: Pick<File, "name" | "size" | "type">,
) {
  if (!resolveAssetMimeType(file)) {
    return "PDF, PPTX, DOCX, JPG, PNG, WebP 파일만 업로드할 수 있습니다.";
  }

  if (file.size > maxAssetUploadSizeBytes) {
    return `파일 크기는 최대 ${formatAssetBytes(maxAssetUploadSizeBytes)}까지 가능합니다.`;
  }

  if (file.size <= 0) {
    return "빈 파일은 업로드할 수 없습니다.";
  }

  return null;
}

export function buildAssetUploadRequest(
  file: File,
  purpose: FilePurpose,
): AssetUploadUrlRequest {
  const validationMessage = getAssetValidationMessage(file);
  const mimeType = resolveAssetMimeType(file);

  if (validationMessage || !mimeType) {
    throw new ProjectAssetError(
      validationMessage ?? "업로드할 수 없는 파일입니다.",
    );
  }

  return {
    mimeType,
    originalName: file.name,
    purpose,
    size: file.size,
  };
}

async function readErrorMessage(response: Response, fallback: string) {
  const message = await response.text();
  return message || fallback;
}

export async function fetchProjectDeckPreview(
  projectId: string,
  fetcher: Fetcher = fetch,
): Promise<Deck | null> {
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/deck`,
    { credentials: "include" },
  );
  if (!response.ok) return null;
  try {
    const body = (await response.json()) as { deck?: unknown };
    return deckSchema.parse(body.deck);
  } catch {
    return null;
  }
}

export async function fetchProjects(
  fetcher: Fetcher = fetch,
): Promise<ProjectListItem[]> {
  const response = await fetcher(
    `/api/v1/workspaces/${demoIds.workspaceId}/projects`,
    { credentials: "include" },
  );

  if (!response.ok) {
    throw new ProjectAssetError(
      await readErrorMessage(response, "프로젝트 목록을 불러오지 못했습니다."),
    );
  }

  return projectListResponseSchema.parse(await response.json());
}

export async function fetchProjectPage(
  input: ProjectPageRequest,
  fetcher: Fetcher = fetch,
): Promise<ProjectPageResponse> {
  const params = new URLSearchParams({
    filter: input.filter,
    limit: String(input.limit),
    page: String(input.page),
    query: input.query,
    sort: input.sort,
  });
  if (input.tags.length > 0) params.set("tags", input.tags.join(","));
  const response = await fetcher(
    `/api/v1/workspaces/${demoIds.workspaceId}/projects/page?${params.toString()}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw new ProjectAssetError(
      await readErrorMessage(response, "프로젝트 목록을 불러오지 못했습니다."),
    );
  }
  return projectPageResponseSchema.parse(await response.json());
}

export async function updateProjectPin(
  projectId: string,
  isPinned: boolean,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(
    `/api/v1/workspaces/${demoIds.workspaceId}/projects/${encodeURIComponent(projectId)}/pin`,
    {
      body: JSON.stringify({ isPinned }),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "PATCH",
    },
  );

  if (!response.ok) {
    throw new ProjectAssetError(
      await readErrorMessage(response, "프로젝트 고정 상태를 변경하지 못했습니다."),
    );
  }

  return updateProjectPinResponseSchema.parse(await response.json());
}

export async function updateProjectTags(
  projectId: string,
  tags: string[],
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(
    `/api/v1/workspaces/${demoIds.workspaceId}/projects/${encodeURIComponent(projectId)}/tags`,
    {
      body: JSON.stringify({ tags }),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "PATCH",
    },
  );

  if (!response.ok) {
    throw new ProjectAssetError(
      await readErrorMessage(response, "프로젝트 태그를 저장하지 못했습니다."),
    );
  }

  return updateProjectTagsResponseSchema.parse(await response.json());
}

export async function createProject(title: string, fetcher: Fetcher = fetch) {
  const response = await fetcher(
    `/api/v1/workspaces/${demoIds.workspaceId}/projects`,
    {
      body: JSON.stringify({ title }),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new ProjectAssetError(
      await readErrorMessage(response, "프로젝트를 만들지 못했습니다."),
    );
  }

  const project = (await response.json()) as Project;
  await createInitialProjectDeck(project, fetcher);

  return project;
}

export async function createProjectWithoutDeck(
  title: string,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(
    `/api/v1/workspaces/${demoIds.workspaceId}/projects`,
    {
      body: JSON.stringify({ title }),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new ProjectAssetError(
      await readErrorMessage(response, "프로젝트를 만들지 못했습니다."),
    );
  }
  return (await response.json()) as Project;
}

export async function deleteProject(
  projectId: string,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(
    `/api/v1/workspaces/${demoIds.workspaceId}/projects/${encodeURIComponent(projectId)}`,
    {
      credentials: "include",
      method: "DELETE",
    },
  );

  if (!response.ok) {
    throw new ProjectAssetError(
      await readErrorMessage(response, "프로젝트를 삭제하지 못했습니다."),
    );
  }

  return deleteProjectResponseSchema.parse(await response.json());
}

export function buildInitialProjectDeck(project: Project): Deck {
  const normalizedProjectId = project.projectId.replace(/^project_/, "");
  const redesignPalette = resolveRedesignPalette();
  const primaryColor = redesignPalette?.primary ?? "#2563eb";
  const secondaryColor = redesignPalette?.secondary ?? "#7c3aed";
  const surfaceColor = redesignPalette?.surface ?? "#ffffff";
  const textColor = redesignPalette?.onSurface ?? "#111827";
  const mutedColor = redesignPalette?.surfaceContainer ?? "#f3f4f6";
  const borderColor = redesignPalette?.outlineVariant ?? "#dbe3f0";

  return deckSchema.parse({
    canvas: {
      aspectRatio: "16:9",
      height: 1080,
      preset: "wide-16-9",
      width: 1920,
    },
    deckId: `deck_${normalizedProjectId}`,
    metadata: {
      language: "ko",
      locale: "ko-KR",
      sourceType: "manual",
    },
    projectId: project.projectId,
    slides: [
      {
        actions: [],
        aiNotes: {
          emphasisPoints: [],
          sourceEvidence: [],
        },
        animations: [],
        elements: [],
        keywords: [],
        order: 1,
        slideId: "slide_1",
        speakerNotes: "",
        style: {
          accentColor: primaryColor,
          backgroundColor: surfaceColor,
          layout: "title",
          textColor,
        },
        thumbnailUrl: "",
        title: "",
      },
    ],
    theme: {
      accentColor: primaryColor,
      backgroundColor: surfaceColor,
      effects: {
        borderRadius: 10,
        shadow: {
          blur: 18,
          color: textColor,
          offsetX: 0,
          offsetY: 8,
          opacity: 0.16,
        },
      },
      fontFamily: "Inter",
      name: "Orbit Blank",
      palette: {
        border: borderColor,
        muted: mutedColor,
        primary: primaryColor,
        secondary: secondaryColor,
        surface: surfaceColor,
      },
      textColor,
      typography: {
        bodyFontFamily: "Inter",
        bodySize: 22,
        captionSize: 16,
        headingFontFamily: "Inter",
        headingSize: 36,
        titleSize: 56,
      },
    },
    title: project.title || "새 프레젠테이션",
    version: 1,
  });
}

export async function createInitialProjectDeck(
  project: Project,
  fetcher: Fetcher = fetch,
) {
  const deck = buildInitialProjectDeck(project);
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(project.projectId)}/deck`,
    {
      body: JSON.stringify({
        deck,
        snapshotReason: "deck-replaced",
      }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    },
  );

  if (!response.ok) {
    throw new ProjectAssetError(
      await readErrorMessage(response, "초기 발표자료를 만들지 못했습니다."),
    );
  }

  return deck;
}

export async function uploadProjectAsset(
  projectId: string,
  file: File,
  purpose: FilePurpose = defaultPurpose,
  fetcher: Fetcher = fetch,
) {
  const uploadRequest = buildAssetUploadRequest(file, purpose);
  const uploadUrl = await requestProjectUploadUrl(
    projectId,
    uploadRequest,
    fetcher,
  );

  await uploadFileToStorage(file, uploadUrl, fetcher);
  return completeProjectAssetUpload(projectId, uploadUrl.fileId, fetcher);
}

async function requestProjectUploadUrl(
  projectId: string,
  uploadRequest: AssetUploadUrlRequest,
  fetcher: Fetcher,
) {
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/assets/upload-url`,
    {
      body: JSON.stringify(uploadRequest),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new ProjectAssetError(
      await readErrorMessage(response, "업로드 URL을 발급하지 못했습니다."),
    );
  }

  return (await response.json()) as AssetUploadUrlResponse;
}

async function uploadFileToStorage(
  file: File,
  uploadUrl: AssetUploadUrlResponse,
  fetcher: Fetcher,
) {
  const response = await fetcher(uploadUrl.uploadUrl, {
    body: file,
    headers: uploadUrl.headers,
    method: uploadUrl.method,
  });

  if (!response.ok) {
    throw new ProjectAssetError(
      await readErrorMessage(response, "스토리지 업로드에 실패했습니다."),
    );
  }
}

async function completeProjectAssetUpload(
  projectId: string,
  fileId: string,
  fetcher: Fetcher,
) {
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/assets/complete`,
    {
      body: JSON.stringify({ fileId }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new ProjectAssetError(
      await readErrorMessage(response, "업로드 완료 처리를 하지 못했습니다."),
    );
  }

  return (await response.json()) as UploadedFile;
}

export function formatAssetBytes(bytes: number) {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;

  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}
