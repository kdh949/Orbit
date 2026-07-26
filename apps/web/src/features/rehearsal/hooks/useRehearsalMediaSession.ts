import { useEffect, useRef } from "react";
import { requestRehearsalMicrophoneStream } from "../../presenter-shell/microphoneSettings";
import {
  createRecordingSession,
  type RecordingSession,
} from "../recording/recordingSession";
import {
  isReusableRehearsalMediaStream,
  setMediaStreamTracksEnabled,
} from "../recording/rehearsalMediaStream";

type MediaChannel = "live-demo" | "recording";

export function useRehearsalMediaSession() {
  const recordingSessionRef = useRef<RecordingSession | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const liveDemoStreamRef = useRef<MediaStream | null>(null);

  useEffect(
    () => () => {
      releaseStream("recording");
      releaseStream("live-demo");
    },
    [],
  );

  function getStream(channel: MediaChannel) {
    return channel === "recording"
      ? recordingStreamRef.current
      : liveDemoStreamRef.current;
  }

  async function acquireStream(channel: MediaChannel) {
    const stream = await requestRehearsalMicrophoneStream(
      navigator.mediaDevices,
    );
    replaceStream(channel, stream);
    return stream;
  }

  function replaceStream(channel: MediaChannel, stream: MediaStream | null) {
    const streamRef =
      channel === "recording" ? recordingStreamRef : liveDemoStreamRef;
    if (streamRef.current !== stream) {
      stopMediaStream(streamRef.current);
    }
    streamRef.current = stream;
  }

  function releaseStream(channel: MediaChannel) {
    replaceStream(channel, null);
    if (channel === "recording") {
      recordingSessionRef.current = null;
    }
  }

  function startRecordingSession(
    stream: MediaStream,
    options: {
      onError: (error: Error) => void;
      onStop: (file: File) => void;
    },
  ) {
    const session = createRecordingSession(stream, {
      onError: (error) => {
        releaseRecordingStream(stream);
        options.onError(error);
      },
      onStop: (file) => {
        releaseRecordingStream(stream);
        options.onStop(file);
      },
    });
    recordingStreamRef.current = stream;
    recordingSessionRef.current = session;
    session.start();
  }

  async function pauseRecording() {
    await recordingSessionRef.current?.pause();
  }

  async function resumeRecording() {
    await recordingSessionRef.current?.resume();
  }

  function stopRecording() {
    recordingSessionRef.current?.stop();
    const stream = recordingStreamRef.current;
    if (stream) {
      releaseRecordingStream(stream);
    } else {
      recordingSessionRef.current = null;
    }
  }

  function setStreamEnabled(channel: MediaChannel, enabled: boolean) {
    setMediaStreamTracksEnabled(getStream(channel), enabled);
  }

  function hasReusableStream(channel: MediaChannel) {
    return isReusableRehearsalMediaStream(getStream(channel));
  }

  return {
    acquireStream,
    getStream,
    hasReusableStream,
    pauseRecording,
    releaseStream,
    replaceStream,
    resumeRecording,
    setStreamEnabled,
    startRecordingSession,
    stopRecording,
  };

  function releaseRecordingStream(stream: MediaStream) {
    stopMediaStream(stream);
    if (recordingStreamRef.current === stream) {
      recordingStreamRef.current = null;
      recordingSessionRef.current = null;
    }
  }
}

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}
