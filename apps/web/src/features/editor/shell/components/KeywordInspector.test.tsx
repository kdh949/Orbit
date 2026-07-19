import { createKeywordOccurrenceId, type Keyword } from "@orbit/shared";
import fs from "node:fs";
import path from "node:path";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  KeywordDetail,
  KeywordHighlightedNotes,
  KeywordList
} from "./KeywordInspector";

const editorShellCssPath = path.join(
  process.cwd(),
  "src/features/editor/editor-shell.css"
);
const keywordInspectorPath = path.join(
  process.cwd(),
  "src/features/editor/shell/components/KeywordInspector.tsx"
);

describe("KeywordDetail", () => {
  it("renders selection clearing and deletion controls for a selected keyword", () => {
    const keyword: Keyword = {
      keywordId: "kw_ai",
      text: "AI",
      synonyms: [],
      abbreviations: [],
      required: false
    };

    const html = renderToString(
      <KeywordDetail
        keyword={keyword}
        showIds={false}
        usage={{
          advancesSlide: false,
          animationIds: []
        }}
        onClearSelection={vi.fn()}
        onDeleteKeyword={vi.fn()}
        onSelectActionMode={vi.fn()}
      />
    );

    expect(html).toContain("선택 해제");
    expect(html).toContain("키워드 삭제");
    expect(html).toContain("키워드 동작");
    expect(html).toContain("필수 키워드");
    expect(html).toContain("다음 슬라이드 넘김");
    expect(html).toContain("애니메이션 트리거");
  });

  it("keeps aggregate keyword badges separate from selected occurrence usage", () => {
    const keyword: Keyword = {
      keywordId: "kw_ai",
      text: "AI",
      synonyms: [],
      abbreviations: [],
      required: false
    };

    const html = renderToString(
      <>
        <KeywordList
          keywords={[keyword]}
          selectedKeywordId="kw_ai"
          showIds={false}
          usageByKeywordId={{
            kw_ai: {
              advancesSlide: true,
              animationIds: ["anim_1"]
            }
          }}
          onSelectKeyword={vi.fn()}
        />
        <KeywordDetail
          keyword={keyword}
          showIds={false}
          usage={{
            advancesSlide: false,
            animationIds: []
          }}
          onClearSelection={vi.fn()}
          onDeleteKeyword={vi.fn()}
          onSelectActionMode={vi.fn()}
        />
      </>
    );

    expect(html).toMatch(/애니메이션.*1/);
    expect(html.match(/다음 슬라이드/g)).toHaveLength(2);
    expect(html).toContain('class="keyword-mode-select"');
    expect(html).not.toContain('value="advance-slide" selected');
  });

  it("marks required checkpoint badges for emphasized editor styling", () => {
    const keyword: Keyword = {
      keywordId: "kw_required",
      text: "핵심 개념",
      synonyms: [],
      abbreviations: [],
      required: true
    };

    const html = renderToString(
      <KeywordList
        keywords={[keyword]}
        selectedKeywordId={null}
        showIds={false}
        onSelectKeyword={vi.fn()}
      />
    );

    expect(html).toContain('class="keyword-chip-badge required">필수');
  });
});

