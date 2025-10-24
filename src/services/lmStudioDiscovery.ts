import { DEFAULT_PROFILE_VALUES } from '@/data/defaults';
import { DiscoveredModel } from '@/types/benchmark';

interface DiscoveryOptions {
  baseUrl?: string;
  apiKey?: string;
  requestTimeoutMs?: number;
  signal?: AbortSignal;
  preferRichMetadata?: boolean;
}

interface DiscoveryResult {
  models: DiscoveredModel[];
  endpoint: string;
}

interface RichModelEntry {
  id?: string;
  name?: string;
  display_name?: string;
  type?: string;
  kind?: string;
  state?: string;
  status?: string;
  max_context_length?: number;
  context_length?: number;
  quantization?: string | null;
  file?: string;
  path?: string;
  archive?: string;
  source?: string;
  capabilities?: unknown;
  loaded?: boolean;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface BasicModelEntry {
  id?: string;
  object?: string;
  owned_by?: string;
  permission?: unknown;
  [key: string]: unknown;
}

interface RichModelsResponse {
  data?: RichModelEntry[];
  models?: RichModelEntry[];
  [key: string]: unknown;
}

interface BasicModelsResponse {
  data?: BasicModelEntry[];
  [key: string]: unknown;
}

const DEFAULT_TIMEOUT = 8000;

const buildHeaders = (apiKey?: string) => {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
};

const withTimeout = async <T>(
  executor: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  externalSignal?: AbortSignal
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const abortHandler = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      abortHandler();
    } else {
      externalSignal.addEventListener('abort', abortHandler);
    }
  }

  try {
    return await executor(controller.signal);
  } finally {
    clearTimeout(timeout);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', abortHandler);
    }
  }
};

const ensureArray = <T>(value: unknown): T[] => {
  if (Array.isArray(value)) {
    return value as T[];
  }
  return [];
};

const toCapabilities = (value: unknown): string[] => {
  const items = ensureArray<unknown>(value);
  return items.filter((item): item is string => typeof item === 'string');
};

const normalizeRichEntry = (entry: RichModelEntry, baseUrl: string, endpoint: string): DiscoveredModel | null => {
  const id = entry.id ?? entry.name;

  if (!id) {
    return null;
  }

  const displayName = typeof entry.display_name === 'string' ? entry.display_name : undefined;
  const kind =
    typeof entry.type === 'string'
      ? entry.type
      : typeof entry.kind === 'string'
        ? entry.kind
        : undefined;

  const state =
    typeof entry.state === 'string'
      ? entry.state
      : typeof entry.status === 'string'
        ? entry.status
        : undefined;

  const maxContextLength =
    typeof entry.max_context_length === 'number'
      ? entry.max_context_length
      : typeof entry.context_length === 'number'
        ? entry.context_length
        : undefined;

  const quantization =
    typeof entry.quantization === 'string'
      ? entry.quantization
      : typeof entry.quantization === 'number'
        ? String(entry.quantization)
        : null;

  const source =
    typeof entry.source === 'string'
      ? entry.source
      : typeof entry.path === 'string'
        ? entry.path
        : typeof entry.file === 'string'
          ? entry.file
          : typeof entry.archive === 'string'
            ? entry.archive
            : null;

  const capabilities = toCapabilities(entry.capabilities);

  const loaded =
    typeof entry.loaded === 'boolean'
      ? entry.loaded
      : state
        ? state.toLowerCase() === 'loaded'
        : undefined;

  return {
    id,
    displayName,
    kind,
    state,
    maxContextLength,
    quantization,
    source,
    capabilities,
    loaded,
    origin: { baseUrl, endpoint },
    metadata: entry.metadata ?? entry,
  };
};

const normalizeBasicEntry = (
  entry: BasicModelEntry,
  baseUrl: string,
  endpoint: string
): DiscoveredModel | null => {
  const id = entry.id;

  if (!id) {
    return null;
  }

  return {
    id,
    displayName: id,
    capabilities: [],
    origin: { baseUrl, endpoint },
    metadata: entry,
  };
};

