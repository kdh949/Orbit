import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRehearsalMediaSession } from "./useRehearsalMediaSession";

describe("useRehearsalMediaSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not release a replacement stream when an old recorder stops late", () => {
    class FakeMediaRecorder {
      static instances: FakeMediaRecorder[] = [];
      static isTypeSupported = () => true;
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onstop: ((event: Event) => void) | null = null;
      state: RecordingState = "inactive";

      constructor() {
        FakeMediaRecorder.instances.push(this);
      }

      addEventListener() {}
      pause() {
        this.state = "paused";
      }
      removeEventListener() {}
      resume() {
        this.state = "recording";
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
      }
    }
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);

    const firstTrackStop = vi.fn();
    const secondTrackStop = vi.fn();
    const firstStream = {
      getTracks: () => [{ stop: firstTrackStop }],
    } as unknown as MediaStream;
    const secondStream = {
      getTracks: () => [{ stop: secondTrackStop }],
    } as unknown as MediaStream;
    let mediaSession: ReturnType<typeof useRehearsalMediaSession> | null = null;

    function Harness() {
      mediaSession = useRehearsalMediaSession();
      return null;
    }

    renderToStaticMarkup(<Harness />);
    mediaSession!.startRecordingSession(firstStream, {
      onError: vi.fn(),
      onStop: vi.fn(),
    });
    mediaSession!.stopRecording();
    mediaSession!.replaceStream("recording", secondStream);

    FakeMediaRecorder.instances[0]?.ondataavailable?.({
      data: new Blob(["audio"]),
    } as BlobEvent);
    FakeMediaRecorder.instances[0]?.onstop?.(new Event("stop"));

    expect(firstTrackStop).toHaveBeenCalled();
    expect(secondTrackStop).not.toHaveBeenCalled();
    expect(mediaSession!.getStream("recording")).toBe(secondStream);
  });
});
