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
