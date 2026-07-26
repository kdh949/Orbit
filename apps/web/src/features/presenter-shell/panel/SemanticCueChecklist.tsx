import {
  CheckCircle2,
  Circle,
  CircleAlert,
  CircleSlash2
} from "lucide-react";

import type { P3SemanticCueProgressItem } from "../../rehearsal/speech/p3RehearsalSession";

export function SemanticCueChecklist(props: {
  items: readonly P3SemanticCueProgressItem[];
}) {
  const coreItems = props.items
    .filter((item) => item.importance === "core")
    .slice(0, 3);
  const supportingItems = props.items.filter(
    (item) => item.importance === "supporting"
  );

  if (coreItems.length === 0 && supportingItems.length === 0) {
    return null;
  }

  const primaryItems = coreItems.length > 0 ? coreItems : supportingItems;
  const secondaryItems = coreItems.length > 0 ? supportingItems : [];
  const coveredPrimaryCount = primaryItems.filter(
    (item) => item.status === "covered"
  ).length;
  const headingLabel = coreItems.length > 0 ? "핵심 메시지" : "발표 메시지";

  return (
    <section
      className="semantic-cue-checklist"
      aria-label={`${headingLabel} 체크리스트`}
    >
      <div className="semantic-cue-checklist-heading">
        <span>{headingLabel}</span>
        <strong>
          {coveredPrimaryCount}/{primaryItems.length}
        </strong>
      </div>

      <ul>
        {primaryItems.map((item) => (
          <SemanticCueChecklistRow item={item} key={item.cueId} />
        ))}
      </ul>

      {secondaryItems.length > 0 ? (
        <details className="semantic-cue-checklist-supporting">
          <summary>보조 메시지 {secondaryItems.length}개</summary>
          <ul>
            {secondaryItems.map((item) => (
              <SemanticCueChecklistRow item={item} key={item.cueId} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function SemanticCueChecklistRow(props: { item: P3SemanticCueProgressItem }) {
  const presentation = statusPresentation[props.item.status];
  const Icon = presentation.icon;

  return (
    <li
      className={`semantic-cue-checklist-row semantic-cue-checklist-row--${props.item.status}`}
    >
      <Icon aria-hidden="true" size={17} />
      <span>{props.item.label}</span>
      <small>{presentation.label}</small>
    </li>
  );
}

const statusPresentation = {
  waiting: { icon: Circle, label: "확인 대기" },
  covered: { icon: CheckCircle2, label: "전달됨" },
  "needs-review": { icon: CircleAlert, label: "검토 필요" },
  unmeasured: { icon: CircleSlash2, label: "측정 불가" }
} as const;
