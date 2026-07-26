import { afterEach, describe, expect, it, vi } from "vitest";

import type { BrowserSpeechRecognition } from "./browserSpeechRecognition";
import {
  resolveWebSpeechAudioTrack,
  startRecognitionWithAudioTrack,
} from "./webSpeechAudioTrack";

describe("webSpeechAudioTrack", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getAudioTracks에서 첫 번째 live audio track을 선택한다", () => {
    const endedAudio = fakeTrack("audio", "ended");
    const liveVideo = fakeTrack("video", "live");
    const liveAudio = fakeTrack("audio", "live");

    expect(
      resolveWebSpeechAudioTrack({
        getAudioTracks: () => [endedAudio, liveAudio],
        getTracks: () => [liveVideo],
      } as unknown as MediaStream),
    ).toBe(liveAudio);
  });

  it("getAudioTracks가 없으면 getTracks에서 live audio track을 찾는다", () => {
    const liveAudio = fakeTrack("audio", "live");

    expect(
      resolveWebSpeechAudioTrack({
        getTracks: () => [fakeTrack("video", "live"), liveAudio],
      } as unknown as MediaStream),
    ).toBe(liveAudio);
  });

  it("live audio track이 없으면 null을 반환한다", () => {
    expect(
      resolveWebSpeechAudioTrack({
        getAudioTracks: () => [fakeTrack("audio", "ended")],
        getTracks: () => [fakeTrack("audio", "ended")],
      } as unknown as MediaStream),
    ).toBeNull();
    expect(resolveWebSpeechAudioTrack(null)).toBeNull();
  });

  it("track이 있으면 recognition.start(track)을 호출한다", () => {
    const recognition = fakeRecognition();
    const track = fakeTrack("audio", "live");

    expect(startRecognitionWithAudioTrack(recognition, track)).toBe("track");
    expect(recognition.startCalls).toEqual([track]);
  });

  it("start(track)이 실패하면 debug 로그 후 start()로 폴백한다", () => {
    const debug = vi
      .spyOn(console, "debug")
      .mockImplementation(() => undefined);
    const recognition = fakeRecognition({ failWithTrack: true });
    const track = fakeTrack("audio", "live");

    expect(startRecognitionWithAudioTrack(recognition, track)).toBe("default");
    expect(recognition.startCalls).toEqual([track, undefined]);
    expect(debug).toHaveBeenCalledWith(
      "[orbit-live-stt] Web Speech start(audioTrack) failed; falling back to default microphone.",
      expect.any(Error),
    );
  });

  it("track이 없으면 recognition.start()를 호출한다", () => {
    const recognition = fakeRecognition();

    expect(startRecognitionWithAudioTrack(recognition, null)).toBe("default");
    expect(recognition.startCalls).toEqual([undefined]);
  });
});

function fakeTrack(kind: string, readyState: MediaStreamTrackState) {
  return { kind, readyState } as MediaStreamTrack;
}

function fakeRecognition(options: { failWithTrack?: boolean } = {}) {
  const startCalls: Array<MediaStreamTrack | undefined> = [];
  return {
    continuous: false,
    interimResults: false,
    lang: "",
    maxAlternatives: 0,
    onresult: null,
    onerror: null,
    onend: null,
    start(audioTrack?: MediaStreamTrack) {
      startCalls.push(audioTrack);
      if (audioTrack && options.failWithTrack) {
        throw new Error("track unsupported");
      }
    },
    stop() {},
    abort() {},
    startCalls,
  } as BrowserSpeechRecognition & {
    startCalls: Array<MediaStreamTrack | undefined>;
  };
}
