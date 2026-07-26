import { loadOrbitConfig } from "@orbit/config";
import {
  referenceExtractionStartResponseSchema,
  type ReferenceExtractionRequest,
  type ReferenceExtractionStartResponse,
} from "@orbit/shared/deck";
import { BadGatewayException, BadRequestException, Injectable } from "@nestjs/common";
import { ExtractService } from "../extract/extract.service";
import { FilesService } from "../files/files.service";
import type {
  ReferenceSearchRequest,
  ReferenceSearchResponse
} from "./references.schema";
import {
  referenceSearchResponseSchema,
  referenceSearchWorkerRequestSchema
} from "./references.schema";

@Injectable()
export class ReferencesService {
  private readonly pythonWorkerUrl = loadOrbitConfig(process.env, {
    service: "api"
  }).PYTHON_WORKER_URL;

  constructor(
    private readonly filesService: FilesService,
    private readonly extractService: ExtractService
  ) {}

  async extract(
    projectId: string,
    input: ReferenceExtractionRequest
  ): Promise<ReferenceExtractionStartResponse> {
    const assets = await Promise.all(
      input.fileIds.map((fileId) =>
        this.filesService.getUploadedAsset(
          projectId,
          fileId,
          "reference-material"
        )
      )
    );

    const unsupported = assets.find(
      (asset) => !supportedReferenceMimeTypes.has(asset.mimeType.toLowerCase())
    );
    if (unsupported) {
      throw new BadRequestException(
        `Unsupported reference MIME type: ${unsupported.mimeType}`
      );
    }

    const files = await Promise.all(
      assets.map(async (asset) => {
        const content = await this.filesService.readUploadedAssetContent(
          projectId,
          asset.fileId,
          "reference-material"
        );
        return {
          originalname: asset.originalName,
          mimetype: content.contentType,
          buffer: content.body
        };
      })
    );
    const result = await this.extractService.extract(
      files,
      projectId,
      input.fileIds
    );

    return referenceExtractionStartResponseSchema.parse({
      fileIds: input.fileIds,
      job: result.job
    });
  }

  async search(
    projectId: string,
    input: ReferenceSearchRequest
  ): Promise<ReferenceSearchResponse> {
    const payload = referenceSearchWorkerRequestSchema.parse({
      ...input,
      projectId
    });
    const response = await fetch(
      workerUrl(this.pythonWorkerUrl, "/references/search"),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      throw new BadGatewayException("Python worker reference search failed.");
    }

    return referenceSearchResponseSchema.parse(await response.json());
  }
}

const supportedReferenceMimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/bmp",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/webp"
]);

function workerUrl(baseUrl: string, path: string): string {
  return new URL(
    path,
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  ).toString();
}
