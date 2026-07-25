import {
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import "../../styles/tokens.css";
import "./dropdown-menu.css";

type DropdownMenuProps = ComponentPropsWithoutRef<"div"> & {
  align?: "start" | "end";
  variant?: "black" | "white";
};

type DropdownMenuItemProps = ComponentPropsWithoutRef<"button"> & {
  icon?: ReactNode;
};

type DropdownMenuAccountProps = Omit<ComponentPropsWithoutRef<"div">, "children"> & {
  initial: string;
  label: string;
};

type DropdownMenuSubmenuProps = {
  children: ReactNode;
  disabled?: boolean;
  label: ReactNode;
};

export function DropdownMenu({
  align = "end",
  children,
  className = "",
  role = "menu",
  variant = "white",
  ...menuProps
}: DropdownMenuProps) {
  return (
    <div
      className={`redesign-dropdown-menu redesign-dropdown-menu-${variant} redesign-dropdown-menu-${align} ${className}`.trim()}
      role={role}
      {...menuProps}
    >
      {children}
    </div>
  );
}

export function DropdownMenuAccount({
  className = "",
  initial,
  label,
  role = "presentation",
  ...accountProps
}: DropdownMenuAccountProps) {
  return (
    <div
      className={`redesign-dropdown-menu-account ${className}`.trim()}
      role={role}
      {...accountProps}
    >
      <span aria-hidden="true" className="redesign-dropdown-menu-account-avatar">
        {initial}
      </span>
      <strong>{label}</strong>
    </div>
  );
}

export function DropdownMenuItem({
  children,
  className = "",
  icon,
  role = "menuitem",
  type = "button",
  ...buttonProps
}: DropdownMenuItemProps) {
  return (
    <button
      className={`redesign-dropdown-menu-item ${className}`.trim()}
      role={role}
      type={type}
      {...buttonProps}
    >
      {icon ? (
        <span aria-hidden="true" className="redesign-dropdown-menu-item-icon">
          {icon}
        </span>
      ) : null}
      <span className="redesign-dropdown-menu-item-label">{children}</span>
    </button>
  );
}

export function DropdownMenuGroup({
  className = "",
  role = "group",
  ...groupProps
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={`redesign-dropdown-menu-group ${className}`.trim()}
      role={role}
      {...groupProps}
    />
  );
}

export function DropdownMenuSeparator({
  className = "",
  role = "separator",
  ...separatorProps
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={`redesign-dropdown-menu-separator ${className}`.trim()}
      role={role}
      {...separatorProps}
    />
  );
}

export function DropdownMenuSubmenu({
  children,
  disabled = false,
  label,
}: DropdownMenuSubmenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="redesign-dropdown-submenu"
      onMouseEnter={() => !disabled && setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <DropdownMenuItem
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" && !disabled) {
            event.preventDefault();
            setOpen(true);
            requestAnimationFrame(() =>
              event.currentTarget.parentElement
                ?.querySelector<HTMLButtonElement>(
                  '.redesign-dropdown-submenu-content [role="menuitem"]:not(:disabled)',
                )
                ?.focus(),
            );
          }
          if (event.key === "ArrowLeft") setOpen(false);
        }}
      >
        {label}
        <span aria-hidden="true" className="redesign-dropdown-submenu-arrow">›</span>
      </DropdownMenuItem>
      {open ? (
        <div className="redesign-dropdown-submenu-content" role="menu">
          {children}
        </div>
      ) : null}
    </div>
  );
}
