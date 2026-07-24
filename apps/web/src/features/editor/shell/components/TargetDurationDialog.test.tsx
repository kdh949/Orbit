import { createDemoDeck } from "@orbit/editor-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TargetDurationDialog } from "./TargetDurationDialog";

describe("TargetDurationDialog", () => {
  it("renders the deck target and slide allocation controls", () => {
    const deck = createDemoDeck();
    deck.targetDurationMinutes = 10;

    const html = renderToStaticMarkup(
      <TargetDurationDialog
        deck={deck}
        onClose={vi.fn()}
        onSave={vi.fn(() => true)}
        open
      />,
    );

    expect(html).toContain("발표 시간 배분");
    expect(html).toContain("target-duration-dialog redesign-dark");
    expect(html).toContain("전체 발표 시간");
    expect(html).toContain('aria-label="1번 슬라이드 제목"');
    expect(html).toContain("균등 배분");
    expect(html).toContain("배분 완료");
  });
});
