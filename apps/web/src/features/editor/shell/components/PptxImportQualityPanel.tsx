import type { QualityReport, SlideImportRenderMode } from "@orbit/shared/deck";

export type PptxImportState =
  | { status: "idle"; warnings: string[]; qualityReport: null; message: string }
  | {
      status: "uploading" | "importing";
      warnings: string[];
      qualityReport: null;
      message: string;
    }
  | {
      status: "succeeded";
      warnings: string[];
      qualityReport: QualityReport;
      message: string;
    }
  | {
      status: "error";
      warnings: string[];
      qualityReport: null;
      message: string;
    };

const renderModeLabels: Record<SlideImportRenderMode, string> = {
  editable: "편집 가능",
  hybrid: "혼합",
  snapshot: "원본 스냅샷"
};

const pixelEvaluationLabels = {
  passed: "통과",
  failed: "실패",
  "not-evaluated": "미평가"
} as const;

export function PptxImportQualityPanel(props: { state: PptxImportState }) {
  const { state } = props;
  if (state.status === "idle") return null;

  const report = state.qualityReport;
  const slideReports = report?.slideReports ?? [];
  const warnings = report
    ? [...new Set([...state.warnings, ...(report.notes ?? [])])]
    : state.warnings;

  return (
    <section
      aria-labelledby="pptx-import-quality-title"
      className="suggestion-card pptx-import-quality"
      data-testid="pptx-import-quality"
    >
      <div className="pptx-import-quality-heading">
        <strong id="pptx-import-quality-title">PPTX 가져오기</strong>
        <span>{state.message}</span>
      </div>

      {report ? (
        <>
          <div className="pptx-import-quality-summary">
            <div>
              <span>구조 품질 점수</span>
              <strong>{report.compositeScore}/100</strong>
            </div>
            <div>
              <span>편집 가능한 객체 비율</span>
              <strong>{Math.round(report.editabilityCoverage * 100)}%</strong>
            </div>
          </div>
          <p className="pptx-import-quality-disclaimer">
            편집 가능한 객체 비율은 시각 품질 점수가 아닙니다.
          </p>
          <p className="pptx-import-quality-pixel" role="status">
            {report.metrics.pixelSimilarity === null
              ? "픽셀 유사도 미평가"
              : `픽셀 유사도 ${report.metrics.pixelSimilarity}/100`}
          </p>

          {slideReports.length > 0 ? (
            <div className="pptx-import-quality-group">
              <strong>슬라이드별 진단</strong>
              {[...slideReports]
                .sort((left, right) => left.slideIndex - right.slideIndex)
                .map((slide) => (
                  <SlideQualityDetails key={slide.slideIndex} slide={slide} />
                ))}
            </div>
          ) : null}

          {report.notesDiagnostics ? (
            <details className="pptx-import-quality-details">
              <summary>발표자 노트 상태</summary>
              <div className="pptx-import-quality-detail-body">
                <span>
                  노트 본문 {report.notesDiagnostics.imported}/
                  {report.notesDiagnostics.total}
                </span>
                <span>
                  노트 미리보기 {report.notesDiagnostics.rendered}/
                  {report.notesDiagnostics.total}
                </span>
                <span>
                  노트 동기화 가능 {report.notesDiagnostics.writable}/
                  {report.notesDiagnostics.total}
                </span>
                <DiagnosticList
                  items={report.notesDiagnostics.warnings.map(
                    (warning) => `${warning.code} × ${warning.count}`
                  )}
                />
              </div>
            </details>
          ) : null}

          {report.motionDiagnostics && report.motionDiagnostics.total > 0 ? (
            <details className="pptx-import-quality-details">
              <summary>모션 진단 {report.motionDiagnostics.total}건</summary>
              <div className="pptx-import-quality-detail-body">
                <DiagnosticList
                  items={report.motionDiagnostics.details.map(
                    (detail) =>
                      `슬라이드 ${detail.slideIndex} · ${detail.code} × ${detail.count}`
                  )}
                />
              </div>
            </details>
          ) : null}
        </>
      ) : null}

      {warnings.length > 0 ? (
        <div className="pptx-import-quality-group">
          <strong>전체 경고</strong>
          <DiagnosticList items={warnings} />
        </div>
      ) : null}
    </section>
  );
}

function SlideQualityDetails(props: {
  slide: QualityReport["slideReports"][number];
}) {
  const { slide } = props;
  const selected = modeLabel(slide.selectedRenderMode);
  const recommended = modeLabel(slide.recommendedRenderMode);
  const pixelEvaluation = slide.pixelEvaluation
    ? pixelEvaluationLabels[slide.pixelEvaluation]
    : "기록 없음";

  return (
    <details
      className="pptx-import-quality-details"
      data-testid={`pptx-import-quality-slide-${slide.slideIndex}`}
    >
      <summary>
        <span>슬라이드 {slide.slideIndex}</span>
        <small>
          선택: {selected} · 권장: {recommended}
        </small>
      </summary>
      <div className="pptx-import-quality-detail-body">
        <span>픽셀 평가: {pixelEvaluation}</span>
        <span>{slide.ssim === null ? "SSIM 미평가" : `SSIM ${slide.ssim.toFixed(4)}`}</span>
        <span>지원되지 않는 객체 {slide.unsupportedObjectCount ?? 0}개</span>
        <span>폰트 대체 {slide.fontSubstitutionCount ?? 0}건</span>
        <span>
          fallback: {slide.fallback === "rendered-background" ? "원본 배경" : "없음"}
        </span>
        <DiagnosticList items={slide.reasons} />
      </div>
    </details>
  );
}

function DiagnosticList(props: { items: readonly string[] }) {
  if (props.items.length === 0) return null;
  return (
    <ul className="pptx-import-quality-diagnostics">
      {props.items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

function modeLabel(mode: SlideImportRenderMode | undefined) {
  return mode ? renderModeLabels[mode] : "기록 없음";
}
