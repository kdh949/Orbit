export type SemanticUtteranceMatch = {
  rank: number;
  sentenceId: string;
  sentenceIndex: number;
  text: string;
  similarity: number;
  covered: boolean;
};
