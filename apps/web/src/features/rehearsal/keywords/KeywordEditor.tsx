import { createDemoDeck } from "@orbit/editor-core/fixtures";
import { demoIds } from "@orbit/shared/common";
import type { Deck, Keyword } from "@orbit/shared/deck";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { fetchProjectDeck, persistSlideKeywords } from "./keywordEditorApi";
import {
  addKeyword,
  deleteKeyword,
  formatTermInput,
  updateKeywordTerms,
  updateKeywordText,
  validateSlideKeywords
} from "./keywordEditorModel";

const demoDeck = createDemoDeck();
const projectId = demoIds.projectId;
const deckQueryKey = ["deck", projectId] as const;

export function KeywordEditor() {
  const queryClient = useQueryClient();
  const [selectedSlideId, setSelectedSlideId] = useState(
    demoDeck.slides[0]?.slideId ?? ""
  );
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const deckQuery = useQuery({
    queryKey: deckQueryKey,
    queryFn: () => fetchProjectDeck(projectId),
    retry: false
  });

  const deck = deckQuery.data?.deck ?? demoDeck;
  const selectedSlide = useMemo(
    () => deck.slides.find((slide) => slide.slideId === selectedSlideId) ?? deck.slides[0],
    [deck, selectedSlideId]
  );
  const validationIssues = validateSlideKeywords(keywords);
  const hasValidationIssues = validationIssues.length > 0;

  useEffect(() => {
    if (!deck.slides.some((slide) => slide.slideId === selectedSlideId)) {
      setSelectedSlideId(deck.slides[0]?.slideId ?? "");
    }
  }, [deck, selectedSlideId]);

  useEffect(() => {
    setKeywords(selectedSlide?.keywords ?? []);
    setLastSavedAt(null);
  }, [selectedSlide]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSlide) {
        throw new Error("선택된 슬라이드가 없습니다.");
      }

      const savedDeck = await persistSlideKeywords(
        deck,
        selectedSlide.slideId,
        keywords,
        deckQuery.data ? "patch" : "put"
      );

      return savedDeck;
    },
    onSuccess: (savedDeck: Deck) => {
      const savedAt = new Date().toISOString();

      queryClient.setQueryData(deckQueryKey, {
        projectId: savedDeck.projectId,
        deck: savedDeck,
        updatedAt: savedAt
      });
      setLastSavedAt(savedAt);
    }
  });

  const nextKeywordName = `키워드 ${keywords.length + 1}`;
  const loadErrorMessage =
    deckQuery.error instanceof Error
      ? deckQuery.error.message
      : "저장된 덱을 불러오지 못했습니다.";

  return (
    <article className="panel keyword-panel">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Rehearsal</p>
          <h2>키워드 편집</h2>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={() => void deckQuery.refetch()}
          aria-label="덱 다시 불러오기"
          title="덱 다시 불러오기"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      {deckQuery.isPending ? (
        <p className="inline-status">덱을 불러오는 중입니다.</p>
      ) : null}

      {deckQuery.isError ? (
        <p className="inline-warning">
          {loadErrorMessage} 데모 덱으로 편집을 시작합니다.
        </p>
      ) : null}

      <div className="keyword-layout">
        <div className="slide-list" aria-label="슬라이드 목록">
          {deck.slides.map((slide) => (
            <button
              key={slide.slideId}
              type="button"
              className={slide.slideId === selectedSlide?.slideId ? "active" : ""}
              onClick={() => setSelectedSlideId(slide.slideId)}
            >
              <span>{slide.order}</span>
              <strong>{slide.title || slide.slideId}</strong>
            </button>
          ))}
        </div>

        <div className="keyword-editor">
          <div className="keyword-editor-toolbar">
            <div>
              <span>deck v{deck.version}</span>
              <strong>{selectedSlide?.title ?? "슬라이드 없음"}</strong>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setKeywords((current) => addKeyword(current, nextKeywordName))}
            >
              <Plus size={16} />
              추가
            </button>
          </div>

          <div className="keyword-rows">
            {keywords.map((keyword) => (
              <div className="keyword-row" key={keyword.keywordId}>
                <label>
                  <span>키워드</span>
                  <input
                    value={keyword.text}
                    onChange={(event) =>
                      setKeywords((current) =>
                        updateKeywordText(current, keyword.keywordId, event.target.value)
                      )
                    }
                  />
                </label>
                <label>
                  <span>동의어</span>
                  <input
                    value={formatTermInput(keyword.synonyms)}
                    onChange={(event) =>
                      setKeywords((current) =>
                        updateKeywordTerms(
                          current,
                          keyword.keywordId,
                          "synonyms",
                          event.target.value
                        )
                      )
                    }
                  />
                </label>
                <label>
                  <span>약어</span>
                  <input
                    value={formatTermInput(keyword.abbreviations)}
                    onChange={(event) =>
                      setKeywords((current) =>
                        updateKeywordTerms(
                          current,
                          keyword.keywordId,
                          "abbreviations",
                          event.target.value
                        )
                      )
                    }
                  />
                </label>
                <button
                  className="icon-button danger-button"
                  type="button"
                  onClick={() =>
                    setKeywords((current) => deleteKeyword(current, keyword.keywordId))
                  }
                  aria-label={`${keyword.text} 삭제`}
                  title={`${keyword.text} 삭제`}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))}

            {keywords.length === 0 ? (
              <p className="empty-state">등록된 키워드가 없습니다.</p>
            ) : null}
          </div>

          {hasValidationIssues ? (
            <ul className="validation-list">
              {validationIssues.map((issue, index) => (
                <li key={`${issue.field}-${index}`}>{issue.message}</li>
              ))}
            </ul>
          ) : null}

          {saveMutation.isError ? (
            <p className="save-error">
              {saveMutation.error instanceof Error
                ? saveMutation.error.message
                : "저장에 실패했습니다."}
            </p>
          ) : null}

          <div className="keyword-editor-footer">
            <span>
              {lastSavedAt
                ? `저장됨 ${new Date(lastSavedAt).toLocaleTimeString("ko-KR")}`
                : deckQuery.data
                  ? "저장된 덱"
                  : "데모 덱"}
            </span>
            <button
              className="primary-button"
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={!selectedSlide || hasValidationIssues || saveMutation.isPending}
            >
              <Save size={16} />
              {saveMutation.isPending ? "저장 중" : "저장"}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
