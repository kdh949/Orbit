import { projectApiErrorSchema, type ProjectApiError } from "@orbit/shared";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";

const requiredColumns = [{ table: "project_members", column: "is_pinned" }] as const;

export type DatabaseReadiness = {
  ready: boolean;
  pendingMigrations: boolean;
  missingColumns: string[];
};

@Injectable()
export class DatabaseReadinessService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async check(): Promise<DatabaseReadiness> {
    const pendingMigrations = await this.dataSource.showMigrations();
    const rows = await this.dataSource.query<
      Array<{
        table_name: string;
        column_name: string;
      }>
    >(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (table_name, column_name) IN (($1, $2))`,
      [requiredColumns[0].table, requiredColumns[0].column]
    );
    const present = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
    const missingColumns = requiredColumns
      .map(({ table, column }) => `${table}.${column}`)
      .filter((column) => !present.has(column));

    return {
      ready: !pendingMigrations && missingColumns.length === 0,
      pendingMigrations,
      missingColumns
    };
  }

  async assertReady(): Promise<void> {
    const readiness = await this.check();
    if (readiness.ready) return;

    const details = [
      ...(readiness.pendingMigrations ? ["pending migrations"] : []),
      ...readiness.missingColumns.map((column) => `missing column: ${column}`)
    ];
    const error: ProjectApiError = projectApiErrorSchema.parse({
      code: "PROJECT_SCHEMA_NOT_READY",
      message: "데이터베이스 schema가 현재 API와 일치하지 않습니다.",
      details
    });
    throw new ServiceUnavailableException(error);
  }
}
