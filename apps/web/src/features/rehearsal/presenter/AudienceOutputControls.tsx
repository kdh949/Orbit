import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronUp,
  IconDeviceDesktopShare,
  IconEyeOff,
  IconPresentationOff,
  IconScreenShare,
  IconX,
} from "@tabler/icons-react";
import { useId, useState } from "react";
import type { AudienceOutputMode } from "./presenterStateStore";
import type { AudienceScreenShareStatus } from "./useAudienceScreenShare";

export function AudienceOutputControls(props: {
  collapsible?: boolean;
  connected: boolean;
  error: string;
  onEndPresentation?: () => void;
  onReturnToSlide: () => void;
  onShowBlack: () => void;
  onStartMonitor: () => Promise<boolean>;
  onStartTabOrWindow: () => Promise<boolean>;
  outputMode: AudienceOutputMode;
  status: AudienceScreenShareStatus;
}) {
  const [isAdvancedOpen, setAdvancedOpen] = useState(false);
  const [isPanelOpen, setPanelOpen] = useState(!props.collapsible);
  const panelId = useId();
  const isAwayFromSlide = props.outputMode !== "slide";
  const controlsDisabled = !props.connected || props.status === "selecting";

  return (
    <section
      aria-label="청중 화면 전환"
      className={`audience-output-controls${props.collapsible ? " audience-output-controls--collapsible" : ""}`}
    >
      {props.collapsible ? (
        <button
          aria-controls={panelId}
          aria-expanded={isPanelOpen}
          aria-label={isPanelOpen ? "발표자 도구 접기" : "발표자 도구 펼치기"}
          className="audience-output-controls-toggle"
          type="button"
          onClick={() => setPanelOpen((current) => !current)}
        >
          {isPanelOpen ? (
            <IconChevronUp aria-hidden="true" size={24} />
          ) : (
            <IconChevronDown aria-hidden="true" size={24} />
          )}
        </button>
      ) : null}

      <div
        className="audience-output-controls-panel"
        hidden={props.collapsible && !isPanelOpen}
        id={panelId}
      >
        <div className="audience-output-controls-row">
          {isAwayFromSlide ? (
            <button type="button" onClick={props.onReturnToSlide}>
              <IconX aria-hidden="true" size={18} />
              슬라이드로 돌아가기
            </button>
          ) : (
            <button
              className="audience-output-share-primary"
              disabled={controlsDisabled}
              type="button"
              onClick={() => void props.onStartTabOrWindow()}
            >
              <IconDeviceDesktopShare aria-hidden="true" size={18} />
              애플리케이션 공유하기
            </button>
          )}
          {props.collapsible ? (
            <button
              className="audience-output-share-primary"
              disabled={controlsDisabled}
              type="button"
              onClick={() => void props.onStartMonitor()}
            >
              <IconScreenShare aria-hidden="true" size={18} />
              전체 화면 공유하기
            </button>
          ) : null}
          <button
            disabled={controlsDisabled}
            type="button"
            onClick={props.onShowBlack}
          >
            <IconEyeOff aria-hidden="true" size={18} />
            청중 화면 가리기
          </button>
          {props.collapsible && props.onEndPresentation ? (
            <button
              className="audience-output-end-presentation"
              type="button"
              onClick={props.onEndPresentation}
            >
              <IconPresentationOff aria-hidden="true" size={18} />
              발표 종료
            </button>
          ) : null}
          {!props.collapsible ? (
            <button
              aria-expanded={isAdvancedOpen}
              disabled={controlsDisabled}
              type="button"
              onClick={() => setAdvancedOpen((current) => !current)}
            >
              고급 옵션
            </button>
          ) : null}
        </div>

        {isAdvancedOpen ? (
          <div className="audience-output-advanced">
            <button
              disabled={controlsDisabled}
              type="button"
              onClick={() => void props.onStartMonitor()}
            >
              전체 화면 공유
            </button>
            <small>전체 모니터 공유는 개인정보가 노출될 수 있습니다.</small>
          </div>
        ) : null}

        <p aria-live="polite" className="audience-output-control-status">
          <IconAlertTriangle aria-hidden="true" size={18} />
          <span>{getAudienceOutputStatus(props)}</span>
        </p>
      </div>

    </section>
  );
}

function getAudienceOutputStatus(props: {
  connected: boolean;
  error: string;
  outputMode: AudienceOutputMode;
  status: AudienceScreenShareStatus;
}) {
  if (props.error) return props.error;
  if (!props.connected) return "청중 화면을 먼저 연결해주세요.";
  if (props.status === "selecting") return "공유할 앱 또는 창을 선택해주세요.";
  if (props.outputMode === "screen-share") return "애플리케이션 화면 공유 중";
  if (props.outputMode === "black") return "청중 화면을 가렸습니다.";
  return "청중 화면에 현재 슬라이드를 표시합니다.";
}
