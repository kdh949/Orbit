import { createContext, type ReactNode, useContext } from "react";

export type ActivityPasscodeRuntimeState =
  | { status: "private"; displayPasscode: string }
  | { status: "public" }
  | { status: "not-prepared" }
  | { status: "legacy-unavailable" };

export type ActivityElementRuntime = {
  audienceUrl: string | null;
  passcodeState: ActivityPasscodeRuntimeState;
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
