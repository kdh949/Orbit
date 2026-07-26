import type { ActivitySessionResultItem } from "@orbit/shared/activities";
import { describe, expect, it } from "vitest";

import {
  countAudienceResponses,
  isPresentationAnalysisPending,
} from "./presentationReportUtils";

describe("PresentationReportPage", () => {
  it("keeps polling only while actual-presentation analysis is unfinished", () => {
    expect(isPresentationAnalysisPending("created")).toBe(true);
    expect(isPresentationAnalysisPending("uploading")).toBe(true);
    expect(isPresentationAnalysisPending("processing")).toBe(true);
    expect(isPresentationAnalysisPending("succeeded")).toBe(false);
    expect(isPresentationAnalysisPending("failed")).toBe(false);
  });

  it("combines audience response counts from the same presentation session", () => {
    const items = [
      { run: { responseCount: 2 }, result: { responseCount: 3 } },
      { run: { responseCount: 4 }, result: null },
    ] as ActivitySessionResultItem[];

    expect(countAudienceResponses(items)).toBe(7);
  });
});
