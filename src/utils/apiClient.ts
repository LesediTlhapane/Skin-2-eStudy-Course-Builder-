import type { CourseProject, SourceDocument } from '../types';

let authGetters: {
  getAccessToken: () => string | null;
  getCompanyId: () => string | null;
} = {
  getAccessToken: () => null,
  getCompanyId: () => null,
};

export function setApiAuthContext(getters: {
  getAccessToken: () => string | null;
  getCompanyId: () => string | null;
}): void {
  authGetters = getters;
}

export function buildTenantHeaders(extraHeaders?: HeadersInit): Headers {
  const headers = new Headers(extraHeaders || {});
  const token = authGetters.getAccessToken();
  const companyId = authGetters.getCompanyId();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (companyId && !headers.has('X-Company-Id')) {
    headers.set('X-Company-Id', companyId);
  }
  return headers;
}

export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const headers = buildTenantHeaders(init.headers);
  return fetch(input, {
    ...init,
    headers,
  });
}

function parseRetryAfterWaitMs(res: Response | null): number {
  const raw = res?.headers?.get?.('retry-after');
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(Math.max(seconds * 1000, 750), 2500);
    }
  }
  return 1200;
}

export type AiFailureCategory =
  | 'rate_limit_store_unavailable'
  | 'auth_service_unavailable'
  | 'concurrency_limit'
  | 'app_rate_limit'
  | 'provider_capacity'
  | 'timeout'
  | 'auth_or_permission'
  | 'validation_or_conflict'
  | 'unknown';

export function classifyAiFailure(
  res: Response | null,
  data: any
): AiFailureCategory {
  const code = String(data?.code || '').trim().toUpperCase();
  if (code === 'RATE_LIMIT_UNAVAILABLE') return 'rate_limit_store_unavailable';
  if (code === 'AUTH_SERVICE_UNAVAILABLE') return 'auth_service_unavailable';
  if (code === 'AI_CONCURRENCY_LIMIT') return 'concurrency_limit';
  if (!res) return 'provider_capacity';
  if (res.status === 401 || res.status === 403) return 'auth_or_permission';
  if (res.status === 400 || res.status === 404 || res.status === 409 || res.status === 413) {
    return 'validation_or_conflict';
  }
  if (res.status === 504) return 'timeout';
  if (res.status === 429) {
    return data?.retryAfterSeconds ? 'app_rate_limit' : 'provider_capacity';
  }
  if (res.status === 502 || res.status === 503) return 'provider_capacity';
  return 'unknown';
}

export function formatAiErrorMessage(
  res: Response | null,
  data: any,
  usedBackupModel: boolean,
  fallback = 'AI generation failed. Your existing course content was preserved.'
): string {
  const category = classifyAiFailure(res, data);
  const rawError = String(data?.error || '').trim();
  if (category === 'rate_limit_store_unavailable') {
    return (
      rawError ||
      'Request rate-limit verification is temporarily unavailable. Your course content was not modified — please retry shortly.'
    );
  }
  if (category === 'auth_service_unavailable') {
    return (
      rawError ||
      'Authentication verification is temporarily unavailable. Your course content is safe — please retry shortly.'
    );
  }
  if (category === 'concurrency_limit') {
    return (
      rawError ||
      'An AI generation request is already in progress. Please wait for it to finish before retrying.'
    );
  }
  if (category === 'timeout') {
    return usedBackupModel
      ? 'Primary and backup AI models timed out. Your existing course content was preserved — please retry.'
      : 'The AI request timed out. Your existing course content was preserved — please retry.';
  }
  if (usedBackupModel && (!res || !res.ok)) {
    return rawError
      ? `${rawError} (Backup AI model also failed; existing course content preserved.)`
      : 'Primary and backup AI models were temporarily unavailable. Existing course content preserved.';
  }
  return rawError || fallback;
}

export async function apiFetchWithAiBackup<T = any>(
  input: RequestInfo | URL,
  payload: Record<string, any>,
  options?: {
    onBackupFailover?: () => void;
    fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    retryDelayMs?: number;
  }
): Promise<{
  res: Response;
  data: T;
  usedBackupModel: boolean;
  failureCategory?: AiFailureCategory;
}> {
  const fetcher = options?.fetchImpl || apiFetch;

  let firstRes: Response | null = null;
  let firstData: any = null;
  let firstNetworkErr: any = null;

  try {
    firstRes = await fetcher(input, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    firstData = await parseApiJson<T>(firstRes);
    if (firstRes.ok && firstData?.success) {
      return { res: firstRes, data: firstData as T, usedBackupModel: false };
    }
  } catch (err) {
    firstNetworkErr = err;
  }

  const failureCategory = firstNetworkErr
    ? 'provider_capacity'
    : classifyAiFailure(firstRes, firstData);

  // Never mask infrastructure failures (rate-limiter outage, auth outage, concurrency gate,
  // client/validation/conflict errors) as AI model failures requiring backup model failover.
  const shouldFailoverToBackupModel =
    Boolean(firstNetworkErr) ||
    failureCategory === 'provider_capacity' ||
    failureCategory === 'timeout';

  if (!firstNetworkErr && !shouldFailoverToBackupModel) {
    return {
      res: firstRes!,
      data: firstData as T,
      usedBackupModel: false,
      failureCategory,
    };
  }

  const waitMs =
    typeof options?.retryDelayMs === 'number'
      ? Math.max(0, options.retryDelayMs)
      : parseRetryAfterWaitMs(firstRes);
  if (waitMs > 0) {
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }

  options?.onBackupFailover?.();

  const backupRes = await fetcher(input, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      useBackupModel: true,
    }),
  });
  const backupData = await parseApiJson<T>(backupRes);
  return {
    res: backupRes,
    data: backupData,
    usedBackupModel: true,
    failureCategory: backupRes.ok ? undefined : classifyAiFailure(backupRes, backupData),
  };
}

