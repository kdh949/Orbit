import { useCallback, useEffect, useRef, useState } from "react";

type PlaybackStatus = "idle" | "loading" | "playing";

type PlaybackState = {
  error: string | null;
  segmentId: string | null;
  status: PlaybackStatus;
};

export function useRehearsalAudioSegmentPlayback(runId: string) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clipUrlsRef = useRef(new Map<string, string>());
  const activeEndSecondsRef = useRef<number | null>(null);
  const requestGenerationRef = useRef(0);
  const [state, setState] = useState<PlaybackState>({
    error: null,
    segmentId: null,
    status: "idle",
  });

  const getAudio = useCallback(() => {
    if (audioRef.current) return audioRef.current;

    const audio = new Audio();
    audio.preload = "metadata";
    const finishPlayback = () => {
      activeEndSecondsRef.current = null;
      setState({ error: null, segmentId: null, status: "idle" });
    };
    audio.addEventListener("timeupdate", () => {
      const endSeconds = activeEndSecondsRef.current;
      if (endSeconds !== null && audio.currentTime >= endSeconds - 0.03) {
        audio.pause();
        finishPlayback();
      }
    });
    audio.addEventListener("ended", finishPlayback);
    audioRef.current = audio;
    return audio;
  }, []);

  const stop = useCallback(() => {
    requestGenerationRef.current += 1;
    activeEndSecondsRef.current = null;
    audioRef.current?.pause();
    setState({ error: null, segmentId: null, status: "idle" });
  }, []);

  const getClipUrl = useCallback(
    async (segmentId: string, startSeconds: number, endSeconds: number) => {
      const cached = clipUrlsRef.current.get(segmentId);
      if (cached) return cached;

      const clip = await fetchRehearsalAudioClip(
        runId,
        startSeconds,
        endSeconds,
      );
      const clipUrl = URL.createObjectURL(clip);
      clipUrlsRef.current.set(segmentId, clipUrl);
      return clipUrl;
    },
    [runId],
  );

  const playSegment = useCallback(
    async (segmentId: string, startSeconds: number, endSeconds: number) => {
      const generation = requestGenerationRef.current + 1;
      requestGenerationRef.current = generation;
      const audio = getAudio();
      audio.pause();
      activeEndSecondsRef.current = null;
      setState({ error: null, segmentId, status: "loading" });

      try {
        const clipUrl = await getClipUrl(segmentId, startSeconds, endSeconds);
        if (requestGenerationRef.current !== generation) return;

        if (audio.src !== clipUrl) {
          audio.src = clipUrl;
          audio.load();
          await waitForAudioMetadata(audio);
        }
        if (requestGenerationRef.current !== generation) return;

        audio.currentTime = 0;
        activeEndSecondsRef.current = Number.isFinite(audio.duration)
          ? audio.duration
          : Math.max(0, endSeconds - startSeconds);
        await audio.play();
        if (requestGenerationRef.current !== generation) {
          audio.pause();
          return;
        }
        setState({ error: null, segmentId, status: "playing" });
      } catch (error) {
        if (requestGenerationRef.current !== generation) return;
        activeEndSecondsRef.current = null;
        audio.pause();
        setState({
          error:
            error instanceof Error
              ? error.message
              : "음성 파일을 재생하지 못했어요.",
          segmentId: null,
          status: "idle",
        });
      }
    },
    [getAudio, getClipUrl],
  );

  useEffect(
    () => () => {
      requestGenerationRef.current += 1;
      activeEndSecondsRef.current = null;
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      for (const clipUrl of clipUrlsRef.current.values()) {
        URL.revokeObjectURL(clipUrl);
      }
      clipUrlsRef.current.clear();
    },
    [],
  );

  return { ...state, playSegment, stop };
}

export async function fetchRehearsalAudioClip(
  runId: string,
  startSeconds: number,
  endSeconds: number,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(
    `/api/v1/rehearsals/${encodeURIComponent(runId)}/audio/clip`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startSeconds, endSeconds }),
    },
  );
  if (response.status === 410) {
    throw new Error("보관 기간이 지나 음성 파일을 재생할 수 없어요.");
  }
  if (!response.ok) {
    throw new Error(
      "음성 구간을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
  }

  const clip = await response.blob();
  if (!clip.type.startsWith("audio/") || clip.size === 0) {
    throw new Error("생성된 음성 구간을 재생할 수 없어요.");
  }
  return clip;
}
function waitForAudioMetadata(audio: HTMLAudioElement) {
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      audio.removeEventListener("loadedmetadata", handleLoaded);
      audio.removeEventListener("error", handleError);
    };
    const handleLoaded = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("음성 파일을 재생할 수 없어요."));
    };
    audio.addEventListener("loadedmetadata", handleLoaded);
    audio.addEventListener("error", handleError);
  });
}
