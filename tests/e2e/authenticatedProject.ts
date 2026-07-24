import type { AuthUser, Deck, Project, ProjectMemberRole } from "@orbit/shared";
import { expect, type Page } from "@playwright/test";

const e2ePassword = "orbit-e2e-password-123";

export type E2eActor = {
  email: string;
  password: string;
  user: AuthUser;
};

export async function authenticateE2ePage(page: Page, label: string) {
  const email = `orbit-e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const displayName = `E2E-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await page.request.post("/api/v1/auth/register", {
    data: { displayName, email, password: e2ePassword },
  });

  expect(response.ok(), await response.text()).toBe(true);
  const payload = (await response.json()) as { user: AuthUser };
  return {
    email,
    password: e2ePassword,
    user: payload.user,
  } satisfies E2eActor;
}

export async function createAuthenticatedProject(
  page: Page,
  options: { deck?: Deck; label: string; title?: string },
) {
  const actor = await authenticateE2ePage(page, options.label);
  const response = await page.request.post(
    "/api/v1/workspaces/workspace_demo_1/projects",
    { data: { title: options.title ?? `E2E ${options.label}` } },
  );
  expect(response.ok(), await response.text()).toBe(true);
  const project = (await response.json()) as Project;

  let deck: Deck | undefined;
  if (options.deck) {
    deck = {
      ...structuredClone(options.deck),
      deckId: `deck_${project.projectId.replace(/^project_/, "")}`,
      projectId: project.projectId,
    };
    const deckResponse = await page.request.put(
      `/api/v1/projects/${encodeURIComponent(project.projectId)}/deck`,
      { data: { deck } },
    );
    expect(deckResponse.ok(), await deckResponse.text()).toBe(true);
  }

  return { actor, deck, project };
}

export async function addAuthenticatedProjectMember(
  ownerPage: Page,
  memberPage: Page,
  options: {
    label: string;
    projectId: string;
    role: Exclude<ProjectMemberRole, "owner">;
  },
) {
  const actor = await authenticateE2ePage(memberPage, options.label);
  const response = await ownerPage.request.post(
    `/api/v1/workspaces/workspace_demo_1/projects/${encodeURIComponent(options.projectId)}/members`,
    { data: { email: actor.email, role: options.role } },
  );

  expect(response.ok(), await response.text()).toBe(true);
  return actor;
}
