import type { Deck } from "@orbit/shared";
import { useEffect, useMemo, useState } from "react";

import { OrbitButton, OrbitDialog } from "../../../../components/ui";
import {
  createTargetDurationDraft,
  distributeTargetDuration,
  formatTargetDuration,
  type SlideTargetDuration,
} from "../targetDurationModel";

export function TargetDurationDialog(props: {
  deck: Deck;
  onClose: () => void;
  onSave: (input: {
    durations: SlideTargetDuration[];
    targetDurationMinutes: number;
  }) => boolean;
  open: boolean;
}) {
  const [targetDurationMinutes, setTargetDurationMinutes] = useState(
    props.deck.targetDurationMinutes,
  );
  const [durations, setDurations] = useState<SlideTargetDuration[]>(() =>
    createTargetDurationDraft(props.deck),
  );

  useEffect(() => {
    if (!props.open) return;
    setTargetDurationMinutes(props.deck.targetDurationMinutes);
    setDurations(createTargetDurationDraft(props.deck));
  }, [props.deck, props.open]);

  const allocatedSeconds = useMemo(
    () =>
      durations.reduce((sum, duration) => sum + duration.estimatedSeconds, 0),
    [durations],
  );
  const targetSeconds = targetDurationMinutes * 60;
  const differenceSeconds = targetSeconds - allocatedSeconds;
  const hasInvalidDuration = durations.some(
    (duration) =>
      !Number.isInteger(duration.estimatedSeconds) ||
      duration.estimatedSeconds < 1,
  );
  const isTargetValid =
    Number.isInteger(targetDurationMinutes) &&
    targetDurationMinutes >= 1 &&
    targetDurationMinutes <= 120;
  const canSave =
    isTargetValid && !hasInvalidDuration && differenceSeconds === 0;

  function updateSlideDuration(
    slideId: string,
    part: "minutes" | "seconds",
    value: number,
  ) {
    setDurations((current) =>
      current.map((duration) => {
        if (duration.slideId !== slideId) return duration;
        const minutes = Math.floor(duration.estimatedSeconds / 60);
        const seconds = duration.estimatedSeconds % 60;
        return {
          ...duration,
          estimatedSeconds:
            part === "minutes"
              ? Math.max(0, Math.round(value)) * 60 + seconds
              : minutes * 60 + Math.min(59, Math.max(0, Math.round(value))),
        };
      }),
    );
  }

  function updateSlideTitle(slideId: string, title: string) {
    setDurations((current) =>
      current.map((duration) =>
        duration.slideId === slideId ? { ...duration, title } : duration,
      ),
    );
  }

  function handleSave() {
    if (!canSave) return;
    if (props.onSave({ durations, targetDurationMinutes })) props.onClose();
  }

  return (
    <OrbitDialog
      className="target-duration-dialog"
      description="전체 발표 시간을 정하고 슬라이드별 시간과 제목을 함께 조정합니다."
      footer={
        <>
          <OrbitButton onClick={props.onClose} variant="secondary">
            취소
          </OrbitButton>
          <OrbitButton disabled={!canSave} onClick={handleSave}>
            저장
          </OrbitButton>
        </>
      }
      onClose={props.onClose}
      open={props.open}
      title="발표 시간 배분"
    >
      <section className="target-duration-total">
        <div>
          <strong>전체 발표 시간</strong>
          <span>1분에서 120분까지 설정할 수 있습니다.</span>
        </div>
        <label>
          <input
            aria-label="전체 발표 시간"
            max={120}
            min={1}
            onChange={(event) =>
              setTargetDurationMinutes(Number(event.currentTarget.value))
            }
            type="number"
            value={targetDurationMinutes}
          />
          <span>분</span>
        </label>
      </section>

      <div className="target-duration-allocation-heading">
        <div>
          <strong>슬라이드별 시간</strong>
          <span>{durations.length}개 슬라이드</span>
        </div>
        <OrbitButton
          disabled={!isTargetValid}
          onClick={() =>
            setDurations(
              distributeTargetDuration(
                targetDurationMinutes,
                durations,
              ),
            )
          }
          size="compact"
          variant="secondary"
        >
          균등 배분
        </OrbitButton>
      </div>

      <div className="target-duration-slide-list">
        {durations.map((duration, index) => (
          <div className="target-duration-slide-row" key={duration.slideId}>
            <span className="target-duration-slide-index">{index + 1}</span>
            <div className="target-duration-slide-title">
              <input
                aria-label={`${index + 1}번 슬라이드 제목`}
                className="target-duration-slide-name-input"
                onChange={(event) =>
                  updateSlideTitle(duration.slideId, event.currentTarget.value)
                }
                placeholder={`슬라이드 ${index + 1}`}
                type="text"
                value={duration.title}
              />
              <span>{formatTargetDuration(duration.estimatedSeconds)}</span>
            </div>
            <label>
              <input
                aria-label={`${index + 1}번 슬라이드 발표 시간 분`}
                min={0}
                onChange={(event) =>
                  updateSlideDuration(
                    duration.slideId,
                    "minutes",
                    Number(event.currentTarget.value),
                  )
                }
                type="number"
                value={Math.floor(duration.estimatedSeconds / 60)}
              />
              <span>분</span>
            </label>
            <label>
              <input
                aria-label={`${index + 1}번 슬라이드 발표 시간 초`}
                max={59}
                min={0}
                onChange={(event) =>
                  updateSlideDuration(
                    duration.slideId,
                    "seconds",
                    Number(event.currentTarget.value),
                  )
                }
                type="number"
                value={duration.estimatedSeconds % 60}
              />
              <span>초</span>
            </label>
          </div>
        ))}
      </div>

      <div
        className={`target-duration-summary ${differenceSeconds === 0 ? "is-balanced" : "is-unbalanced"}`}
      >
        <span>
          배분 합계 <strong>{formatTargetDuration(allocatedSeconds)}</strong>
        </span>
        <span>
          전체 시간 <strong>{formatTargetDuration(targetSeconds)}</strong>
        </span>
        <b>
          {differenceSeconds === 0
            ? "배분 완료"
            : differenceSeconds > 0
              ? `${formatTargetDuration(differenceSeconds)} 남음`
              : `${formatTargetDuration(Math.abs(differenceSeconds))} 초과`}
        </b>
      </div>
    </OrbitDialog>
  );
}
