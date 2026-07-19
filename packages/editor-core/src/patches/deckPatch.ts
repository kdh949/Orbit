import type { Deck, DeckChangeRecord } from "@orbit/shared";

export type ApplyDeckPatchErrorCode =
  | "PATCH_VALIDATION_FAILED"
  | "DECK_VALIDATION_FAILED"
  | "CHANGE_RECORD_VALIDATION_FAILED"
  | "DECK_ID_MISMATCH"
  | "BASE_VERSION_MISMATCH"
  | "SLIDE_NOT_FOUND"
  | "ELEMENT_NOT_FOUND"
  | "ANIMATION_NOT_FOUND"
  | "ANIMATION_TARGET_NOT_FOUND"
  | "SLIDE_ACTION_NOT_FOUND"
  | "SLIDE_ACTION_ANIMATION_NOT_FOUND"
  | "SLIDE_ACTION_ANIMATION_TIMING_INCOMPATIBLE"
  | "SLIDE_ACTION_KEYWORD_NOT_FOUND"
  | "DUPLICATE_SLIDE_ID"
  | "DUPLICATE_ELEMENT_ID"
  | "DUPLICATE_ANIMATION_ID"
  | "DUPLICATE_SLIDE_ACTION_ID"
  | "SLIDE_KIND_MISMATCH"
  | "LAST_SLIDE_DELETE_FORBIDDEN"
  | "INVALID_SLIDE_REORDER"
  | "UNSUPPORTED_OPERATION";

export type DeckPatchVersionMetadata = {
  deckId: Deck["deckId"];
  baseVersion: number;
  nextVersion: number;
};

export type ApplyDeckPatchError = {
  code: ApplyDeckPatchErrorCode;
  message: string;
  operationType?: string;
  details?: string[];
};

export type ApplyDeckPatchSuccess = {
  ok: true;
  deck: Deck;
  changeRecord: DeckChangeRecord;
  metadata: DeckPatchVersionMetadata;
};

export type ApplyDeckPatchFailure = {
  ok: false;
  error: ApplyDeckPatchError;
};

export type ApplyDeckPatchResult =
  | ApplyDeckPatchSuccess
  | ApplyDeckPatchFailure;

export type ApplyDeckPatchOptions = {
  changeId?: DeckChangeRecord["changeId"];
  actorUserId?: string;
  createdAt?: string;
};
