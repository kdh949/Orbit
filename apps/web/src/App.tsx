import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  OrbitAppHeader,
  type OrbitAppNavigationItem,
} from "./components/OrbitAppHeader";
import { OrbitEmptyState } from "./components/ui";
import {
  authMeQueryKey,
  fetchCurrentUser,
  markAuthLoggedOut,
  type AuthUser,
} from "./features/auth/auth-session";
import { LandingPage } from "./features/landing/LandingPage";
import { AppProviders } from "./app/AppProviders";
import "./features/projects/orbit-create-deck.css";
import { getRoute, type Route } from "./app/routing/appRoutes";
import { renderAppRoute } from "./app/routing/renderAppRoute";
export {
  DeckRenderPage,
  deckRenderPayloadStorageKey,
} from "./app/fixtures/DeckRenderPage";
export {
  fetchProjectAccess,
  getProjectAccessFailureBehavior,
  getProjectAccessRoleLabel,
  ProjectAccessRequestError,
  shouldRetryProjectAccess,
} from "./app/access/projectAccess";
export {
  getRoute,
  isDeckRenderRouteEnabled,
  type Route,
} from "./app/routing/appRoutes";
import "./features/projects/orbit-project-access.css";
import { RehearsalMicCheckModal } from "./features/rehearsal/preflight/RehearsalMicCheckModal";
import {
  isRehearsalEntryPath,
  rehearsalNavigationRequestEvent,
} from "./features/reports/reportUtils";

function navigateImmediately(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function replaceImmediately(path: string) {
  window.history.replaceState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function navigateTo(path: string) {
  if (
    isRehearsalEntryPath(path) &&
    !new URL(path, window.location.origin).searchParams.has("preflight")
  ) {
    window.dispatchEvent(
      new CustomEvent(rehearsalNavigationRequestEvent, { detail: path }),
    );
    return;
  }
  navigateImmediately(path);
}

export function App() {
  return (
    <AppProviders>
      <AppContent />
    </AppProviders>
  );
}

function AppContent() {
  const [route, setRoute] = useState(() => getRoute());
  const [pendingRehearsalPath, setPendingRehearsalPath] = useState<
    string | null
  >(null);

  useEffect(() => {
    const handleRouteChange = () => setRoute(getRoute());
    window.addEventListener("popstate", handleRouteChange);
    return () => window.removeEventListener("popstate", handleRouteChange);
  }, []);

  useEffect(() => {
    const requestRehearsal = (event: Event) => {
      setPendingRehearsalPath((event as CustomEvent<string>).detail);
    };
    const interceptRehearsalLink = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = (
        event.target as Element | null
      )?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || !isRehearsalEntryPath(anchor.href)) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingRehearsalPath(anchor.href);
    };
    window.addEventListener(rehearsalNavigationRequestEvent, requestRehearsal);
    document.addEventListener("click", interceptRehearsalLink, true);
    return () => {
      window.removeEventListener(
        rehearsalNavigationRequestEvent,
        requestRehearsal,
      );
      document.removeEventListener("click", interceptRehearsalLink, true);
    };
  }, []);

  const withRehearsalModal = (content: ReactNode) => (
    <>
      {content}
      {pendingRehearsalPath ? (
        <RehearsalMicCheckModal
          onClose={() => setPendingRehearsalPath(null)}
          onStart={() => {
            const target = new URL(
              pendingRehearsalPath,
              window.location.origin,
            );
            target.searchParams.set("preflight", "complete");
            setPendingRehearsalPath(null);
            navigateImmediately(
              `${target.pathname}${target.search}${target.hash}`,
            );
          }}
          onStartWithoutMicrophone={() => {
            const target = new URL(
              pendingRehearsalPath,
              window.location.origin,
            );
            target.searchParams.set("preflight", "without-voice");
            setPendingRehearsalPath(null);
            navigateImmediately(
              `${target.pathname}${target.search}${target.hash}`,
            );
          }}
        />
      ) : null}
    </>
  );

  const auth = useQuery({
    queryKey: authMeQueryKey,
    queryFn: () => fetchCurrentUser(),
    retry: false,
  });

  useEffect(() => {
    if (!auth.isPending && route.name === "profile" && !auth.data) {
      navigateTo("/login");
    }
  }, [auth.data, auth.isPending, route.name]);

  useEffect(() => {
    if (
      !auth.isPending &&
      auth.data &&
      (route.name === "login" || route.name === "signup")
    ) {
      replaceImmediately("/");
    }
  }, [auth.data, auth.isPending, route.name]);

  if (auth.isPending && shouldWaitForAuthResolution(route)) {
    return withRehearsalModal(<AuthLoadingFallback />);
  }

  if (auth.data && (route.name === "login" || route.name === "signup")) {
    return withRehearsalModal(<AuthLoadingFallback />);
  }

  if (route.name === "home" && !auth.data) {
    return withRehearsalModal(<LandingPage onNavigate={navigateTo} />);
  }

  if (!shouldRenderAppFrame(route)) {
    return withRehearsalModal(
      renderAppRoute(route, auth.data ?? undefined, navigateTo),
    );
  }

  return withRehearsalModal(
    <AppFrame
      isAuthenticated={Boolean(auth.data)}
      route={route}
      user={auth.data ?? undefined}
    >
      {renderAppRoute(route, auth.data ?? undefined, navigateTo)}
    </AppFrame>,
  );
}

