import type { ProjectTagColor } from "@orbit/shared/projects";
import { IconCheck } from "@tabler/icons-react";

type ProjectTagChipProps = {
  color: ProjectTagColor;
  name: string;
  onClick?: () => void;
  selected?: boolean;
  showSelectedIcon?: boolean;
};

export function ProjectTagChip(props: ProjectTagChipProps) {
  const className = `workspace-project-tag-chip is-${props.color}${props.selected ? " is-selected" : ""}`;
  const content = (
    <>
      <span>{props.name}</span>
      {props.showSelectedIcon && props.selected ? <IconCheck aria-hidden="true" size={13} /> : null}
    </>
  );

  return props.onClick ? (
    <button aria-pressed={props.selected} className={className} onClick={props.onClick} type="button">
      {content}
    </button>
  ) : (
    <span className={className}>{content}</span>
  );
}
