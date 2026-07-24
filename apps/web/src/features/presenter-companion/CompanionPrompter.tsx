import type {
  PresentationCompanionNavigationCommand,
  PresentationCompanionOutputState,
  PresentationCompanionPrompterState,
} from "@orbit/shared";
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconNotes,
} from "@tabler/icons-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export const companionPrompterExpandedStorageKey =
  "orbit.companion.prompter.expanded.v1";

export function CompanionPrompter(props: {
  canControl: boolean;
  canViewPrompter: boolean;
  connected: boolean;
  navigationError: string;
  navigationPending: PresentationCompanionNavigationCommand | null;
  output: PresentationCompanionOutputState | null;
  prompter: PresentationCompanionPrompterState | null;
  sendNavigation: (
    action: PresentationCompanionNavigationCommand["action"],
  ) => boolean;
}) {
  const [expanded, setExpanded] = useState(
    readCompanionPrompterExpanded,
  );
  const [followPaused, setFollowPaused] = useState(false);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const prompter =
    props.prompter &&
    props.output &&
    props.prompter.authorityEpochId ===
      props.output.authorityEpochId &&
    props.prompter.slideId === props.output.slideId
      ? props.prompter
      : null;
  const currentRow = useMemo(
    () =>
      prompter?.rows.find(
        (row) => row.sentenceId === prompter.focusSentenceId,
      ) ??
      prompter?.rows.find((row) => row.status === "current") ??
      prompter?.rows[0] ??
      null,
    [prompter],
  );
  const hasReadyPrompter =
    props.canViewPrompter &&
    prompter?.availability === "ready";
  const navigationDisabled =
    !props.canControl ||
    !props.connected ||
    Boolean(props.navigationPending);

  useEffect(() => {
    if (typeof window === "undefined") return;
    persistCompanionPrompterExpanded(expanded);
  }, [expanded]);

  useEffect(() => {
    if (
      !expanded ||
      followPaused ||
      !prompter?.focusSentenceId
    ) {
      return;
    }
    rowRefs.current
      .get(prompter.focusSentenceId)
      ?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
  }, [
    expanded,
    followPaused,
    prompter?.focusSentenceId,
    prompter?.prompterRevision,
  ]);

  const resumeFollow = () => {
    setFollowPaused(false);
    if (prompter?.focusSentenceId) {
      rowRefs.current
        .get(prompter.focusSentenceId)
        ?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
    }
  };

  return (
    <aside
      aria-label="iPad 대본 프롬프터와 발표 제어"
      className="presenter-companion-prompter"
      data-expanded={expanded}
    >
      {expanded ? (
        <section className="presenter-companion-prompter-drawer">
          <header className="presenter-companion-prompter-header">
            <div>
              <span className="presenter-companion-prompter-kicker">
                <IconNotes aria-hidden="true" size={18} stroke={1.8} />
                현재 슬라이드 대본
              </span>
              <strong>
                슬라이드 {(prompter?.slideIndex ?? 0) + 1}
              </strong>
            </div>
            <span
              className="presenter-companion-prompter-progress"
              data-tracking={prompter?.trackingStatus ?? "waiting"}
            >
              {getTrackingLabel(prompter?.trackingStatus)}
              <b>{prompter?.progressPercent ?? 0}%</b>
            </span>
            <button
              aria-label="대본 프롬프터 접기"
              className="presenter-companion-prompter-collapse"
              onClick={() => setExpanded(false)}
              type="button"
            >
              <IconChevronDown aria-hidden="true" size={22} />
            </button>
          </header>
          <div
            className="presenter-companion-prompter-scroll"
            onPointerDown={() => setFollowPaused(true)}
            onTouchMove={() => setFollowPaused(true)}
            onWheel={() => setFollowPaused(true)}
          >
            {hasReadyPrompter ? (
              <ol className="presenter-companion-prompter-rows">
                {(prompter?.rows ?? []).map((row) => (
                  <li
                    aria-current={
                      row.sentenceId ===
                      prompter?.focusSentenceId
                        ? "true"
                        : undefined
                    }
                    data-status={row.status}
                    key={row.sentenceId}
                    ref={(element) => {
                      if (element) {
                        rowRefs.current.set(row.sentenceId, element);
                      } else {
                        rowRefs.current.delete(row.sentenceId);
                      }
                    }}
                  >
                    {row.text}
                  </li>
                ))}
              </ol>
            ) : (
              <PrompterUnavailable
                availability={prompter?.availability}
                canView={props.canViewPrompter}
              />
            )}
          </div>
          {followPaused && hasReadyPrompter ? (
            <button
              className="presenter-companion-prompter-resume"
              onClick={resumeFollow}
              type="button"
            >
              현재 대본으로
            </button>
          ) : null}
        </section>
      ) : null}

      <nav
        aria-label="iPad 발표 이동"
        className="presenter-companion-presenter-rail"
      >
        <button
          aria-label="이전 슬라이드"
          className="presenter-companion-navigation-button"
          disabled={navigationDisabled || !props.output?.canGoPrevious}
          onClick={() => props.sendNavigation("previous-slide")}
          type="button"
        >
          <IconChevronLeft aria-hidden="true" size={26} stroke={2} />
          <span>이전</span>
        </button>
        <button
          aria-expanded={expanded}
          aria-label={
            expanded ? "대본 프롬프터 접기" : "대본 프롬프터 펼치기"
          }
          className="presenter-companion-prompter-preview"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          <span>
            <small>
              슬라이드 {(props.output?.slideIndex ?? 0) + 1}
            </small>
            <strong>
              {getPrompterPreview({
                canView: props.canViewPrompter,
                currentText: currentRow?.text,
                availability: prompter?.availability,
              })}
            </strong>
          </span>
          {expanded ? (
            <IconChevronDown aria-hidden="true" size={22} />
          ) : (
            <IconChevronUp aria-hidden="true" size={22} />
          )}
        </button>
        <button
          aria-label="다음 애니메이션 또는 슬라이드"
          className="presenter-companion-navigation-button"
          disabled={navigationDisabled || !props.output?.canGoNext}
          onClick={() => props.sendNavigation("next-step")}
          type="button"
        >
          <span>다음</span>
          <IconChevronRight aria-hidden="true" size={26} stroke={2} />
        </button>
      </nav>
      <p
        aria-live="polite"
        className="presenter-companion-navigation-message"
      >
        {props.navigationError}
      </p>
    </aside>
  );
}

