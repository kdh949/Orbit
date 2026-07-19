import type { TextElementProps } from "@orbit/shared";
import { describe, expect, it } from "vitest";

import { p0AnimationDeck } from "../../../rehearsal/presenter/__fixtures__/animationDeck";
import { isTextElementOverflowing } from "./textLayout";

const slide = p0AnimationDeck.slides[0]!;
const maybeTextElement = slide.elements.find(
  (element) => element.elementId === "el_body"
);

if (!maybeTextElement || maybeTextElement.type !== "text") {
  throw new Error("text fixture missing");
}
const textElement = maybeTextElement;

function isOverflowing(
  props: TextElementProps,
  frame: { width: number; height: number } = { width: 180, height: 48 }
) {
  return isTextElementOverflowing({
    frame: {
      x: textElement.x,
      y: textElement.y,
      width: frame.width,
      height: frame.height,
      rotation: textElement.rotation
    },
    props,
    slide,
    theme: p0AnimationDeck.theme
  });
}

describe("isTextElementOverflowing", () => {
  it("detects mixed Korean, English, and an unbroken word outside a fixed frame", () => {
    expect(
      isOverflowing({
        ...textElement.props,
        text: "한글 English Supercalifragilisticexpialidocious 반복 텍스트"
      })
    ).toBe(true);
  });

  it("uses every rich-text run when measuring overflow", () => {
    expect(
      isOverflowing({
        ...textElement.props,
        text: "짧은 시작 뒤에 매우 큰 글꼴의 여러 줄 텍스트",
        runs: [
          { text: "짧은 ", baseline: "normal", fontSize: 12 },
          {
            text: "시작 뒤에 매우 큰 글꼴의 여러 줄 텍스트",
            baseline: "normal",
            fontSize: 48,
            fontWeight: "bold"
          }
        ]
      })
    ).toBe(true);
  });

  it("compares rotated text against the horizontal frame axis", () => {
    expect(
      isOverflowing(
        {
          ...textElement.props,
          text: "세로 텍스트",
          fontSize: 36,
          writingMode: "vertical-270"
        },
        { width: 24, height: 320 }
      )
    ).toBe(true);
  });
});
