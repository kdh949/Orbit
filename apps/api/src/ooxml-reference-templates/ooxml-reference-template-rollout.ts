import type { OrbitConfig } from "@orbit/config";
import { ServiceUnavailableException } from "@nestjs/common";

export const OOXML_REFERENCE_TEMPLATE_ROLLOUT = Symbol(
  "OOXML_REFERENCE_TEMPLATE_ROLLOUT",
);

export type OoxmlReferenceTemplateRollout = {
  enabled: boolean;
  allowlist: ReadonlySet<string>;
};

export function createOoxmlReferenceTemplateRollout(
  config: OrbitConfig,
): OoxmlReferenceTemplateRollout {
  return {
    enabled: config.AI_PPT_OOXML_REFERENCE_TEMPLATES_ENABLED,
    allowlist: new Set(config.AI_PPT_OOXML_REFERENCE_TEMPLATE_ALLOWLIST),
  };
}

export function isOoxmlReferenceTemplateRolloutAllowed(
  rollout: OoxmlReferenceTemplateRollout,
  templateId: string,
  version: number,
): boolean {
  return rollout.enabled && rollout.allowlist.has(`${templateId}@${version}`);
}

export function assertOoxmlReferenceTemplateRolloutAllowed(
  rollout: OoxmlReferenceTemplateRollout,
  templateId?: string,
  version?: number,
): void {
  const available =
    templateId === undefined || version === undefined
      ? rollout.enabled
      : isOoxmlReferenceTemplateRolloutAllowed(rollout, templateId, version);
  if (!available) {
    throw new ServiceUnavailableException(
      "OOXML reference template mode is unavailable.",
    );
  }
}