function PrompterUnavailable(props: {
  availability?: PresentationCompanionPrompterState["availability"];
  canView: boolean;
}) {
  let message = "발표자 화면에서 대본을 기다리고 있습니다.";
  if (!props.canView) {
    message = "이 연결에서는 대본을 볼 수 없습니다.";
  } else if (props.availability === "empty") {
    message = "현재 슬라이드에 발표자 대본이 없습니다.";
  } else if (props.availability === "too-large") {
    message = "현재 대본이 너무 길어 iPad에 표시할 수 없습니다.";
  }
  return (
    <p className="presenter-companion-prompter-empty" role="status">
      {message}
    </p>
  );
}

function getTrackingLabel(
  status?: PresentationCompanionPrompterState["trackingStatus"],
): string {
  if (status === "listening") return "음성 따라가기";
  if (status === "paused") return "따라가기 일시 정지";
  if (status === "error") return "음성 인식 확인 필요";
  return "대기 중";
}

function getPrompterPreview(input: {
  availability?: PresentationCompanionPrompterState["availability"];
  canView: boolean;
  currentText?: string;
}): string {
  if (!input.canView) return "대본 보기 권한 없음";
  if (input.currentText) return input.currentText;
  if (input.availability === "empty") return "현재 슬라이드 대본 없음";
  if (input.availability === "too-large") return "대본을 표시할 수 없음";
  return "대본 동기화 대기 중";
}

export function readCompanionPrompterExpanded(
  storage?: Pick<Storage, "getItem">,
): boolean {
  const resolvedStorage =
    storage ??
    (typeof window === "undefined" ? null : window.localStorage);
  try {
    return (
      resolvedStorage?.getItem(companionPrompterExpandedStorageKey) ===
      "true"
    );
  } catch {
    return false;
  }
}

export function persistCompanionPrompterExpanded(
  expanded: boolean,
  storage?: Pick<Storage, "setItem">,
) {
  const resolvedStorage =
    storage ??
    (typeof window === "undefined" ? null : window.localStorage);
  try {
    resolvedStorage?.setItem(
      companionPrompterExpandedStorageKey,
      expanded ? "true" : "false",
    );
  } catch {
    // 발표 제어는 저장소 사용 가능 여부와 무관하게 계속 동작한다.
  }
}
