import {
  IconAlignBoxCenterBottom as AlignBottom,
  IconAlignBoxCenterMiddle as AlignMiddle,
  IconAlignBoxCenterTop as AlignTop,
  IconAlignBoxLeftMiddle as AlignLeft,
  IconAlignBoxRightMiddle as AlignRight,
} from "@tabler/icons-react";export function MultiSelectionQuickBar(props: {
  canAlign: boolean;
  canDistribute: boolean;
  selectedCount: number;
  onAlignBottom: () => void;
  onAlignCenterX: () => void;
  onAlignCenterY: () => void;
  onAlignLeft: () => void;
  onAlignRight: () => void;
  onAlignTop: () => void;
  onDistributeX: () => void;
  onDistributeY: () => void;
}) {
  return (
    <section className="selection-quickbar" data-testid="editor-multi-selection-quickbar">
      <div className="selection-quickbar-fields">
        <span className="quickbar-inline-hint">
          {props.selectedCount}개 선택됨
        </span>
        <div aria-label="가로 정렬" role="group">
          <button
            aria-label="왼쪽 정렬"
          className="quickbar-toggle"
            disabled={!props.canAlign}
            title="왼쪽 정렬"
            type="button"
            onClick={props.onAlignLeft}
          >
            <AlignLeft aria-hidden="true" size={17} />
          </button>
          <button
            aria-label="가로 가운데 정렬"
            className="quickbar-toggle"
            disabled={!props.canAlign}
            title="가로 가운데 정렬"
            type="button"
            onClick={props.onAlignCenterX}
          >
            <AlignMiddle aria-hidden="true" size={17} />
          </button>
          <button
            aria-label="오른쪽 정렬"
            className="quickbar-toggle"
            disabled={!props.canAlign}
            title="오른쪽 정렬"
            type="button"
            onClick={props.onAlignRight}
          >
            <AlignRight aria-hidden="true" size={17} />
          </button>
        </div>
        <div aria-label="세로 정렬" role="group">
          <button
            aria-label="위쪽 정렬"
            className="quickbar-toggle"
            disabled={!props.canAlign}
            title="위쪽 정렬"
            type="button"
            onClick={props.onAlignTop}
          >
            <AlignTop aria-hidden="true" size={17} />
          </button>
          <button
            aria-label="세로 가운데 정렬"
            className="quickbar-toggle"
            disabled={!props.canAlign}
            title="세로 가운데 정렬"
            type="button"
            onClick={props.onAlignCenterY}
          >
            <AlignMiddle aria-hidden="true" size={17} />
          </button>
          <button
            aria-label="아래쪽 정렬"
            className="quickbar-toggle"
            disabled={!props.canAlign}
            title="아래쪽 정렬"
            type="button"
            onClick={props.onAlignBottom}
          >
            <AlignBottom aria-hidden="true" size={17} />
          </button>
        </div>
        <button
          className="quickbar-action-chip"
          disabled={!props.canDistribute}
          type="button"
          onClick={props.onDistributeX}
        >
          가로 분배
        </button>
        <button
          className="quickbar-action-chip"
          disabled={!props.canDistribute}
          type="button"
          onClick={props.onDistributeY}
        >
          세로 분배
        </button>
      </div>
    </section>
  );
}
