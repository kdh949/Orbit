import type { PresentationCompanionSignal } from "@orbit/shared";
import { useEffect, useRef, useState } from "react";
import {
  createReceiverCompanionWebRtcController,
  type CompanionSignalInput,
  type CompanionWebRtcStatus,
} from "./companionWebRtc";

export function useCompanionWebRtc(input: {
  sendSignal: (signal: CompanionSignalInput) => boolean;
  shareEpochId: string | null;
  subscribeSignal: (
    listener: (signal: PresentationCompanionSignal) => void,
  ) => () => void;
}) {
  const [status, setStatus] =
    useState<CompanionWebRtcStatus>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const sendSignalRef = useRef(input.sendSignal);
  sendSignalRef.current = input.sendSignal;
  const controllerRef = useRef(
    createReceiverCompanionWebRtcController({
      onStatusChange: setStatus,
      onStreamChange: setStream,
      sendSignal: (signal) => sendSignalRef.current(signal),
    }),
  );

  useEffect(
    () => input.subscribeSignal(controllerRef.current.handleSignal),
    [input.subscribeSignal],
  );
  useEffect(() => {
    void controllerRef.current.setExpectedShareEpoch(input.shareEpochId);
  }, [input.shareEpochId]);
  useEffect(
    () => () => {
      controllerRef.current.dispose();
    },
    [],
  );

  return { status, stream };
}
