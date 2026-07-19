import { z } from "zod";

import { isoDateTimeSchema } from "../common/time.schema";

export const projectSchema = z.object({
  projectId: z.string().min(1),
  workspaceId: z.string().min(1),
  title: z.string().min(1),
  createdBy: z.string().min(1),
  createdAt: isoDateTimeSchema,
});

export const createProjectRequestSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export const updateProjectRequestSchema = z
  .object({ title: z.string().trim().min(1).max(120) })
  .strict();

export const deleteProjectResponseSchema = z.object({
  projectId: z.string().min(1),
});

export const projectListItemSchema = projectSchema.extend({
  isPinned: z.boolean(),
});

export const updateProjectPinRequestSchema = z
  .object({ isPinned: z.boolean() })
  .strict();

export const updateProjectPinResponseSchema = z.object({
  projectId: z.string().min(1),
  isPinned: z.boolean(),
});

export const projectMemberRoleSchema = z.enum(["owner", "editor", "viewer"]);
export const projectMemberStatusSchema = z.enum([
  "pending",
  "accepted",
  "rejected",
]);
export const projectMemberSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
  role: projectMemberRoleSchema,
  status: projectMemberStatusSchema,
  createdAt: isoDateTimeSchema,
});
export const projectAccessResponseSchema = z.object({
  project: projectSchema,
  membership: z
    .object({
      role: projectMemberRoleSchema,
      status: projectMemberStatusSchema,
    })
    .nullable(),
});
export const projectApiErrorCodeSchema = z.enum([
  "PROJECT_ACCESS_UNAVAILABLE",
  "PROJECT_MEMBERS_UNAVAILABLE",
  "PROJECT_SCHEMA_NOT_READY",
]);
export const projectApiErrorSchema = z.object({
  code: projectApiErrorCodeSchema,
  message: z.string().min(1),
  details: z.array(z.string()).default([]),
});
export const projectMembersResponseSchema = z.object({
  members: z.array(projectMemberSchema),
  requests: z.array(projectMemberSchema),
});
export const upsertProjectMemberRequestSchema = z.object({
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  role: z.enum(["editor", "viewer"]),
});
export const createProjectAccessRequestSchema = z.object({
  role: z.enum(["editor", "viewer"]),
});
export const updateProjectMemberRoleRequestSchema = z.object({
  role: projectMemberRoleSchema,
});
export const updateProjectMemberStatusRequestSchema = z.object({
  status: z.enum(["accepted", "rejected"]),
});

export const projectListResponseSchema = z.array(projectListItemSchema);

export type Project = z.infer<typeof projectSchema>;
export type ProjectListItem = z.infer<typeof projectListItemSchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;
export type DeleteProjectResponse = z.infer<typeof deleteProjectResponseSchema>;
export type UpdateProjectPinRequest = z.infer<typeof updateProjectPinRequestSchema>;
export type UpdateProjectPinResponse = z.infer<typeof updateProjectPinResponseSchema>;
export type ProjectMemberRole = z.infer<typeof projectMemberRoleSchema>;
export type ProjectMemberStatus = z.infer<typeof projectMemberStatusSchema>;
export type ProjectMember = z.infer<typeof projectMemberSchema>;
export type ProjectAccessResponse = z.infer<typeof projectAccessResponseSchema>;
export type ProjectApiErrorCode = z.infer<typeof projectApiErrorCodeSchema>;
export type ProjectApiError = z.infer<typeof projectApiErrorSchema>;
export type ProjectMembersResponse = z.infer<typeof projectMembersResponseSchema>;
export type UpsertProjectMemberRequest = z.infer<typeof upsertProjectMemberRequestSchema>;
export type CreateProjectAccessRequest = z.infer<typeof createProjectAccessRequestSchema>;
export type UpdateProjectMemberRoleRequest = z.infer<typeof updateProjectMemberRoleRequestSchema>;
export type UpdateProjectMemberStatusRequest = z.infer<typeof updateProjectMemberStatusRequestSchema>;
