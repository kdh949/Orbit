import type { SlidePracticeReportRecord } from "@orbit/shared/slide-practice";
import { useState } from "react";

import greatStampUrl from "../../../assets/orbit-great-stamp.webp";
import thumbsUpMascotBlinkUrl from "../../../assets/orbit-mascot-thumbs-up-blink.webp";
import thumbsUpMascotUrl from "../../../assets/orbit-mascot-thumbs-up.webp";
import { practiceCelebrationOutcome } from "./practiceCelebration";

export function PracticeCelebrationFeedback(props: {
  animate: boolean;
  report: SlidePracticeReportRecord;
}) {
  const [reactionNonce, setReactionNonce] = useState(0);
  const outcome = practiceCelebrationOutcome(props.report);
  const reactionMessage = reactionNonce === 0
    ? ""
    : reactionNonce % 2 === 1
      ? "ORBIT 마스코트가 함께 기뻐해요"
      : "ORBIT 마스코트가 다시 힘차게 반응했어요";
  if (!outcome.noFiller) return null;
  return (
    <aside
      aria-label="습관어 사용 없음"
      className={`editor-practice-celebration${props.animate ? " is-new" : ""}`}
      data-great={outcome.great || undefined}
    >
      <span className="editor-practice-celebration-kicker">오늘의 좋은 변화</span>
      <strong aria-live="polite">오늘은 ‘음…’ 같은 습관어가 없었어요</strong>
      <div className="editor-practice-celebration-assets">
        <button
          aria-label="ORBIT 마스코트와 함께 기뻐하기"
          className="editor-practice-celebration-mascot-button"
          onClick={() => setReactionNonce((current) => current + 1)}
          type="button"
        >
          <div
            className={`editor-practice-celebration-mascot-flight${reactionNonce > 0 ? " is-reacting" : ""}`}
            key={reactionNonce}
          >
            <span className="editor-practice-celebration-mascot-stage">
              <span className="editor-practice-celebration-mascot-character">
                <img
                  alt=""
                  className="editor-practice-celebration-mascot is-open"
                  src={thumbsUpMascotUrl}
                />
                <img
                  alt=""
                  className="editor-practice-celebration-mascot is-blinking"
                  src={thumbsUpMascotBlinkUrl}
                />
              </span>
            </span>
          </div>
        </button>
        <span aria-live="polite" className="editor-practice-visually-hidden">
          {reactionMessage}
        </span>
        {outcome.great ? (
          <img alt="" className="editor-practice-celebration-stamp" src={greatStampUrl} />
        ) : null}
      </div>
      {outcome.great ? <span className="editor-practice-great-copy">참 잘했어요 · GREAT</span> : null}
    </aside>
  );
}