const mergeDiscoveredModels = (existing: DiscoveredModel, incoming: DiscoveredModel): DiscoveredModel => {
  const mergedCapabilities =
    existing.capabilities.length >= incoming.capabilities.length
      ? existing.capabilities
      : incoming.capabilities;

  return {
    ...existing,
    ...incoming,
    capabilities: mergedCapabilities,
    metadata: {
      ...(existing.metadata ?? {}),
      ...(incoming.metadata ?? {}),
    },
    origin: existing.origin ?? incoming.origin,
    loaded: typeof incoming.loaded === 'boolean' ? incoming.loaded : existing.loaded,
  };
};

const fetchEndpoint = async (
  baseUrl: string,
  endpoint: string,
  headers: HeadersInit,
  signal: AbortSignal
): Promise<{ ok: boolean; status: number; body?: unknown }> => {
  const url = new URL(endpoint, baseUrl).toString();
  try {
    const response = await fetch(url, { method: 'GET', headers, signal });
    if (!response.ok) {
      return { ok: false, status: response.status };
    }
    const body: unknown = await response.json();
    return { ok: true, status: response.status, body };
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw error;
    }
    throw new Error(`Failed to fetch ${url}: ${(error as Error).message}`);
  }
};

const discoverWithEndpoint = async (
  baseUrl: string,
  path: string,
  headers: HeadersInit,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<DiscoveryResult | null> => {
  const body = await withTimeout(
    (internalSignal) => fetchEndpoint(baseUrl, path, headers, internalSignal),
    timeoutMs,
    signal
  );

  if (!body.ok) {
    return null;
  }

  const endpoint = path;
  const raw = body.body;

  if (path.startsWith('/api/v0')) {
    const payload = raw as RichModelsResponse;
    const modelsRaw = ensureArray<RichModelEntry>(payload.models ?? payload.data);
    const models = modelsRaw
      .map((entry) => normalizeRichEntry(entry, baseUrl, endpoint))
      .filter((entry): entry is DiscoveredModel => Boolean(entry));
    return { models, endpoint };
  }

  const payload = raw as BasicModelsResponse;
  const modelsRaw = ensureArray<BasicModelEntry>(payload.data);
  const models = modelsRaw
    .map((entry) => normalizeBasicEntry(entry, baseUrl, endpoint))
    .filter((entry): entry is DiscoveredModel => Boolean(entry));
  return { models, endpoint };
};

export const discoverLmStudioModels = async ({
  baseUrl = DEFAULT_PROFILE_VALUES.baseUrl,
  apiKey,
  requestTimeoutMs = DEFAULT_TIMEOUT,
  signal,
  preferRichMetadata = true,
}: DiscoveryOptions = {}): Promise<DiscoveryResult> => {
  const headers = buildHeaders(apiKey);

  const endpoints = preferRichMetadata
    ? ['/api/v0/models', '/v1/models']
    : ['/v1/models', '/api/v0/models'];

  let lastResult: DiscoveryResult | null = null;
  let lastError: Error | null = null;

  for (const endpoint of endpoints) {
    try {
      const result = await discoverWithEndpoint(baseUrl, endpoint, headers, requestTimeoutMs, signal);
      if (!result) {
        continue;
      }

      if (result.models.length > 0) {
        return result;
      }

      lastResult = result;
    } catch (error) {
      lastError = error as Error;
    }
  }

  if (lastResult) {
    return lastResult;
  }

  if (lastError) {
    throw lastError;
  }

  return {
    endpoint: endpoints[0],
    models: [],
  };
};

export const mergeDiscoveryResults = (results: DiscoveryResult[]): DiscoveredModel[] => {
  const byId = new Map<string, DiscoveredModel>();

  for (const { models } of results) {
    for (const model of models) {
      const existing = byId.get(model.id);
      if (!existing) {
        byId.set(model.id, model);
      } else {
        byId.set(model.id, mergeDiscoveredModels(existing, model));
      }
    }
  }

  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
};
