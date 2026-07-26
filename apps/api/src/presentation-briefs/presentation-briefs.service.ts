import {
  getPresentationBriefResponseSchema,
  presentationBriefSchema,
  putPresentationBriefRequestSchema,
  putPresentationBriefResponseSchema,
  type ApprovedReferenceSnapshotRef,
  type BriefRequirement,
  type PutPresentationBriefRequest,
} from "@orbit/shared/coaching";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { createHash, randomUUID } from "node:crypto";
import type { DataSource, EntityManager } from "typeorm";

import { FilesService } from "../files/files.service";
import { ProjectsService } from "../projects/projects.service";

type BriefRow = {
  brief_id: string;
  project_id: string;
  revision: number;
  content_json: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
};

type ReferenceRow = {
  file_id: string;
  file_content_hash: string;
};

@Injectable()
export class PresentationBriefsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly projects: ProjectsService,
    private readonly files: FilesService,
  ) {}

  async get(projectId: string, actorUserId: string) {
    await this.projects.assertCanReadProject(projectId, actorUserId);
    const brief = await this.getCurrent(projectId);
    return getPresentationBriefResponseSchema.parse({ brief });
  }

  getCurrent(projectId: string) {
    return this.dataSource.transaction((manager) => this.readCurrent(manager, projectId));
  }

  async put(projectId: string, actorUserId: string, body: unknown) {
    const request = putPresentationBriefRequestSchema.parse(body);
    await this.projects.assertCanWriteProject(projectId, actorUserId);

    const brief = await this.dataSource.transaction(async (manager) => {
      const current = await this.readCurrent(manager, projectId, true);
      const approvedReferences = await this.resolveReferences(
        manager,
        projectId,
        request.approvedReferenceFileIds,
      );

      if (
        current &&
        request.expectedRevision !== current.revision &&
        this.hasEquivalentContent(current, request, approvedReferences)
      ) {
        return current;
      }

      if (
        (!current && request.expectedRevision !== 0) ||
        (current && request.expectedRevision !== current.revision)
      ) {
        throw new ConflictException({
          code: "REVISION_CONFLICT",
          message: "Brief가 다른 곳에서 변경되었습니다. 최신 기준을 확인해 주세요.",
          currentRevision: current?.revision ?? 0,
        });
      }

      const now = new Date();
      const briefId = current?.briefId ?? `brief_${randomUUID()}`;
      const revision = (current?.revision ?? 0) + 1;
      const requirements = this.resolveRequirements(
        current?.requirements ?? [],
        request,
      );
      const content = {
        audience: request.audience,
        purpose: request.purpose,
        evaluatorLensRef: request.evaluatorLensRef,
        targetDurationMinutes: request.targetDurationMinutes,
        desiredOutcome: request.desiredOutcome,
        requirements,
        terminology: request.terminology,
        challengeTopics: request.challengeTopics,
      };

      await manager.query(
        `
          INSERT INTO presentation_briefs (
            brief_id, project_id, revision, content_json,
            created_by, updated_by, created_at, updated_at
          )
          VALUES ($1,$2,$3,$4,$5,$5,$6,$6)
          ON CONFLICT (project_id) DO UPDATE SET
            revision = EXCLUDED.revision,
            content_json = EXCLUDED.content_json,
            updated_by = EXCLUDED.updated_by,
            updated_at = EXCLUDED.updated_at
        `,
        [briefId, projectId, revision, content, actorUserId, now],
      );
      await manager.query(
        `DELETE FROM presentation_brief_approved_references WHERE brief_id = $1`,
        [briefId],
      );
      for (const [index, reference] of approvedReferences.entries()) {
        await manager.query(
          `
            INSERT INTO presentation_brief_approved_references (
              project_id, brief_id, file_id, file_content_hash, display_order
            ) VALUES ($1,$2,$3,$4,$5)
          `,
          [projectId, briefId, reference.fileId, reference.fileContentHash, index + 1],
        );
      }

      return presentationBriefSchema.parse({
        briefId,
        projectId,
        revision,
        ...content,
        approvedReferences,
        createdAt: current?.createdAt ?? now.toISOString(),
        updatedAt: now.toISOString(),
      });
    });

    return putPresentationBriefResponseSchema.parse({ brief });
  }

  private async readCurrent(
    manager: EntityManager,
    projectId: string,
    lock = false,
  ) {
    const rows = (await manager.query(
      `SELECT * FROM presentation_briefs WHERE project_id = $1${lock ? " FOR UPDATE" : ""}`,
      [projectId],
    )) as BriefRow[];
    const row = rows[0];
    if (!row) return null;

    const references = (await manager.query(
      `
        SELECT file_id, file_content_hash
        FROM presentation_brief_approved_references
        WHERE brief_id = $1
        ORDER BY display_order ASC
      `,
      [row.brief_id],
    )) as ReferenceRow[];

    return presentationBriefSchema.parse({
      briefId: row.brief_id,
      projectId: row.project_id,
      revision: row.revision,
      ...row.content_json,
      approvedReferences: references.map((reference) => ({
        fileId: reference.file_id,
        fileContentHash: reference.file_content_hash,
      })),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    });
  }

  private async resolveReferences(
    manager: EntityManager,
    projectId: string,
    fileIds: string[],
  ): Promise<ApprovedReferenceSnapshotRef[]> {
    const resolved: ApprovedReferenceSnapshotRef[] = [];
    for (const fileId of fileIds) {
      const rows = (await manager.query(
        `
          SELECT file_id, content_hash
          FROM project_assets
          WHERE project_id = $1 AND file_id = $2
            AND purpose = 'reference-material' AND status = 'uploaded'
          FOR SHARE
        `,
        [projectId, fileId],
      )) as Array<{ file_id: string; content_hash: string | null }>;
      const asset = rows[0];
      if (!asset) {
        throw new NotFoundException(`Approved reference unavailable: ${fileId}`);
      }
      const extracted = (await manager.query(
        `SELECT 1 FROM reference_chunks WHERE project_id = $1 AND file_id = $2 LIMIT 1`,
        [projectId, fileId],
      )) as unknown[];
      if (extracted.length === 0) {
        throw new ConflictException({
          code: "SOURCE_NOT_READY",
          message: "참고자료 추출이 아직 완료되지 않았습니다.",
        });
      }

      let contentHash = asset.content_hash;
      if (!contentHash) {
        const content = await this.files.readUploadedAssetContent(
          projectId,
          fileId,
          "reference-material",
        );
        contentHash = createHash("sha256").update(content.body).digest("hex");
        await manager.query(
          `UPDATE project_assets SET content_hash = $3 WHERE project_id = $1 AND file_id = $2 AND content_hash IS NULL`,
          [projectId, fileId, contentHash],
        );
      }
      resolved.push({ fileId, fileContentHash: contentHash });
    }
    return resolved;
  }

  private resolveRequirements(
    current: BriefRequirement[],
    request: PutPresentationBriefRequest,
  ): BriefRequirement[] {
    const currentById = new Map(current.map((requirement) => [requirement.requirementId, requirement]));
    return request.requirements.map((input) => {
      if (!input.requirementId) {
        return { ...input, requirementId: `requirement_${randomUUID()}`, revision: 1 };
      }
      const existing = currentById.get(input.requirementId);
      if (!existing || existing.revision !== input.expectedRevision) {
        throw new ConflictException({
          code: "REVISION_CONFLICT",
          message: "Brief 세부 기준이 변경되었습니다. 최신 기준을 확인해 주세요.",
        });
      }
      const changed =
        existing.kind !== input.kind ||
        existing.text !== input.text ||
        existing.reviewStatus !== input.reviewStatus;
      return {
        requirementId: existing.requirementId,
        revision: changed ? existing.revision + 1 : existing.revision,
        kind: input.kind,
        text: input.text,
        reviewStatus: input.reviewStatus,
      };
    });
  }

  private hasEquivalentContent(
    current: NonNullable<Awaited<ReturnType<PresentationBriefsService["readCurrent"]>>>,
    request: PutPresentationBriefRequest,
    references: ApprovedReferenceSnapshotRef[],
  ) {
    return JSON.stringify({
      audience: current.audience,
      purpose: current.purpose,
      evaluatorLensRef: current.evaluatorLensRef,
      targetDurationMinutes: current.targetDurationMinutes,
      desiredOutcome: current.desiredOutcome,
      requirements: current.requirements.map(({ kind, text, reviewStatus }) => ({ kind, text, reviewStatus })),
      terminology: current.terminology,
      challengeTopics: current.challengeTopics,
      referenceFileIds: current.approvedReferences.map((reference) => reference.fileId),
    }) === JSON.stringify({
      audience: request.audience,
      purpose: request.purpose,
      evaluatorLensRef: request.evaluatorLensRef,
      targetDurationMinutes: request.targetDurationMinutes,
      desiredOutcome: request.desiredOutcome,
      requirements: request.requirements.map(({ kind, text, reviewStatus }) => ({ kind, text, reviewStatus })),
      terminology: request.terminology,
      challengeTopics: request.challengeTopics,
      referenceFileIds: references.map((reference) => reference.fileId),
    });
  }
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
