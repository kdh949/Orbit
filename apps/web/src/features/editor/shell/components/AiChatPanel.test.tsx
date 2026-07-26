import { createActivitySlide, createDemoDeck } from "@orbit/editor-core";
import { deckElementSchema } from "@orbit/shared/deck";
import fs from "node:fs";
import path from "node:path";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readCssBundle } from "../../../../styles/readCssBundle.test-utils";
import {
  AiChatPanel,
  createInitialAiChatState,
  type AiChatState
} from "./AiChatPanel";

vi.mock("../../design-agent/components/DesignProposalPreviewModal", () => ({
  DesignProposalPreviewModal: () => null
}));
vi.mock("../../design-agent/components/DesignProposalCompareCard", () => ({
  DesignProposalCompareCard: () => null
}));

const editorShellCssPath = path.join(
  process.cwd(),
  "src/features/editor/editor-shell.css"
);
const editorAiChatScrollCssPath = path.join(
  process.cwd(),
  "src/features/editor/styles/editor-ai-chat-scroll.css"
);

describe("AiChatPanel", () => {
  it("renders the history and message composer", () => {
    const deck = createDemoDeck();
    const html = renderToString(
      <AiChatPanel
        onSpeakerNotesAssistantRequest={() => undefined}
        projectId={deck.projectId}
        deck={deck}
        currentSlide={deck.slides[0] ?? null}
        selectedElementIds={[]}
        chatState={createInitialAiChatState(deck.projectId)}
        onChatStateChange={() => undefined}
        onProposalApplied={() => undefined}
        onGeneratedImageInsert={() => true}
      />
    );

    expect(html).toContain('aria-label="AI 채팅"');
    expect(html).not.toContain('aria-label="AI 챗봇 안내"');
    expect(html).not.toContain("무엇을 도와드릴까요?");
    expect(html).not.toContain("Response");
    expect(html).toContain("현재 슬라이드에서 바꾸고 싶은 디자인");
    expect(html).toContain('placeholder="바꾸고 싶은 디자인을 말씀해 주세요"');
    expect(html).toContain('aria-label="메시지 보내기"');
    expect(html).toContain('aria-label="AI 작업 모드"');
    expect(html).toContain('class="ai-chat-scroll-content"');
    expect(html).toContain("슬라이드 다시 디자인");
    expect(html).toContain("레이아웃 정리");
    expect(html).toContain("핵심 메시지 강조");
    expect(html).toContain("애니메이션 추천");
    expect(html).toContain("이미지 생성");
    expect(html).toContain("<textarea");
  });

  it("keeps the speaker notes action limited to the first slide", () => {
    const deck = createDemoDeck();
    const firstSlideHtml = renderToString(
      <AiChatPanel
        onSpeakerNotesAssistantRequest={() => undefined}
        projectId={deck.projectId}
        deck={deck}
        currentSlide={deck.slides[0] ?? null}
        selectedElementIds={[]}
        chatState={createInitialAiChatState(deck.projectId)}
        onChatStateChange={() => undefined}
        onProposalApplied={() => undefined}
        onGeneratedImageInsert={() => true}
      />
    );
    const secondSlideHtml = renderToString(
      <AiChatPanel
        onSpeakerNotesAssistantRequest={() => undefined}
        projectId={deck.projectId}
        deck={deck}
        currentSlide={deck.slides[1] ?? null}
        selectedElementIds={[]}
        chatState={createInitialAiChatState(deck.projectId)}
        onChatStateChange={() => undefined}
        onProposalApplied={() => undefined}
        onGeneratedImageInsert={() => true}
      />
    );

    expect(firstSlideHtml).toContain('aria-label="추천 AI 요청"');
    expect(firstSlideHtml).toContain("아이스브레이킹 인트로 추가");
    expect(secondSlideHtml).toContain("슬라이드 다시 디자인");
    expect(secondSlideHtml).not.toContain("아이스브레이킹 인트로 추가");
  });

  it("keeps assistant suggestion and mode controls compact", () => {
    const css = readCssBundle(editorShellCssPath);
    const scrollCss = fs.readFileSync(editorAiChatScrollCssPath, "utf8");

    expect(css).toMatch(
      /\.editor-ai-assistant-panel\s*\.ai-chat-suggestions\s*\{[^}]*gap:\s*var\(--redesign-space-2\);[^}]*padding:\s*0 var\(--redesign-space-4\) var\(--redesign-space-3\);/s
    );
    expect(css).toMatch(
      /\.editor-ai-assistant-panel\s*\.ai-chat-suggestions\s*button\s*\{[^}]*min-height:\s*42px;[^}]*padding:\s*0 var\(--redesign-space-4\);/s
    );
    expect(css).toMatch(
      /\.editor-ai-assistant-panel\s*\.ai-chat-mode-switch\s*button\s*\{[^}]*min-height:\s*34px;[^}]*padding:\s*0 var\(--redesign-space-3\);/s
    );
    expect(css).toMatch(
      /\.editor-ai-assistant-panel\s*\.ai-chat-input-shell\s*\{[^}]*min-height:\s*58px;/s
    );
    expect(css).toMatch(
      /\.editor-ai-assistant-panel\s*\.ai-chat-input-shell\s*textarea\s*\{[^}]*min-height:\s*44px;/s
    );
    expect(css).toMatch(
      /\.editor-ai-assistant-panel\s*\.ai-chat-message\.user\s*\.ai-chat-message-stack\s*\{[^}]*width:\s*fit-content;[^}]*max-width:\s*78%;/s
    );
    expect(scrollCss).toMatch(
      /\.editor-ai-assistant-panel\s*\.ai-chat-scroll-content\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s
    );
  });

  it("renders editor-owned history again after the panel remounts", () => {
    const deck = createDemoDeck();
    const chatState: AiChatState = {
      messages: [
        ...createInitialAiChatState(deck.projectId).messages,
        {
          id: "user-persisted",
          role: "user",
          content: "이 채팅 기록은 패널을 다시 열어도 유지됩니다."
        }
      ],
      projectId: deck.projectId,
      sessionId: "session-persisted"
    };
    const renderPanel = () =>
      renderToString(
        <AiChatPanel
          onSpeakerNotesAssistantRequest={() => undefined}
          projectId={deck.projectId}
          deck={deck}
          currentSlide={deck.slides[0] ?? null}
          selectedElementIds={[]}
          chatState={chatState}
          onChatStateChange={() => undefined}
          onProposalApplied={() => undefined}
          onGeneratedImageInsert={() => true}
        />
      );

    expect(renderPanel()).toContain("이 채팅 기록은 패널을 다시 열어도 유지됩니다.");
    expect(renderPanel()).toContain("이 채팅 기록은 패널을 다시 열어도 유지됩니다.");
  });

  it("disables design requests for a special slide", () => {
    const deck = createDemoDeck();
    const slide = createActivitySlide(deck, "poll");
    const html = renderToString(
      <AiChatPanel
        onSpeakerNotesAssistantRequest={() => undefined}
        projectId={deck.projectId}
        deck={{ ...deck, slides: [...deck.slides, slide] }}
        currentSlide={slide}
        designEditingEnabled={false}
        selectedElementIds={[]}
        chatState={createInitialAiChatState(deck.projectId)}
        onChatStateChange={() => undefined}
        onProposalApplied={() => undefined}
        onGeneratedImageInsert={() => true}
      />
    );

    expect(html).toContain("특수 장표는 AI 디자인 대신 장표 설정에서 관리합니다");
    expect(html).toContain('placeholder="장표 설정에서 내용을 관리해 주세요"');
    expect(html).toContain('aria-label="AI에게 메시지 보내기"');
    expect(html).toContain("disabled");
  });

  it("renders a selected project image thumbnail for image generation context", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;
    const image = deckElementSchema.parse({
      elementId: "el_reference_image",
      type: "image",
      role: "media",
      x: 100,
      y: 100,
      width: 320,
      height: 180,
      zIndex: 10,
      props: {
        src: `/api/v1/projects/${deck.projectId}/assets/file_reference/content`,
        alt: "선택한 참고 이미지",
      },
    });
    slide.elements = [...slide.elements, image];

    const html = renderToString(
      <AiChatPanel
        onSpeakerNotesAssistantRequest={() => undefined}
        projectId={deck.projectId}
        deck={deck}
        currentSlide={slide}
        selectedElementIds={[image.elementId]}
        chatState={createInitialAiChatState(deck.projectId)}
        onChatStateChange={() => undefined}
        onProposalApplied={() => undefined}
        onGeneratedImageInsert={() => true}
      />
    );

    expect(html).toContain("선택한 이미지");
    expect(html).toContain("이미지 생성 모드에서 자동 사용됨");
    expect(html).toContain("file_reference");
  });

  it("hides selected image context for non-project images", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;
    const image = deckElementSchema.parse({
      elementId: "el_external_image",
      type: "image",
      role: "media",
      x: 100,
      y: 100,
      width: 320,
      height: 180,
      zIndex: 10,
      props: {
        src: "https://example.com/image.png",
        alt: "외부 이미지",
      },
    });
    slide.elements = [...slide.elements, image];

    const html = renderToString(
      <AiChatPanel
        onSpeakerNotesAssistantRequest={() => undefined}
        projectId={deck.projectId}
        deck={deck}
        currentSlide={slide}
        selectedElementIds={[image.elementId]}
        chatState={createInitialAiChatState(deck.projectId)}
        onChatStateChange={() => undefined}
        onProposalApplied={() => undefined}
        onGeneratedImageInsert={() => true}
      />
    );

    expect(html).not.toContain("이미지 생성 모드에서 자동 사용됨");
  });
});
