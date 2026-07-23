import { demoIds } from "@orbit/shared";
import type { LiveSttAudioLevelEvent } from "../liveStt";
import type { DiagnosticSink } from "../../diagnostics/diagnosticTypes";
import { DiagnosticLiveSttPort } from "./diagnosticLiveSttPort";
import { type LiveSttEngineId, type LiveSttPort } from "./liveSttPort";
import { MoonshineLiveSttPort } from "./moonshineLiveSttPort";
import { OpenAiRealtimeLiveSttPort } from "./openAiRealtimeLiveSttPort";
import { RerankingLiveSttPort } from "./rerankingLiveSttPort";
import { createSherpaLiveSttPort } from "./sherpaLiveSttPort";
import { WebSpeechLiveSttPort } from "./webSpeechLiveSttPort";

export const defaultLiveSttEngineId: LiveSttEngineId = "openai-realtime";

export type CreateLiveSttPortOptions = {
  projectId?: string;
  onAudioLevel?: (event: LiveSttAudioLevelEvent) => void;
  diagnostics?: DiagnosticSink;
};

export function createLiveSttPort(
  engineId: LiveSttEngineId = defaultLiveSttEngineId,
  options: CreateLiveSttPortOptions = {}
): LiveSttPort {
  const port = createBaseLiveSttPort(engineId, options);
  return options.diagnostics
    ? new DiagnosticLiveSttPort(port, options.diagnostics)
    : port;
}

function createBaseLiveSttPort(
  engineId: LiveSttEngineId,
  options: CreateLiveSttPortOptions
): LiveSttPort {
  switch (engineId) {
    case "openai-realtime":
      return new OpenAiRealtimeLiveSttPort({
        projectId: options.projectId ?? demoIds.projectId,
        onAudioLevel: options.onAudioLevel,
        diagnostics: options.diagnostics
      });
    case "sherpa":
      return createSherpaLiveSttPort();
    case "web-speech":
      return new RerankingLiveSttPort(
        new WebSpeechLiveSttPort({ processLocally: true }),
        options.diagnostics
      );
    case "moonshine":
      return new MoonshineLiveSttPort();
  }
}
