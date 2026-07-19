import { describe, expect, it } from "vitest";

import { canonicalJson } from "./canonical-json";

describe("canonicalJson", () => {
  it("is stable across object key order while preserving array order", () => {
    expect(canonicalJson({ beta: 2, alpha: { delta: 4, gamma: 3 } })).toBe(
      canonicalJson({ alpha: { gamma: 3, delta: 4 }, beta: 2 }),
    );
    expect(canonicalJson(["second", "first"])).not.toBe(canonicalJson(["first", "second"]));
  });
});
