import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PresentationMenu } from "./PresentationMenu";

function getButtonTag(html: string, attribute: string) {
  return html.match(new RegExp(`<button[^>]*${attribute}[^>]*>`))?.[0] ?? "";
}

describe("PresentationMenu", () => {
  it("발표 준비 중에도 청중 링크 메뉴는 열 수 있다", () => {
    const html = renderToStaticMarkup(
      <PresentationMenu
        activeStartAction="presentation"
        canOpenAudienceLink
        canStartPresentation={false}
        isOpen
        onOpenAudienceLink={vi.fn()}
        onStartFullRehearsal={vi.fn()}
        onStartPresentation={vi.fn()}
        onStartRehearsal={vi.fn()}
        onToggle={vi.fn()}
      />,
    );

    expect(getButtonTag(html, 'aria-label="발표 메뉴 열기"')).not.toContain(
      "disabled",
    );
    expect(getButtonTag(html, 'class="editor-present-button"')).not.toContain(
      "disabled",
    );
    expect(getButtonTag(html, 'aria-label="발표 시작"')).toContain("disabled");
    expect(getButtonTag(html, 'aria-label="슬라이드 한 장 리허설"')).toContain(
      "disabled",
    );
    expect(html).toContain("redesign-dropdown-menu-black");
    expect(html).toContain("editor-presentation-menu");
    expect(html).toContain("발표 시작");
    expect(html).toContain("전체 리허설");
    expect(html).toContain("청중 링크·QR");
  });

  it("청중 링크를 사용할 수 없으면 메뉴 버튼을 비활성화한다", () => {
    const html = renderToStaticMarkup(
      <PresentationMenu
        canOpenAudienceLink={false}
        canStartPresentation={false}
        isOpen={false}
        onOpenAudienceLink={vi.fn()}
        onStartFullRehearsal={vi.fn()}
        onStartPresentation={vi.fn()}
        onStartRehearsal={vi.fn()}
        onToggle={vi.fn()}
      />,
    );

    expect(getButtonTag(html, 'aria-label="발표 메뉴 열기"')).toContain(
      "disabled",
    );
  });

  it("슬라이드 리허설 중에는 편집 버튼으로 에디터에 돌아갈 수 있다", () => {
    const html = renderToStaticMarkup(
      <PresentationMenu
        canOpenAudienceLink
        canStartPresentation={false}
        isOpen={false}
        isSlideRehearsalActive
        onOpenAudienceLink={vi.fn()}
        onStartFullRehearsal={vi.fn()}
        onStartPresentation={vi.fn()}
        onStartRehearsal={vi.fn()}
        onToggle={vi.fn()}
      />,
    );

    const rehearsalButton = getButtonTag(
      html,
      'aria-label="에디터로 돌아가기"',
    );
    expect(rehearsalButton).not.toContain("disabled");
    expect(rehearsalButton).toContain('aria-pressed="true"');
    expect(getButtonTag(html, 'class="editor-present-button"')).toContain(
      "disabled",
    );
    expect(getButtonTag(html, 'aria-label="발표 메뉴 열기"')).toContain(
      "disabled",
    );
    expect(html).toContain("rehearsal-disabled");
    expect(html).toContain("tabler-icon-edit");
    expect(html).not.toContain("tabler-icon-microphone");
  });
});
