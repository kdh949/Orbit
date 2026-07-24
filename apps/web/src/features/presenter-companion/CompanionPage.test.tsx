import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CompanionShell } from "./CompanionPage";

vi.mock("./CompanionAudienceRenderer", () => ({
  CompanionAudienceRenderer: () => <div>Companion output</div>,
}));
vi.mock("./useCompanionSocket", () => ({
  useCompanionSocket: () => ({
    authorityEpochId: null,
    error: "",
    output: null,
    status: "connecting",
  }),
}));

describe("CompanionShell", () => {
  it("renders a credential bootstrap loading shell without presenter data", () => {
    const html = renderToStaticMarkup(<CompanionShell bootstrap={null} />);

    expect(html).toContain("iPad 발표 도우미 연결 중");
    expect(html).not.toContain("speakerNotes");
    expect(html).not.toContain("transcript");
  });

  it("renders a fixed public failure without exposing request details", () => {
    const html = renderToStaticMarkup(
      <CompanionShell
        bootstrap={null}
        error="연결 코드가 만료되었거나 이미 사용되었습니다."
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("iPad 연결을 확인해주세요");
  });
});
