import { Deck } from "@orbit/shared/deck";
import { RehearsalMetrics } from "@orbit/shared/presentation";

export * from "./image-providers";
export * from "./provider-contracts";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmProvider {
  generateText(messages: LlmMessage[]): Promise<string>;
}

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

export interface ReportSttProvider {
  transcribe(input: {
    fileId: string;
    consentToServerStt: boolean;
  }): Promise<{ text: string; durationSeconds: number }>;
}

export interface OcrProvider {
  extractText(input: { fileId: string; mimeType: string }): Promise<string>;
}

export interface DeckGenerationProvider {
  generateDeck(input: {
    projectId: string;
    referenceText: string;
    title: string;
  }): Promise<Deck>;
}

export interface RehearsalAnalyzer {
  analyzeTranscript(input: {
    deck: Deck;
    transcript: string;
    durationSeconds: number;
  }): Promise<RehearsalMetrics>;
}
