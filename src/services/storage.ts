import { BenchmarkRun, ModelProfile } from '@/types/benchmark';
import { supabase } from '@/services/supabaseClient';
import { createEmptyRunMetrics } from '@/data/defaults';

const PROFILE_TABLE = 'profiles';
const RUN_TABLE = 'runs';

interface ProfileRow {
  id: string;
  data: ModelProfile;
  updated_at?: string;
  name?: string;
  model_id?: string;
}

interface RunRow {
  id: string;
  data: BenchmarkRun;
  updated_at?: string;
  label?: string;
  status?: string;
  profile_id?: string;
  completed_at?: string | null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isProfileRow = (value: unknown): value is ProfileRow => {
  if (!isObject(value)) {
    return false;
  }

  const { id, data } = value;
  return typeof id === 'string' && isObject(data);
};

const isRunRow = (value: unknown): value is RunRow => {
  if (!isObject(value)) {
    return false;
  }

  const { id, data } = value;
  return typeof id === 'string' && isObject(data);
};

const ensureClient = () => {
  if (!supabase) {
    throw new Error('Supabase client is not configured. Check your environment variables.');
  }

  return supabase;
};

export const loadProfiles = async (): Promise<ModelProfile[]> => {
  try {
    const client = ensureClient();
    const { data, error } = await client.from(PROFILE_TABLE).select('id, data');

    if (error) {
      console.error('Failed to load profiles from Supabase', error);
      return [];
    }

    const rows = Array.isArray(data) ? data.filter(isProfileRow) : [];

    return rows.map((row) => ({
      ...row.data,
      id: isObject(row.data) && typeof row.data.id === 'string' ? row.data.id : row.id,
    }));
  } catch (error) {
    console.error('Unexpected error loading profiles from Supabase', error);
    return [];
  }
};

export const upsertProfileRecord = async (profile: ModelProfile) => {
  try {
    const client = ensureClient();
    const payload: ProfileRow & {
      name?: string;
      model_id?: string;
    } = {
      id: profile.id,
      data: profile,
      updated_at: new Date().toISOString(),
      name: profile.name,
      model_id: profile.modelId,
    };

    const { error } = await client.from(PROFILE_TABLE).upsert(payload);

    if (error) {
      console.error('Failed to upsert profile in Supabase', error);
    }
  } catch (error) {
    console.error('Unexpected error upserting profile in Supabase', error);
  }
};

export const deleteProfileRecord = async (profileId: string) => {
  try {
    const client = ensureClient();
    const { error } = await client.from(PROFILE_TABLE).delete().eq('id', profileId);
    if (error) {
      console.error('Failed to delete profile from Supabase', error);
    }
  } catch (error) {
    console.error('Unexpected error deleting profile from Supabase', error);
  }
};

export const loadRuns = async (): Promise<BenchmarkRun[]> => {
  try {
    const client = ensureClient();
    const { data, error } = await client.from(RUN_TABLE).select('id, data');

    if (error) {
      console.error('Failed to load runs from Supabase', error);
      return [];
    }

    if (!Array.isArray(data)) {
      return [];
    }

    const runs: BenchmarkRun[] = [];

    data.forEach((value) => {
      if (!isRunRow(value)) {
        return;
      }

      const runData: BenchmarkRun = value.data;
      const metrics = {
        ...createEmptyRunMetrics(),
        ...runData.metrics,
      };

      runs.push({
        ...runData,
        metrics,
        id: typeof runData.id === 'string' ? runData.id : value.id,
      });
    });

    return runs;
  } catch (error) {
    console.error('Unexpected error loading runs from Supabase', error);
    return [];
  }
};

export const upsertRunRecord = async (run: BenchmarkRun) => {
  try {
    const client = ensureClient();
    const payload: RunRow & {
      label?: string;
      status?: string;
      profile_id?: string;
      completed_at?: string | null;
    } = {
      id: run.id,
      data: run,
      updated_at: new Date().toISOString(),
      label: run.label,
      status: run.status,
      profile_id: run.profileId,
      completed_at: run.completedAt ?? null,
    };

    const { error } = await client.from(RUN_TABLE).upsert(payload);

    if (error) {
      console.error('Failed to upsert run in Supabase', error);
    }
  } catch (error) {
    console.error('Unexpected error upserting run in Supabase', error);
  }
};

export const deleteRunRecord = async (runId: string) => {
  try {
    const client = ensureClient();
    const { error } = await client.from(RUN_TABLE).delete().eq('id', runId);
    if (error) {
      console.error('Failed to delete run from Supabase', error);
    }
  } catch (error) {
    console.error('Unexpected error deleting run from Supabase', error);
  }
};
