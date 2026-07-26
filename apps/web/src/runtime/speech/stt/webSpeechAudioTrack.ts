import type { BrowserSpeechRecognition } from "./browserSpeechRecognition";

export type WebSpeechStartMode = "track" | "default";

export function resolveWebSpeechAudioTrack(
  stream: MediaStream | null | undefined,
): MediaStreamTrack | null {
  if (!stream) {
    return null;
  }

  const audioTracks =
    typeof stream.getAudioTracks === "function"
      ? stream.getAudioTracks()
      : stream.getTracks().filter((track) => track.kind === "audio");

  return audioTracks.find(isLiveAudioTrack) ?? null;
}

export function startRecognitionWithAudioTrack(
  recognition: BrowserSpeechRecognition,
  track: MediaStreamTrack | null,
): WebSpeechStartMode {
  if (!track) {
    recognition.start();
    return "default";
  }

  try {
    recognition.start(track);
    return "track";
  } catch (error) {
    console.debug(
      "[orbit-live-stt] Web Speech start(audioTrack) failed; falling back to default microphone.",
      error,
    );
    recognition.start();
    return "default";
  }
}

function isLiveAudioTrack(track: MediaStreamTrack) {
  return track.kind === "audio" && track.readyState === "live";
}
