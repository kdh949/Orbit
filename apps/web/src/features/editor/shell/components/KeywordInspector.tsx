import { createKeywordOccurrenceId, type Keyword } from "@orbit/shared";
import { useState } from "react";

import { DropdownMenu, DropdownMenuItem } from "../../../../components/ui";
import { IdBadge } from "./EditorIdBadge";

export interface KeywordUsageSummary {
  advancesSlide: boolean;
  animationIds: string[];
}

export type KeywordActionMode =
  | "advance-slide"
  | "animation-trigger"
  | "required-keyword";

export type KeywordSelectionContext = {
  keywordId: string;
  occurrenceKey: string | null;
};

interface SpeakerNotesWordPart {
  keyword: Keyword | null;
  kind: "word";
  start: number;
  value: string;
}

interface SpeakerNotesTextPart {
  kind: "text";
  value: string;
}

type SpeakerNotesPart = SpeakerNotesWordPart | SpeakerNotesTextPart;

interface KeywordMatch {
  keyword: Keyword;
  value: string;
}

export function KeywordHighlightedNotes(props: {
  keywords: Keyword[];
  notes: string;
  selectedKeywordOccurrenceKey?: string | null;
  selectedKeywordId: string | null;
  showIds: boolean;
  slideId: string;
  usageByKeywordId?: Record<string, KeywordUsageSummary>;
  onSelectKeyword: (keywordId: string, occurrenceKey?: string | null) => void;
  onSelectKeywordActionMode?: (
    mode: KeywordActionMode,
    selection?: KeywordSelectionContext | null
  ) => void;
  onSelectKeywordText: (
    value: string,
    start: number
  ) => KeywordSelectionContext | null;
}) {
  const {
    keywords,
    notes,
    selectedKeywordOccurrenceKey = null,
    showIds,
    slideId,
    usageByKeywordId,
    onSelectKeyword,
    onSelectKeywordActionMode,
    onSelectKeywordText
  } = props;
  const [openTokenKey, setOpenTokenKey] = useState<string | null>(null);

  if (!notes) {
    return <p className="script-copy">발표 메모가 아직 없습니다.</p>;
  }

  const parts = tokenizeSpeakerNotes(notes, keywords);

  function selectTokenAction(
    part: SpeakerNotesWordPart,
    mode: KeywordActionMode,
    keyword: Keyword | null,
    occurrenceKey: string | null
  ) {
    const selection = keyword
      ? {
          keywordId: keyword.keywordId,
          occurrenceKey
        }
      : onSelectKeywordText(part.value, part.start);

    if (keyword) {
      onSelectKeyword(keyword.keywordId, occurrenceKey);
    }

    onSelectKeywordActionMode?.(mode, selection);
    setOpenTokenKey(null);
  }

  return (
    <div className="script-copy">
      {parts.map((part, index) => {
        if (part.kind === "text") {
          return part.value;
        }

        const keyword = part.keyword;
        const occurrenceKey = keyword
          ? createKeywordOccurrenceId(
              slideId,
              keyword.keywordId,
              part.start,
              part.start + part.value.length
            )
          : null;
        const isSelected = Boolean(
          occurrenceKey && occurrenceKey === selectedKeywordOccurrenceKey
        );
        const tokenTone = getKeywordTokenTone(keyword, occurrenceKey, usageByKeywordId);
        const tokenKey = `${part.start}-${part.value}-${index}`;
        const shouldShowKeywordMark = Boolean(
          keyword && (!selectedKeywordOccurrenceKey || isSelected)
        );
        const tokenClassName = [
          shouldShowKeywordMark ? "keyword-mark" : "keyword-note-token",
          `keyword-tone-${tokenTone}`,
          isSelected ? "selected" : ""
        ].filter(Boolean).join(" ");

        return (
          <span
            className="keyword-token-menu-anchor"
            key={tokenKey}
            onBlur={(event) => {
              if (
                event.relatedTarget &&
                event.currentTarget.contains(event.relatedTarget as Node)
              ) {
                return;
              }
              setOpenTokenKey(null);
            }}
          >
            <button
              aria-expanded={openTokenKey === tokenKey}
              aria-haspopup="menu"
              className={tokenClassName}
              data-keyword-id={keyword?.keywordId}
              data-occurrence-id={occurrenceKey ?? undefined}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setOpenTokenKey((current) =>
                  current === tokenKey ? null : tokenKey
                );
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setOpenTokenKey(null);
                }
              }}
            >
              <strong>{part.value}</strong>
              {showIds && keyword ? <IdBadge id={keyword.keywordId} /> : null}
            </button>
            {openTokenKey === tokenKey ? (
              <DropdownMenu
                align="start"
                aria-label={`${part.value} 키워드 동작`}
                className="keyword-token-dropdown"
                variant="black"
                onClick={(event) => event.stopPropagation()}
              >
                <DropdownMenuItem
                  onClick={() =>
                    selectTokenAction(
                      part,
                      "animation-trigger",
                      keyword,
                      occurrenceKey
                    )
                  }
                >
                  애니메이션 트리거
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    selectTokenAction(
                      part,
                      "required-keyword",
                      keyword,
                      occurrenceKey
                    )
                  }
                >
                  필수 키워드
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    selectTokenAction(
                      part,
                      "advance-slide",
                      keyword,
                      occurrenceKey
                    )
                  }
                >
                  페이지 넘김
                </DropdownMenuItem>
              </DropdownMenu>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

export function KeywordList(props: {
  keywords: Keyword[];
  selectedKeywordId: string | null;
  showIds: boolean;
  usageByKeywordId?: Record<string, KeywordUsageSummary>;
  onSelectKeyword: (keywordId: string) => void;
}) {
  const { keywords, selectedKeywordId, showIds, usageByKeywordId, onSelectKeyword } = props;

  return (
    <div className="keyword-strip">
      {keywords.length > 0 ? (
        keywords.map((keyword) => (
          <button
            className={`keyword-chip ${
              keyword.keywordId === selectedKeywordId ? "selected" : ""
            }`}
            key={keyword.keywordId}
            type="button"
            onClick={() => onSelectKeyword(keyword.keywordId)}
          >
            <span>{keyword.text}</span>
            {keyword.required ? (
              <small className="keyword-chip-badge required">필수</small>
            ) : null}
            {(usageByKeywordId?.[keyword.keywordId]?.animationIds.length ?? 0) > 0 ? (
              <small className="keyword-chip-badge">
                애니메이션 {usageByKeywordId?.[keyword.keywordId]?.animationIds.length}
              </small>
            ) : null}
            {usageByKeywordId?.[keyword.keywordId]?.advancesSlide ? (
              <small className="keyword-chip-badge">다음 슬라이드</small>
            ) : null}
            {showIds ? <IdBadge id={keyword.keywordId} /> : null}
          </button>
        ))
      ) : (
        <span className="keyword-empty">등록된 키워드 없음</span>
      )}
    </div>
  );
}

export function KeywordDetail(props: {
  keyword: Keyword;
  requiredActive?: boolean;
  showIds: boolean;
  usage?: KeywordUsageSummary | null;
  onClearSelection?: () => void;
  onDeleteKeyword?: () => void;
  onSelectActionMode?: (mode: KeywordActionMode) => void;
}) {
  const {
    keyword,
    onClearSelection,
    onDeleteKeyword,
    onSelectActionMode,
    requiredActive = keyword.required,
    showIds,
    usage
  } = props;
  const selectedActionMode: KeywordActionMode | "" =
    (usage?.animationIds.length ?? 0) > 0
      ? "animation-trigger"
      : usage?.advancesSlide
        ? "advance-slide"
        : requiredActive
          ? "required-keyword"
          : "";

  return (
    <section className="keyword-detail-card">
      <div className="keyword-detail-header">
        <div>
          <strong>{keyword.text}</strong>
          {showIds ? <IdBadge id={keyword.keywordId} /> : null}
        </div>
        <div className="keyword-detail-actions">
          <button
            className="keyword-detail-action"
            type="button"
            onClick={onClearSelection}
          >
            선택 해제
          </button>
          <button
            className="keyword-detail-action danger"
            type="button"
            onClick={onDeleteKeyword}
          >
            키워드 삭제
          </button>
        </div>
      </div>
      <div className="keyword-badge-row">
        {keyword.required ? <small className="keyword-badge">필수</small> : null}
        {(usage?.animationIds.length ?? 0) > 0 ? (
          <small className="keyword-badge">
            애니메이션 {usage?.animationIds.length}
          </small>
        ) : null}
        {usage?.advancesSlide ? (
          <small className="keyword-badge">다음 슬라이드</small>
        ) : null}
      </div>
      <div className="keyword-control-row">
        <label className="keyword-mode-select-label">
          <span>키워드 동작</span>
          <select
            className="keyword-mode-select"
            value={selectedActionMode}
            onChange={(event) => {
              const mode = event.target.value as KeywordActionMode | "";
              if (!mode) return;
              onSelectActionMode?.(mode);
            }}
          >
            <option value="" disabled>
              유형 선택
            </option>
            <option value="required-keyword">필수 키워드</option>
            <option value="advance-slide">다음 슬라이드 넘김</option>
            <option value="animation-trigger">애니메이션 트리거</option>
          </select>
        </label>
      </div>
      <KeywordAliases label="유의어" values={keyword.synonyms} />
      <KeywordAliases label="약어" values={keyword.abbreviations} />
    </section>
  );
}

export function KeywordSummary(props: { keyword: Keyword; showIds: boolean }) {
  const { keyword, showIds } = props;

  return (
    <div className="stack-item">
      {showIds ? <IdBadge id={keyword.keywordId} /> : null}
      <strong>{keyword.text}</strong>
      <small>
        synonyms {keyword.synonyms.join(", ") || "none"} · abbreviations{" "}
        {keyword.abbreviations.join(", ") || "none"}
      </small>
    </div>
  );
}

function KeywordAliases(props: { label: string; values: string[] }) {
  return (
    <div className="keyword-alias-row">
      <span>{props.label}</span>
      <div>
        {props.values.length > 0 ? (
          props.values.map((value) => (
            <small className="keyword-alias" key={value}>
              {value}
            </small>
          ))
        ) : (
          <small className="keyword-alias muted">없음</small>
        )}
      </div>
    </div>
  );
}

function getKeywordTokenTone(
  keyword: Keyword | null,
  occurrenceKey: string | null,
  usageByKeywordId?: Record<string, KeywordUsageSummary>
): "default" | "next-slide" | "required" {
  if (!keyword) {
    return "default";
  }

  const usage = usageByKeywordId?.[keyword.keywordId];
  if (usage?.advancesSlide) {
    return "next-slide";
  }

  const isRequiredOccurrence = occurrenceKey
    ? (keyword.requiredOccurrenceIds ?? []).includes(occurrenceKey)
    : false;

  return keyword.required || isRequiredOccurrence ? "required" : "default";
}

function tokenizeSpeakerNotes(notes: string, keywords: Keyword[]): SpeakerNotesPart[] {
  const parts: SpeakerNotesPart[] = [];
  const tokenPattern = /([0-9A-Za-z가-힣]+)/g;
  let cursor = 0;

  for (const match of notes.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    const value = match[0];

    if (cursor < index) {
      parts.push({
        kind: "text",
        value: notes.slice(cursor, index)
      });
    }

    parts.push({
      kind: "word",
      start: index,
      value,
      keyword: findKeywordMatch(keywords, value)?.keyword ?? null
    });
    cursor = index + value.length;
  }

  if (cursor < notes.length) {
    parts.push({
      kind: "text",
      value: notes.slice(cursor)
    });
  }

  return parts;
}

function findKeywordMatch(keywords: Keyword[], rawValue: string): KeywordMatch | null {
  const normalizedValue = normalizeTerm(rawValue);

  if (!normalizedValue) {
    return null;
  }

  for (const keyword of keywords) {
    const matched = [keyword.text, ...keyword.synonyms, ...keyword.abbreviations].find(
      (value) => normalizeTerm(value) === normalizedValue
    );

    if (matched) {
      return {
        keyword,
        value: matched
      };
    }
  }

  return null;
}

function normalizeTerm(value: string) {
  return value.trim().toLocaleLowerCase("ko-KR");
}
