import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { RehearsalLiveSttStatusNotice } from "./RehearsalLiveSttStatusNotice";
import { buildRehearsalLiveSttStatusModel } from "./rehearsalLiveSttStatus";

describe("RehearsalLiveSttStatus", () => {
  it("오류와 자동 따라가기 중단 안내 및 재연결 버튼을 렌더링한다", () => {
    const html = renderToStaticMarkup(
      <RehearsalLiveSttStatusNotice
        canRetry
        isRetrying={false}
        model={buildRehearsalLiveSttStatusModel({
          isRecording: true,
          liveError: "한국어 온디바이스 언어팩을 사용할 수 없습니다.",
          liveStatus: "unavailable",
        })}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("음성 인식 사용 불가");
    expect(html).toContain("자동 따라가기가 일시 중단");
    expect(html).toContain("음성 인식 다시 연결");
  });

  it("오류 UI에 credential이나 발표자 대본 원문을 포함하지 않는다", () => {
    const presenterScript = "외부에 노출하면 안 되는 발표자 대본 원문";
    const html = renderToStaticMarkup(
      <RehearsalLiveSttStatusNotice
        canRetry={false}
        isRetrying={false}
        model={buildRehearsalLiveSttStatusModel({
          isRecording: true,
          liveError: "token=private-token Web Speech 연결 실패",
          liveStatus: "failed",
        })}
        onRetry={vi.fn()}
      />,
    );

    expect(html).not.toContain("private-token");
    expect(html).not.toContain(presenterScript);
  });
});