describe("KeywordHighlightedNotes", () => {
  it("keeps punctuation and manual line breaks in the original reading order", () => {
    const html = renderToString(
      <KeywordHighlightedNotes
        keywords={[]}
        notes={"첫 문장입니다.\n둘째 문장입니다."}
        selectedKeywordId={null}
        showIds={false}
        slideId="slide_1"
        onSelectKeyword={vi.fn()}
        onSelectKeywordText={vi.fn()}
      />
    );

    expect(html).toContain(
      "<strong>문장입니다</strong></button></span>.\n<span"
    );
  });

  it("uses natural text spacing and preserves line breaks in the editor stylesheet", () => {
    const css = fs.readFileSync(editorShellCssPath, "utf8");

    expect(css).toMatch(
      /\.script-copy\s*\{[^}]*white-space:\s*pre-wrap;[^}]*word-break:\s*keep-all;/s
    );
    expect(css).toMatch(
      /\.keyword-note-token\s*\{[^}]*margin:\s*0;[^}]*padding:\s*0;/s
    );
    expect(css).toMatch(
      /\.keyword-note-token strong\s*\{[^}]*font-weight:\s*inherit;/s
    );
    expect(css).toMatch(
      /\.keyword-token-dropdown\.redesign-dropdown-menu\s*\{[^}]*left:\s*0;[^}]*top:\s*calc\(100% \+ var\(--redesign-space-1\)\);[^}]*z-index:\s*var\(--redesign-z-dropdown\);/s
    );
    expect(css).toMatch(
      /\.keyword-token-dropdown\.redesign-dropdown-menu\s*\{[^}]*background:\s*var\(--redesign-color-surface-container\);[^}]*color:\s*var\(--redesign-color-on-surface\);/s
    );
    expect(css).toMatch(
      /\.orbit-shell\.editor-professional \.script-keyword-section \.keyword-strip\s*\{[^}]*flex-wrap:\s*wrap;[^}]*overflow:\s*visible;/s
    );
    expect(css).toMatch(
      /\.orbit-shell\.editor-professional \.script-keyword-section \.keyword-chip\s*\{[^}]*flex:\s*0 1 auto;[^}]*max-width:\s*100%;/s
    );
    expect(css).toMatch(
      /\.orbit-shell \.script-notes-editor\s*\{[^}]*font-size:\s*var\(--redesign-type-body-sm-size\);[^}]*line-height:\s*1\.6;/s
    );
    expect(css).toMatch(
      /\.orbit-shell\.editor-professional \.script-notes-editor-shell\s*\{[^}]*min-height:\s*calc\(var\(--redesign-space-16\) \* 2 \+ var\(--redesign-space-10\)\);/s
    );
    expect(css).toMatch(
      /\.orbit-shell\.editor-professional \.script-notes-editor-shell \.script-notes-editor\s*\{[^}]*min-height:\s*calc\(var\(--redesign-space-16\) \* 2\);/s
    );
  });

  it("selects only the clicked keyword occurrence when the same keyword appears repeatedly", () => {
    const keyword: Keyword = {
      keywordId: "kw_ai",
      text: "AI",
      synonyms: [],
      abbreviations: [],
      required: false
    };

    const html = renderToString(
      <KeywordHighlightedNotes
        keywords={[keyword]}
        notes="AI 덱은 AI 흐름을 설명합니다."
        selectedKeywordId="kw_ai"
        selectedKeywordOccurrenceKey={createKeywordOccurrenceId(
          "slide_1",
          "kw_ai",
          0,
          2
        )}
        showIds={false}
        slideId="slide_1"
        onSelectKeyword={vi.fn()}
        onSelectKeywordText={vi.fn()}
      />
    );

    expect(html.match(/class="keyword-mark keyword-tone-default selected"/g)).toHaveLength(1);
    expect(html).toContain(
      'class="keyword-note-token keyword-tone-default" data-keyword-id="kw_ai" data-occurrence-id="kwo_slide_1_kw_ai_6_8"'
    );
    expect(html).toContain(
      'data-occurrence-id="kwo_slide_1_kw_ai_0_2"'
    );
    expect(html).toContain(
      'data-occurrence-id="kwo_slide_1_kw_ai_6_8"'
    );
  });

  it("uses the dark dropdown variant for script token actions", () => {
    const source = fs.readFileSync(keywordInspectorPath, "utf8");

    expect(source).toContain('className="keyword-token-dropdown"');
    expect(source).toContain('variant="black"');
    expect(source).not.toContain('className="keyword-token-dropdown"\n                variant="white"');
  });

  it("applies distinct script token tones for required and next slide keywords", () => {
    const requiredKeyword: Keyword = {
      keywordId: "kw_required",
      text: "리허설",
      synonyms: [],
      abbreviations: [],
      required: true
    };
    const nextSlideKeyword: Keyword = {
      keywordId: "kw_next",
      text: "플랫폼",
      synonyms: [],
      abbreviations: [],
      required: false
    };

    const html = renderToString(
      <KeywordHighlightedNotes
        keywords={[requiredKeyword, nextSlideKeyword]}
        notes="리허설 이후 플랫폼 설명으로 넘어갑니다."
        selectedKeywordId={null}
        showIds={false}
        slideId="slide_1"
        usageByKeywordId={{
          kw_next: {
            advancesSlide: true,
            animationIds: []
          }
        }}
        onSelectKeyword={vi.fn()}
        onSelectKeywordText={vi.fn()}
      />
    );

    expect(html).toContain('class="keyword-mark keyword-tone-required"');
    expect(html).toContain('class="keyword-mark keyword-tone-next-slide"');
  });
});
