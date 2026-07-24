import type { Deck, Slide } from "@orbit/shared";
import {
  IconArrowUpRight,
  IconPresentation,
  IconQrcode
} from "@tabler/icons-react";

import { OrbitButton, OrbitDialog } from "../../../components/ui";

export function ActivityQrInsertDialog(props: {
  deck: Deck;
  onClose: () => void;
  onInsert: (activityId: string) => void;
  open: boolean;
  targetSlide: Slide | null;
}) {
  if (!props.open) return null;

  const activities = props.deck.slides.filter(
    (slide): slide is Extract<Slide, { kind: "activity" }> => slide.kind === "activity"
  );

  return (
    <OrbitDialog
      className="activity-qr-insert-dialog redesign-dark"
      description="삽입할 참여 장표를 고르면 현재 장표에 연결된 QR이 표시됩니다."
      footer={(
        <OrbitButton onClick={props.onClose} variant="secondary">닫기</OrbitButton>
      )}
      onClose={props.onClose}
      open
      title="참여 QR 코드 추가"
    >
      <section className="activity-qr-insert-summary">
        <span className="activity-qr-insert-summary-icon">
          <IconQrcode aria-hidden="true" size={24} stroke={2.2} />
        </span>
        <div>
          <span>LIVE PARTICIPATION</span>
          <strong>특수 장표와 같은 참여 링크를 사용해요</strong>
          <p>발표를 준비하면 최신 세션 QR이 자동으로 표시됩니다.</p>
        </div>
      </section>
      {props.targetSlide ? (
        <p className="activity-qr-insert-target">
          <IconPresentation aria-hidden="true" size={16} />
          <span>추가 위치</span>
          <strong>{props.targetSlide.title || "제목 없는 장표"}</strong>
        </p>
      ) : null}
      {activities.length > 0 ? (
        <section aria-label="QR로 연결할 참여 장표" className="activity-qr-insert-options">
          <div className="activity-qr-insert-options-heading">
            <div>
              <span>연결할 참여 장표</span>
              <strong>QR을 넣을 대상을 선택하세요</strong>
            </div>
            <b>{activities.length}</b>
          </div>
          {activities.map((slide, index) => (
            <button
              aria-label={`${slide.activity.title} 참여 QR 코드 추가`}
              data-orbit-dialog-initial={index === 0 || undefined}
              key={slide.slideId}
              type="button"
              onClick={() => props.onInsert(slide.activity.activityId)}
            >
              <span className="activity-qr-insert-option-icon">
                <IconQrcode aria-hidden="true" size={22} stroke={2.2} />
              </span>
              <span className="activity-qr-insert-option-copy">
                <em>{activityTemplateLabel(slide.activity.template)}</em>
                <strong>{slide.activity.title}</strong>
                <small>{slide.title || "특수 장표"}</small>
              </span>
              <span className="activity-qr-insert-option-action">
                추가 <IconArrowUpRight aria-hidden="true" size={16} stroke={2.4} />
              </span>
            </button>
          ))}
        </section>
      ) : (
        <p className="activity-qr-insert-empty" role="status">
          <IconQrcode aria-hidden="true" size={22} />
          <span>먼저 참여 장표를 만든 뒤 해당 QR을 일반 장표에 추가할 수 있어요.</span>
        </p>
      )}
    </OrbitDialog>
  );
}

function activityTemplateLabel(template: Extract<Slide, { kind: "activity" }>["activity"]["template"]) {
  if (template === "pre-question") return "사전 질문";
  if (template === "poll") return "실시간 투표";
  return "만족도 조사";
}
