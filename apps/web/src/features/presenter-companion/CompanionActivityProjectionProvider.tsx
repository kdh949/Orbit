import {
  ActivityPublicProjectionProvider,
  type ActivityPublicRuntimeProjection,
} from "../activity-slides";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";

import { fetchPresenterCompanionActivityProjection } from "./presenterCompanionApi";

const refreshIntervalMs = 1_000;

export function CompanionActivityProjectionProvider(props: {
  activityIds: readonly string[];
  children: ReactNode;
  sessionId: string;
}) {
  const activityIds = useMemo(
    () => Array.from(new Set(props.activityIds)).sort(),
    [props.activityIds],
  );
  const activityIdsKey = activityIds.join(":");
  const [projections, setProjections] = useState<
    ReadonlyMap<string, ActivityPublicRuntimeProjection>
  >(new Map());

  useEffect(() => {
    let cancelled = false;
    if (activityIds.length === 0) {
      setProjections(new Map());
      return;
    }
    const refresh = async () => {
      const entries: Array<
        readonly [string, ActivityPublicRuntimeProjection]
      > = await Promise.all(
        activityIds.map(async (activityId) => {
          try {
            const projection =
              await fetchPresenterCompanionActivityProjection(
                props.sessionId,
                activityId,
              );
            return [activityId, projection] as const;
          } catch {
            return [
              activityId,
              {
                audienceUrl: null,
                publicResult: null,
                run: null,
              },
            ] as const;
          }
        }),
      );
      if (!cancelled) {
        setProjections(new Map(entries));
      }
    };
    void refresh();
    const timerId = window.setInterval(() => void refresh(), refreshIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [activityIdsKey, props.sessionId]);

  return (
    <ActivityPublicProjectionProvider projections={projections}>
      {props.children}
    </ActivityPublicProjectionProvider>
  );
}
