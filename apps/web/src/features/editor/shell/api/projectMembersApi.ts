import { projectMembersResponseSchema } from "@orbit/shared/projects";
import type {
  ProjectMemberRole,
  ProjectMembersResponse,
} from "@orbit/shared/projects";

export type ShareRole = "owner" | "editor" | "viewer";

function projectMembersUrl(workspaceId: string, projectId: string) {
  return `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/members`;
}

async function readProjectMembersError(response: Response, fallbackMessage: string) {
  const text = await response.text();

  if (!text) {
    return fallbackMessage;
  }

  try {
    const payload = JSON.parse(text) as {
      error?: string;
      message?: string | string[];
    };

    if (typeof payload.message === "string") {
      return payload.message;
    }

    if (Array.isArray(payload.message)) {
      return payload.message.join(", ");
    }

    if (typeof payload.error === "string") {
      return payload.error;
    }
  } catch {
    return text;
  }

  return fallbackMessage;
}

export async function fetchProjectMembers(
  workspaceId: string,
  projectId: string
): Promise<ProjectMembersResponse> {
  const response = await fetch(projectMembersUrl(workspaceId, projectId), {
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error(
      await readProjectMembersError(response, "Project members fetch failed")
    );
  }

  return projectMembersResponseSchema.parse(await response.json());
}

export async function inviteProjectMember(
  workspaceId: string,
  projectId: string,
  email: string,
  role: Exclude<ProjectMemberRole, "owner">
): Promise<ProjectMembersResponse> {
  const response = await fetch(projectMembersUrl(workspaceId, projectId), {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ email, role })
  });

  if (!response.ok) {
    throw new Error(
      await readProjectMembersError(response, "Project member invite failed")
    );
  }

  return projectMembersResponseSchema.parse(await response.json());
}

export async function updateProjectMemberRole(
  workspaceId: string,
  projectId: string,
  userId: string,
  role: ShareRole
): Promise<ProjectMembersResponse> {
  const response = await fetch(
    `${projectMembersUrl(workspaceId, projectId)}/${encodeURIComponent(userId)}/role`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ role })
    }
  );

  if (!response.ok) {
    throw new Error(
      await readProjectMembersError(response, "Project member role update failed")
    );
  }

  return projectMembersResponseSchema.parse(await response.json());
}

export async function updateProjectMemberStatus(
  workspaceId: string,
  projectId: string,
  userId: string,
  status: "accepted" | "rejected"
): Promise<ProjectMembersResponse> {
  const response = await fetch(
    `${projectMembersUrl(workspaceId, projectId)}/${encodeURIComponent(userId)}/status`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ status })
    }
  );

  if (!response.ok) {
    throw new Error(
      await readProjectMembersError(response, "Project member request update failed")
    );
  }

  return projectMembersResponseSchema.parse(await response.json());
}

export async function removeProjectMember(
  workspaceId: string,
  projectId: string,
  userId: string
): Promise<ProjectMembersResponse> {
  const response = await fetch(
    `${projectMembersUrl(workspaceId, projectId)}/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      credentials: "include"
    }
  );

  if (!response.ok) {
    throw new Error(
      await readProjectMembersError(response, "Project member removal failed")
    );
  }

  return projectMembersResponseSchema.parse(await response.json());
}
