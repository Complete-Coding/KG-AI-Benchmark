import { BenchmarkRun, ModelProfile } from '@/types/benchmark';

const PROFILE_KEY = 'kg-benchmark::profiles::v1';
const RUN_KEY = 'kg-benchmark::runs::v1';

const hasStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const safeParse = <T>(value: string | null, fallback: T): T => {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.warn('Failed to parse stored benchmark data', error);
    return fallback;
  }
};

export const loadProfiles = (): ModelProfile[] => {
  if (!hasStorage()) {
    return [];
  }

  return safeParse<ModelProfile[]>(window.localStorage.getItem(PROFILE_KEY), []);
};

export const saveProfiles = (profiles: ModelProfile[]) => {
  if (!hasStorage()) {
    return;
  }

  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profiles));
};

export const loadRuns = (): BenchmarkRun[] => {
  if (!hasStorage()) {
    return [];
  }

  return safeParse<BenchmarkRun[]>(window.localStorage.getItem(RUN_KEY), []);
};

export const saveRuns = (runs: BenchmarkRun[]) => {
  if (!hasStorage()) {
    return;
  }

  window.localStorage.setItem(RUN_KEY, JSON.stringify(runs));
};
