import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SemanticCapabilityStatus } from "./SemanticCapabilityStatus";
import type { SemanticCapabilityStatusItem } from "./semanticCapabilityStatusModel";

describe("SemanticCapabilityStatus", () => {
  it("시스템 상태 영역을 렌더링하지 않는다", () => {
    const html = renderToStaticMarkup(
      <SemanticCapabilityStatus items={[statusItem()]} onAction={() => undefined} />
    );

    expect(html).toBe("");
  });
});

function statusItem(): SemanticCapabilityStatusItem {
  return {
    key: "nli",
    severity: "warning",
    shortLabel: "정밀 판정 비활성",
    detail: "기본 의미 체크로 계속합니다.",
    retryable: true,
    affectedCount: 1,
    source: "system-status",
    actionLabel: "재시도",
    recovered: false,
    measurementMode: "basic"
  };
}
