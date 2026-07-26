import { createContext, type ReactNode, useContext } from "react";

import type { ActivityElementRuntime } from "../../../runtime/presentation/activityElementRuntime";

export type {
  ActivityElementRuntime,
  ActivityPasscodeRuntimeState,
} from "../../../runtime/presentation/activityElementRuntime";

const ActivityElementRuntimeContext =
  createContext<ActivityElementRuntime | null>(null);

export function ActivityElementRuntimeProvider(props: {
  children: ReactNode;
  value: ActivityElementRuntime;
}) {
  return (
    <ActivityElementRuntimeContext.Provider value={props.value}>
      {props.children}
    </ActivityElementRuntimeContext.Provider>
  );
}

export function useActivityElementRuntime() {
  return useContext(ActivityElementRuntimeContext);
}
