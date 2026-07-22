import { Module } from "@nestjs/common";
import { loadOrbitConfig } from "@orbit/config";

import { AuthModule } from "../auth/auth.module";
import { OoxmlReferenceTemplatesController } from "./ooxml-reference-templates.controller";
import {
  OOXML_REFERENCE_TEMPLATE_PYTHON_URL,
  OoxmlReferenceTemplatesService,
} from "./ooxml-reference-templates.service";
import {
  createOoxmlReferenceTemplateRollout,
  OOXML_REFERENCE_TEMPLATE_ROLLOUT,
} from "./ooxml-reference-template-rollout";

@Module({
  imports: [AuthModule],
  controllers: [OoxmlReferenceTemplatesController],
  providers: [
    OoxmlReferenceTemplatesService,
    {
      provide: OOXML_REFERENCE_TEMPLATE_PYTHON_URL,
      useFactory: () =>
        loadOrbitConfig(process.env, { service: "api" }).PYTHON_WORKER_URL,
    },
    {
      provide: OOXML_REFERENCE_TEMPLATE_ROLLOUT,
      useFactory: () =>
        createOoxmlReferenceTemplateRollout(
          loadOrbitConfig(process.env, { service: "api" }),
        ),
    },
  ],
  exports: [OOXML_REFERENCE_TEMPLATE_ROLLOUT],
})
export class OoxmlReferenceTemplatesModule {}
