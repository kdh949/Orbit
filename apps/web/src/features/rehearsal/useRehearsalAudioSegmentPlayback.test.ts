import { describe, expect, it, vi } from "vitest";

import { fetchRehearsalAudioClip } from "./useRehearsalAudioSegmentPlayback";

describe("fetchRehearsalAudioClip", () => {
  it("requests a generated clip and returns its audio blob", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }),
          {
            status: 200,
          },
        ),
    ) as unknown as typeof fetch;

    const clip = await fetchRehearsalAudioClip("run/1", 10, 12.5, fetcher);

    expect(clip.type).toBe("audio/wav");
    expect(clip.size).toBe(3);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/rehearsals/run%2F1/audio/clip",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startSeconds: 10, endSeconds: 12.5 }),
      },
    );
  });

  it("reports expired source audio separately", async () => {
    const fetcher = vi.fn(
      async () => new Response(null, { status: 410 }),
    ) as unknown as typeof fetch;

    await expect(
      fetchRehearsalAudioClip("run-1", 10, 12, fetcher),
    ).rejects.toThrow("보관 기간이 지나");
  });
});
