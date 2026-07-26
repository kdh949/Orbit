import {
  projectAccessResponseSchema,
  type Project,
  type ProjectAccessResponse,
  type ProjectMemberRole,
} from "@orbit/shared/projects";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconFileText } from "@tabler/icons-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";

import { OrbitButton, OrbitFailureState } from "../../components/ui";
import { markAuthLoggedOut } from "../../features/auth/auth-session";
import { ProjectAccessProvider } from "../../features/projects/ProjectAccessContext";

function navigateTo(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function AuthLoadingFallback() {
  return (
    <main className="orbit-page">
      <div role="status">로그인 상태를 확인하고 있습니다.</div>
    </main>
  );
}

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class ProjectAccessRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProjectAccessRequestError";
  }
}

export async function fetchProjectAccess(
  projectId: string,
  fetcher: Fetcher = fetch,
): Promise<ProjectAccessResponse> {
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/access`,
    {
      credentials: "include",
    },
  );
  if (!response.ok) {
    throw new ProjectAccessRequestError(
      await readApiError(response, "프로젝트 권한을 확인하지 못했습니다."),
      response.status,
    );
  }
  return projectAccessResponseSchema.parse(await response.json());
}

export function shouldRetryProjectAccess(failureCount: number, error: unknown) {
  if (error instanceof ProjectAccessRequestError) {
    return error.status >= 500 && failureCount < 2;
  }

  return failureCount < 2;
}

export function getProjectAccessFailureBehavior(
  error: unknown,
  hasAcceptedMembership: boolean,
) {
  if (error instanceof ProjectAccessRequestError && error.status === 401) {
    return "login";
  }

  return hasAcceptedMembership ? "preserve" : "blocking";
}
async function requestProjectAccess(
  projectId: string,
  role: Exclude<ProjectMemberRole, "owner">,
): Promise<ProjectAccessResponse> {
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/access-requests`,
    {
      body: JSON.stringify({ role }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new Error(
      await readApiError(response, "프로젝트 권한 요청에 실패했습니다."),
    );
  }
  return projectAccessResponseSchema.parse(await response.json());
}

async function readApiError(response: Response, fallback: string) {
  const text = await response.text();
  if (!text) return fallback;

  try {
    const body = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof body.message === "string") return body.message;
    if (Array.isArray(body.message)) return body.message.join(", ");
    if (typeof body.error === "string") return body.error;
  } catch {
    return text;
  }

  return fallback;
}

