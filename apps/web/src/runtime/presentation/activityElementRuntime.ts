export type ActivityPasscodeRuntimeState =
  | { status: "private"; displayPasscode: string }
  | { status: "public" }
  | { status: "not-prepared" }
  | { status: "legacy-unavailable" };

export type ActivityElementRuntime = {
  audienceUrl: string | null;
  passcodeState: ActivityPasscodeRuntimeState;
};
