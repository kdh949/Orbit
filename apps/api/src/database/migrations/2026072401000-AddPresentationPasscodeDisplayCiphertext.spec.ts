import type { QueryRunner } from "typeorm";
import { describe, expect, it, vi } from "vitest";

import { AddPresentationPasscodeDisplayCiphertext2026072401000 } from "./2026072401000-AddPresentationPasscodeDisplayCiphertext";

describe("AddPresentationPasscodeDisplayCiphertext migration", () => {
  it("adds paired encrypted display columns without backfilling plaintext", async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: vi.fn(async (query: string) => queries.push(query))
    } as unknown as QueryRunner;
    await new AddPresentationPasscodeDisplayCiphertext2026072401000().up(
      queryRunner
    );
    const sql = queries.join("\n");

    expect(sql).toContain("session_password_display_ciphertext text");
    expect(sql).toContain("session_password_key_version smallint");
    expect(sql).toContain(
      "chk_presentation_sessions_display_ciphertext_pair"
    );
    expect(sql).not.toContain("session_password_hash =");
  });
});
