import { describe, expect, it } from "vitest";

import { getPresenterAidPolicy } from "./presenterAidPolicy";

describe("presenterAidPolicy", () => {
  it("리허설과 실전의 노출 밀도를 고정한다", () => {
    expect(getPresenterAidPolicy("rehearsal")).toMatchObject({
      maxCapabilityItems: 6,
      showCapabilityDetail: true,
      showRecovery: true
    });
    expect(getPresenterAidPolicy("live")).toMatchObject({
      maxCapabilityItems: 1,
      showCapabilityDetail: false,
      showRecovery: true
    });
  });
});
