import { demoIds } from "@orbit/shared/common";
import { publicCreatableJobTypeSchema } from "@orbit/shared/jobs";
import { Body, Controller, Get, NotFoundException, Param, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { AuthService } from "../auth/auth.service";
import {
  getCurrentUser,
  type SignedCookieRequest,
} from "../auth/current-user";
import { ProjectsService } from "../projects/projects.service";
import { JobsService } from "./jobs.service";

const createJobSchema = z.object({
  projectId: z.string().min(1).optional(),
  type: publicCreatableJobTypeSchema,
  payload: z.record(z.unknown()).optional()
}).strict();

@Controller(["jobs", "api/v1/jobs"])
export class JobsController {
  constructor(
    private readonly authService: AuthService,
    private readonly jobsService: JobsService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Post()
  async createJob(
    @Body() body: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const input = createJobSchema.parse(body);
    const user = await getCurrentUser(this.authService, request);
    await this.projectsService.assertCanWriteProject(
      input.projectId ?? demoIds.projectId,
      user.userId,
    );
    return this.jobsService.create(input);
  }

  @Get(":jobId")
  async getJob(
    @Param("jobId") jobId: string,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    const job = await this.jobsService.get(jobId);
    if (!job) {
      throw new NotFoundException(`Job not found: ${jobId}`);
    }
    await this.projectsService.assertCanReadProject(job.projectId, user.userId);
    return job;
  }
}
