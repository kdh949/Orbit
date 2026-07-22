import type {
  DesignPackOption,
  SystemDesignPackSelection
} from "@orbit/shared";
import { systemDesignPackSelectionSchema } from "@orbit/shared";
import { IconCheck, IconSparkles } from "@tabler/icons-react";

export function DesignPackOptions(props: {
  error?: string;
  loading: boolean;
  onSelect: (selection: SystemDesignPackSelection | null) => void;
  options: DesignPackOption[];
  selected: SystemDesignPackSelection | null;
}) {
  return (
    <fieldset className="ai-ppt-style-fieldset ai-ppt-design-pack-fieldset">
      <legend>디자인 팩</legend>
      <p className="ai-ppt-design-pack-help">
        AI 추천을 유지하거나 표지·본문 구성을 직접 선택하세요.
      </p>
      <div className="ai-ppt-design-pack-grid" role="list">
        <button
          aria-label="AI 추천 자동 모드"
          aria-pressed={props.selected === null}
          className={[
            "ai-ppt-design-pack-card",
            "ai-ppt-design-pack-auto",
            props.selected === null ? "selected" : ""
          ].join(" ")}
          type="button"
          onClick={() => props.onSelect(null)}
        >
          <span className="ai-ppt-design-pack-auto-icon" aria-hidden="true">
            <IconSparkles size={26} />
          </span>
          <span className="ai-ppt-design-pack-card-heading">
            <strong>AI 추천</strong>
            <SelectionMark selected={props.selected === null} />
          </span>
          <small>내용과 목적에 가장 잘 맞는 승인된 팩을 자동 적용합니다.</small>
        </button>
        {props.options.map((option, index) => {
          const selected =
            props.selected?.id === option.id &&
            props.selected.version === option.version;
          return (
            <button
              aria-label={`${option.name} 디자인 팩 ${selected ? "선택됨" : "선택"}`}
              aria-pressed={selected}
              className={[
                "ai-ppt-design-pack-card",
                selected ? "selected" : ""
              ].join(" ")}
              key={`${option.id}@${option.version}`}
              type="button"
              onClick={() =>
                props.onSelect(systemDesignPackSelectionSchema.parse({
                  id: option.id,
                  version: option.version
                }))
              }
            >
              <span className="ai-ppt-design-pack-rank">
                {index === 0 ? "AI 추천 1순위" : `추천 ${index + 1}`}
              </span>
              <DesignPackPreview option={option} />
              <span className="ai-ppt-design-pack-card-heading">
                <strong>{option.name}</strong>
                <SelectionMark selected={selected} />
              </span>
              <small>{option.rationale}</small>
            </button>
          );
        })}
      </div>
      {props.loading ? (
        <p className="ai-ppt-design-pack-status" role="status">
          발표에 맞는 디자인 팩을 추천하는 중입니다.
        </p>
      ) : null}
      {props.error ? (
        <p className="ai-ppt-design-pack-warning" role="status">
          {props.error} AI 추천 자동 모드로 계속할 수 있습니다.
        </p>
      ) : null}
    </fieldset>
  );
}

function DesignPackPreview({ option }: { option: DesignPackOption }) {
  return (
    <span
      aria-label={`${option.name} 표지와 본문 미리보기`}
      className={`ai-ppt-design-pack-preview ai-ppt-design-pack-preview-${option.family}`}
      role="img"
    >
      <span
        className="ai-ppt-design-pack-slide ai-ppt-design-pack-cover"
        data-preview-id={option.preview.coverPreviewId}
      >
        <i />
        <strong>표지</strong>
        <b />
      </span>
      <span
        className="ai-ppt-design-pack-slide ai-ppt-design-pack-body"
        data-preview-id={option.preview.bodyPreviewId}
      >
        <strong>본문</strong>
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}

function SelectionMark({ selected }: { selected: boolean }) {
  return (
    <span className="ai-ppt-palette-selected-mark" aria-hidden="true">
      {selected ? <IconCheck size={14} /> : null}
    </span>
  );
}
