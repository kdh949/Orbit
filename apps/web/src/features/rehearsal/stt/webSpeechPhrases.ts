import type {
  BrowserSpeechRecognition,
  BrowserSpeechRecognitionGlobal,
  BrowserSpeechRecognitionPhrase
} from "./browserSpeechRecognition";
import type { LiveSttBiasPhrase } from "../../../runtime/speech/stt/liveSttPort";

export const WEB_SPEECH_MIN_BOOST = 1;
export const WEB_SPEECH_MAX_BOOST = 5;

export function isWebSpeechPhrasesSupported(
  recognition: BrowserSpeechRecognition,
  globalScope: BrowserSpeechRecognitionGlobal = getBrowserSpeechRecognitionGlobal()
) {
  return (
    "phrases" in recognition &&
    typeof globalScope.SpeechRecognitionPhrase === "function"
  );
}

export function toWebSpeechPhrases(
  phrases: readonly LiveSttBiasPhrase[],
  globalScope: BrowserSpeechRecognitionGlobal = getBrowserSpeechRecognitionGlobal()
): BrowserSpeechRecognitionPhrase[] {
  const SpeechRecognitionPhrase = globalScope.SpeechRecognitionPhrase;
  if (!SpeechRecognitionPhrase) {
    return [];
  }

  return phrases.map(
    (phrase) =>
      new SpeechRecognitionPhrase(phrase.text, biasWeightToWebSpeechBoost(phrase.weight))
  );
}

export function applyWebSpeechPhrases(
  recognition: BrowserSpeechRecognition,
  phrases: readonly LiveSttBiasPhrase[],
  globalScope: BrowserSpeechRecognitionGlobal = getBrowserSpeechRecognitionGlobal()
) {
  if (!isWebSpeechPhrasesSupported(recognition, globalScope)) {
    return false;
  }

  try {
    recognition.phrases = toWebSpeechPhrases(phrases, globalScope);
    return true;
  } catch {
    return false;
  }
}

function getBrowserSpeechRecognitionGlobal(): BrowserSpeechRecognitionGlobal {
  return globalThis as BrowserSpeechRecognitionGlobal;
}

function biasWeightToWebSpeechBoost(weight: number) {
  return WEB_SPEECH_MIN_BOOST + clamp(weight, 0, 1) * 4;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}
