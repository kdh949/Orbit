import type { CommunityTemplateCategory } from "@orbit/shared/community-templates";
import { useQuery } from "@tanstack/react-query";
import { IconCheck, IconChevronDown, IconSearch } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { DropdownMenu, DropdownMenuItem } from "../../components/ui";
import {
  communityTemplateKeys,
  fetchCommunityCategories,
} from "./communityTemplateApi";
import "./community-template-gallery.css";

type CategoryValue = CommunityTemplateCategory | "";

export function CommunityTemplateCategoryDropdown(props: {
  disabled?: boolean;
  id: string;
  includeAllOption?: boolean;
  invalid?: boolean;
  onChange: (value: CategoryValue) => void;
  value: CategoryValue;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const categories = useQuery({
    queryKey: communityTemplateKeys.categories,
    queryFn: () => fetchCommunityCategories(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const options = useMemo(
    () =>
      [
        ...(props.includeAllOption
          ? [{ categoryId: "" as const, name: "전체" }]
          : []),
        ...(categories.data?.items ?? []),
      ].filter((option) =>
        option.name.toLocaleLowerCase("ko-KR").includes(
          query.trim().toLocaleLowerCase("ko-KR"),
        ),
      ),
    [categories.data, props.includeAllOption, query],
  );
  const selected = options.find(
    (option) => option.categoryId === props.value,
  );

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="community-template-category-dropdown" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-invalid={props.invalid || undefined}
        className="community-template-category-trigger"
        disabled={props.disabled || categories.isError}
        id={props.id}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className={selected ? "" : "is-placeholder"}>
          {selected?.name ??
            (categories.isLoading
              ? "대표 주제 불러오는 중"
              : "대표 주제를 선택해 주세요")}
        </span>
        <IconChevronDown aria-hidden="true" size={18} />
      </button>
      {open ? (
        <DropdownMenu
          align="start"
          aria-label="대표 주제 선택"
          className="community-template-category-menu"
          role="listbox"
          variant="white"
        >
          <label className="community-template-category-search">
            <IconSearch aria-hidden="true" size={16} />
            <input
              autoFocus
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="대표 주제 검색"
              value={query}
            />
          </label>
          {options.map((option) => {
            const active = option.categoryId === props.value;
            return (
              <DropdownMenuItem
                aria-selected={active}
                className={active ? "is-selected" : ""}
                icon={active ? <IconCheck size={16} /> : undefined}
                key={option.categoryId}
                onClick={() => {
                  props.onChange(option.categoryId);
                  setOpen(false);
                  setQuery("");
                }}
                role="option"
              >
                {option.name}
              </DropdownMenuItem>
            );
          })}
          {!options.length ? (
            <p className="community-template-category-empty">
              일치하는 대표 주제가 없습니다.
            </p>
          ) : null}
        </DropdownMenu>
      ) : null}
    </div>
  );
}
