import type {
  ActivityPublicResult,
  ActivityRuntimeStatus,
} from "@orbit/shared";
import {
  createContext,
  type ReactNode,
  useContext,
} from "react";

export type ActivityPublicRuntimeProjection = {
  audienceUrl: string | null;
  publicResult: ActivityPublicResult | null;
  run: { status: ActivityRuntimeStatus } | null;
};

const emptyProjection: ActivityPublicRuntimeProjection = {
  audienceUrl: null,
  publicResult: null,
  run: null,
};

const ActivityPublicProjectionContext =
  createContext<ReadonlyMap<string, ActivityPublicRuntimeProjection> | null>(
    null,
  );

export function ActivityPublicProjectionProvider(props: {
  children: ReactNode;
  projections: ReadonlyMap<string, ActivityPublicRuntimeProjection>;
}) {
  return (
    <ActivityPublicProjectionContext.Provider value={props.projections}>
      {props.children}
    </ActivityPublicProjectionContext.Provider>
  );
}

export function useActivityPublicProjection(activityId: string) {
  const projections = useContext(ActivityPublicProjectionContext);
  if (projections === null) {
    return null;
  }
  return projections.get(activityId) ?? emptyProjection;
}
