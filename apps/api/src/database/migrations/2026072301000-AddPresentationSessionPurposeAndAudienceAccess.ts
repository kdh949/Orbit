import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPresentationSessionPurposeAndAudienceAccess2026072301000
  implements MigrationInterface
{
  name = "AddPresentationSessionPurposeAndAudienceAccess2026072301000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_presentation_sessions_one_active_per_project
    `);
    await queryRunner.query(`
      ALTER TABLE presentation_sessions
        DROP CONSTRAINT IF EXISTS chk_presentation_sessions_access_secret,
        ADD COLUMN session_purpose text NOT NULL DEFAULT 'presentation',
        ADD COLUMN audience_access_enabled boolean NOT NULL DEFAULT true,
        ADD CONSTRAINT chk_presentation_sessions_purpose
          CHECK (session_purpose IN ('presentation', 'rehearsal')),
        ADD CONSTRAINT chk_presentation_sessions_rehearsal_audience
          CHECK (
            session_purpose <> 'rehearsal'
            OR audience_access_enabled = false
          ),
        ADD CONSTRAINT chk_presentation_sessions_access_secret
          CHECK (
            audience_access_enabled = false
            OR (
              access_mode = 'passcode'
              AND session_password_hash IS NOT NULL
            )
            OR (
              access_mode = 'public'
              AND session_password_hash IS NULL
            )
          )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_presentation_sessions_one_active_per_project_purpose
      ON presentation_sessions (project_id, session_purpose)
      WHERE status IN ('draft', 'live')
    `);
    await queryRunner.query(`
      CREATE INDEX idx_presentation_sessions_project_deck_purpose_created
      ON presentation_sessions (
        project_id,
        deck_id,
        session_purpose,
        created_at DESC
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_presentation_sessions_project_deck_purpose_created
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_presentation_sessions_one_active_per_project_purpose
    `);
    await queryRunner.query(`
      UPDATE presentation_sessions
      SET
        status = 'ended',
        active_activity_run_id = NULL,
        ended_at = COALESCE(ended_at, now()),
        closed_at = COALESCE(closed_at, now()),
        updated_at = now()
      WHERE session_purpose = 'rehearsal'
        AND status IN ('draft', 'live')
    `);
    await queryRunner.query(`
      ALTER TABLE presentation_sessions
        DROP CONSTRAINT IF EXISTS chk_presentation_sessions_access_secret,
        DROP CONSTRAINT IF EXISTS chk_presentation_sessions_rehearsal_audience,
        DROP CONSTRAINT IF EXISTS chk_presentation_sessions_purpose
    `);
    await queryRunner.query(`
      UPDATE presentation_sessions
      SET
        access_mode = 'public',
        session_password_hash = NULL
      WHERE audience_access_enabled = false
        AND session_password_hash IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE presentation_sessions
        DROP COLUMN IF EXISTS audience_access_enabled,
        DROP COLUMN IF EXISTS session_purpose,
        ADD CONSTRAINT chk_presentation_sessions_access_secret
          CHECK (
            (access_mode = 'passcode' AND session_password_hash IS NOT NULL)
            OR (access_mode = 'public' AND session_password_hash IS NULL)
          )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_presentation_sessions_one_active_per_project
      ON presentation_sessions (project_id)
      WHERE status IN ('draft', 'live')
    `);
  }
}
