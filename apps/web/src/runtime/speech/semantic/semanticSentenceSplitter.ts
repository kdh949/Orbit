import {
  createCanonicalScriptSentenceIndex,
  type CanonicalScriptSentence
} from "../tracking/canonicalScriptSentenceIndex";

export type SemanticScriptSentence = CanonicalScriptSentence;

export function splitSpeakerNotesIntoSemanticSentences(
  speakerNotes: string
): SemanticScriptSentence[] {
  return createCanonicalScriptSentenceIndex(speakerNotes).sentences;
}
