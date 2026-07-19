import {
  IconChevronDown,
  IconEdit,
  IconLink,
  IconMicrophone,
  IconPlayerPlay,
} from "@tabler/icons-react";

import { DropdownMenu, DropdownMenuItem } from "../../../../components/ui";
import { EditorIconButton } from "./EditorIconButton";

type PresentationMenuProps = {
  activeStartAction?: "presentation" | "rehearsal" | null;
  canOpenAudienceLink: boolean;
  canStartPresentation: boolean;
  isSlideRehearsalActive?: boolean;
  isOpen: boolean;
  onOpenAudienceLink: () => void;
  onStartFullRehearsal: () => void;
  onStartPresentation: () => void;
  onStartRehearsal: () => void;
  onToggle: () => void;
};

export function PresentationMenu(props: PresentationMenuProps) {
  const {
    activeStartAction = null,
    canOpenAudienceLink,
    canStartPresentation,
    isSlideRehearsalActive = false,
    isOpen,
    onOpenAudienceLink,
    onStartFullRehearsal,
    onStartPresentation,
    onStartRehearsal,
    onToggle,
  } = props;
  const isPresentationMenuDisabled =
    isSlideRehearsalActive || (!canStartPresentation && !canOpenAudienceLink);

  return (
    <>
      <EditorIconButton
        aria-pressed={isSlideRehearsalActive}
        className={`editor-rehearsal-button ${isSlideRehearsalActive ? "active" : ""}`}
        disabled={!canStartPresentation && !isSlideRehearsalActive}
        icon={
          isSlideRehearsalActive ? (
            <IconEdit size={16} />
          ) : (
            <IconMicrophone size={16} />
          )
        }
        label={
          isSlideRehearsalActive
            ? "에디터로 돌아가기"
            : activeStartAction === "rehearsal"
              ? "리허설 준비 중"
              : "슬라이드 한 장 리허설"
        }
        title={
          isSlideRehearsalActive ? "에디터로 돌아가기" : "슬라이드 한 장 리허설"
        }
        onClick={onStartRehearsal}
      />
      <div className="top-action-menu">
        <div
          className={`editor-presentation-split ${isOpen ? "active" : ""} ${isSlideRehearsalActive ? "rehearsal-disabled" : ""}`}
        >
          <button
            aria-expanded={isOpen}
            aria-haspopup="menu"
            className="editor-present-button"
            disabled={isPresentationMenuDisabled}
            type="button"
            onClick={onToggle}
          >
            <IconPlayerPlay aria-hidden="true" size={16} />
            {activeStartAction === "presentation" ? "준비 중" : "발표하기"}
          </button>
          <button
            aria-expanded={isOpen}
            aria-haspopup="menu"
            aria-label="발표 메뉴 열기"
            className="editor-present-menu-button"
            disabled={isPresentationMenuDisabled}
            type="button"
            onClick={onToggle}
          >
            <IconChevronDown aria-hidden="true" size={14} />
          </button>
        </div>
        {isOpen && !isSlideRehearsalActive ? (
          <DropdownMenu
            align="end"
            className="editor-presentation-menu"
            data-editor-keyboard-scope="popup-menu"
            variant="black"
          >
            <DropdownMenuItem
              aria-label="발표 시작"
              disabled={!canStartPresentation}
              icon={<IconPlayerPlay size={16} />}
              onClick={onStartPresentation}
            >
              발표 시작
            </DropdownMenuItem>
            <DropdownMenuItem
              aria-label="전체 리허설"
              disabled={!canStartPresentation}
              icon={<IconMicrophone size={16} />}
              onClick={onStartFullRehearsal}
            >
              전체 리허설
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<IconLink size={16} />}
              disabled={!canOpenAudienceLink}
              onClick={onOpenAudienceLink}
            >
              <span className="editor-presentation-menu-label">
                <span>청중 링크·QR</span>
                <small>QR 코드 발급</small>
              </span>
            </DropdownMenuItem>
          </DropdownMenu>
        ) : null}
      </div>
    </>
  );
}
