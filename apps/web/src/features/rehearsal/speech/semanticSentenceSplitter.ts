import {
  createCanonicalScriptSentenceIndex,
  type CanonicalScriptSentence
} from "../../../runtime/speech/tracking/canonicalScriptSentenceIndex";

export type SemanticScriptSentence = CanonicalScriptSentence;

export function splitSpeakerNotesIntoSemanticSentences(
  speakerNotes: string
): SemanticScriptSentence[] {
  return createCanonicalScriptSentenceIndex(speakerNotes).sentences;
}