export function ProjectAccessGate(props: {
  children: ReactNode;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const access = useQuery({
    queryKey: ["project-access", props.projectId],
    queryFn: () => fetchProjectAccess(props.projectId),
    retry: shouldRetryProjectAccess,
  });
  const isUnauthorized =
    access.error instanceof ProjectAccessRequestError &&
    access.error.status === 401;
  const membership = access.data?.membership ?? null;
  const acceptedMembership =
    membership?.status === "accepted" ? membership : null;
  const hasAcceptedMembership = acceptedMembership !== null;
  const failureBehavior = getProjectAccessFailureBehavior(
    access.error,
    hasAcceptedMembership,
  );

  useEffect(() => {
    const membership = access.data?.membership;
    if (access.isSuccess && membership?.status !== "accepted") {
      navigateTo(`/project/${encodeURIComponent(props.projectId)}/request`);
    }
  }, [access.data?.membership, access.isSuccess, props.projectId]);

  useEffect(() => {
    if (!isUnauthorized) return;

    markAuthLoggedOut(queryClient);
    navigateTo("/login");
  }, [isUnauthorized, queryClient]);

  if (access.isLoading) return <EditorLoadingFallback />;
  if (failureBehavior === "login") return <AuthLoadingFallback />;
  if (access.isError && failureBehavior === "blocking") {
    return (
      <ProjectAccessError
        onRetry={() => void access.refetch()}
        projectId={props.projectId}
      />
    );
  }
  if (!hasAcceptedMembership) return <EditorLoadingFallback />;

  return (
    <ProjectAccessProvider membership={acceptedMembership}>
      {access.isError && failureBehavior === "preserve" ? (
        <ProjectAccessRecoveryNotice onRetry={() => void access.refetch()} />
      ) : null}
      {props.children}
    </ProjectAccessProvider>
  );
}

function ProjectAccessRecoveryNotice(props: { onRetry: () => void }) {
  return (
    <aside className="orbit-project-access-recovery" role="status">
      <span>
        권한 정보를 다시 확인하지 못했지만 작업 화면은 유지하고 있습니다.
      </span>
      <OrbitButton onClick={props.onRetry} size="compact" variant="secondary">
        다시 확인
      </OrbitButton>
    </aside>
  );
}

function ProjectAccessError(props: { onRetry: () => void; projectId: string }) {
  return (
    <ProjectAccessLayout projectId={props.projectId}>
      <OrbitFailureState
        description="프로젝트 권한 정보를 서버에서 확인하지 못했습니다."
        onRetry={props.onRetry}
        recommendedAction="인터넷 연결을 확인한 뒤 다시 확인하세요. 계속 실패하면 프로젝트 소유자에게 내 권한 상태를 문의하세요."
        retryLabel="다시 확인"
        title="프로젝트 권한을 확인하지 못했습니다."
      />
    </ProjectAccessLayout>
  );
}

export function ProjectAccessRequestPage(props: { projectId: string }) {
  const queryClient = useQueryClient();
  const [role, setRole] =
    useState<Exclude<ProjectMemberRole, "owner">>("editor");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const access = useQuery({
    queryKey: ["project-access", props.projectId],
    queryFn: () => fetchProjectAccess(props.projectId),
    retry: false,
  });

  const membership = access.data?.membership;

  useEffect(() => {
    if (membership?.status === "accepted") {
      navigateTo(`/project/${encodeURIComponent(props.projectId)}`);
    }
  }, [membership?.status, props.projectId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setError(null);
    setIsSubmitting(true);
    try {
      const response = await requestProjectAccess(props.projectId, role);
      queryClient.setQueryData(["project-access", props.projectId], response);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "프로젝트 권한 요청에 실패했습니다.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (access.isLoading) return <EditorLoadingFallback />;

  if (access.isError) {
    return (
      <ProjectAccessLayout projectId={props.projectId}>
        <OrbitFailureState
          description="현재 프로젝트의 접근 상태를 확인하는 중 문제가 발생했습니다."
          onRetry={() => void access.refetch()}
          recommendedAction="인터넷 연결을 확인한 뒤 다시 확인하세요. 같은 문제가 계속되면 프로젝트 목록으로 돌아가 다시 열어보세요."
          retryLabel="다시 확인"
          title="권한 상태를 확인하지 못했습니다."
        />
      </ProjectAccessLayout>
    );
  }

  if (membership?.status === "pending") {
    return (
      <ProjectAccessLayout
        project={access.data?.project}
        projectId={props.projectId}
      >
        <article className="orbit-access-message">
          <span className="redesign-eyebrow">APPROVAL PENDING</span>
          <h1>승인을 기다리고 있어요.</h1>
          <p>
            프로젝트 소유자가 요청을 확인하고 있습니다. 승인되면 이 프로젝트에
            접근할 수 있습니다.
          </p>
          <dl className="project-request-meta">
            <div>
              <dt>요청 권한</dt>
              <dd>{getProjectAccessRoleLabel(membership.role)}</dd>
            </div>
            <div>
              <dt>상태</dt>
              <dd>대기 중</dd>
            </div>
          </dl>
          <OrbitButton
            onClick={() => void access.refetch()}
            variant="secondary"
          >
            승인 상태 다시 확인
          </OrbitButton>
          <button
            className="orbit-access-back"
            onClick={() => navigateTo("/project")}
            type="button"
          >
            프로젝트 목록으로
          </button>
        </article>
      </ProjectAccessLayout>
    );
  }

  return (
    <ProjectAccessLayout
      project={access.data?.project}
      projectId={props.projectId}
    >
      <form className="orbit-access-message" onSubmit={handleSubmit}>
        <span className="redesign-eyebrow">ACCESS REQUIRED</span>
        <h1>
          이 프로젝트에 참여하려면
          <br />
          승인이 필요해요.
        </h1>
        <p>
          이 프로젝트는 승인된 사용자만 열 수 있습니다. 필요한 권한을 선택해서
          프로젝트 소유자에게 요청하세요.
        </p>
        <div
          className="project-request-options"
          role="radiogroup"
          aria-label="요청 권한"
        >
          <label className={role === "editor" ? "active" : ""}>
            <input
              checked={role === "editor"}
              name="project-role"
              onChange={() => setRole("editor")}
              type="radio"
              value="editor"
            />
            <strong>편집 가능</strong>
            <span>프로젝트를 열고 슬라이드를 수정할 수 있습니다.</span>
          </label>
          <label className={role === "viewer" ? "active" : ""}>
            <input
              checked={role === "viewer"}
              name="project-role"
              onChange={() => setRole("viewer")}
              type="radio"
              value="viewer"
            />
            <strong>보기 전용</strong>
            <span>프로젝트 내용을 읽고 확인할 수 있습니다.</span>
          </label>
        </div>
        {error ? (
          <p className="orbit-access-error" role="alert">
            {error}
          </p>
        ) : null}
        <OrbitButton disabled={isSubmitting} type="submit">
          {isSubmitting ? "요청 중..." : "권한 요청하기"}
        </OrbitButton>
        <button
          className="orbit-access-back"
          onClick={() => navigateTo("/project")}
          type="button"
        >
          프로젝트 목록으로
        </button>
      </form>
    </ProjectAccessLayout>
  );
}

function ProjectAccessLayout(props: {
  children: ReactNode;
  project?: Project;
  projectId: string;
}) {
  return (
    <section className="orbit-project-access">
      <aside className="orbit-access-context">
        <div className="orbit-access-icon">
          <IconFileText aria-hidden="true" size={26} />
        </div>
        <p className="redesign-eyebrow">PRIVATE PROJECT</p>
        <h2>{props.project?.title ?? "비공개 프로젝트"}</h2>
        <p>승인된 구성원만 발표자료를 열고 함께 작업할 수 있습니다.</p>
        <dl>
          <div>
            <dt>프로젝트 ID</dt>
            <dd>{props.project?.projectId ?? props.projectId}</dd>
          </div>
          <div>
            <dt>생성일</dt>
            <dd>
              {props.project
                ? new Date(props.project.createdAt).toLocaleDateString("ko-KR")
                : "확인 중"}
            </dd>
          </div>
        </dl>
      </aside>
      <div className="orbit-access-card">{props.children}</div>
    </section>
  );
}

export function getProjectAccessRoleLabel(role: ProjectMemberRole) {
  if (role === "owner") return "소유자";
  return role === "editor" ? "편집 가능" : "보기 전용";
}

export function EditorLoadingFallback() {
  return (
    <section
      aria-label="에디터를 불러오는 중"
      className="editor-loading-page redesign-dark"
      role="status"
    >
      <span aria-hidden="true" className="editor-loading-indicator" />
    </section>
  );
}
