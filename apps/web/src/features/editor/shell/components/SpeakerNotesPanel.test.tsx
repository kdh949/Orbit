import { createDemoDeck } from "@orbit/editor-core";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { getSpeakerNotesLengthGuidance } from "../speakerNotesAssistant";
import { SpeakerNotesPanel } from "./SpeakerNotesPanel";
import { SpeakerNotesQnaTab } from "./SpeakerNotesQnaTab";
import { SpeakerNotesReportTab } from "./SpeakerNotesReportTab";

function renderPanel(isExpanded: boolean, isEditing = false) {
  const deck = createDemoDeck();
  const currentSlide = deck.slides[0] ?? null;

  return renderToStaticMarkup(
    <SpeakerNotesPanel
      canGenerateQuestionGuides
      contentRef={createRef<HTMLDivElement>()}
      currentSlide={currentSlide}
      deck={deck}
      draft={currentSlide?.speakerNotes ?? ""}
      flushPendingSaves={vi.fn()}
      guidance={getSpeakerNotesLengthGuidance(currentSlide?.speakerNotes ?? "")}
      height={240}
      isEditing={isEditing}
      isExpanded={isExpanded}
      isMaximized={false}
      isResizing={false}
      maxHeight={480}
      minHeight={120}
      onCancelEdit={vi.fn()}
      onClearKeyword={vi.fn()}
      onDeleteKeyword={vi.fn()}
      onDraftChange={vi.fn()}
      onOpenAssistant={vi.fn()}
      onResizeKeyDown={vi.fn()}
      onResizeStart={vi.fn()}
      onSaveEdit={vi.fn()}
      onSelectKeyword={vi.fn()}
      onSelectKeywordActionMode={vi.fn()}
      onSelectKeywordText={vi.fn()}
      onStartEdit={vi.fn()}
      onTabSelected={vi.fn()}
      onToggleMaximized={vi.fn()}
      onTogglePanel={vi.fn()}
      projectId={deck.projectId}
      questionGuideAutoStatus="idle"
      questionGuideRefreshToken={0}
      reportRefreshToken={0}
      requestedTab={null}
      selectedKeyword={null}
      selectedKeywordId={null}
      selectedKeywordOccurrenceKey={null}
      selectedKeywordRequiredActive={false}
      selectedKeywordUsage={null}
      showIds={false}
      usageByKeywordId={{}}
    />,
  );
}

describe("SpeakerNotesPanel", () => {
  it("접힌 상태에서는 대본 레이블과 한 줄 미리보기, 펼치기 아이콘을 표시한다", () => {
    const html = renderPanel(false);

    expect(html).toContain("speaker-notes-collapsed-label\">대본");
    expect(html).not.toContain("script-panel-icon");
    expect(html).not.toContain("speaker-notes-preview");
    expect(html).toContain("speaker-notes-collapsed-preview");
    expect(html).toContain(createDemoDeck().slides[0]?.speakerNotes ?? "");
    expect(html).toContain("speaker-notes-toggle-chevron");
    expect(html).toContain("tabler-icon-chevron-up");
  });

  it("대본, QnA, 리포트 탭과 대본 내부의 압축 액션을 렌더링한다", () => {
    const html = renderPanel(true);

    expect(html).toContain('role="tablist"');
    expect(html).toContain(">대본</button>");
    expect(html).toContain(">QnA</button>");
    expect(html).toContain(">리포트</button>");
    expect(html).toContain('id="speaker-notes-script-tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("script-notes-surface-actions");
    expect(html).toContain('aria-label="발표 메모를 슬라이드 편집 영역까지 확대"');
    expect(html).toContain("tabler-icon-maximize");
    expect(html).not.toContain("speaker-notes-action-row");
    expect(html).toContain('aria-label="AI로 메모 다듬기"');
    expect(html).toContain("tabler-icon-wand");
    expect(html).not.toContain('aria-label="메모 편집"');
    expect(html).toContain("더블클릭하거나 Enter 키를 눌러 편집");
    expect(html).not.toContain("speaker-notes-length-meter");
  });

  it("편집 상태에서는 대본 안에 취소와 저장 액션을 표시한다", () => {
    const html = renderPanel(true, true);

    expect(html).toContain("script-notes-editor-shell");
    expect(html).toContain('aria-label="메모 편집 취소"');
    expect(html).toContain('aria-label="메모 저장"');
    expect(html).not.toContain('aria-label="AI로 메모 다듬기"');
  });

  it("QnA와 리포트 내용을 독립된 탭 컴포넌트로 렌더링한다", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0] ?? null;
    const qnaHtml = renderToStaticMarkup(
      <SpeakerNotesQnaTab
        canGenerate
        deck={deck}
        flushPendingSaves={vi.fn()}
        projectId={deck.projectId}
        questionGuideAutoStatus="idle"
        questionGuideRefreshToken={0}
        slide={slide}
      />,
    );
    const reportHtml = renderToStaticMarkup(
      <SpeakerNotesReportTab
        deck={deck}
        projectId={deck.projectId}
        refreshToken={0}
        slide={slide}
      />,
    );

    expect(qnaHtml).toContain('id="speaker-notes-qna-panel"');
    expect(qnaHtml).toContain("질문 생성");
    expect(qnaHtml).not.toContain("현재 슬라이드 예상 질문");
    expect(reportHtml).toContain('id="speaker-notes-report-panel"');
    expect(reportHtml).toContain("연습 기록을 불러오는 중");
  });
});
