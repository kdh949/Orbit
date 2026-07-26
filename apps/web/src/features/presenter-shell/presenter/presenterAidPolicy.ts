export type PresenterAidPolicy = {
  maxCapabilityItems: number;
  maxCoreCueItems: number;
  showCapabilityDetail: boolean;
  showRecovery: boolean;
};

const policies: Record<"rehearsal" | "live", PresenterAidPolicy> = {
  rehearsal: {
    maxCapabilityItems: 6,
    maxCoreCueItems: 8,
    showCapabilityDetail: true,
    showRecovery: true
  },
  live: {
    maxCapabilityItems: 1,
    maxCoreCueItems: 1,
    showCapabilityDetail: false,
    showRecovery: true
  }
};

export function getPresenterAidPolicy(mode: "rehearsal" | "live") {
  return policies[mode];
}
