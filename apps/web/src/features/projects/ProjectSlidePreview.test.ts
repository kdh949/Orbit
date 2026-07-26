import type { Slide } from "@orbit/shared/deck";
import { describe, expect, it } from "vitest";
import { buildWorkspaceThumbnailSlide } from "./workspaceThumbnail";

describe("buildWorkspaceThumbnailSlide", () => {
  it("removes the background wash from a home-card preview without mutating the deck slide", () => {
    const slide = {
      slideId: "slide_1",
      style: {
        backgroundImage: {
          alt: "사무실",
          fit: "cover",
          opacity: 0.2,
          src: "/api/v1/projects/project_1/assets/file_1/content",
        },
      },
    } as Slide;

    const thumbnailSlide = buildWorkspaceThumbnailSlide(slide);

    expect(thumbnailSlide.style.backgroundImage?.opacity).toBe(1);
    expect(slide.style.backgroundImage?.opacity).toBe(0.2);
    expect(thumbnailSlide).not.toBe(slide);
  });

  it("keeps slides without a background image unchanged", () => {
    const slide = { style: {} } as Slide;

    expect(buildWorkspaceThumbnailSlide(slide)).toBe(slide);
  });
});
