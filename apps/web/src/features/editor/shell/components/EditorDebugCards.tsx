import type { DeckElement, Keyword } from "@orbit/shared/deck";

import { IdBadge } from "./EditorIdBadge";

export function InfoCard(props: { title: string; lines: string[] }) {
  return (
    <section className="suggestion-card">
      <strong>{props.title}</strong>
      <div className="stack-list">
        {props.lines.map((line) => (
          <div className="stack-item compact" key={line}>
            <span>{line}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ElementSummary(props: { element: DeckElement }) {
  const { element } = props;

  return (
    <div className="stack-item" data-testid={`debug-element-${element.elementId}`}>
      <IdBadge id={element.elementId} />
      <strong>
        {element.type}
        {element.role ? ` · ${element.role}` : ""}
      </strong>
      <small>
        {Math.round(element.x)},{Math.round(element.y)} · {Math.round(element.width)}x
        {Math.round(element.height)} · r{Math.round(element.rotation)} · z
        {element.zIndex} · opacity {element.opacity}
      </small>
    </div>
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
