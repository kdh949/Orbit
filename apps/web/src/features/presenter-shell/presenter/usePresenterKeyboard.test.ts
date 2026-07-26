import { describe, expect, it } from "vitest";
import { getPresenterKeyboardCommand } from "./usePresenterKeyboard";

describe("usePresenterKeyboard", () => {
  it.each([" ", "ArrowRight", "PageDown", "Enter"])(
    "maps %s to next-step",
    (key) => {
      expect(getPresenterKeyboardCommand({ key, target: null })).toBe("next-step");
    }
  );

  it.each(["ArrowLeft", "PageUp"])("maps %s to previous-slide", (key) => {
    expect(getPresenterKeyboardCommand({ key, target: null })).toBe("previous-slide");
  });

  it("ignores unrelated keys", () => {
    expect(getPresenterKeyboardCommand({ key: "Escape", target: null })).toBeNull();
  });

  it.each(["button", "a[href]", "[role='button']"])(
    "ignores shortcuts when the event target is inside %s",
    (matchedSelector) => {
      expect(
        getPresenterKeyboardCommand({
          key: "Enter",
          target: createClosestTarget(matchedSelector)
        })
      ).toBeNull();
      expect(
        getPresenterKeyboardCommand({
          key: " ",
          target: createClosestTarget(matchedSelector)
        })
      ).toBeNull();
    }
  );

  it.each([
    ["button", { tagName: "BUTTON" }],
    ["link", { tagName: "A", hasAttribute: (name: string) => name === "href" }],
    ["summary", { tagName: "SUMMARY" }],
    ["button role", { tagName: "SPAN", getAttribute: () => "button" }],
    ["link role", { tagName: "SPAN", getAttribute: () => "link" }],
    ["contenteditable", { isContentEditable: true, tagName: "DIV" }]
  ])("ignores presenter keys from interactive %s targets", (_, target) => {
    expect(
      getPresenterKeyboardCommand({
        key: " ",
        target: target as unknown as EventTarget
      })
    ).toBeNull();
  });

  it("ignores presenter keys from descendants of interactive controls", () => {
    expect(
      getPresenterKeyboardCommand({
        key: "Enter",
        target: {
          tagName: "SPAN",
          closest: (selector: string) =>
            selector.includes("button") ? ({} as Element) : null
        } as unknown as EventTarget
      })
    ).toBeNull();
  });

  it("keeps presenter keys active on body or stage-like targets", () => {
    expect(
      getPresenterKeyboardCommand({
        key: " ",
        target: {
          tagName: "BODY",
          closest: () => null
        } as unknown as EventTarget
      })
    ).toBe("next-step");
  });
});

function createClosestTarget(matchedSelector: string): EventTarget {
  const target = {
    closest: (selector: string) =>
      selector.includes(matchedSelector) ? target : null,
    isContentEditable: false
  };

  return target as unknown as EventTarget;
}
