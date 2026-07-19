import { DropdownMenu, DropdownMenuItem } from "../../../../components/ui";

export type EditorFileMenuVariant = "dark" | "soft-gray" | "white";

export type EditorFileMenuItem = {
  disabled?: boolean;
  id: string;
  label: string;
  meta?: string;
  onSelect: () => void;
};

type EditorFileMenuProps = {
  align?: "start" | "end";
  groups: Array<{
    items: EditorFileMenuItem[];
    label?: string;
  }>;
  subtitle: string;
  title: string;
  variant?: EditorFileMenuVariant;
};

export function EditorFileMenu(props: EditorFileMenuProps) {
  const variant = props.variant ?? "white";
  const dropdownVariant = variant === "white" ? "white" : "black";

  return (
    <DropdownMenu
      align={props.align ?? "start"}
      className={`editor-file-menu editor-file-menu--${variant}`}
      data-editor-keyboard-scope="popup-menu"
      data-variant={variant}
      variant={dropdownVariant}
    >
      <div className="editor-file-menu-context">
        <span>{props.subtitle}</span>
      </div>
      {props.groups.map((group, groupIndex) => (
        <section
          className="editor-file-menu-group"
          key={`${group.label ?? "menu"}-${groupIndex}`}
        >
          {group.label ? (
            <span className="editor-file-menu-group-label">{group.label}</span>
          ) : null}
          {group.items.map((item) => (
            <DropdownMenuItem
              className="editor-file-menu-item"
              disabled={item.disabled}
              key={item.id}
              onClick={item.onSelect}
            >
              <span className="editor-file-menu-item-label">{item.label}</span>
              {item.meta ? <small>{item.meta}</small> : null}
            </DropdownMenuItem>
          ))}
        </section>
      ))}
    </DropdownMenu>
  );
}
