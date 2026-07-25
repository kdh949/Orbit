import { lazy, Suspense } from "react";

type LabRouteEnv = {
  DEV?: boolean;
  MODE?: string;
  VITE_SEMANTIC_CUE_LAB_ENABLED?: string | boolean;
};

/**
 * The lab is a dev/QA-only surface. It is reachable only in development, under
 * vitest, or when `VITE_SEMANTIC_CUE_LAB_ENABLED=true` is explicitly set. A
 * default production build never exposes it.
 */
export function isSemanticCueLabRouteEnabled(env: LabRouteEnv = import.meta.env): boolean {
  return (
    Boolean(env.DEV) ||
    env.MODE === "test" ||
    env.VITE_SEMANTIC_CUE_LAB_ENABLED === "true" ||
    env.VITE_SEMANTIC_CUE_LAB_ENABLED === true
  );
}

const SemanticCueLabPage = lazy(() =>
  import("./SemanticCueLabPage").then((module) => ({
    default: module.SemanticCueLabPage
  }))
);

export function SemanticCueLabRoute() {
  if (!isSemanticCueLabRouteEnabled()) {
    return (
      <div data-testid="semantic-cue-lab-disabled">Semantic Cue Lab is disabled.</div>
    );
  }

  return (
    <Suspense fallback={<div>Semantic Cue Lab 로딩 중…</div>}>
      <SemanticCueLabPage />
    </Suspense>
  );
}
