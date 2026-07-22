import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OoxmlReferenceTemplateOptions } from "./OoxmlReferenceTemplateOptions";

describe("OoxmlReferenceTemplateOptions", () => {
  it("renders cover/body previews, exact version, and editable ranges", () => {
    const html = renderToStaticMarkup(
      createElement(OoxmlReferenceTemplateOptions, {
        error: "",
        loading: false,
        onRetry: vi.fn(),
        onSelect: vi.fn(),
        options: [
          {
            templateId: "operating-review",
            version: 1,
            name: "Operating Review",
            description: "운영 지표와 실행 과제 보고",
            preview: { coverAssetId: "cover", bodyAssetId: "body" },
            editableRanges: [
              {
                contentType: "text",
                mutationPolicy: "text-content",
                slotCount: 4,
              },
              {
                contentType: "chart",
                mutationPolicy: "chart-data",
                slotCount: 1,
              },
            ],
          },
        ],
        selected: { templateId: "operating-review", version: 1 },
      }),
    );

    expect(html).toContain("표지 미리보기");
    expect(html).toContain("본문 미리보기");
    expect(html).toContain("v1");
    expect(html).toContain("문구 4개");
    expect(html).toContain("차트 데이터 1개");
    expect(html).toContain('aria-pressed="true"');
  });

  it.each([
    [{ loading: true, error: "", options: [] }, 'aria-busy="true"'],
    [
      { loading: false, error: "catalog unavailable", options: [] },
      'role="alert"',
    ],
    [
      { loading: false, error: "", options: [] },
      "현재 사용할 수 있는 원본 템플릿이 없습니다.",
    ],
  ])("renders bounded loading, error, and empty states", (state, expected) => {
    const html = renderToStaticMarkup(
      createElement(OoxmlReferenceTemplateOptions, {
        ...state,
        onRetry: vi.fn(),
        onSelect: vi.fn(),
        selected: null,
      }),
    );

    expect(html).toContain(expected);
  });
});
