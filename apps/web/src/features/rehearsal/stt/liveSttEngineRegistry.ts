import { demoIds } from "@orbit/shared";
import type { LiveSttAudioLevelEvent } from "../liveStt";
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
};

export function createLiveSttPort(
  engineId: LiveSttEngineId = defaultLiveSttEngineId,
  options: CreateLiveSttPortOptions = {}
): LiveSttPort {
  switch (engineId) {
    case "openai-realtime":
      return new OpenAiRealtimeLiveSttPort({
        projectId: options.projectId ?? demoIds.projectId,
        onAudioLevel: options.onAudioLevel
      });
    case "sherpa":
      return createSherpaLiveSttPort();
    case "web-speech":
      return new RerankingLiveSttPort(
        new WebSpeechLiveSttPort({ processLocally: true })
      );
    case "moonshine":
      return new MoonshineLiveSttPort();
  }
}
