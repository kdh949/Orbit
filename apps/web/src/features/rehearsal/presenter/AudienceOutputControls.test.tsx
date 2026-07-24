import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AudienceOutputControls } from "./AudienceOutputControls";

const baseProps = {
  connected: true,
  error: "",
  onReturnToSlide: vi.fn(),
  onShowBlack: vi.fn(),
  onStartMonitor: async () => true,
  onStartTabOrWindow: async () => true,
  outputMode: "slide" as const,
  status: "idle" as const,
};

describe("AudienceOutputControls", () => {
  it("renders keyboard-accessible basic sharing and black controls", () => {
    const html = renderToStaticMarkup(
      <AudienceOutputControls {...baseProps} />,
    );

    expect(html).toContain("애플리케이션 공유하기");
    expect(html).toContain("청중 화면 가리기");
    expect(html).toContain("고급 옵션");
    expect(html).toContain('aria-live="polite"');
  });

  it("renders the presenter toolbar collapsed with four matching actions", () => {
    const html = renderToStaticMarkup(
      <AudienceOutputControls
        {...baseProps}
        collapsible
        onEndPresentation={vi.fn()}
      />,
    );

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('hidden=""');
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain("애플리케이션 공유하기");
    expect(html).toContain("전체 화면 공유하기");
    expect(html).toContain("청중 화면 가리기");
    expect(html).toContain("발표 종료");
    expect(html).not.toContain("고급 옵션");
  });

  it("shows return-to-slide while sharing", () => {
    const html = renderToStaticMarkup(
      <AudienceOutputControls
        {...baseProps}
        outputMode="screen-share"
        status="sharing"
      />,
    );

    expect(html).toContain("슬라이드로 돌아가기");
    expect(html).toContain("애플리케이션 화면 공유 중");
  });

  it("guides the presenter before connection without private data", () => {
    const html = renderToStaticMarkup(
      <AudienceOutputControls {...baseProps} connected={false} />,
    );

    expect(html).toContain("청중 화면을 먼저 연결해주세요");
    expect(html).toContain('disabled=""');
    expect(html).not.toContain("speakerNotes");
    expect(html).not.toContain("transcript");
  });

  it("offers the latest slide return while the audience output is black", () => {
    const html = renderToStaticMarkup(
      <AudienceOutputControls {...baseProps} outputMode="black" />,
    );

    expect(html).toContain("슬라이드로 돌아가기");
    expect(html).toContain("청중 화면을 가렸습니다");
  });
});
