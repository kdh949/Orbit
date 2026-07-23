import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OrbitDiagnosticRecorder } from "./diagnosticRecorder";
import { DiagnosticDrawer } from "./DiagnosticDrawer";

describe("DiagnosticDrawer", () => {
  it("keeps recording status and sensitive-data notice visible", () => {
    const diagnostics = new OrbitDiagnosticRecorder({
      createId: () => "session-1"
    });
    diagnostics.start({ mode: "full", surface: "presentation" });
    diagnostics.emit({
      stage: "matcher",
      name: "matcher.occurrence.evaluated",
      outcome: "rejected",
      reason: "LOW_CONFIDENCE",
      trace: { triggerTraceId: "speech:item-1:0" }
    });

    const html = renderToStaticMarkup(
      <DiagnosticDrawer
        flush={vi.fn()}
        snapshot={diagnostics.snapshot()}
        start={vi.fn()}
        stop={vi.fn()}
        surface="presentation"
      />
    );

    expect(html).toContain("full 기록 중");
    expect(html).toContain("transcript, speaker notes, STT bias phrase");
    expect(html).toContain("서버로 전송되지 않고");
    expect(html).toContain("matcher.occurrence.evaluated");
    expect(html).toContain("JSONL 내보내기");
    expect(html).toContain("전체 삭제");
  });

  it("shows memory fallback warnings", () => {
    const diagnostics = new OrbitDiagnosticRecorder();
    diagnostics.reportStorageWarning(new Error("QuotaExceededError"));

    const html = renderToStaticMarkup(
      <DiagnosticDrawer
        flush={vi.fn()}
        snapshot={diagnostics.snapshot()}
        start={vi.fn()}
        stop={vi.fn()}
        surface="rehearsal"
      />
    );

    expect(html).toContain("로컬 저장 실패");
    expect(html).toContain("최근 500개 이벤트");
  });
});
