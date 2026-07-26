import { useEffect, useState } from "react";
import type { Job } from "@orbit/shared/jobs";

/**
 * job.progress를 추적하되, STT dead zone(30%→65%) 구간에서는
 * 초당 0.4%씩 fake smooth animation을 적용한 표시용 progress를 반환한다.
 */
export function useJobSmoothProgress(
  job: Job | null,
  isActive: boolean,
): number {
  const [smoothProgress, setSmoothProgress] = useState(0);

  useEffect(() => {
    if (!isActive) {
      setSmoothProgress(0);
      return;
    }
  }, [isActive]);

  useEffect(() => {
    const real = job?.progress ?? 0;
    setSmoothProgress((prev) => Math.max(prev, real));
  }, [job?.progress]);

  useEffect(() => {
    if (!isActive) return;

    const interval = setInterval(() => {
      setSmoothProgress((prev) => {
        if (prev < 30 || prev >= 65) return prev;
        return Math.min(prev + 0.4, 64);
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isActive]);

  return smoothProgress;
}
