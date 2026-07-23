import { createContext, type ReactNode, useContext } from "react";

export type ActivityElementRuntime = {
  audienceUrl: string | null;
  displayPasscode: string | null;
};

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
