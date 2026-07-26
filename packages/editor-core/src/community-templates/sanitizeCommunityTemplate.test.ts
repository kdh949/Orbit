import { deckSchema } from "@orbit/shared/deck";
import { describe, expect, it } from "vitest";

import {
  createActivityResultsSlide,
  createActivitySlide,
} from "../patches/activitySlideOperations";
import { sanitizeCommunityTemplate } from "./sanitizeCommunityTemplate";
import {
  createPrivateCommunityTemplateDeck,
  privateTemplateFileId,
  privateTemplateMarker,
  privateTemplateUrl,
} from "./communityTemplate.fixture";

describe("sanitizeCommunityTemplate", () => {
  it("removes every private marker, URL, asset reference, and source field", () => {
    const snapshot = sanitizeCommunityTemplate(
      createPrivateCommunityTemplateDeck(),
    );
    const json = JSON.stringify(snapshot);

    expect(json).not.toContain(privateTemplateMarker);
    expect(json).not.toContain(privateTemplateUrl);
    expect(json).not.toContain(privateTemplateFileId);
    expect(json).not.toContain("http://");
    expect(json).not.toContain("https://");
    expect(json).not.toContain("data:");
    expect(json).not.toMatch(
      /speakerNotes|semanticCues|aiNotes|thumbnailUrl|backgroundImage|ooxml|fileId|src|url/i,
    );
  });

  it("keeps layout while replacing text, media, tables, and charts deterministically", () => {
    const snapshot = sanitizeCommunityTemplate(
      createPrivateCommunityTemplateDeck(),
    );
    const firstSlide = snapshot.slides[0]!;
    const imagePlaceholder = firstSlide.elements.find(
      (element) => element.elementId === "el_image_private",
    );
    const svgPlaceholder = firstSlide.elements.find(
      (element) => element.elementId === "el_svg_private",
    );
    const title = firstSlide.elements.find(
      (element) => element.elementId === "el_1",
    );
    const table = firstSlide.elements.find(
      (element) => element.elementId === "el_table_private",
    );

    expect(imagePlaceholder).toMatchObject({
      type: "rect",
      role: "media",
      x: 800,
      y: 100,
      width: 320,
      height: 240,
    });
    expect(svgPlaceholder).toMatchObject({
      type: "rect",
      role: "media",
      x: 1140,
      y: 100,
      width: 320,
      height: 240,
    });
    expect(title).toMatchObject({
      type: "text",
      props: { text: "제목을 입력하세요", fontFamily: "Pretendard" },
    });
    expect(table).toMatchObject({
      type: "table",
      props: {
        rows: [
          [{ text: "내용" }, { text: "내용" }],
          [{ text: "내용" }, { text: "내용" }],
        ],
      },
    });
    expect(
      firstSlide.elements.some(
        (element) => element.elementId === "el_empty_group_private",
      ),
    ).toBe(false);

    const charts = snapshot.slides[1]!.elements.filter(
      (element) => element.type === "chart",
    );
    expect(charts.map((element) => element.props.type)).toEqual([
      "bar",
      "line",
      "pie",
      "doughnut",
      "scatter",
    ]);
    expect(charts.map((element) => element.props.title)).toEqual(
      Array(5).fill("샘플 차트"),
    );
  });

  it.each(["activity", "activity-results"] as const)(
    "rejects a Deck containing a %s slide",
    (kind) => {
      const source = createPrivateCommunityTemplateDeck();
      const activity = createActivitySlide(source, "satisfaction");
      const withActivity = deckSchema.parse({
        ...source,
        slides: [...source.slides, activity],
      });
      const unsafe =
        kind === "activity"
          ? withActivity
          : deckSchema.parse({
              ...withActivity,
              slides: [
                ...withActivity.slides,
                createActivityResultsSlide(
                  withActivity,
                  activity.activity.activityId,
                ),
              ],
            });

      expect(() => sanitizeCommunityTemplate(unsafe)).toThrow(
        "COMMUNITY_TEMPLATE_ACTIVITY_UNSUPPORTED",
      );
    },
  );
});
