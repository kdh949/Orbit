import { createDemoDeck } from "@orbit/editor-core";
import { expect, test } from "@playwright/test";

import { createAuthenticatedProject } from "./authenticatedProject";

test.describe("editor save and access recovery", () => {
  test("keeps a failed patch visible and retries it when the browser comes online", async ({
    context,
    page
  }) => {
    const { project } = await createAuthenticatedProject(page, {
      deck: createDemoDeck(),
      label: "save-recovery"
    });
    const recoveredTitle = "Offline patch recovered";

    await page.goto(`/project/${project.projectId}`);
    await expect(page.getByLabel("Presentation editor")).toBeVisible();

    await context.setOffline(true);
    try {
      await page.getByLabel("프레젠테이션 제목 수정").click();
      const titleInput = page.getByRole("textbox", {
        name: "프레젠테이션 제목",
        exact: true
      });
      await titleInput.fill(recoveredTitle);
      await titleInput.press("Enter");

      await expect(
        page.locator(".editor-document-title").getByText("저장 실패", { exact: true })
      ).toBeVisible();
      await expect(page.getByLabel("저장 재시도")).toBeVisible();
    } finally {
      await context.setOffline(false);
    }

    await expect(
      page.locator(".editor-document-title").getByText("저장됨", { exact: true })
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText(recoveredTitle, { exact: true })).toBeVisible();
  });

  test("opens project members and version history after access succeeds", async ({
    page
  }) => {
    const { actor, project } = await createAuthenticatedProject(page, {
      deck: createDemoDeck(),
      label: "access-recovery"
    });

    await page.goto(`/project/${project.projectId}`);
    await expect(page.getByLabel("Presentation editor")).toBeVisible();

    await page.getByLabel("공유").click();
    const shareDialog = page.getByRole("dialog", { name: "프로젝트 공유" });
    await expect(shareDialog).toBeVisible();
    await expect(shareDialog.getByText(actor.email, { exact: true })).toBeVisible();
    await shareDialog.getByRole("button", { name: "닫기" }).click();

    await page.getByLabel("버전 기록").click();
    await expect(page).toHaveURL(new RegExp(`/project/${project.projectId}/history$`));
    await expect(
      page.getByRole("heading", { name: "이전 작업을 확인하고 안전하게 복원하세요." })
    ).toBeVisible();
  });
});
