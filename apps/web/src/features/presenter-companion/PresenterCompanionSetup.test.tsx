import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  PresenterCompanionSetup,
  getPurposeLabel,
} from "./PresenterCompanionSetup";
import { getStatusLabel } from "./PresenterCompanionStatus";

describe("PresenterCompanionSetup", () => {
  it("renders as a collapsed optional preflight control", () => {
    const html = renderToStaticMarkup(
      <PresenterCompanionSetup
        projectId="project_1"
        sessionId="session_1"
        sessionPurpose="presentation"
      />,
    );

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("iPad 발표 도우미");
    expect(html).toContain("선택");
    expect(html).toContain("연결하지 않아도 발표를 시작할 수 있어요.");
    expect(html).toContain("연결 안 함");
    expect(html).not.toContain("비공개 입력 테스트");
    expect(html).not.toContain("필기 입력");
    expect(html).not.toContain("입력 테스트");
  });

  it("labels both session purposes", () => {
    expect(getPurposeLabel("presentation")).toBe("실전 발표");
    expect(getPurposeLabel("rehearsal")).toBe("리허설");
  });

  it("shows only connection and output readiness in expanded content", () => {
    const html = renderToStaticMarkup(
      <PresenterCompanionSetup
        projectId="project_1"
        sessionId="session_1"
        sessionPurpose="rehearsal"
        statusController={{
          refresh: vi.fn().mockResolvedValue(undefined),
          setStatus: vi.fn(),
          status: {
            connected: true,
            connectedAt: "2026-07-23T00:00:00.000Z",
            pairingGeneration: 1,
            rttBucket: "fast",
          },
          statusUnavailable: false,
        }}
        variant="popover"
      />,
    );

    expect(html).toContain("연결됨");
    expect(html).toContain("준비됨");
    expect(html).toContain("iPad 연결");
    expect(html).toContain("발표 화면");
    expect(html).not.toContain("필기 입력");
    expect(html).not.toContain("비공개 입력 테스트");
  });

  it("keeps the runtime pairing popover focused on QR and connection state", () => {
    const html = renderToStaticMarkup(
      <PresenterCompanionSetup
        projectId="project_1"
        sessionId="session_1"
        sessionPurpose="presentation"
        statusController={{
          refresh: vi.fn().mockResolvedValue(undefined),
          setStatus: vi.fn(),
          status: null,
          statusUnavailable: false,
        }}
        variant="popover"
      />,
    );

    expect(html).toContain('data-variant="popover"');
    expect(html).not.toContain("iPad 입력 테스트 패드");
    expect(html).not.toContain("나중에 연결");
    expect(html).not.toContain("iPad 기기 확인 진행 단계");
    expect(html).not.toContain("필기 입력");
  });

  it("keeps health failures informational instead of blocking presentation", () => {
    expect(getStatusLabel(null, true)).toContain("발표는 계속됩니다");
    expect(
      getStatusLabel(
        {
          connected: true,
          connectedAt: "2026-07-23T00:00:00.000Z",
          pairingGeneration: 1,
          rttBucket: "slow",
        },
        false,
      ),
    ).toBe("연결됨 · 느림");
  });
});