export function compactSourcesForApi(sources: SourceDocument[] = []): SourceDocument[] {
  return sources.slice(0, 6).map(s => ({
    ...s,
    extractedText: (s.extractedText || s.summary || '').slice(0, 2000),
  }));
}

export function compactProjectForApi(
  project: CourseProject,
  options?: { onlyModuleId?: string; focusModuleId?: string; includeLessonText?: boolean }
): CourseProject {
  const includeLessonText = options?.includeLessonText ?? true;
  const filteredContentModules = options?.onlyModuleId
    ? project.content.modules.filter(m => m.moduleId === options.onlyModuleId)
    : project.content.modules;

  return {
    ...project,
    versions: [],
    qaHistory: [],
    sources: compactSourcesForApi(project.sources),
    content: {
      ...project.content,
      generationHistory: [],
      modules: filteredContentModules.map(m => {
        const keepFull = includeLessonText || options?.focusModuleId === m.moduleId;
        return {
          ...m,
          lessons: keepFull
            ? m.lessons
            : m.lessons.map(l => ({
                ...l,
                explanation: l.explanation.slice(0, 420),
              })),
        };
      }),
    },
  };
}

export function utf8ByteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length;
  }
  return text.length * 2;
}

export function compactProjectForCloudPayload(
  project: CourseProject,
  maxBytes = 2_800_000
): { project: CourseProject; trimmed: boolean } {
  const fits = (candidate: CourseProject) =>
    utf8ByteLength(JSON.stringify({ project: candidate })) <= maxBytes;

  if (fits(project)) {
    return { project, trimmed: false };
  }

  let candidate: CourseProject = {
    ...project,
    versions: Array.isArray(project.versions) ? project.versions.slice(0, 3) : [],
  };
  if (fits(candidate)) return { project: candidate, trimmed: true };

  candidate = {
    ...candidate,
    versions: [],
    content: {
      ...candidate.content,
      generationHistory: [],
    },
  };
  if (fits(candidate)) return { project: candidate, trimmed: true };

  candidate = {
    ...candidate,
    qaHistory: Array.isArray(candidate.qaHistory) ? candidate.qaHistory.slice(0, 2) : [],
  };
  if (fits(candidate)) return { project: candidate, trimmed: true };

  for (const limit of [50_000, 12_000, 3_000, 500]) {
    candidate = {
      ...candidate,
      sources: (candidate.sources || []).map(s => ({
        ...s,
        extractedText:
          typeof s.extractedText === 'string' && s.extractedText.length > limit
            ? s.extractedText.slice(0, limit)
            : s.extractedText,
      })),
    };
    if (fits(candidate)) return { project: candidate, trimmed: true };
  }

  candidate = {
    ...candidate,
    qaHistory: [],
    sources: (candidate.sources || []).map(s => ({
      ...s,
      extractedText: (s.extractedText || s.summary || '').slice(0, 250),
    })),
  };
  if (fits(candidate)) return { project: candidate, trimmed: true };

  // Strip source extractedText completely if still over cap
  candidate = {
    ...candidate,
    sources: (candidate.sources || []).map(s => ({
      ...s,
      extractedText: '',
    })),
  };
  if (fits(candidate)) return { project: candidate, trimmed: true };

  // Trim secondary content fields (sourceClaims excerpts & lengthy module worked examples) as last resort
  candidate = {
    ...candidate,
    content: {
      ...candidate.content,
      modules: (candidate.content?.modules || []).map(m => ({
        ...m,
        lessons: (m.lessons || []).map(l => ({
          ...l,
          sourceClaims: (l.sourceClaims || []).slice(0, 5),
        })),
      })),
    },
  };

  return { project: candidate, trimmed: true };
}

export async function parseApiJson<T = any>(res: Response): Promise<T> {
  const rawText = await res.text();
  const trimmed = rawText.trim();
  if (!trimmed) {
    if (!res.ok) {
      throw new Error(`Request failed with HTTP ${res.status} (${res.statusText || 'Empty response'}).`);
    }
    return {} as T;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    if (res.status === 413) {
      throw new Error(
        'Request payload exceeded Vercel 4.5 MB limit (HTTP 413). Large attachments or version history are trimmed automatically — please retry.'
      );
    }
    const preview = trimmed.replace(/\s+/g, ' ').slice(0, 140);
    throw new Error(
      `API endpoint returned HTTP ${res.status} non-JSON response ("${preview}"). Verify backend API routes are running.`
    );
  }
}
