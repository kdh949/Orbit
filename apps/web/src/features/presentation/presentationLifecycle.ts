export type PresentationRuntimePhase =
  | "preflight"
  | "starting"
  | "active"
  | "finishing"
  | "completed"
  | "failed";

export function shouldWarnBeforePresentationUnload(phase: PresentationRuntimePhase) {
  return phase === "active" || phase === "finishing";
}

export function shouldClosePresenterSessionOnPreflightExit(
  audienceAccessEnabled: boolean | null,
) {
  return audienceAccessEnabled === false;
}
