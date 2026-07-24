import { describe, expect, it } from "vitest";
import { calculateContainRect } from "./surfaceGeometry";

describe("calculateContainRect", () => {
  it.each([
    {
      content: { height: 1080, width: 1920 },
      container: { height: 900, width: 1600 },
      expected: { height: 900, width: 1600, x: 0, y: 0 },
      label: "16:9",
    },
    {
      content: { height: 768, width: 1024 },
      container: { height: 900, width: 1600 },
      expected: { height: 900, width: 1200, x: 200, y: 0 },
      label: "4:3",
    },
    {
      content: { height: 1920, width: 1080 },
      container: { height: 900, width: 1600 },
      expected: {
        height: 900,
        width: 506.25,
        x: 546.875,
        y: 0,
      },
      label: "portrait",
    },
  ])("maps a $label source into one centered content rect", ({
    container,
    content,
    expected,
  }) => {
    expect(calculateContainRect(container, content)).toEqual(expected);
  });

  it("fails closed for unavailable media dimensions", () => {
    expect(
      calculateContainRect(
        { height: 900, width: 1600 },
        { height: 0, width: 0 },
      ),
    ).toEqual({ height: 0, width: 0, x: 0, y: 0 });
  });
});
