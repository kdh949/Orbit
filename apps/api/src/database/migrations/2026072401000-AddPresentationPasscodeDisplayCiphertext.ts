import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPresentationPasscodeDisplayCiphertext2026072401000
  implements MigrationInterface
{
  name = "AddPresentationPasscodeDisplayCiphertext2026072401000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE presentation_sessions
        ADD COLUMN session_password_display_ciphertext text,
        ADD COLUMN session_password_key_version smallint
    `);
    await queryRunner.query(`
      ALTER TABLE presentation_sessions
        ADD CONSTRAINT chk_presentation_sessions_display_ciphertext_pair
          CHECK (
            (session_password_display_ciphertext IS NULL
              AND session_password_key_version IS NULL)
            OR
            (access_mode = 'passcode'
              AND session_password_display_ciphertext IS NOT NULL
              AND session_password_key_version BETWEEN 1 AND 32767)
          )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE presentation_sessions
        DROP CONSTRAINT IF EXISTS chk_presentation_sessions_display_ciphertext_pair,
        DROP COLUMN IF EXISTS session_password_key_version,
        DROP COLUMN IF EXISTS session_password_display_ciphertext
    `);
  }
}
