import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  OrbitButton,
  OrbitColorBlock,
  OrbitDialog,
  OrbitEmptyState,
  OrbitFailureState,
  OrbitField,
  OrbitIconLabel,
  OrbitIconButton,
  OrbitInput,
  OrbitStatus,
  OrbitTabs,
  isOrbitDialogDismissAllowed
} from "./index";

describe("Redesign System primitives", () => {
  it("renders button hierarchy and loading semantics", () => {
    const html = renderToStaticMarkup(
      <>
        <OrbitButton>Primary</OrbitButton>
        <OrbitButton variant="secondary">Secondary</OrbitButton>
        <OrbitButton variant="quiet">Quiet</OrbitButton>
        <OrbitButton loading>Loading</OrbitButton>
      </>
    );
    expect(html).toContain("redesign-button-primary");
    expect(html).toContain("redesign-button-secondary");
    expect(html).toContain("redesign-button-quiet");
    expect(html).toContain('aria-busy="true"');
  });

  it("renders semantic status and color-block tones", () => {
    const html = renderToStaticMarkup(
      <>
        <OrbitStatus tone="lilac">편집 중</OrbitStatus>
        <OrbitColorBlock icon={<span>icon</span>} tone="lime">템플릿에서 시작</OrbitColorBlock>
      </>
    );
    expect(html).toContain("redesign-status-lilac");
    expect(html).toContain("redesign-color-block-lime");
  });

  it("connects field labels, descriptions, and errors", () => {
    const html = renderToStaticMarkup(
      <OrbitField error="이메일 형식을 확인하세요." id="email" label="이메일">
        <OrbitInput type="email" />
      </OrbitField>
    );
    expect(html).toContain('for="email"');
    expect(html).toContain('aria-describedby="email-helper"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
  });

  it("renders labeled icon actions and controlled tabs", () => {
    const html = renderToStaticMarkup(
      <>
        <OrbitIconButton aria-label="검색">icon</OrbitIconButton>
        <OrbitTabs
          activeTab="members"
          ariaLabel="공유 정보"
          onChange={() => undefined}
          tabs={[{ id: "members", label: "함께 작업 중" }, { id: "requests", label: "승인 요청" }]}
        >
          참여자 목록
        </OrbitTabs>
      </>
    );
    expect(html).toContain('aria-label="검색"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('role="tabpanel"');
  });

  it("renders a consistently spaced icon label", () => {
    const html = renderToStaticMarkup(
      <OrbitIconLabel icon={<span>icon</span>}>참고 자료</OrbitIconLabel>
    );

    expect(html).toContain("redesign-icon-label");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("참고 자료");
  });

  it("renders dialog and empty-state semantics", () => {
    const html = renderToStaticMarkup(
      <>
        <OrbitDialog description="프로젝트 권한을 관리합니다." onClose={() => undefined} open title="공유">공유 설정</OrbitDialog>
        <OrbitEmptyState description="새 프로젝트를 만들어 시작하세요." title="프로젝트가 없습니다." />
      </>
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('role="status"');
  });

  it("renders a reusable failure state with text-only variations", () => {
    const html = renderToStaticMarkup(
      <OrbitFailureState
        description="연결을 확인한 뒤 프로젝트 목록을 다시 불러오세요."
        onRetry={() => undefined}
        retryLabel="목록 다시 불러오기"
        title="프로젝트를 불러오지 못했습니다."
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("프로젝트를 불러오지 못했습니다.");
    expect(html).toContain("목록 다시 불러오기");
  });

  it("blocks every dialog dismiss path while closing is disabled", () => {
    expect(isOrbitDialogDismissAllowed(false)).toBe(true);
    expect(isOrbitDialogDismissAllowed(true)).toBe(false);
  });
});
