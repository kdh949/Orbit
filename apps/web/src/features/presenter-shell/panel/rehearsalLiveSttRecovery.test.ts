import { describe, expect, it, vi } from "vitest";

import {
  canRetryInitialRecordingLiveStt,
  createInitialLiveSttRetryCoordinator,
  sanitizeLiveSttErrorMessage,
} from "./rehearsalLiveSttRecovery";

describe("rehearsalLiveSttRecovery", () => {
  it("초기 녹음 STT 실패이고 재사용 가능한 스트림일 때만 재연결한다", () => {
    expect(
      canRetryInitialRecordingLiveStt({
        hasActiveSession: false,
        hasReusableStream: true,
        isRecording: true,
        isRetrying: false,
        liveStatus: "failed",
      }),
    ).toBe(true);
    expect(
      canRetryInitialRecordingLiveStt({
        hasActiveSession: true,
        hasReusableStream: true,
        isRecording: true,
        isRetrying: false,
        liveStatus: "failed",
      }),
    ).toBe(false);
  });

  it("동시에 재연결을 요청해도 start를 한 번만 실행한다", async () => {
    const coordinator = createInitialLiveSttRetryCoordinator();
    let resolveStart: () => void = () => undefined;
    const start = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveStart = () => resolve(true);
        }),
    );

    const first = coordinator.retry(start);
    const second = coordinator.retry(start);
    expect(start).toHaveBeenCalledTimes(1);

    resolveStart();
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(coordinator.isRetrying()).toBe(false);
  });

  it("재연결 대기 중 취소하면 늦게 완료된 성공 결과를 버린다", async () => {
    const coordinator = createInitialLiveSttRetryCoordinator();
    let resolveStart: () => void = () => undefined;
    const pending = coordinator.retry(
      () =>
        new Promise<boolean>((resolve) => {
          resolveStart = () => resolve(true);
        }),
    );

    coordinator.cancel();
    resolveStart();

    await expect(pending).resolves.toBe(false);
  });

  it.each([
    "Authorization: Bearer-private token=private-token",
    "Bearer private-token api_key=private-key",
    "cookie=session-cookie&secret=private-secret",
    "request failed?api_key=private-key&token=private-token",
  ])("오류 문구에서 credential을 가리고 길이를 제한한다: %s", (message) => {
    const sanitized = sanitizeLiveSttErrorMessage(
      `${message} ${"x".repeat(300)}`,
    );

    expect(sanitized).not.toContain("private-");
    expect(sanitized?.length).toBeLessThanOrEqual(240);
  });
});
