import { describe, expect, it } from "vitest";

import { activityIdSchema } from "./activity";
import { authUserSchema } from "./auth";
import { practiceGoalSchema } from "./coaching";
import { demoIds } from "./common";
import { communityTemplateSnapshotSchema } from "./community-templates";
import { deckSchema } from "./deck";
import { uploadedFileSchema } from "./files";
import { jobSchema } from "./jobs";
import { presentationSessionSchema } from "./presentation";
import { projectSchema } from "./projects";
import { pronunciationLexiconSnapshotSchema } from "./pronunciation";
import { websocketEventSchema } from "./realtime";
import { rehearsalRunSchema } from "./rehearsals";
import { slidePracticeContentHashSchema } from "./slide-practice";

describe("@orbit/shared subpath exports", () => {
  it("publishes each high-change domain through a stable entrypoint", () => {
    expect(deckSchema).toBeDefined();
    expect(rehearsalRunSchema).toBeDefined();
    expect(jobSchema).toBeDefined();
    expect(websocketEventSchema).toBeDefined();
    expect(activityIdSchema).toBeDefined();
    expect(authUserSchema).toBeDefined();
    expect(practiceGoalSchema).toBeDefined();
    expect(demoIds).toBeDefined();
    expect(communityTemplateSnapshotSchema).toBeDefined();
    expect(uploadedFileSchema).toBeDefined();
    expect(presentationSessionSchema).toBeDefined();
    expect(projectSchema).toBeDefined();
    expect(pronunciationLexiconSnapshotSchema).toBeDefined();
    expect(slidePracticeContentHashSchema).toBeDefined();
  });
});
