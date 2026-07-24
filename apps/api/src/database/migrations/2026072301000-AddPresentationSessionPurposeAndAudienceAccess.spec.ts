import { describe, expect, it, vi } from "vitest";

import { AddPresentationSessionPurposeAndAudienceAccess2026072301000 } from "./2026072301000-AddPresentationSessionPurposeAndAudienceAccess";

describe("AddPresentationSessionPurposeAndAudienceAccess migration", () => {
  it("backfills existing sessions and scopes active uniqueness by purpose", async () => {
    const query = vi.fn(async (_sql: string) => undefined);

    await new AddPresentationSessionPurposeAndAudienceAccess2026072301000().up({
      query,
    } as never);

    const sql = query.mock.calls.map(([value]) => value).join("\n");
    expect(sql).toContain(
      "session_purpose text NOT NULL DEFAULT 'presentation'",
    );
    expect(sql).toContain(
      "audience_access_enabled boolean NOT NULL DEFAULT true",
    );
    expect(sql).toContain("audience_access_enabled = false");
    expect(sql).toContain(
      "idx_presentation_sessions_one_active_per_project_purpose",
    );
    expect(sql).toContain("(project_id, session_purpose)");
  });

  it("ends active rehearsal sessions before restoring project-wide uniqueness", async () => {
    const query = vi.fn(async (_sql: string) => undefined);

    await new AddPresentationSessionPurposeAndAudienceAccess2026072301000().down(
      { query } as never,
    );

    const sql = query.mock.calls.map(([value]) => value).join("\n");
    expect(sql).toContain("session_purpose = 'rehearsal'");
    expect(sql.indexOf("session_purpose = 'rehearsal'")).toBeLessThan(
      sql.indexOf("DROP COLUMN IF EXISTS session_purpose"),
    );
    expect(sql).toContain(
      "idx_presentation_sessions_one_active_per_project",
    );
  });
});
