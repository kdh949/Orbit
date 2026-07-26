import type { OrbitMockupScreen } from "../features/mockups/OrbitMockupFlow";

type StaticRoute =
  | { name: "community" }
  | { name: "create-deck" }
  | { name: "deck-render" }
  | { name: "design-system" }
  | { name: "home" }
  | { name: "login" }
  | { name: "mockup"; screen: OrbitMockupScreen }
  | { name: "profile" }
  | { name: "project-list" }
  | { name: "rehearsal-project-list" }
  | { name: "report-list" }
  | { name: "report-mockup" }
  | { name: "signup" };

const mockupRoutes = {
  "/mockup": "public",
  "/mockup/audience": "audience",
  "/mockup/brief": "brief",
  "/mockup/catalog": "catalog",
  "/mockup/challenge-qna": "challenge-qna",
  "/mockup/create": "create",
  "/mockup/editor": "editor",
  "/mockup/focused-practice": "focused-practice",
  "/mockup/home": "home",
  "/mockup/live": "live",
  "/mockup/live-presenter": "live-presenter",
  "/mockup/login": "login",
  "/mockup/microphone-check": "microphone-check",
  "/mockup/practice-plan": "practice-plan",
  "/mockup/presenter": "presenter",
  "/mockup/project-request": "project-request",
  "/mockup/rehearsal": "rehearsal",
  "/mockup/rehearsal-complete": "rehearsal-complete",
  "/mockup/report": "report",
  "/mockup/report-project": "report-project",
  "/mockup/reports": "reports",
  "/mockup/signup": "signup",
  "/mockup/version-history": "version-history",
} satisfies Record<string, OrbitMockupScreen>;

const fixedRoutes = {
  "/": { name: "home" },
  "/community": { name: "community" },
  "/createdeck": { name: "create-deck" },
  "/design-system": { name: "design-system" },
  "/login": { name: "login" },
  "/profile": { name: "profile" },
  "/report_mockup": { name: "report-mockup" },
  "/reports": { name: "report-list" },
  "/signup": { name: "signup" },
} satisfies Record<string, StaticRoute>;

export const staticRouteTable: Readonly<Record<string, StaticRoute>> =
  Object.freeze({
    ...fixedRoutes,
    ...(Object.fromEntries(
      Object.entries(mockupRoutes).map(([path, screen]) => [
        path,
        { name: "mockup", screen },
      ]),
    ) as Record<string, StaticRoute>),
  });

export function resolveStaticRoute(
  pathname: string,
  search: string,
  options: { deckRenderEnabled: boolean },
): StaticRoute | undefined {
  if (pathname === "/project") {
    return new URLSearchParams(search).get("intent") === "rehearsal"
      ? { name: "rehearsal-project-list" }
      : { name: "project-list" };
  }
  if (pathname === "/__deck-render") {
    return options.deckRenderEnabled ? { name: "deck-render" } : undefined;
  }
  return staticRouteTable[pathname];
}

export function parseRouteNonNegativeInteger(value: string | null) {
  if (value === null || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}
