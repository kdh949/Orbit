import { describe, expect, it, vi } from "vitest";

import {
  buildRehearsalLiveSttStatusModel,
  canRetryInitialRecordingLiveStt,
  createInitialLiveSttRetryCoordinator,
  sanitizeLiveSttErrorMessage,
} from "./rehearsalLiveSttStatus";

describe("rehearsalLiveSttStatus", () => {
  it.each([
    ["listening", "녹음 · 음성 인식 중", "success"],
    ["starting", "녹음 중 · 음성 인식 연결 중", "neutral"],
    ["failed", "녹음 중 · 음성 인식 오류", "danger"],
    ["unavailable", "녹음 중 · 음성 인식 오류", "warning"],
  ] as const)(
    "recording + %s 상태를 실제 STT 상태로 표시한다",
    (liveStatus, topbarLabel, tone) => {
      expect(
        buildRehearsalLiveSttStatusModel({
          isRecording: true,
          liveError: "인식 엔진 오류",
          liveStatus,
        }),
      ).toMatchObject({ topbarLabel, tone });
    },
  );

  it("STT 실패 중에도 녹음과 리포트 생성이 계속됨을 알린다", () => {
    const model = buildRehearsalLiveSttStatusModel({
      isRecording: true,
      liveError: "언어팩을 사용할 수 없습니다.",
      liveStatus: "unavailable",
    });

    expect(model.description).toContain("녹음과 리포트 생성은 계속");
    expect(model.description).toContain("자동 따라가기가 일시 중단");
    expect(model.topbarLabel).not.toBe("녹음 · 음성 인식 중");
  });

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
    expect(coordinator.isRetrying()).toBe(true);

    resolveStart();
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(coordinator.isRetrying()).toBe(false);
  });

  it("재연결 실패 뒤에는 새 연결 요청을 다시 실행할 수 있다", async () => {
    const coordinator = createInitialLiveSttRetryCoordinator();
    const start = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(coordinator.retry(start)).resolves.toBe(false);
    await expect(coordinator.retry(start)).resolves.toBe(true);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("재연결 대기 중 취소하면 늦게 완료된 성공 결과를 버린다", async () => {
    const coordinator = createInitialLiveSttRetryCoordinator();
    let resolveStart: () => void = () => undefined;
    const retryState: { isCurrent?: () => boolean } = {};
    const pending = coordinator.retry(
      (isCurrent) =>
        new Promise<boolean>((resolve) => {
          retryState.isCurrent = isCurrent;
          resolveStart = () => resolve(true);
        }),
    );

    expect(retryState.isCurrent?.()).toBe(true);
    coordinator.cancel();
    expect(retryState.isCurrent?.()).toBe(false);
    resolveStart();

    await expect(pending).resolves.toBe(false);
    expect(coordinator.isRetrying()).toBe(false);
  });

  it("오류 문구에서 credential을 가리고 길이를 제한한다", () => {
    const sanitized = sanitizeLiveSttErrorMessage(
      `Authorization: Bearer-private token=private-token ${"x".repeat(300)}`,
    );

    expect(sanitized).not.toContain("Bearer-private");
    expect(sanitized).not.toContain("private-token");
    expect(sanitized?.length).toBeLessThanOrEqual(240);
  });
});
