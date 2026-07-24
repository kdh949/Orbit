import type { PresentationCompanionSignal } from "@orbit/shared";
import { useEffect, useRef, useState } from "react";
import {
  createPresenterCompanionWebRtcController,
  type CompanionSignalInput,
  type CompanionWebRtcStatus,
} from "./companionWebRtc";

export function usePresenterCompanionWebRtc(input: {
  activeShare: { shareEpochId: string; stream: MediaStream } | null;
  enabled: boolean;
  sendSignal: (signal: CompanionSignalInput) => boolean;
  subscribeSignal: (
    listener: (signal: PresentationCompanionSignal) => void,
  ) => () => void;
}) {
  const [status, setStatus] =
    useState<CompanionWebRtcStatus>("idle");
  const sendSignalRef = useRef(input.sendSignal);
  sendSignalRef.current = input.sendSignal;
  const controllerRef = useRef(
    createPresenterCompanionWebRtcController({
      onStatusChange: setStatus,
      sendSignal: (signal) => sendSignalRef.current(signal),
    }),
  );

  useEffect(
    () => input.subscribeSignal(controllerRef.current.handleSignal),
    [input.subscribeSignal],
  );
  useEffect(() => {
    void controllerRef.current.setShare(
      input.enabled ? input.activeShare : null,
    );
  }, [input.activeShare, input.enabled]);
  useEffect(
    () => () => {
      controllerRef.current.dispose();
    },
    [],
  );

  return { status };
}
