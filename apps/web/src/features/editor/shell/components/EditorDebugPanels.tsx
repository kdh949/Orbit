import type { Deck, DeckAnimation, DeckElement, Slide } from "@orbit/shared";

import { ElementSummary, InfoCard, KeywordSummary } from "./EditorDebugCards";

export function EditorDebugPanels(props: {
  currentSlide: Slide | null;
  currentSlideAnimations: DeckAnimation[];
  currentSlideId: string | null;
  deck: Deck;
  isDataViewOpen: boolean;
  isDev: boolean;
  lastPatchLabel: string;
  onCloseDataView: () => void;
  redoCount: number;
  saveStatusLabel: string;
  selectedElementIds: string[];
  undoCount: number;
  validationHighlightElementIds: string[];
  visibleElements: DeckElement[];
}) {
  const {
    currentSlide,
    currentSlideAnimations,
    currentSlideId,
    deck,
    isDataViewOpen,
    isDev,
    lastPatchLabel,
    onCloseDataView,
    redoCount,
    saveStatusLabel,
    selectedElementIds,
    undoCount,
    validationHighlightElementIds,
    visibleElements
  } = props;

  return (
    <>
      <div data-testid="editor-elements-debug" hidden>
        {JSON.stringify(
          visibleElements.map((element) => ({
            elementId: element.elementId,
            type: element.type,
            role: element.role,
            ...(element.type === "text"
              ? {
                  fontSize: element.props.fontSize,
                  lineHeight: element.props.lineHeight
                }
              : {}),
            x: Math.round(element.x),
            y: Math.round(element.y),
            width: Math.round(element.width),
            height: Math.round(element.height),
            rotation: Math.round(element.rotation)
          }))
        )}
      </div>
      <div data-testid="editor-quality-debug" hidden>
        {JSON.stringify({
          currentSlideId,
          selectedElementIds,
          validationHighlightElementIds
        })}
      </div>
      <div data-testid="editor-slide-style-debug" hidden>
        {JSON.stringify(
          currentSlide
            ? {
                backgroundColor:
                  currentSlide.style.backgroundColor ?? deck.theme.backgroundColor,
                textColor: currentSlide.style.textColor ?? deck.theme.textColor,
                accentColor: currentSlide.style.accentColor ?? deck.theme.accentColor
              }
            : null
        )}
      </div>
      <div data-testid="editor-animations-debug" hidden>
        {JSON.stringify(currentSlide?.animations ?? [])}
      </div>

      {isDev && isDataViewOpen ? (
        <section className="floating-dev-panel">
          <div className="ai-header dev-panel-header">
            <h2>ORBIT-14 Data View</h2>
            <div>
              <button type="button" onClick={onCloseDataView}>
                ×
              </button>
            </div>
          </div>

          <InfoCard
            title="Deck Meta"
            lines={[
              `deckId: ${deck.deckId}`,
              `version: ${deck.version}`,
              `theme: ${deck.theme.name}`,
              `font: ${deck.theme.fontFamily}`,
              `palette.primary: ${deck.theme.palette.primary}`,
              `effects.radius: ${deck.theme.effects.borderRadius}`
            ]}
          />
          <InfoCard
            title="Slide Style"
            lines={
              currentSlide
                ? [
                    `canvas: ${deck.canvas.preset} / ${deck.canvas.width} × ${deck.canvas.height}`,
                    `locale: ${deck.metadata.language} / ${deck.metadata.locale}`,
                    `layout: ${currentSlide.style.layout ?? "none"}`,
                    `fontFamily: ${currentSlide.style.fontFamily ?? deck.theme.fontFamily}`,
                    `backgroundColor: ${currentSlide.style.backgroundColor ?? deck.theme.backgroundColor}`,
                    `textColor: ${currentSlide.style.textColor ?? deck.theme.textColor}`,
                    `accentColor: ${currentSlide.style.accentColor ?? deck.theme.accentColor}`,
                    `backgroundImage: ${currentSlide.style.backgroundImage?.src ?? "none"}`
                  ]
                : ["empty deck: no selected slide"]
            }
          />
          <InfoCard
            title="Editor Debug"
            lines={[
              `saveStatus: ${saveStatusLabel}`,
              `baseVersion: ${deck.version}`,
              `undo: ${undoCount}`,
              `redo: ${redoCount}`,
              `lastPatch: ${lastPatchLabel}`
            ]}
          />

          <section className="suggestion-card">
            <strong>Keywords</strong>
            <div className="stack-list">
              {currentSlide && currentSlide.keywords.length > 0 ? (
                currentSlide.keywords.map((keyword) => (
                  <KeywordSummary key={keyword.keywordId} keyword={keyword} showIds />
                ))
              ) : (
                <div className="stack-item compact"><span>no keywords</span></div>
              )}
            </div>
          </section>
          <section className="suggestion-card">
            <strong>Animations</strong>
            <div className="stack-list">
              {currentSlideAnimations.map((animation) => (
                <div className="stack-item" key={animation.animationId}>
                  <span>{animation.animationId}</span>
                  <strong>{animation.type} → {animation.elementId}</strong>
                  <small>
                    order {animation.order} · {animation.durationMs}ms · delay {animation.delayMs}ms · {animation.easing}
                  </small>
                </div>
              ))}
            </div>
          </section>
          <section className="suggestion-card">
            <strong>Elements</strong>
            <div className="stack-list">
              {visibleElements.length > 0 ? (
                visibleElements.map((element) => (
                  <ElementSummary key={element.elementId} element={element} />
                ))
              ) : (
                <div className="stack-item compact"><span>no elements</span></div>
              )}
            </div>
          </section>
        </section>
      ) : null}
    </>
  );
}