export function shouldWaitForAuthResolution(route: Route) {
  return ![
    "design-system",
    "mockup",
    "report-mockup",
    "audience-session",
    "audience-activity",
    "companion-spike",
    "companion-spike-audience",
    "companion-spike-capture",
    "companion-pair",
    "companion",
    "present",
    "deck-render",
    "not-found",
  ].includes(route.name);
}

export function shouldRenderAppFrame(route: Route) {
  return (
    route.name !== "login" &&
    route.name !== "signup" &&
    route.name !== "design-system" &&
    route.name !== "mockup" &&
    route.name !== "project-editor" &&
    route.name !== "activity-preview" &&
    route.name !== "presentation" &&
    route.name !== "present" &&
    route.name !== "rehearsal" &&
    route.name !== "report-mockup" &&
    route.name !== "audience-session" &&
    route.name !== "audience-activity" &&
    route.name !== "companion-spike" &&
    route.name !== "companion-spike-audience" &&
    route.name !== "companion-spike-capture" &&
    route.name !== "companion-pair" &&
    route.name !== "companion" &&
    route.name !== "deck-render"
  );
}

function AuthLoadingFallback() {
  return (
    <main className="orbit-page">
      <OrbitEmptyState
        description="로그인 상태와 작업 공간을 확인하고 있습니다."
        title="ORBIT를 준비하고 있어요."
      />
    </main>
  );
}

function AppFrame(props: {
  children: ReactNode;
  isAuthenticated: boolean;
  route: Route;
  user?: AuthUser;
}) {
  const { children, isAuthenticated, route, user } = props;
  const queryClient = useQueryClient();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const pageRef = useRef<HTMLElement>(null);
  const isHomeDashboard = route.name === "home";
  const routeScrollKey = JSON.stringify(route);
  const userLabel = user ? getUserLabel(user) : "로그인";
  const userInitial = user ? getUserInitial(user) : "U";

  useEffect(() => {
    pageRef.current?.scrollTo({ left: 0, top: 0 });
    window.scrollTo({ left: 0, top: 0 });
  }, [routeScrollKey]);

  async function handleLogout() {
    if (isLoggingOut) return;

    setIsLoggingOut(true);
    try {
      const response = await fetch("/api/v1/auth/logout", {
        credentials: "include",
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("로그아웃하지 못했습니다.");
      }
      await queryClient.cancelQueries({ queryKey: authMeQueryKey });
      markAuthLoggedOut(queryClient);
      navigateTo("/login");
    } finally {
      setIsLoggingOut(false);
    }
  }
  return (
    <div
      className={`orbit-layout orbit-product-shell orbit-headerless-shell${
        isHomeDashboard ? " orbit-home-shell" : ""
      }`}
    >
      <OrbitAppHeader
        activeItem={getAppNavigationItem(route)}
        avatar={user?.avatar}
        isAuthenticated={isAuthenticated}
        isLoggingOut={isLoggingOut}
        onAvatarUpdated={(nextUser) =>
          queryClient.setQueryData<AuthUser | null>(authMeQueryKey, nextUser)
        }
        onLogout={() => void handleLogout()}
        onNavigate={navigateTo}
        userInitial={userInitial}
        userLabel={userLabel}
      />
      <main ref={pageRef} className="orbit-page">
        {children}
      </main>
    </div>
  );
}

export function getAppNavigationItem(route: Route): OrbitAppNavigationItem {
  if (route.name === "home") return "home";
  if (
    route.name === "report-list" ||
    route.name === "report-project-overview" ||
    route.name === "rehearsal-report" ||
    route.name === "presentation-report"
  ) {
    return "reports";
  }
  if (route.name === "rehearsal" || route.name === "rehearsal-project-list") {
    return "rehearsal";
  }
  return "project";
}

function getUserInitial(user: AuthUser) {
  const source = user.displayName?.trim() || getUserLabel(user) || "U";
  return source.slice(0, 1).toUpperCase();
}

function getUserLabel(user: AuthUser) {
  return user.displayName?.trim() || user.email?.trim() || user.userId;
}
