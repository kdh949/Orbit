import type { Keyword } from "@orbit/shared/deck";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { KeywordHighlightedText } from "./KeywordHighlightedText";

describe("KeywordHighlightedText", () => {
  it("renders interactive keyword marks when selection is enabled", () => {
    const html = renderToStaticMarkup(
      <p>
        <KeywordHighlightedText
          keywords={[keyword("kw_ai", "생성형 AI", ["인공지능"], ["OAI"])]}
          text="생성형 AI는 인공지능 초안을 OAI 흐름으로 정리합니다."
          onSelectKeyword={() => undefined}
        />
      </p>
    );

    expect(html).toContain("<button");
    expect(html).toContain('class="keyword-mark "');
    expect(html).toContain("<strong>생성형 AI</strong>");
    expect(html).toContain("<strong>인공지능</strong>");
    expect(html).toContain("<strong>OAI</strong>");
  });

  it("keeps the longest keyword match when aliases overlap", () => {
    const html = renderToStaticMarkup(
      <p>
        <KeywordHighlightedText
          keywords={[
            keyword("kw_ai", "AI"),
            keyword("kw_gen_ai", "생성형 AI")
          ]}
          text="생성형 AI와 AI를 비교합니다."
          onSelectKeyword={() => undefined}
        />
      </p>
    );

    expect(html).toContain("<strong>생성형 AI</strong>");
    expect(html.match(/<strong>AI<\/strong>/g)).toHaveLength(1);
  });

  it("renders non-interactive marks when no select handler is provided", () => {
    const html = renderToStaticMarkup(
      <p>
        <KeywordHighlightedText
          keywords={[keyword("kw_privacy", "개인정보")]}
          text="개인정보 기준을 설명합니다."
        />
      </p>
    );

    expect(html).toContain('<span class="keyword-mark " data-keyword-id="kw_privacy">');
    expect(html).not.toContain("<button");
  });

  it("only marks the matching occurrence when occurrence highlights are provided", () => {
    const html = renderToStaticMarkup(
      <p>
        <KeywordHighlightedText
          highlightedOccurrences={[
            {
              occurrenceId: "kwo_slide_1_kw_ai_9_11",
              keywordId: "kw_ai",
              start: 9,
              end: 11
            }
          ]}
          keywords={[keyword("kw_ai", "AI")]}
          text="AI first AI second"
        />
      </p>
    );

    expect(html.match(/class="keyword-mark "/g)).toHaveLength(1);
    expect(html).not.toContain("keyword-note-token");
    expect(html.match(/<strong>AI<\/strong>/g)).toHaveLength(1);
    expect(html).toContain('data-occurrence-id="kwo_slide_1_kw_ai_9_11"');
  });
});

function keyword(
  keywordId: string,
  text: string,
  synonyms: string[] = [],
  abbreviations: string[] = []
): Keyword {
  return {
    keywordId,
    text,
    synonyms,
    abbreviations,
    required: true
  };
}
