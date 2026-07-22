import {
  aiDeckDesignSelectionResponseSchema,
  designPackOptionsRequestSchema,
  designPackOptionsResponseSchema,
  generateDeckDesignSelectionSchema,
  type DesignPackOptionsRequest,
  type GenerateDeckDesignSelection,
} from "@orbit/shared";

export function styleColorPath(projectId: string, jobId: string) {
  return `/project/${encodeURIComponent(projectId)}/style-color/${encodeURIComponent(jobId)}`;
}

export function generationPath(projectId: string, jobId: string) {
  return `/project/${encodeURIComponent(projectId)}/generation/${encodeURIComponent(jobId)}`;
}

export async function requestDesignSelection(projectId: string, jobId: string) {
  return request(projectId, jobId, { method: "GET" });
}

export async function saveDesignSelection(
  projectId: string,
  jobId: string,
  selection: GenerateDeckDesignSelection,
) {
  return request(projectId, jobId, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(generateDeckDesignSelectionSchema.parse(selection)),
  });
}

export async function requestDesignPackOptions(
  projectId: string,
  input: DesignPackOptionsRequest,
) {
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/design-pack-options`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(designPackOptionsRequestSchema.parse(input)),
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : "디자인 팩 추천을 불러오지 못했습니다.",
    );
  }
  return designPackOptionsResponseSchema.parse(payload);
}

async function request(projectId: string, jobId: string, init: RequestInit) {
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/jobs/${encodeURIComponent(jobId)}/design-selection`,
    { ...init, credentials: "include" },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : "스타일 정보를 처리하지 못했습니다.",
    );
  }
  return aiDeckDesignSelectionResponseSchema.parse(payload);
}
