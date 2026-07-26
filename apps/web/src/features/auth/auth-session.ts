import {
  projectTagDefinitionsResponseSchema,
  type CreateProjectTagDefinitionRequest,
  type ProjectTagDefinitionsResponse,
} from "@orbit/shared/projects";
import type { QueryClient } from "@tanstack/react-query";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const maxProfileAvatarBytes = 3 * 1024 * 1024;

export type AuthUser = {
  userId: string;
  email: string;
  displayName: string;
  avatar?: AuthAvatar | null;
};

export type OfficialAvatarId =
  | "orbit-01"
  | "orbit-02"
  | "orbit-03"
  | "orbit-04"
  | "orbit-05"
  | "orbit-06"
  | "orbit-07"
  | "orbit-08"
  | "orbit-09"
  | "orbit-10"
  | "orbit-11"
  | "orbit-12"
  | "orbit-13"
  | "orbit-14"
  | "orbit-15";

export type AuthAvatar =
  | { kind: "official"; avatarId: OfficialAvatarId }
  | { kind: "uploaded"; fileId: string };

export const officialAvatarIds: readonly OfficialAvatarId[] = [
  "orbit-01", "orbit-02", "orbit-03", "orbit-04", "orbit-05",
  "orbit-06", "orbit-07", "orbit-08", "orbit-09", "orbit-10",
  "orbit-11", "orbit-12", "orbit-13", "orbit-14", "orbit-15",
];

export const authMeQueryKey = ["auth", "me"] as const;
export const projectTagDefinitionsQueryKey = ["auth", "project-tags"] as const;

export async function fetchProjectTagDefinitions(
  fetcher: Fetcher = fetch,
): Promise<ProjectTagDefinitionsResponse> {
  const response = await fetcher("/api/v1/auth/project-tags", { credentials: "include" });
  if (!response.ok) throw new Error("태그를 불러오지 못했습니다.");
  return projectTagDefinitionsResponseSchema.parse(await response.json());
}

export async function createProjectTagDefinition(
  input: CreateProjectTagDefinitionRequest,
  fetcher: Fetcher = fetch,
): Promise<ProjectTagDefinitionsResponse> {
  const response = await fetcher("/api/v1/auth/project-tags", {
    body: JSON.stringify(input),
    credentials: "include",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (response.status === 409) throw new Error("이미 사용 중인 태그 이름입니다.");
  if (!response.ok) throw new Error("태그를 저장하지 못했습니다.");
  return projectTagDefinitionsResponseSchema.parse(await response.json());
}

export async function fetchCurrentUser(fetcher: Fetcher = fetch): Promise<AuthUser | null> {
  const response = await fetcher("/api/v1/auth/me", {
    credentials: "include"
  });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error("Unauthenticated");
  }
  const payload = (await response.json()) as AuthUser | { user: AuthUser };
  return "user" in payload ? payload.user : payload;
}

export function getAvatarUrl(avatar: AuthAvatar | null | undefined): string | null {
  if (!avatar) return null;
  if (avatar.kind === "official") return `/avatars/${avatar.avatarId}.png`;
  return `/api/v1/auth/avatar/${encodeURIComponent(avatar.fileId)}`;
}

export async function updateOfficialAvatar(avatarId: OfficialAvatarId): Promise<AuthUser> {
  const response = await fetch("/api/v1/auth/avatar/official", {
    body: JSON.stringify({ avatarId }),
    credentials: "include",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return readUpdatedUser(response);
}

export async function uploadProfileAvatar(file: File): Promise<AuthUser> {
  if (file.size > maxProfileAvatarBytes) {
    throw new Error("파일 크기가 3MB를 초과했습니다. 3MB 이하 이미지를 선택해 주세요.");
  }
  const response = await fetch("/api/v1/auth/avatar/upload", {
    body: file,
    credentials: "include",
    headers: { "content-type": file.type },
    method: "PUT",
  });
  return readUpdatedUser(response);
}

export async function updateProfileDisplayName(
  displayName: string,
  fetcher: Fetcher = fetch,
): Promise<AuthUser> {
  const response = await fetcher("/api/v1/auth/profile", {
    body: JSON.stringify({ displayName }),
    credentials: "include",
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
  return readUpdatedUser(response, "닉네임을 저장하지 못했습니다.");
}

async function readUpdatedUser(
  response: Response,
  fallback = "프로필 이미지를 저장하지 못했습니다.",
): Promise<AuthUser> {
  const text = await response.text();
  let payload: { message?: string | string[]; user?: AuthUser } = {};
  if (text) {
    try {
      payload = JSON.parse(text) as { message?: string | string[]; user?: AuthUser };
    } catch {
      // HTML proxy errors also use the status-code fallback below.
    }
  }
  if (!response.ok) {
    const message = Array.isArray(payload.message)
      ? payload.message.join(", ")
      : payload.message;
    if (message === "Nickname already in use") {
      throw new Error("이미 사용 중인 닉네임입니다.");
    }
    throw new Error(message || `${fallback} (${response.status})`);
  }
  if (!payload.user) throw new Error("프로필 응답이 올바르지 않습니다.");
  return payload.user;
}

export function markAuthLoggedOut(queryClient: QueryClient) {
  queryClient.setQueryData<AuthUser | null>(authMeQueryKey, null);
}
