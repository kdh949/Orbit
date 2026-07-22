import {
  ooxmlReferenceTemplateIdSchema,
  ooxmlReferenceTemplateOptionsResponseSchema,
  type OoxmlReferenceTemplateOptionsResponse,
} from "@orbit/shared";
import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { z } from "zod";
import {
  assertOoxmlReferenceTemplateRolloutAllowed,
  isOoxmlReferenceTemplateRolloutAllowed,
  OOXML_REFERENCE_TEMPLATE_ROLLOUT,
  type OoxmlReferenceTemplateRollout,
} from "./ooxml-reference-template-rollout";

const previewAssetIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

export type OoxmlReferenceTemplatePreview = {
  body: Uint8Array;
  contentType: "image/png";
};

export const OOXML_REFERENCE_TEMPLATE_PYTHON_URL = Symbol(
  "OOXML_REFERENCE_TEMPLATE_PYTHON_URL",
);

@Injectable()
export class OoxmlReferenceTemplatesService {
  constructor(
    @Inject(OOXML_REFERENCE_TEMPLATE_PYTHON_URL)
    private readonly pythonWorkerUrl: string,
    @Inject(OOXML_REFERENCE_TEMPLATE_ROLLOUT)
    private readonly rollout: OoxmlReferenceTemplateRollout,
  ) {}

  async listOptions(): Promise<OoxmlReferenceTemplateOptionsResponse> {
    assertOoxmlReferenceTemplateRolloutAllowed(this.rollout);
    const response = await requestPython(
      this.pythonWorkerUrl,
      "/internal/ai/ooxml-reference-templates/options",
    );
    try {
      const parsed = ooxmlReferenceTemplateOptionsResponseSchema.parse(
        await response.json(),
      );
      return {
        options: parsed.options.filter((option) =>
          isOoxmlReferenceTemplateRolloutAllowed(
            this.rollout,
            option.templateId,
            option.version,
          ),
        ),
      };
    } catch {
      throw unavailable();
    }
  }

  async readPreview(
    rawTemplateId: string,
    rawVersion: string,
    rawAssetId: string,
  ): Promise<OoxmlReferenceTemplatePreview> {
    const templateId = ooxmlReferenceTemplateIdSchema.parse(rawTemplateId);
    const version = z.coerce.number().int().positive().parse(rawVersion);
    assertOoxmlReferenceTemplateRolloutAllowed(
      this.rollout,
      templateId,
      version,
    );
    const assetId = previewAssetIdSchema.parse(rawAssetId);
    const response = await requestPython(
      this.pythonWorkerUrl,
      `/internal/ai/ooxml-reference-templates/${encodeURIComponent(templateId)}/versions/${version}/previews/${encodeURIComponent(assetId)}`,
    );
    const contentType = response.headers.get("content-type")?.split(";", 1)[0];
    const body = new Uint8Array(await response.arrayBuffer());
    if (
      contentType !== "image/png" ||
      body.byteLength < 8 ||
      body.byteLength > 10_485_760 ||
      !isPng(body)
    ) {
      throw unavailable();
    }
    return { body, contentType: "image/png" };
  }
}

async function requestPython(
  pythonWorkerUrl: string,
  path: string,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(
      new URL(
        path,
        pythonWorkerUrl.endsWith("/") ? pythonWorkerUrl : `${pythonWorkerUrl}/`,
      ),
      { signal: AbortSignal.timeout(30_000) },
    );
  } catch {
    throw unavailable();
  }
  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      // Internal error bodies are deliberately discarded.
    }
    throw unavailable();
  }
  return response;
}

function isPng(body: Uint8Array): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return signature.every((value, index) => body[index] === value);
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException(
    "OOXML reference template catalog is unavailable.",
  );
}
