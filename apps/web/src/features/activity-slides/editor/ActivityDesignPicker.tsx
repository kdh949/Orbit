import type { ActivitySlide } from "@orbit/shared";
import {
  IconKey,
  IconLayoutBottombar,
  IconLayoutDashboard,
  IconLayoutSidebarRight,
  IconMessage,
  IconPhotoScan,
  IconQrcode,
  IconSquare
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import { useState } from "react";

import { OrbitButton, OrbitDialog } from "../../../components/ui";

export type ActivityDesignPresetId =
  | "spotlight"
  | "split"
  | "editorial"
  | "essentials"
  | "blank";

const presets: Array<{
  id: ActivityDesignPresetId;
  name: string;
  description: string;
  Icon: ComponentType<{ size?: number }>;
}> = [
  {
    id: "spotlight",
    name: "Spotlight",
    description: "질문을 크게 강조하고 QR과 입장 코드를 나란히 배치",
    Icon: IconLayoutDashboard
  },
  {
    id: "split",
    name: "Split",
    description: "질문과 참여 영역을 밝고 어두운 두 화면으로 분리",
    Icon: IconLayoutSidebarRight
  },
  {
    id: "editorial",
    name: "Editorial",
    description: "큰 제목과 강조 밴드를 사용하는 행사형 구성",
    Icon: IconLayoutBottombar
  },
  {
    id: "essentials",
    name: "Essentials",
    description: "QR과 입장 코드만 남긴 최소 구성",
    Icon: IconQrcode
  },
  {
    id: "blank",
    name: "Blank",
    description: "빈 캔버스에서 원하는 요소를 직접 구성",
    Icon: IconSquare
  }
];

export function ActivityDesignPicker(props: {
  onAddRuntimeElement?: (
    kind: "title" | "description" | "qr" | "passcode"
  ) => void;
  onApplyPreset?: (presetId: ActivityDesignPresetId) => void;
  slide: ActivitySlide;
}) {
  const [pendingPreset, setPendingPreset] =
    useState<ActivityDesignPresetId | null>(null);
  const isEditable = props.slide.activityAppearance.mode === "editable";

  function requestPreset(presetId: ActivityDesignPresetId) {
    if (isEditable && props.slide.elements.length > 0) {
      setPendingPreset(presetId);
      return;
    }
    props.onApplyPreset?.(presetId);
  }

  return (
    <section className="activity-design-picker" aria-labelledby="activity-design-heading">
      <div className="activity-inspector-section-heading">
        <strong id="activity-design-heading">참여 화면 디자인</strong>
        <span>
          템플릿으로 시작한 뒤 모든 요소를 캔버스에서 자유롭게 편집할 수 있어요.
        </span>
      </div>
      <div className="activity-design-preset-grid">
        {presets.map((preset) => (
          <button
            className="activity-design-preset-card"
            key={preset.id}
            onClick={() => requestPreset(preset.id)}
            type="button"
          >
            <span aria-hidden="true" className="activity-design-preset-icon">
              <preset.Icon size={22} />
            </span>
            <strong>{preset.name}</strong>
            <small>{preset.description}</small>
          </button>
        ))}
      </div>

      {isEditable ? (
        <div className="activity-runtime-element-palette">
          <strong>참여 요소 추가</strong>
          <div>
            <OrbitButton
              icon={<IconMessage aria-hidden="true" size={16} />}
              onClick={() => props.onAddRuntimeElement?.("title")}
              type="button"
              variant="secondary"
            >
              질문 제목
            </OrbitButton>
            <OrbitButton
              icon={<IconPhotoScan aria-hidden="true" size={16} />}
              onClick={() => props.onAddRuntimeElement?.("description")}
              type="button"
              variant="secondary"
            >
              질문 설명
            </OrbitButton>
            <OrbitButton
              icon={<IconQrcode aria-hidden="true" size={16} />}
              onClick={() => props.onAddRuntimeElement?.("qr")}
              type="button"
              variant="secondary"
            >
              QR
            </OrbitButton>
            <OrbitButton
              icon={<IconKey aria-hidden="true" size={16} />}
              onClick={() => props.onAddRuntimeElement?.("passcode")}
              type="button"
              variant="secondary"
            >
              입장 코드
            </OrbitButton>
          </div>
        </div>
      ) : null}

      <OrbitDialog
        description="질문과 응답 데이터는 그대로 유지되지만 현재 캔버스 요소는 새 디자인으로 교체됩니다."
        footer={
          <>
            <OrbitButton
              onClick={() => setPendingPreset(null)}
              type="button"
              variant="secondary"
            >
              취소
            </OrbitButton>
            <OrbitButton
              onClick={() => {
                if (pendingPreset) props.onApplyPreset?.(pendingPreset);
                setPendingPreset(null);
              }}
              type="button"
            >
              디자인 교체
            </OrbitButton>
          </>
        }
        onClose={() => setPendingPreset(null)}
        open={pendingPreset !== null}
        title="현재 디자인을 교체할까요?"
      >
        <p>이 작업은 에디터의 실행 취소로 되돌릴 수 있습니다.</p>
      </OrbitDialog>
    </section>
  );
}
