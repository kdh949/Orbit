import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiPptMockupPage,
  AiPptStyleColorPage,
} from "./AiPptMockupPage";
import { DesignPackOptions } from "./DesignPackOptions";

describe("AI PPT wizard UI", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the Style & Color loading preview from the development query", () => {
    vi.stubGlobal("window", { location: { search: "?preview=style-loading" } });

    const html = renderToStaticMarkup(createElement(AiPptMockupPage));

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Style &amp; Color");
    expect(html).toContain("ai-ppt-style-loader");
  });

  it("starts with one content screen and multiple attachments", () => {
    const html = renderToStaticMarkup(createElement(AiPptMockupPage));

    expect(html).toContain('aria-label="발표 내용 입력"');
    expect(html).toContain('name="topic"');
    expect(html).toContain('name="content"');
    expect(html).toContain('name="audience"');
    expect(html).toContain("대본 톤");
    expect(html).toContain("전문적인");
    expect(html).toContain('type="file"');
    expect(html).toContain("multiple");
    expect(html).toContain("여기에 놓아 미리보기");
    expect(html).toContain("ai-ppt-drop-preview");
    expect(html).toContain("참고 자료를 여기에 놓으세요");
    expect(html).not.toContain(
      "선택 사항 · PDF, PPTX, DOCX 또는 이미지 파일을 여러 개 첨부할 수 있습니다.",
    );
    expect(html).toContain('aria-label="참고 자료 파일 업로드"');
    expect(html).toContain("내용 구성");
    expect(html).toContain("웹 리서치 허용");
    expect(html).toContain("이미지 구성");
    expect(html).toContain("AI 이미지 사용");
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html.match(/<label class="ai-ppt-policy-checkbox">/g)).toHaveLength(2);
    expect(html).not.toContain('aria-haspopup="menu"');
    expect(html).toContain("입력한 내용만 사용합니다");
    expect(html).toContain("이미지 없이 도형과 타이포 중심으로 구성합니다");
    expect(html).not.toContain(
      "선택한 어조는 슬라이드 디자인이 아닌 발표 대본에만 반영됩니다.",
    );
    expect(html).toContain("redesign-icon-label");
    expect(html).not.toContain('name="duration"');
    expect(html).not.toContain('name="slides"');
    expect(html).not.toContain(">References<");
  });

  it("shows the two-step content and Style & Color indicator", () => {
    const html = renderToStaticMarkup(createElement(AiPptMockupPage));

    expect(html).toContain(">내용 입력<");
    expect(html).toContain(">Style &amp; Color<");
    expect(html).not.toContain(">슬라이드 구성 미리보기<");
    expect(html).toContain('aria-current="step"');
    expect(html).not.toContain("핵심 컨텍스트");
    expect(html).toContain("상세 내용 및 컨텍스트");
    expect(html).toContain("대본 톤");
    expect(html).toContain("다음 단계");
    expect(html).not.toContain("AI 없이 직접 시작");
    expect(html).not.toContain("빈 슬라이드");
    expect(html).not.toContain("PPTX 가져오기");
    expect(html).not.toContain(">Brief<");
    expect(html).not.toContain(">Color<");
  });

  it("shows compact font and palette selection on Style & Color", () => {
    const html = renderToStaticMarkup(
      createElement(AiPptStyleColorPage, {
        jobId: "job-1",
        projectId: "project-1",
      }),
    );

    expect(html).toContain("폰트");
    expect(html).toContain("디자인 팩");
    expect(html).toContain("AI 추천");
    expect(html).toContain("Pretendard");
    expect(html).toContain("컬러 팔레트");
    expect(html).not.toContain("ai-ppt-panel-heading");
    expect(html).toContain(">Aa<");
    expect(html).toContain("다음 액션");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("AI로 컬러 팔레트 만들기");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('class="ai-ppt-ai-palette-create"');
    expect(html).toContain('class="ai-ppt-ai-palette-create-icon"');
    expect(html).not.toContain("workspace-home-create");
    expect(html).not.toContain('id="ai-ppt-ai-palette-panel"');
    expect(html.indexOf("ai-ppt-palette-swatches")).toBeLessThan(
      html.indexOf("ai-ppt-palette-mockup"),
    );
    expect(html).not.toContain("ai-ppt-font-korean");
    expect(html).not.toContain("ai-ppt-font-latin");
    expect(html).not.toContain("ai-ppt-font-badge");
    expect(html).not.toContain("ai-ppt-palette-hex");
    expect(html).not.toContain("ai-ppt-palette-card-footer");
    expect(html).not.toContain("ai-ppt-palette-mockup-header");
    expect(html).not.toContain("ai-ppt-palette-mockup-footer");
    expect(html).not.toContain("Pretendard matches professional presentation tone.");
    expect(html).not.toContain("--color-primary-main");
  });

  it("shows three cover and body recommendations with manual override", () => {
    const options = [
      option("executive-review", "executive-review", "Executive Review"),
      option("kickoff-alignment", "kickoff-alignment", "Kickoff & Alignment"),
      option("editorial-insight", "editorial-insight", "Editorial Insight"),
    ] as const;
    const html = renderToStaticMarkup(
      createElement(DesignPackOptions, {
        loading: false,
        onSelect: vi.fn(),
        options: [...options],
        selected: { id: "kickoff-alignment", version: 1 },
      }),
    );

    expect(html).toContain("AI 추천 1순위");
    expect(html.match(/표지와 본문 미리보기/g)).toHaveLength(3);
    expect(html).toContain('data-preview-id="preview-executive-review-cover"');
    expect(html).toContain('aria-label="Kickoff &amp; Alignment 디자인 팩 선택됨"');
    expect(html).toContain('aria-pressed="true"');
  });

  it("keeps auto mode available when recommendations fail", () => {
    const html = renderToStaticMarkup(
      createElement(DesignPackOptions, {
        error: "추천을 불러오지 못했습니다.",
        loading: false,
        onSelect: vi.fn(),
        options: [],
        selected: null,
      }),
    );

    expect(html).toContain("AI 추천 자동 모드로 계속할 수 있습니다");
    expect(html).toContain('aria-label="AI 추천 자동 모드"');
    expect(html).toContain('aria-pressed="true"');
  });
});

function option(
  id: "executive-review" | "kickoff-alignment" | "editorial-insight",
  family: "executive-review" | "kickoff-alignment" | "editorial-insight",
  name: string,
) {
  return {
    id,
    version: 1,
    name,
    family,
    rationale: `${name} 추천 근거`,
    preview: {
      manifestId: `preview-${id}`,
      coverPreviewId: `preview-${id}-cover`,
      bodyPreviewId: `preview-${id}-body`,
    },
  };
}
