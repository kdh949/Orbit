const DURATION_SECONDS = {
  ms: 0.001,
  s: 1,
  m: 60,
  h: 3600,
};

export function targetRpsAtProgress(profile, progress) {
  if (profile.executor !== "ramping-arrival-rate") return null;

  const stageDurations = profile.stages.map((stage) =>
    durationInSeconds(stage.duration),
  );
  const totalDuration = stageDurations.reduce(
    (total, duration) => total + duration,
    0,
  );
  const normalizedProgress = Math.min(1, Math.max(0, Number(progress)));
  const elapsed = normalizedProgress * totalDuration;
  const timeUnitSeconds = durationInSeconds(profile.timeUnit);

  let stageStart = 0;
  let startRate = profile.startRate;
  for (let index = 0; index < profile.stages.length; index += 1) {
    const stage = profile.stages[index];
    const duration = stageDurations[index];
    const stageEnd = stageStart + duration;
    if (elapsed <= stageEnd) {
      const stageProgress = (elapsed - stageStart) / duration;
      const currentRate =
        startRate + (stage.target - startRate) * stageProgress;
      return currentRate / timeUnitSeconds;
    }
    stageStart = stageEnd;
    startRate = stage.target;
  }

  return startRate / timeUnitSeconds;
}

function durationInSeconds(value) {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(String(value));
  if (!match) throw new Error(`Unsupported k6 duration: ${String(value)}`);
  const seconds = Number(match[1]) * DURATION_SECONDS[match[2]];
  if (seconds <= 0) throw new Error(`k6 duration must be positive: ${value}`);
  return seconds;
}
