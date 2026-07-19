import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { buildSlideRailItems } from "../slideRailModel";
import { SlideRail } from "./SlideRail";

const slides = [
  { slideId: "slide_1", thumbnailUrl: "", title: "시작" },
  { slideId: "slide_2", thumbnailUrl: "", title: "" },
];

function renderRail(canMutate: boolean, viewMode: "list" | "thumbnail" = "thumbnail") {
  return renderToString(
    <SlideRail
      canMutate={canMutate}
      canvasAspectRatio="16 / 9"
      items={buildSlideRailItems(slides, "slide_1")}
      viewMode={viewMode}
      onDelete={vi.fn()}
      onDuplicate={vi.fn()}
      onMove={vi.fn()}
      onReorder={vi.fn()}
      onSelect={vi.fn()}
    />,
  );
}

describe("SlideRail", () => {
  it("renders draggable slide cards with roving selection ARIA", () => {
    const html = renderRail(true);

    expect(html).toContain('aria-label="슬라이드 목록"');
    expect(html).toContain('data-slide-id="slide_1"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('aria-selected="true"');
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain("is-draggable");
    expect(html).not.toContain("드래그하여 이동");
    expect(html).not.toContain("시작 메뉴");
    expect(html).toContain('role="menu"');
    expect(html).toContain("슬라이드 2");
  });

  it("omits titles from thumbnails while keeping accessible labels", () => {
    const html = renderRail(true, "thumbnail");
    const thumbnailStart = html.indexOf('class="slide-thumb orbit-thumb"');
    const thumbnailEnd = html.indexOf("</span>", thumbnailStart);

    expect(html).not.toContain("slide-title-text");
    expect(html.slice(thumbnailStart, thumbnailEnd)).toContain("slide-number");
    expect(html).toContain('aria-label="1. 시작"');
  });

  it("keeps titles in list mode", () => {
    const html = renderRail(true, "list");

    expect(html).toContain("slide-title-text");
    expect(html).toContain("시작");
    expect(html).toContain("슬라이드 2");
  });

  it("does not render mutation controls for a Viewer", () => {
    const html = renderRail(false);
    expect(html).not.toContain("드래그하여 이동");
    expect(html).not.toContain(" 메뉴");
    expect(html).not.toContain(">복제<");
    expect(html).not.toContain(">삭제<");
    expect(html).toContain('data-slide-id="slide_1"');
  });

  it("disables boundary movement and last-slide deletion actions", () => {
    const boundaryHtml = renderRail(true);
    const singleHtml = renderToString(
      <SlideRail
        canMutate
        canvasAspectRatio="16 / 9"
        items={buildSlideRailItems(slides.slice(0, 1), "slide_1")}
        viewMode="list"
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onMove={vi.fn()}
        onReorder={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(boundaryHtml).toMatch(/<button disabled="" role="menuitem" type="button">위로 이동/);
    expect(singleHtml).toMatch(/<button disabled="" role="menuitem" type="button">삭제/);
  });
});
