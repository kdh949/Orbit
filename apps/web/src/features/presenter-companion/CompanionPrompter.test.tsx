import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CompanionPrompter,
  companionPrompterExpandedStorageKey,
  persistCompanionPrompterExpanded,
  readCompanionPrompterExpanded,
} from "./CompanionPrompter";

describe("CompanionPrompter", () => {
  it("renders collapsed previous, script, and next controls by default", () => {
    const html = renderToStaticMarkup(
      <CompanionPrompter
        canControl
        canViewPrompter
        connected
        navigationError=""
        navigationPending={null}
        output={{
          sessionId: "session_1",
          authorityEpochId: "epoch_1",
          outputRevision: 1,
          outputMode: "black",
          slideId: "slide_1",
          slideIndex: 0,
          animationStep: 0,
          canGoNext: true,
          canGoPrevious: false,
        }}
        prompter={{
          sessionId: "session_1",
          authorityEpochId: "epoch_1",
          prompterRevision: 1,
          slideId: "slide_1",
          slideIndex: 0,
          availability: "ready",
          trackingStatus: "listening",
          progressPercent: 50,
          focusSentenceId: "sentence_1",
          rows: [
            {
              sentenceId: "sentence_1",
              status: "current",
              text: "현재 발표 대본입니다.",
            },
          ],
        }}
        sendNavigation={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="이전 슬라이드"');
    expect(html).toContain(
      'aria-label="다음 애니메이션 또는 슬라이드"',
    );
    expect(html).toContain("현재 발표 대본입니다.");
    expect(html).toContain('data-expanded="false"');
    expect(html).not.toContain("현재 슬라이드 대본");
  });

  it("disables navigation while a command is pending", () => {
    const html = renderToStaticMarkup(
      <CompanionPrompter
        canControl
        canViewPrompter
        connected
        navigationError="발표 화면이 변경되었습니다. 다시 눌러주세요."
        navigationPending={{
          sessionId: "session_1",
          authorityEpochId: "epoch_1",
          clientOperationId: "nav_1",
          expectedOutputRevision: 1,
          action: "next-step",
        }}
        output={{
          sessionId: "session_1",
          authorityEpochId: "epoch_1",
          outputRevision: 1,
          outputMode: "black",
          slideId: "slide_1",
          slideIndex: 0,
          animationStep: 0,
          canGoNext: true,
          canGoPrevious: true,
        }}
        prompter={null}
        sendNavigation={vi.fn()}
      />,
    );

    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain("발표 화면이 변경되었습니다.");
  });

  it("remembers only the expanded preference on the current device", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(readCompanionPrompterExpanded(storage)).toBe(false);
    persistCompanionPrompterExpanded(true, storage);
    expect(values).toEqual(
      new Map([[companionPrompterExpandedStorageKey, "true"]]),
    );
    expect(readCompanionPrompterExpanded(storage)).toBe(true);
  });
});
