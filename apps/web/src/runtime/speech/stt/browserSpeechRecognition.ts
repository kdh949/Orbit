export type BrowserSpeechRecognitionAlternative = {
  transcript: string;
  confidence?: number;
};

export type BrowserSpeechRecognitionResult = {
  isFinal: boolean;
  length: number;
  [index: number]: BrowserSpeechRecognitionAlternative | undefined;
};

export type BrowserSpeechRecognitionResultList = {
  length: number;
  [index: number]: BrowserSpeechRecognitionResult | undefined;
};

export type BrowserSpeechRecognitionEvent = {
  resultIndex: number;
  results: BrowserSpeechRecognitionResultList;
};

export type BrowserSpeechRecognitionErrorEvent = {
  error?: string;
  message?: string;
};

export type BrowserSpeechRecognitionPhrase = {
  phrase: string;
  boost: number;
};

export type BrowserSpeechRecognitionPhraseConstructor = new (
  phrase: string,
  boost: number,
) => BrowserSpeechRecognitionPhrase;

export type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  processLocally?: boolean;
  phrases?: BrowserSpeechRecognitionPhrase[];
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: (audioTrack?: MediaStreamTrack) => void;
  stop: () => void;
  abort: () => void;
};

export type BrowserSpeechRecognitionAvailability =
  | "available"
  | "downloadable"
  | "downloading"
  | "unavailable";

export type BrowserSpeechRecognitionQuality =
  | "command"
  | "dictation"
  | "conversation";

export type BrowserSpeechRecognitionAvailabilityOptions = {
  langs: string[];
  processLocally?: boolean;
  quality?: BrowserSpeechRecognitionQuality;
};

export type BrowserSpeechRecognitionConstructor = {
  new (): BrowserSpeechRecognition;
  available?: (
    options: BrowserSpeechRecognitionAvailabilityOptions,
  ) => Promise<BrowserSpeechRecognitionAvailability>;
  install?: (
    options: BrowserSpeechRecognitionAvailabilityOptions,
  ) => Promise<boolean>;
};

export type BrowserSpeechRecognitionGlobal = {
  SpeechRecognitionPhrase?: BrowserSpeechRecognitionPhraseConstructor;
};

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    SpeechRecognitionPhrase?: BrowserSpeechRecognitionPhraseConstructor;
  }
}

export function getBrowserSpeechRecognitionConstructor(
  source: Pick<
    Window,
    "SpeechRecognition" | "webkitSpeechRecognition"
  > = window,
) {
  return source.SpeechRecognition ?? source.webkitSpeechRecognition ?? null;
}
