import { demoIds } from "@orbit/shared";
import type { LiveSttAudioLevelEvent } from "../../../runtime/speech/stt/liveSttAdapter";
import { type LiveSttEngineId, type LiveSttPort } from "../../../runtime/speech/stt/liveSttPort";
import { MoonshineLiveSttPort } from "../../../runtime/speech/stt/moonshineLiveSttPort";
import { OpenAiRealtimeLiveSttPort } from "../../../runtime/speech/stt/openAiRealtimeLiveSttPort";
import { RerankingLiveSttPort } from "../../../runtime/speech/stt/rerankingLiveSttPort";
import { createSherpaLiveSttPort } from "./sherpaLiveSttPort";
import { WebSpeechLiveSttPort } from "../../../runtime/speech/stt/webSpeechLiveSttPort";

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
