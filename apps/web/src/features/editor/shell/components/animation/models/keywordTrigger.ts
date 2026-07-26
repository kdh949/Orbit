import type { Keyword } from "@orbit/shared/deck";

export type AnimationKeywordTriggerOption = {
  keywordId: string;
  label: string;
  required: boolean;
};

export function toAnimationKeywordTriggerOptions(
  keywords: Keyword[]
): AnimationKeywordTriggerOption[] {
  return keywords.map((keyword) => ({
    keywordId: keyword.keywordId,
    label: keyword.text,
    required: keyword.required
  }));
}
