import type { ReactNode } from "react";
import { forwardRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRecordingFile,
  createRecordingSession,
  normalizeRecordingMimeType,
  runRehearsalPauseSequence,
  selectRecordingMimeType,
} from "./recording/recordingSession";
import {
  isReusableRehearsalMediaStream,
  setMediaStreamTracksEnabled,
} from "./recording/rehearsalMediaStream";
import { LiveSttAdapterError } from "../../runtime/speech/stt/liveSttAdapter";
import { SherpaLiveSttAdapter } from "../../runtime/speech/stt/sherpa/sherpaOnnxLiveSttAdapter";

vi.mock("react-konva", () => {
  const Group = forwardRef<HTMLDivElement, { children?: ReactNode }>(
    ({ children }, ref) => <div ref={ref}>{children}</div>,
  );
  const Stage = forwardRef<HTMLDivElement, { children?: ReactNode }>(
    ({ children }, ref) => <div ref={ref}>{children}</div>,
  );
  const Text = ({ text }: { text?: string }) => <span>{text}</span>;

  return {
    Arrow: () => <span data-konva-arrow="true" />,
    Circle: () => <span data-konva-circle="true" />,
    Group,
    Image: () => <span data-konva-image="true" />,
    Layer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Line: () => <span data-konva-line="true" />,
    Rect: () => <span data-konva-rect="true" />,
    RegularPolygon: () => <span data-konva-polygon="true" />,
    Shape: () => <span data-konva-shape="true" />,
    Star: () => <span data-konva-star="true" />,
    Stage,
    Text,
  };
});

describe("RehearsalWorkspace recording", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the sherpa adapter as an explicit unavailable shell", async () => {
    await expect(
      new SherpaLiveSttAdapter().start(
        { getTracks: () => [] } as unknown as MediaStream,
        {
          onPartialTranscript: () => undefined,
          onError: () => undefined,
        },
      ),
    ).rejects.toMatchObject({
      code: "LIVE_STT_MODEL_UNAVAILABLE",
    } satisfies Partial<LiveSttAdapterError>);
  });

  it("records audio through a MediaRecorder-compatible session", async () => {
    const stoppedFiles: File[] = [];
    const errors: Error[] = [];
    const session = createRecordingSession(
      { getTracks: () => [] } as unknown as MediaStream,
      {
        recorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
        now: () => new Date("2026-06-29T00:00:00.000Z"),
        onStop: (file) => stoppedFiles.push(file),
        onError: (error) => errors.push(error),
      },
    );

    session.start();
    expect(session.recorder.state).toBe("recording");

    await session.pause();
    expect(session.recorder.state).toBe("paused");

    await session.pause();
    expect(session.recorder.state).toBe("paused");

    await session.resume();
    expect(session.recorder.state).toBe("recording");

    await session.resume();
    expect(session.recorder.state).toBe("recording");

    session.stop();
    expect(errors).toEqual([]);
    expect(stoppedFiles).toHaveLength(1);
    expect(stoppedFiles[0]?.name).toBe(
      "rehearsal-2026-06-29T00-00-00-000Z.webm",
    );
    expect(stoppedFiles[0]?.type).toBe("audio/webm");
  });

  it("pauses recording before speech and settles in paused state", async () => {
    const order: string[] = [];

    const result = await runRehearsalPauseSequence({
      pauseRecording: async () => {
        order.push("recording");
      },
      pauseSpeech: async () => {
        order.push("speech");
      },
    });

    expect(order).toEqual(["recording", "speech"]);
    expect(result).toEqual({ error: null, status: "paused" });
  });

  it("restores running state when recorder pause fails", async () => {
    const pauseSpeech = vi.fn(async () => undefined);
    const failure = new Error("recorder pause failed");

    const result = await runRehearsalPauseSequence({
      pauseRecording: async () => {
        throw failure;
      },
      pauseSpeech,
    });

    expect(pauseSpeech).not.toHaveBeenCalled();
    expect(result).toEqual({ error: failure, status: "running" });
  });

  it("keeps paused state when speech stop fails after recording pause", async () => {
    const failure = new Error("speech stop failed");

    const result = await runRehearsalPauseSequence({
      pauseRecording: async () => undefined,
      pauseSpeech: async () => {
        throw failure;
      },
    });

    expect(result).toEqual({ error: failure, status: "paused" });
  });

  it("keeps live rehearsal paused when speech stop fails", async () => {
    const failure = new Error("speech stop failed");

    const result = await runRehearsalPauseSequence({
      pauseSpeech: async () => {
        throw failure;
      },
    });

    expect(result).toEqual({ error: failure, status: "paused" });
  });

  it("비활성화한 live 오디오 트랙을 재사용하고 다시 활성화한다", () => {
    const track = { enabled: true, readyState: "live" } as MediaStreamTrack;
    const stream = {
      active: true,
      getAudioTracks: () => [track],
    } as unknown as MediaStream;

    setMediaStreamTracksEnabled(stream, false);
    expect(track.enabled).toBe(false);
    expect(isReusableRehearsalMediaStream(stream)).toBe(true);

    setMediaStreamTracksEnabled(stream, true);
    expect(track.enabled).toBe(true);
  });

  it("selects the first supported recording MIME type", () => {
    const recorderCtor = {
      isTypeSupported: vi.fn((mimeType: string) => mimeType === "audio/mp4"),
    } as unknown as typeof MediaRecorder;

    expect(selectRecordingMimeType(recorderCtor)).toBe("audio/mp4");
  });

  it("does not select unsupported OpenAI report STT MIME fallbacks", () => {
    const recorderCtor = {
      isTypeSupported: vi.fn((mimeType: string) => mimeType === "audio/ogg"),
    } as unknown as typeof MediaRecorder;

    expect(selectRecordingMimeType(recorderCtor)).toBe("audio/webm");
  });

  it("normalizes recorder codec MIME types before upload", () => {
    const file = createRecordingFile(
      new Blob(["audio"], { type: "audio/webm;codecs=opus" }),
      "audio/webm;codecs=opus",
      new Date("2026-06-29T00:00:00.000Z"),
    );

    expect(normalizeRecordingMimeType("audio/webm;codecs=opus")).toBe(
      "audio/webm",
    );
    expect(file.type).toBe("audio/webm");
    expect(file.name).toBe("rehearsal-2026-06-29T00-00-00-000Z.webm");
  });
});

class FakeMediaRecorder {
  static isTypeSupported(mimeType: string) {
    return mimeType === "audio/webm";
  }

  state: RecordingState = "inactive";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;

  constructor(
    readonly stream: MediaStream,
    readonly options?: MediaRecorderOptions,
  ) {}

  start() {
    this.state = "recording";
  }

  pause() {
    this.state = "paused";
  }

  resume() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({
      data: new Blob(["audio"], {
        type: this.options?.mimeType ?? "audio/webm",
      }),
    } as BlobEvent);
    this.onstop?.(new Event("stop"));
  }
}
