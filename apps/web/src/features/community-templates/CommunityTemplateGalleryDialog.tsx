import type {
  CommunityTemplateCard,
  CommunityTemplateCategory,
  CommunityTemplateListQuery,
} from "@orbit/shared/community-templates";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useReducer } from "react";

import {
  CommunityTemplateGalleryView,
  type CommunityTemplateGalleryViewProps,
} from "./CommunityTemplateGalleryView";
import {
  CommunityTemplateWebError,
  communityTemplateKeys,
  fetchCommunityTemplateList,
  fetchRecentCommunityTemplates,
} from "./communityTemplateApi";

export { CommunityTemplateGalleryView } from "./CommunityTemplateGalleryView";
export type { CommunityTemplateGalleryViewProps } from "./CommunityTemplateGalleryView";

export type CommunityTemplateGalleryFilters = {
  searchInput: string;
  query: string;
  category: CommunityTemplateCategory | undefined;
  page: number;
};

type FilterAction =
  | { type: "change-search-input"; searchInput: string }
  | { type: "commit-search"; query: string }
  | {
      type: "select-category";
      category: CommunityTemplateCategory | undefined;
    }
  | { type: "change-page"; page: number }
  | { type: "reset" };

const initialFilters: CommunityTemplateGalleryFilters = {
  searchInput: "",
  query: "",
  category: undefined,
  page: 1,
};

export function reduceCommunityTemplateGalleryFilters(
  state: CommunityTemplateGalleryFilters,
  action: FilterAction,
): CommunityTemplateGalleryFilters {
  if (action.type === "change-search-input") {
    return { ...state, searchInput: action.searchInput };
  }
  if (action.type === "commit-search") {
    return { ...state, query: action.query.trim(), page: 1 };
  }
  if (action.type === "select-category") {
    return { ...state, category: action.category, page: 1 };
  }
  if (action.type === "change-page") {
    return { ...state, page: Math.max(1, action.page) };
  }
  return initialFilters;
}

export function CommunityTemplateGalleryDialog(props: {
  applyingInstanceKey: string | null;
  applyError: string | null;
  onApply: (instanceKey: string, card: CommunityTemplateCard) => void;
  onClose: () => void;
  onOpenPublish: () => void;
  onRetryApply: () => void;
  open: boolean;
  publishReturnFocus?: boolean;
}) {
  const [filters, dispatch] = useReducer(
    reduceCommunityTemplateGalleryFilters,
    initialFilters,
  );
  const queryInput: CommunityTemplateListQuery = {
    query: filters.query || undefined,
    category: filters.category,
    page: filters.page,
    limit: 12,
  };
  const listQuery = useQuery({
    enabled: props.open,
    queryKey: communityTemplateKeys.list(queryInput),
    queryFn: () => fetchCommunityTemplateList(queryInput),
    retry: false,
    staleTime: 60_000,
  });
  const recentQuery = useQuery({
    enabled: props.open,
    queryKey: communityTemplateKeys.recent,
    queryFn: () => fetchRecentCommunityTemplates(),
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!props.open) return;
    const timeout = window.setTimeout(() => {
      dispatch({ type: "commit-search", query: filters.searchInput });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [filters.searchInput, props.open]);

  useEffect(() => {
    if (!props.open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [props.open]);

  const viewProps: CommunityTemplateGalleryViewProps = {
    applyingInstanceKey: props.applyingInstanceKey,
    applyError: props.applyError,
    category: filters.category,
    hasMore: listQuery.data?.hasMore ?? false,
    list: {
      items: listQuery.data?.items ?? [],
      loading: listQuery.isLoading,
      error: getGalleryError(
        listQuery.error,
        listQuery.isError ? "모든 템플릿을 불러오지 못했습니다." : null,
      ),
    },
    onApply: props.onApply,
    onCategoryChange: (category) =>
      dispatch({ type: "select-category", category }),
    onClose: props.onClose,
    onOpenPublish: props.onOpenPublish,
    onPageChange: (page) => dispatch({ type: "change-page", page }),
    onResetFilters: () => dispatch({ type: "reset" }),
    onRetryApply: props.onRetryApply,
    onRetryList: () => void listQuery.refetch(),
    onRetryRecent: () => void recentQuery.refetch(),
    onSearchInputChange: (searchInput) =>
      dispatch({ type: "change-search-input", searchInput }),
    open: props.open,
    page: filters.page,
    publishReturnFocus: props.publishReturnFocus ?? false,
    recent: {
      items: recentQuery.data?.items ?? [],
      loading: recentQuery.isLoading,
      error: getGalleryError(
        recentQuery.error,
        recentQuery.isError
          ? "최근 사용한 템플릿을 불러오지 못했습니다."
          : null,
      ),
    },
    searchInput: filters.searchInput,
  };

  return <CommunityTemplateGalleryView {...viewProps} />;
}

function getGalleryError(error: unknown, fallback: string | null) {
  if (error instanceof CommunityTemplateWebError) return error.message;
  return fallback;
}
