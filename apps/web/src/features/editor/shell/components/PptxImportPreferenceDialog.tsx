import type { PptxImportPreference } from "@orbit/shared/deck";
import { useEffect, useState } from "react";

import { OrbitButton, OrbitDialog } from "../../../../components/ui";
import "./pptx-import-preference-dialog.css";

const options: Array<{
  description: string;
  label: string;
  preference: PptxImportPreference;
  tradeoff: string;
}> = [
  {
    description: "원본 장표의 배치와 시각적 인상을 최대한 그대로 유지합니다.",
    label: "원본 그대로 보기",
    preference: "appearance-first",
    tradeoff: "복잡한 개체는 이미지처럼 보여 편집 범위가 줄어들 수 있습니다."
  },
  {
    description: "텍스트와 도형을 가능한 한 개별 개체로 가져옵니다.",
    label: "내용 편집하기",
    preference: "editability-first",
    tradeoff: "지원되지 않는 효과는 단순화되어 원본과 다르게 보일 수 있습니다."
  }
];

export function PptxImportPreferenceDialog(props: {
  fileName: string;
  onCancel: () => void;
  onConfirm: (preference: PptxImportPreference) => void;
  open: boolean;
  pending?: boolean;
}) {
  const [selection, setSelection] = useState<PptxImportPreference | null>(null);

  useEffect(() => {
    if (props.open) setSelection(null);
  }, [props.fileName, props.open]);

  return (
    <OrbitDialog
      className="pptx-import-preference-dialog"
      closeDisabled={props.pending}
      description="가져온 뒤 가장 중요하게 유지할 기준을 선택하세요. 이 선택은 이번 파일에만 적용됩니다."
      footer={(
        <>
          <OrbitButton
            disabled={props.pending}
            onClick={props.onCancel}
            variant="secondary"
          >
            취소
          </OrbitButton>
          <OrbitButton
            disabled={!selection || props.pending}
            loading={props.pending}
            onClick={() => {
              if (selection) props.onConfirm(selection);
            }}
          >
            가져오기 시작
          </OrbitButton>
        </>
      )}
      onClose={props.onCancel}
      open={props.open}
      title="PPTX 가져오기 방식"
    >
      <p className="pptx-import-preference-file" title={props.fileName}>
        {props.fileName}
      </p>
      <fieldset className="pptx-import-preference-options">
        <legend>가져오기 기준</legend>
        {options.map((option) => (
          <label
            className={selection === option.preference ? "is-selected" : ""}
            key={option.preference}
          >
            <input
              checked={selection === option.preference}
              disabled={props.pending}
              name="pptx-import-preference"
              onChange={() => setSelection(option.preference)}
              type="radio"
              value={option.preference}
            />
            <span>
              <strong>{option.label}</strong>
              <small>{option.description}</small>
              <em>{option.tradeoff}</em>
            </span>
          </label>
        ))}
      </fieldset>
    </OrbitDialog>
  );
}
