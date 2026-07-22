import type { OoxmlReferenceTemplateOption } from "@orbit/shared";
import { IconCheck, IconRefresh } from "@tabler/icons-react";

import { OrbitButton } from "../../components/ui";

export function OoxmlReferenceTemplateOptions(props: {
  error: string;
  loading: boolean;
  onRetry: () => void;
  onSelect: (option: OoxmlReferenceTemplateOption) => void;
  options: OoxmlReferenceTemplateOption[];
  selected: Pick<OoxmlReferenceTemplateOption, "templateId" | "version"> | null;
}) {
  if (props.loading) {
    return (
      <section
        aria-busy="true"
        aria-label="원본 템플릿 불러오는 중"
        className="ai-ppt-reference-template-state"
      >
        <strong>원본 템플릿을 확인하고 있습니다.</strong>
        <span>승인된 미리보기와 편집 가능 범위를 불러오는 중입니다.</span>
      </section>
    );
  }
  if (props.error) {
    return (
      <section className="ai-ppt-reference-template-state" role="alert">
        <strong>원본 템플릿을 불러오지 못했습니다.</strong>
        <span>{props.error}</span>
        <OrbitButton
          icon={<IconRefresh aria-hidden="true" size={16} />}
          onClick={props.onRetry}
          size="compact"
          variant="secondary"
        >
          다시 불러오기
        </OrbitButton>
      </section>
    );
  }
  if (props.options.length === 0) {
    return (
      <section className="ai-ppt-reference-template-state" role="status">
        <strong>현재 사용할 수 있는 원본 템플릿이 없습니다.</strong>
        <span>승인과 원본 검증이 끝난 템플릿만 여기에 표시됩니다.</span>
      </section>
    );
  }
  return (
    <fieldset className="ai-ppt-reference-template-fieldset">
      <legend>원본 템플릿</legend>
      <p>표지와 본문을 확인한 뒤 exact version을 선택하세요.</p>
      <div className="ai-ppt-reference-template-grid">
        {props.options.map((option) => {
          const selected =
            props.selected?.templateId === option.templateId &&
            props.selected.version === option.version;
          return (
            <button
              aria-label={`${option.name} 버전 ${option.version} ${selected ? "선택됨" : "선택"}`}
              aria-pressed={selected}
              className={selected ? "selected" : ""}
              key={`${option.templateId}@${option.version}`}
              onClick={() => props.onSelect(option)}
              type="button"
            >
              <span className="ai-ppt-reference-template-previews">
                <img
                  alt={`${option.name} 표지 미리보기`}
                  src={previewPath(option, option.preview.coverAssetId)}
                />
                <img
                  alt={`${option.name} 본문 미리보기`}
                  src={previewPath(option, option.preview.bodyAssetId)}
                />
              </span>
              <span className="ai-ppt-reference-template-copy">
                <span>
                  <strong>{option.name}</strong>
                  <small>v{option.version}</small>
                  {selected ? <IconCheck aria-hidden="true" size={16} /> : null}
                </span>
                <span>{option.description}</span>
                <small>
                  편집 가능: {option.editableRanges.map(editableLabel).join(" · ")}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function previewPath(
  option: Pick<OoxmlReferenceTemplateOption, "templateId" | "version">,
  assetId: string,
): string {
  return `/api/v1/ooxml-reference-templates/${encodeURIComponent(option.templateId)}/versions/${option.version}/previews/${encodeURIComponent(assetId)}`;
}

function editableLabel(
  range: OoxmlReferenceTemplateOption["editableRanges"][number],
): string {
  const label = {
    text: "문구",
    image: "이미지",
    table: "표 셀",
    chart: "차트 데이터",
  }[range.contentType];
  return `${label} ${range.slotCount}개`;
}
