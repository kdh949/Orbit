import type { QualityReport } from "@orbit/shared/deck";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  PptxImportQualityPanel,
  type PptxImportState
} from "./PptxImportQualityPanel";

const qualityReport: QualityReport = {
  compositeScore: 82,
  metrics: {
    geometry: 90,
    text: 80,
    color: 80,
    layer: 90,
    editability: 100,
    pixelSimilarity: null
  },
  weights: {
    geometry: 25,
    text: 15,
    color: 10,
    layer: 10,
    editability: 10,
    pixelSimilarity: 30
  },
  editabilityCoverage: 1,
  appliedCap: null,
  slideReports: [
    {
      slideIndex: 1,
      status: "not_evaluated",
      ssim: null,
      reasons: [
        "PPTX_RENDER_MODE_APPEARANCE_SNAPSHOT_PIXEL_NOT_EVALUATED"
      ],
      fallback: "rendered-background",
      selectedRenderMode: "snapshot",
      recommendedRenderMode: "snapshot",
      pixelEvaluation: "not-evaluated",
      unsupportedObjectCount: 2,
      fontSubstitutionCount: 1
    },
    {
      slideIndex: 2,
      status: "vectorization_failed",
      ssim: 0.89,
      reasons: ["PPTX_RENDER_MODE_HYBRID_RASTER_FALLBACK"],
      fallback: "none",
      selectedRenderMode: "hybrid",
      recommendedRenderMode: "snapshot",
      pixelEvaluation: "failed",
      unsupportedObjectCount: 1,
      fontSubstitutionCount: 0
    }
  ],
  motionDiagnostics: {
    total: 1,
    unsupported: 1,
    downgraded: 0,
    unresolved: 0,
    excluded: 0,
    details: [
      {
        slideIndex: 2,
        code: "PPTX_MOTION_EFFECT_UNSUPPORTED",
        count: 1
      }
    ]
  },
  notesDiagnostics: {
    total: 8,
    imported: 8,
    rendered: 7,
    writable: 8,
    warnings: [{ code: "PPTX_NOTES_RENDER_FAILED", count: 1 }]
  },
  notes: ["pixel renderer unavailable"]
};

function renderPanel(state: PptxImportState) {
  return renderToStaticMarkup(<PptxImportQualityPanel state={state} />);
}

describe("PptxImportQualityPanel", () => {
  it("does not render for an idle import", () => {
    expect(
      renderPanel({
        status: "idle",
        warnings: [],
        qualityReport: null,
        message: ""
      })
    ).toBe("");
  });

  it("shows per-slide modes, pixel status, fallback, font, notes, motion, and every warning", () => {
    const html = renderPanel({
      status: "succeeded",
      warnings: ["warning one", "warning two", "warning three", "warning four"],
      qualityReport,
      message: "PPTX 가져오기 완료"
    });

    expect(html).toContain("편집 가능한 객체 비율");
    expect(html).toContain("시각 품질 점수가 아닙니다");
    expect(html).toContain("픽셀 유사도 미평가");
    expect(html).toContain("슬라이드 1");
    expect(html).toContain("선택: 원본 스냅샷");
    expect(html).toContain("권장: 원본 스냅샷");
    expect(html).toContain("슬라이드 2");
    expect(html).toContain("선택: 혼합");
    expect(html).toContain("픽셀 평가: 실패");
    expect(html).toContain("SSIM 0.8900");
    expect(html).toContain("지원되지 않는 객체 2개");
    expect(html).toContain("폰트 대체 1건");
    expect(html).toContain(
      "PPTX_RENDER_MODE_APPEARANCE_SNAPSHOT_PIXEL_NOT_EVALUATED"
    );
    expect(html).toContain("노트 본문 8/8");
    expect(html).toContain("노트 미리보기 7/8");
    expect(html).toContain("PPTX_NOTES_RENDER_FAILED × 1");
    expect(html).toContain("PPTX_MOTION_EFFECT_UNSUPPORTED × 1");
    expect(html).toContain("pixel renderer unavailable");
    expect(html).toContain("warning one");
    expect(html).toContain("warning four");
    expect(html.match(/<details/g)).toHaveLength(4);
  });

  it("labels a measured pixel score independently from editability coverage", () => {
    const measuredReport: QualityReport = {
      ...qualityReport,
      metrics: { ...qualityReport.metrics, pixelSimilarity: 96 },
      slideReports: []
    };
    const html = renderPanel({
      status: "succeeded",
      warnings: [],
      qualityReport: measuredReport,
      message: "PPTX 가져오기 완료"
    });

    expect(html).toContain("픽셀 유사도 96/100");
    expect(html).toContain("편집 가능한 객체 비율");
    expect(html).not.toContain("시각 품질 100%");
  });
});
