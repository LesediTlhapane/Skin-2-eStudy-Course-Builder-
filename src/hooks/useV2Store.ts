import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AIModelMeta,
  AIProvider,
  CourseProject,
  CourseTemplate,
  CourseVersionSnapshot,
  WorkflowStage,
} from '../types';
import { SYSTEM_TEMPLATES } from '../data/templates';
import { BENCHMARK_PRESETS, createEmptyCourseProject } from '../data/benchmarks';
import { apiFetch, compactProjectForCloudPayload, parseApiJson } from '../utils/apiClient';
import {
  clearCloudRecoveryDraft,
  loadCloudRecoveryDrafts,
  openCourseBuilderDB,
  reconcileCloudRecoveryDrafts,
  saveCloudRecoveryDraft,
  saveCloudRecoveryDraftsSync,
  STORE_PROJECTS,
  STORE_TEMPLATES,
  type CloudRecoveryDraft,
} from '../utils/cloudRecovery';

const FALLBACK_PROJECTS_KEY = 'estudy_v2_projects_fallback';
const FALLBACK_TEMPLATES_KEY = 'estudy_v2_templates_fallback';
const AI_PROVIDER_KEY = 'estudy_v2_ai_provider';
const AI_MODEL_KEY = 'estudy_v2_ai_model';
const ACTIVE_PROJECT_SESSION_PREFIX = 'estudy_v2_active_project:';

function readSessionActiveProjectId(companyId: string | null): string | null {
  if (!companyId || typeof sessionStorage === 'undefined') return null;
  try {
    return sessionStorage.getItem(`${ACTIVE_PROJECT_SESSION_PREFIX}${companyId}`) || null;
  } catch {
    return null;
  }
}

function writeSessionActiveProjectId(companyId: string | null, projectId: string | null): void {
  if (!companyId || typeof sessionStorage === 'undefined') return;
  const key = `${ACTIVE_PROJECT_SESSION_PREFIX}${companyId}`;
  try {
    if (projectId) {
      sessionStorage.setItem(key, projectId);
    } else {
      sessionStorage.removeItem(key);
    }
  } catch {
    /* ignore sessionStorage unavailable */
  }
}

async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openCourseBuilderDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result || []) as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function idbPutAll<T extends { id: string }>(storeName: string, items: T[]): Promise<void> {
  const db = await openCourseBuilderDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const desiredIds = new Set(items.map(it => it.id));
    const keysReq = store.getAllKeys();
    keysReq.onsuccess = () => {
      const existingKeys = (keysReq.result || []) as IDBValidKey[];
      for (const k of existingKeys) {
        if (!desiredIds.has(String(k))) {
          store.delete(k);
        }
      }
      for (const item of items) {
        store.put(item);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function readLocalBackupSnapshot(): Promise<{
  projects: CourseProject[];
  customTemplates: CourseTemplate[];
}> {
  try {
    const [loadedProjects, loadedTemplates] = await Promise.all([
      idbGetAll<CourseProject>(STORE_PROJECTS),
      idbGetAll<CourseTemplate>(STORE_TEMPLATES),
    ]);
    return {
      projects: (loadedProjects || []).map(normalizeProjectSchema),
      customTemplates: Array.isArray(loadedTemplates) ? loadedTemplates : [],
    };
  } catch {
    try {
      const pRaw = localStorage.getItem(FALLBACK_PROJECTS_KEY);
      const tRaw = localStorage.getItem(FALLBACK_TEMPLATES_KEY);
      return {
        projects: pRaw ? JSON.parse(pRaw).map(normalizeProjectSchema) : [],
        customTemplates: tRaw ? JSON.parse(tRaw) : [],
      };
    } catch {
      return { projects: [], customTemplates: [] };
    }
  }
}

export function normalizeProjectSchema(raw: any): CourseProject {
  const base = createEmptyCourseProject({
    templateId: raw?.templateId || 'tpl-technical-engineering',
    templateName: raw?.templateName || 'eStudy Master Course Generation Template',
    creationMode: raw?.creationMode || 'brief',
  });
  const now = new Date().toISOString();
  const sources = Array.isArray(raw?.sources)
    ? raw.sources.map((s: any) => ({
        ...s,
        verificationStatus: s?.verificationStatus || 'NEEDS REVIEW',
        keyTopics: Array.isArray(s?.keyTopics) ? s.keyTopics : [],
        relevantSections: Array.isArray(s?.relevantSections) ? s.relevantSections : [],
      }))
    : [];

  return {
    ...base,
    ...raw,
    id: String(raw?.id || base.id),
    createdAt: raw?.createdAt || now,
    updatedAt: raw?.updatedAt || now,
    currentStage:
      typeof raw?.currentStage === 'number' && raw.currentStage >= 1 && raw.currentStage <= 7
        ? raw.currentStage
        : 1,
    lifecycleStatus: raw?.lifecycleStatus || 'draft',
    sources,
    versions: Array.isArray(raw?.versions) ? raw.versions : [],
    qaHistory: Array.isArray(raw?.qaHistory) ? raw.qaHistory : [],
    brief: {
      ...base.brief,
      ...(raw?.brief || {}),
      saCompliance: {
        ...base.brief.saCompliance,
        ...(raw?.brief?.saCompliance || {}),
      },
      templateFieldValues: {
        ...(raw?.brief?.templateFieldValues || {}),
      },
      fieldStatuses: {
        ...(raw?.brief?.fieldStatuses || {}),
      },
      approval: raw?.brief?.approval || { approved: false },
    },
    curriculum: {
      ...base.curriculum,
      ...(raw?.curriculum || {}),
      modules: Array.isArray(raw?.curriculum?.modules) ? raw.curriculum.modules : [],
      coverageChecks: Array.isArray(raw?.curriculum?.coverageChecks)
        ? raw.curriculum.coverageChecks
        : [],
      conflicts: Array.isArray(raw?.curriculum?.conflicts) ? raw.curriculum.conflicts : [],
      approval: raw?.curriculum?.approval || { approved: false },
    },
    outcomes: {
      ...base.outcomes,
      ...(raw?.outcomes || {}),
      courseOutcomes: Array.isArray(raw?.outcomes?.courseOutcomes)
        ? raw.outcomes.courseOutcomes
        : [],
      moduleOutcomes: Array.isArray(raw?.outcomes?.moduleOutcomes)
        ? raw.outcomes.moduleOutcomes
        : [],
      approval: raw?.outcomes?.approval || { approved: false },
    },
    assessments: {
      ...base.assessments,
      ...(raw?.assessments || {}),
      items: Array.isArray(raw?.assessments?.items) ? raw.assessments.items : [],
      alignmentFlags: Array.isArray(raw?.assessments?.alignmentFlags)
        ? raw.assessments.alignmentFlags
        : [],
      approval: raw?.assessments?.approval || { approved: false },
    },
    content: {
      ...base.content,
      ...(raw?.content || {}),
      modules: Array.isArray(raw?.content?.modules) ? raw.content.modules : [],
      generationHistory: Array.isArray(raw?.content?.generationHistory)
        ? raw.content.generationHistory
        : [],
      approval: raw?.content?.approval || { approved: false },
    },
  };
}

export type AppRoute = 'dashboard' | 'templates' | 'workspace';

export interface UseV2StoreOptions {
  companyId?: string | null;
  accessToken?: string | null;
  isCloudMode?: boolean;
}

export function useV2Store(options?: UseV2StoreOptions) {
  const companyId = options?.companyId || null;
  const accessToken = options?.accessToken || null;
  const isCloudMode = Boolean(options?.isCloudMode && companyId && accessToken);

  const [projects, setProjects] = useState<CourseProject[]>([]);
  const [customTemplates, setCustomTemplates] = useState<CourseTemplate[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [route, setRouteState] = useState<AppRoute>('dashboard');
  const [isLoaded, setIsLoaded] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [pendingLocalMigrationCount, setPendingLocalMigrationCount] = useState<number>(0);
  const [pendingRecoveryDrafts, setPendingRecoveryDrafts] = useState<CloudRecoveryDraft[]>([]);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);

  const [selectedProvider, setSelectedProviderState] = useState<AIProvider>('groq');

  const [selectedModel, setSelectedModelState] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(AI_MODEL_KEY);
      if (saved && !saved.toLowerCase().includes('gemini')) return saved;
    } catch {
      /* ignore localStorage unavailable */
    }
    return 'openai/gpt-oss-120b';
  });

  const [availableModels, setAvailableModels] = useState<AIModelMeta[]>([]);
  const [keysStatus, setKeysStatus] = useState<{ groq: boolean }>({
    groq: false,
  });

  const projectsRef = useRef<CourseProject[]>(projects);
  projectsRef.current = projects;
  const customTemplatesRef = useRef<CourseTemplate[]>(customTemplates);
  customTemplatesRef.current = customTemplates;
  const activeProjectIdRef = useRef<string | null>(activeProjectId);
  activeProjectIdRef.current = activeProjectId;
  const routeRef = useRef<AppRoute>(route);
  routeRef.current = route;

  const dirtyProjectIdsRef = useRef<Set<string>>(new Set());
  const unsavedNewCourseIdsRef = useRef<Set<string>>(new Set());
  const editRevisionRef = useRef<Map<string, number>>(new Map());
  const lastSyncedUpdatedAtRef = useRef<Map<string, string>>(new Map());
  const lastCloudCompanyIdRef = useRef<string | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authBlockedRef = useRef<boolean>(false);

  const clearSaveError = useCallback(() => setSaveError(null), []);
  const clearRecoveryNotice = useCallback(() => setRecoveryNotice(null), []);

  const setRoute = useCallback(
    (nextRoute: AppRoute) => {
      setRouteState(nextRoute);
      if (isCloudMode && companyId) {
        if (nextRoute === 'workspace' && activeProjectIdRef.current) {
          writeSessionActiveProjectId(companyId, activeProjectIdRef.current);
        } else if (nextRoute === 'dashboard') {
          writeSessionActiveProjectId(companyId, null);
        }
      }
    },
    [isCloudMode, companyId]
  );

  const buildDraftForProject = useCallback(
    (targetCompanyId: string, project: CourseProject, syncError?: string | null): CloudRecoveryDraft => ({
      recoveryKey: `${targetCompanyId}:${project.id}`,
      companyId: targetCompanyId,
      projectId: project.id,
      baseServerUpdatedAt: lastSyncedUpdatedAtRef.current.get(project.id) ?? null,
      isNewCourse: unsavedNewCourseIdsRef.current.has(project.id),
      savedOfflineAt: new Date().toISOString(),
      lastSyncError: syncError ?? null,
      project,
    }),
    []
  );

  const backupDirtyProjects = useCallback(
    (targetCompanyId: string | null, syncError?: string | null) => {
      if (!targetCompanyId || dirtyProjectIdsRef.current.size === 0) return;
      const drafts: CloudRecoveryDraft[] = [];
      for (const id of dirtyProjectIdsRef.current) {
        const proj = projectsRef.current.find(p => p.id === id);
        if (proj) {
          drafts.push(buildDraftForProject(targetCompanyId, proj, syncError));
        }
      }
      if (drafts.length === 0) return;
      saveCloudRecoveryDraftsSync(drafts);
      for (const draft of drafts) {
        void saveCloudRecoveryDraft(draft);
      }
    },
    [buildDraftForProject]
  );

  // Load AI models & configured keys from backend
  useEffect(() => {
    fetch('/api/ai/models')
      .then(r => parseApiJson<any>(r))
      .then(data => {
        if (Array.isArray(data.models)) {
          setAvailableModels(data.models);
          const validIds = new Set(data.models.map((m: AIModelMeta) => m.id));
          if (!validIds.has(selectedModel)) {
            setSelectedModelState('openai/gpt-oss-120b');
          }
        }
        if (data.keysConfigured) {
          setKeysStatus({
            groq: Boolean(data.keysConfigured.groq),
          });
        }
      })
      .catch(err => {
        console.warn('Could not load AI models metadata:', err);
      });
  }, []);

  const reloadCloudWorkspace = useCallback(async () => {
    if (!isCloudMode || !companyId || !accessToken) return;
    setIsLoaded(false);
    setSaveError(null);
    authBlockedRef.current = false;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    dirtyProjectIdsRef.current.clear();
    unsavedNewCourseIdsRef.current.clear();
    editRevisionRef.current.clear();
    lastSyncedUpdatedAtRef.current.clear();

    try {
      const [coursesRes, templatesRes, localBackup, localRecoveryDrafts] = await Promise.all([
        apiFetch('/api/v2/courses'),
        apiFetch('/api/v2/templates'),
        readLocalBackupSnapshot(),
        loadCloudRecoveryDrafts(companyId),
      ]);

      const coursesData = await parseApiJson<any>(coursesRes);
      const templatesData = await parseApiJson<any>(templatesRes);

      if (!coursesRes.ok || !coursesData.success) {
        throw new Error(coursesData.error || 'Failed to load company courses.');
      }

      const loadedCloudProjects: CourseProject[] = Array.isArray(coursesData.courses)
        ? coursesData.courses.map(normalizeProjectSchema)
        : [];
      const loadedCloudTemplates: CourseTemplate[] = Array.isArray(templatesData.templates)
        ? templatesData.templates.filter((t: CourseTemplate) => !t.isSystemReference)
        : [];

      for (const proj of loadedCloudProjects) {
        if (proj.updatedAt) {
          lastSyncedUpdatedAtRef.current.set(proj.id, proj.updatedAt);
        }
      }

      const reconciled = reconcileCloudRecoveryDrafts(
        loadedCloudProjects,
        localRecoveryDrafts,
        normalizeProjectSchema
      );

      for (const discarded of reconciled.discardedKeys) {
        void clearCloudRecoveryDraft(discarded.companyId, discarded.projectId);
      }
      for (const newId of reconciled.autoRecoveredNewIds) {
        unsavedNewCourseIdsRef.current.add(newId);
      }
      for (const id of reconciled.autoRecoveredIds) {
        dirtyProjectIdsRef.current.add(id);
        editRevisionRef.current.set(id, (editRevisionRef.current.get(id) || 0) + 1);
      }

      setHasUnsavedChanges(reconciled.autoRecoveredIds.length > 0);
      setPendingRecoveryDrafts(reconciled.conflictingDrafts);
      if (reconciled.autoRecoveredIds.length > 0) {
        setRecoveryNotice(
          `Restored unsaved local changes for ${reconciled.autoRecoveredIds.length} course(s) from your previous session and queued cloud sync.`
        );
      }

      // Count local IndexedDB projects not yet mirrored in cloud workspace
      const cloudKnownIds = new Set(
        reconciled.projects.flatMap(p => [p.id, p.localSourceId].filter(Boolean) as string[])
      );
      const unmigratedLocal = (localBackup.projects || []).filter(
        p => !cloudKnownIds.has(p.id) && !(p.localSourceId && cloudKnownIds.has(p.localSourceId))
      );
      setPendingLocalMigrationCount(unmigratedLocal.length);

      setProjects(reconciled.projects);
      setCustomTemplates(loadedCloudTemplates);

      const sessionActiveId = readSessionActiveProjectId(companyId);
      const candidateActiveId = activeProjectIdRef.current || sessionActiveId;
      const restoredActiveExists =
        Boolean(candidateActiveId) &&
        reconciled.projects.some(p => p.id === candidateActiveId);
      setActiveProjectId(restoredActiveExists ? candidateActiveId : null);
      if (restoredActiveExists && candidateActiveId) {
        setRouteState('workspace');
        writeSessionActiveProjectId(companyId, candidateActiveId);
      } else if (sessionActiveId) {
        writeSessionActiveProjectId(companyId, null);
      }

      setLastSavedAt(new Date().toISOString());
    } catch (err: any) {
      setSaveError(err?.message || 'Unable to load cloud workspace.');
    } finally {
      setIsLoaded(true);
    }
  }, [isCloudMode, companyId, accessToken]);

  // Initial load: Cloud mode (Supabase PostgreSQL via Express) OR legacy Local IndexedDB mode
  useEffect(() => {
    if (isCloudMode && companyId) {
      lastCloudCompanyIdRef.current = companyId;
      void reloadCloudWorkspace();
      return;
    }

    // If transitioning out of Cloud mode (e.g., kicked out / session expired), preserve any dirty cloud drafts immediately
    if (lastCloudCompanyIdRef.current && dirtyProjectIdsRef.current.size > 0) {
      backupDirtyProjects(
        lastCloudCompanyIdRef.current,
        'Session ended before cloud sync completed.'
      );
      dirtyProjectIdsRef.current.clear();
      unsavedNewCourseIdsRef.current.clear();
      setHasUnsavedChanges(false);
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    (async () => {
      try {
        const [loadedProjects, loadedTemplates] = await Promise.all([
          idbGetAll<CourseProject>(STORE_PROJECTS),
          idbGetAll<CourseTemplate>(STORE_TEMPLATES),
        ]);

        if (loadedProjects.length > 0) {
          const normalized = loadedProjects
            .map(normalizeProjectSchema)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          setProjects(normalized);
        } else {
          const starter = createEmptyCourseProject({
            templateId: 'tpl-technical-engineering',
            templateName: 'Technical & Engineering Mastery Template',
            creationMode: 'brief',
            preset: BENCHMARK_PRESETS[0],
          });
          setProjects([starter]);
        }
        setCustomTemplates(loadedTemplates);
        setLastSavedAt(new Date().toISOString());
      } catch {
        try {
          const pRaw = localStorage.getItem(FALLBACK_PROJECTS_KEY);
          const tRaw = localStorage.getItem(FALLBACK_TEMPLATES_KEY);
          if (pRaw) {
            const parsed = JSON.parse(pRaw);
            if (Array.isArray(parsed)) setProjects(parsed.map(normalizeProjectSchema));
          }
          if (tRaw) setCustomTemplates(JSON.parse(tRaw));
        } catch {
          /* ignore localStorage unavailable */
        }
      } finally {
        setIsLoaded(true);
      }
    })();
  }, [isCloudMode, companyId, reloadCloudWorkspace, backupDirtyProjects]);

  const persistNow = useCallback(
    async (projList?: CourseProject[], tplList?: CourseTemplate[]) => {
      const currentProjects = projList || projectsRef.current;
      const currentTemplates = tplList || customTemplatesRef.current;

      setSaveState('saving');
      setSaveError(null);
      try {
        if (isCloudMode && companyId) {
          const dirtyIds = Array.from(dirtyProjectIdsRef.current);
          if (dirtyIds.length > 0) {
            for (const id of dirtyIds) {
              const target =
                projectsRef.current.find(p => p.id === id) ||
                currentProjects.find(p => p.id === id);
              if (!target) {
                dirtyProjectIdsRef.current.delete(id);
                continue;
              }
              const sentRevision = editRevisionRef.current.get(id) || 0;
              const draft = buildDraftForProject(companyId, target);
              void saveCloudRecoveryDraft(draft);

              const compacted = compactProjectForCloudPayload(target, 2_800_000).project;
              const isNewUnsaved = unsavedNewCourseIdsRef.current.has(id);

              let res = await apiFetch(
                isNewUnsaved
                  ? '/api/v2/courses'
                  : `/api/v2/courses/${encodeURIComponent(id)}`,
                {
                  method: isNewUnsaved ? 'POST' : 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ project: compacted }),
                }
              );
              let data = await parseApiJson<any>(res);

              // If PUT returned 404 for a course that was never successfully POSTed, retry as POST
              if (!isNewUnsaved && res.status === 404 && !lastSyncedUpdatedAtRef.current.has(id)) {
                res = await apiFetch('/api/v2/courses', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ project: compacted }),
                });
                data = await parseApiJson<any>(res);
              }

              if (!res.ok || !data.success) {
                const isAuthIssue = res.status === 401 || res.status === 403;
                authBlockedRef.current = isAuthIssue;
                const friendlyError = isAuthIssue
                  ? 'Your session expired or workspace access changed. Your latest edits are backed up locally in this browser — sign in again to sync them to the cloud.'
                  : data.error || `Cloud save failed (HTTP ${res.status}). Local backup preserved.`;
                void saveCloudRecoveryDraft(buildDraftForProject(companyId, target, friendlyError));
                const err = new Error(friendlyError) as Error & { status?: number };
                err.status = res.status;
                throw err;
              }

              authBlockedRef.current = false;
              unsavedNewCourseIdsRef.current.delete(id);
              const syncedTimestamp = String(data.course?.updatedAt || target.updatedAt || '');
              if (syncedTimestamp) {
                lastSyncedUpdatedAtRef.current.set(id, syncedTimestamp);
              }

              // Only mark clean if no newer local edits happened while the request was in flight
              if ((editRevisionRef.current.get(id) || 0) === sentRevision) {
                dirtyProjectIdsRef.current.delete(id);
                await clearCloudRecoveryDraft(companyId, id);
              }
            }
          }
          setHasUnsavedChanges(dirtyProjectIdsRef.current.size > 0);
          setLastSavedAt(new Date().toISOString());
          return;
        }

        await Promise.all([
          idbPutAll(STORE_PROJECTS, currentProjects),
          idbPutAll(STORE_TEMPLATES, currentTemplates),
        ]);
        setLastSavedAt(new Date().toISOString());
      } catch (err: any) {
        if (!isCloudMode) {
          try {
            localStorage.setItem(FALLBACK_PROJECTS_KEY, JSON.stringify(currentProjects));
            localStorage.setItem(FALLBACK_TEMPLATES_KEY, JSON.stringify(currentTemplates));
            setLastSavedAt(new Date().toISOString());
            return;
          } catch {
            /* ignore localStorage unavailable */
          }
        } else if (companyId) {
          backupDirtyProjects(companyId, err?.message || 'Cloud save failed.');
          setHasUnsavedChanges(dirtyProjectIdsRef.current.size > 0);

          const status = typeof err?.status === 'number' ? err.status : 0;
          const isAuthIssue = status === 401 || status === 403;
          if (!isAuthIssue && dirtyProjectIdsRef.current.size > 0 && !retryTimerRef.current) {
            retryTimerRef.current = setTimeout(() => {
              retryTimerRef.current = null;
              if (dirtyProjectIdsRef.current.size > 0 && !authBlockedRef.current) {
                void persistNow();
              }
            }, 5000);
          }
        }
        setSaveError(
          err?.message ||
            'Failed to save changes to cloud. A local recovery copy is preserved in this browser.'
        );
      } finally {
        setSaveState('saved');
      }
    },
    [isCloudMode, companyId, buildDraftForProject, backupDirtyProjects]
  );

  // Retry automatically when browser regains network connectivity
  useEffect(() => {
    if (!isCloudMode) return;
    const handleOnline = () => {
      if (dirtyProjectIdsRef.current.size > 0 && !authBlockedRef.current) {
        void persistNow();
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [isCloudMode, persistNow]);

  // Persist projects cleanly with debounce & write immediate cloud recovery backup on dirty edits
  useEffect(() => {
    if (!isLoaded) return;
    if (isCloudMode && dirtyProjectIdsRef.current.size === 0) return;

    if (isCloudMode && companyId) {
      backupDirtyProjects(companyId);
      setHasUnsavedChanges(true);
    }

    setSaveState('saving');
    const timer = setTimeout(() => {
      void persistNow(projects, customTemplates);
    }, isCloudMode ? 450 : 250);
    return () => clearTimeout(timer);
  }, [projects, customTemplates, isLoaded, isCloudMode, companyId, persistNow, backupDirtyProjects]);

  // Warn before closing tab and synchronously snapshot dirty cloud drafts to localStorage
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const targetCompanyId = companyId || lastCloudCompanyIdRef.current;
      if (targetCompanyId && dirtyProjectIdsRef.current.size > 0) {
        backupDirtyProjects(
          targetCompanyId,
          'Browser tab closed before cloud sync completed.'
        );
      }
      if (saveState === 'saving' || (isCloudMode && dirtyProjectIdsRef.current.size > 0)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [saveState, isCloudMode, companyId, backupDirtyProjects]);

  const flushSaveNow = useCallback(async () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (isCloudMode && activeProjectIdRef.current) {
      dirtyProjectIdsRef.current.add(activeProjectIdRef.current);
    }
    await persistNow(projectsRef.current, customTemplatesRef.current);
  }, [persistNow, isCloudMode]);

  const restoreRecoveryDraft = useCallback(
    (projectId: string) => {
      const draft = pendingRecoveryDrafts.find(d => d.projectId === projectId);
      if (!draft) return;

      const restored: CourseProject = normalizeProjectSchema({
        ...draft.project,
        updatedAt: new Date().toISOString(),
      });
      if (!projectsRef.current.some(p => p.id === projectId)) {
        unsavedNewCourseIdsRef.current.add(projectId);
      }
      dirtyProjectIdsRef.current.add(projectId);
      editRevisionRef.current.set(projectId, (editRevisionRef.current.get(projectId) || 0) + 1);
      setHasUnsavedChanges(true);

      setProjects(prev => {
        const exists = prev.some(p => p.id === projectId);
        const next = exists
          ? prev.map(p => (p.id === projectId ? restored : p))
          : [restored, ...prev];
        return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      });
      setPendingRecoveryDrafts(prev => prev.filter(d => d.projectId !== projectId));
      setRecoveryNotice(
        `Restored local draft for "${restored.brief.title || 'Untitled Course'}" and queued cloud sync.`
      );
    },
    [pendingRecoveryDrafts]
  );

  const discardRecoveryDraft = useCallback(
    (projectId: string) => {
      const targetCompanyId = companyId || lastCloudCompanyIdRef.current;
      if (targetCompanyId) {
        void clearCloudRecoveryDraft(targetCompanyId, projectId);
      }
      setPendingRecoveryDrafts(prev => prev.filter(d => d.projectId !== projectId));
    },
    [companyId]
  );

  const allTemplates = [
    ...SYSTEM_TEMPLATES,
    ...customTemplates.filter(t => !SYSTEM_TEMPLATES.some(sys => sys.id === t.id)),
  ];
  const activeProject = projects.find(p => p.id === activeProjectId) || null;

  const setProvider = useCallback((_provider: AIProvider) => {
    setSelectedProviderState('groq');
    try {
      localStorage.setItem(AI_PROVIDER_KEY, 'groq');
    } catch {
      /* ignore localStorage unavailable */
    }
    const defaultModel = 'openai/gpt-oss-120b';
    setSelectedModelState(defaultModel);
    try {
      localStorage.setItem(AI_MODEL_KEY, defaultModel);
    } catch {
      /* ignore localStorage unavailable */
    }
  }, []);

  const setModel = useCallback((model: string) => {
    setSelectedModelState(model);
    try {
      localStorage.setItem(AI_MODEL_KEY, model);
    } catch {
      /* ignore localStorage unavailable */
    }
  }, []);

  const createProject = useCallback(
    (project: CourseProject) => {
      const enriched: CourseProject = isCloudMode && companyId ? { ...project, companyId } : project;
      if (isCloudMode && companyId) {
        unsavedNewCourseIdsRef.current.add(enriched.id);
        dirtyProjectIdsRef.current.add(enriched.id);
        editRevisionRef.current.set(enriched.id, 1);
        setHasUnsavedChanges(true);
        void saveCloudRecoveryDraft(buildDraftForProject(companyId, enriched));
        writeSessionActiveProjectId(companyId, enriched.id);
      }
      setProjects(prev => [enriched, ...prev]);
      setActiveProjectId(enriched.id);
      setRouteState('workspace');

      if (isCloudMode && companyId) {
        void (async () => {
          setSaveState('saving');
          const sentRevision = editRevisionRef.current.get(enriched.id) || 1;
          try {
            const compacted = compactProjectForCloudPayload(enriched, 2_800_000).project;
            const res = await apiFetch('/api/v2/courses', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ project: compacted }),
            });
            const data = await parseApiJson<any>(res);
            if (!res.ok || !data.success) {
              throw new Error(data.error || 'Failed to save new course to cloud.');
            }
            unsavedNewCourseIdsRef.current.delete(enriched.id);
            const syncedAt = String(data.course?.updatedAt || enriched.updatedAt || '');
            if (syncedAt) {
              lastSyncedUpdatedAtRef.current.set(enriched.id, syncedAt);
            }
            if ((editRevisionRef.current.get(enriched.id) || 0) === sentRevision) {
              dirtyProjectIdsRef.current.delete(enriched.id);
              setHasUnsavedChanges(dirtyProjectIdsRef.current.size > 0);
              await clearCloudRecoveryDraft(companyId, enriched.id);
            }
            setLastSavedAt(new Date().toISOString());
          } catch (err: any) {
            const msg =
              err?.message ||
              'Failed to save new course to cloud. Local recovery copy preserved.';
            void saveCloudRecoveryDraft(buildDraftForProject(companyId, enriched, msg));
            setSaveError(msg);
          } finally {
            setSaveState('saved');
          }
        })();
      }
    },
    [isCloudMode, companyId, buildDraftForProject]
  );

  const openProject = useCallback(
    (projectId: string, stage?: WorkflowStage) => {
      setActiveProjectId(projectId);
      if (isCloudMode && companyId) {
        writeSessionActiveProjectId(companyId, projectId);
      }
      if (stage) {
        if (isCloudMode) {
          dirtyProjectIdsRef.current.add(projectId);
          editRevisionRef.current.set(projectId, (editRevisionRef.current.get(projectId) || 0) + 1);
          setHasUnsavedChanges(true);
        }
        setProjects(prev =>
          prev.map(p => (p.id === projectId ? { ...p, currentStage: stage } : p))
        );
      }
      setRouteState('workspace');
    },
    [isCloudMode, companyId]
  );

  const updateProject = useCallback(
    (
      projectId: string,
      updater: (prev: CourseProject) => CourseProject,
      snapshotOptions?: {
        trigger: CourseVersionSnapshot['trigger'];
        summary: string;
      }
    ) => {
      if (isCloudMode) {
        dirtyProjectIdsRef.current.add(projectId);
        editRevisionRef.current.set(projectId, (editRevisionRef.current.get(projectId) || 0) + 1);
        setHasUnsavedChanges(true);
      }
      let createdSnapshot: CourseVersionSnapshot | null = null;

      setProjects(prev =>
        prev.map(p => {
          if (p.id !== projectId) return p;
          const next = updater(p);
          const now = new Date().toISOString();
          let versions = next.versions || [];
          if (snapshotOptions) {
            const { versions: _ignored, ...rest } = p;
            createdSnapshot = {
              id: `ver-${Date.now()}`,
              versionNumber: versions.length + 1,
              createdAt: now,
              stage: p.currentStage,
              trigger: snapshotOptions.trigger,
              summary: snapshotOptions.summary,
              data: JSON.parse(JSON.stringify(rest)),
            };
            versions = [createdSnapshot, ...versions].slice(0, 30);
          }
          return {
            ...next,
            updatedAt: now,
            versions,
          };
        })
      );

      const snap = createdSnapshot as CourseVersionSnapshot | null;
      if (isCloudMode && snapshotOptions && snap) {
        const snapshotPayload: CourseVersionSnapshot = {
          ...snap,
          data: compactProjectForCloudPayload(snap.data as CourseProject, 2_500_000)
            .project,
        };
        void (async () => {
          try {
            const res = await apiFetch(
              `/api/v2/courses/${encodeURIComponent(projectId)}/versions`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ snapshot: snapshotPayload }),
              }
            );
            const data = await parseApiJson<any>(res);
            if (!res.ok || !data.success) {
              throw new Error(data.error || 'Failed to persist version snapshot to cloud.');
            }
          } catch (err: any) {
            setSaveError(err?.message || 'Failed to persist version snapshot to cloud.');
          }
        })();
      }
    },
    [isCloudMode]
  );

  const syncProjectFromServer = useCallback(
    (serverProject: CourseProject) => {
      const normalized = normalizeProjectSchema(serverProject);
      dirtyProjectIdsRef.current.delete(normalized.id);
      unsavedNewCourseIdsRef.current.delete(normalized.id);
      if (normalized.updatedAt) {
        lastSyncedUpdatedAtRef.current.set(normalized.id, normalized.updatedAt);
      }
      if (companyId) {
        void clearCloudRecoveryDraft(companyId, normalized.id);
      }
      setHasUnsavedChanges(dirtyProjectIdsRef.current.size > 0);
      setProjects(prev => {
        const exists = prev.some(p => p.id === normalized.id);
        if (!exists) return [normalized, ...prev];
        return prev.map(p => (p.id === normalized.id ? normalized : p));
      });
      setLastSavedAt(new Date().toISOString());
      setSaveState('saved');
      setSaveError(null);
    },
    [companyId]
  );

  const loadCourseVersions = useCallback(
    async (projectId: string): Promise<CourseVersionSnapshot[]> => {
      const localExisting = projects.find(p => p.id === projectId)?.versions || [];
      if (!isCloudMode) {
        return localExisting;
      }
      const res = await apiFetch(
        `/api/v2/courses/${encodeURIComponent(projectId)}/versions`
      );
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        const message = data.error || 'Failed to load course version history from cloud.';
        setSaveError(message);
        throw new Error(message);
      }
      const cloudVersions: CourseVersionSnapshot[] = Array.isArray(data.versions)
        ? data.versions
        : [];
      setProjects(prev =>
        prev.map(p => {
          if (p.id !== projectId) return p;
          const byId = new Map<string, CourseVersionSnapshot>();
          for (const v of cloudVersions) {
            if (v?.id) byId.set(v.id, v);
          }
          for (const v of p.versions || []) {
            if (v?.id && !byId.has(v.id)) byId.set(v.id, v);
          }
          const merged = Array.from(byId.values()).sort(
            (a, b) => b.versionNumber - a.versionNumber
          );
          return { ...p, versions: merged };
        })
      );
      return cloudVersions;
    },
    [isCloudMode, projects]
  );

  const restoreProjectVersion = useCallback(
    (projectId: string, snapshotId: string) => {
      const current = projects.find(p => p.id === projectId);
      const target = current?.versions.find(v => v.id === snapshotId);
      if (!current || !target) return;

      const { versions: _curr, ...currentRest } = current;
      const now = new Date().toISOString();
      const backupBeforeRestore: CourseVersionSnapshot = {
        id: `ver-${Date.now()}`,
        versionNumber: current.versions.length + 1,
        createdAt: now,
        stage: current.currentStage,
        trigger: 'restore',
        summary: `Auto-saved before restoring v${target.versionNumber}`,
        data: JSON.parse(JSON.stringify(currentRest)),
      };
      const restored = normalizeProjectSchema({
        ...JSON.parse(JSON.stringify(target.data)),
        id: current.id,
        companyId: current.companyId,
        updatedAt: now,
        versions: [backupBeforeRestore, ...current.versions].slice(0, 30),
      });

      if (isCloudMode) {
        dirtyProjectIdsRef.current.add(projectId);
        editRevisionRef.current.set(projectId, (editRevisionRef.current.get(projectId) || 0) + 1);
        setHasUnsavedChanges(true);
      }
      setProjects(prev => prev.map(p => (p.id === projectId ? restored : p)));

      if (isCloudMode) {
        void (async () => {
          try {
            const snapshotPayload: CourseVersionSnapshot = {
              ...backupBeforeRestore,
              data: compactProjectForCloudPayload(
                backupBeforeRestore.data as CourseProject,
                2_500_000
              ).project,
            };
            const verRes = await apiFetch(
              `/api/v2/courses/${encodeURIComponent(projectId)}/versions`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ snapshot: snapshotPayload }),
              }
            );
            const verData = await parseApiJson<any>(verRes);
            if (!verRes.ok || !verData.success) {
              throw new Error(verData.error || 'Failed to archive pre-restore version snapshot.');
            }
          } catch (err: any) {
            setSaveError(err?.message || 'Failed to persist version restore snapshot to cloud.');
          }
        })();
      }
    },
    [projects, isCloudMode]
  );

  const duplicateProject = useCallback(
    (projectId: string) => {
      const target = projects.find(p => p.id === projectId);
      if (!target) return;
      const now = new Date().toISOString();
      const copy: CourseProject = {
        ...JSON.parse(JSON.stringify(target)),
        id: `course-${Date.now()}`,
        localSourceId: undefined,
        lifecycleStatus: 'draft',
        createdAt: now,
        updatedAt: now,
        versions: [],
      };
      copy.brief.title = `${target.brief.title || 'Untitled Course'} (Copy)`;
      if (isCloudMode && companyId) {
        unsavedNewCourseIdsRef.current.add(copy.id);
        dirtyProjectIdsRef.current.add(copy.id);
        editRevisionRef.current.set(copy.id, 1);
        setHasUnsavedChanges(true);
        void saveCloudRecoveryDraft(buildDraftForProject(companyId, copy));
      }
      setProjects(prev => [copy, ...prev]);

      if (isCloudMode && companyId) {
        void (async () => {
          setSaveState('saving');
          const sentRevision = editRevisionRef.current.get(copy.id) || 1;
          try {
            const compacted = compactProjectForCloudPayload(copy, 2_800_000).project;
            const res = await apiFetch('/api/v2/courses', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ project: compacted }),
            });
            const data = await parseApiJson<any>(res);
            if (!res.ok || !data.success) {
              throw new Error(data.error || 'Failed to duplicate course in cloud.');
            }
            unsavedNewCourseIdsRef.current.delete(copy.id);
            const syncedAt = String(data.course?.updatedAt || copy.updatedAt || '');
            if (syncedAt) {
              lastSyncedUpdatedAtRef.current.set(copy.id, syncedAt);
            }
            if ((editRevisionRef.current.get(copy.id) || 0) === sentRevision) {
              dirtyProjectIdsRef.current.delete(copy.id);
              setHasUnsavedChanges(dirtyProjectIdsRef.current.size > 0);
              await clearCloudRecoveryDraft(companyId, copy.id);
            }
            setLastSavedAt(new Date().toISOString());
          } catch (err: any) {
            const msg =
              err?.message ||
              'Failed to duplicate course in cloud. Local recovery copy preserved.';
            void saveCloudRecoveryDraft(buildDraftForProject(companyId, copy, msg));
            setSaveError(msg);
          } finally {
            setSaveState('saved');
          }
        })();
      }
    },
    [projects, isCloudMode, companyId, buildDraftForProject]
  );

  const deleteProject = useCallback(
    (projectId: string) => {
      const removed = projects.find(p => p.id === projectId);
      dirtyProjectIdsRef.current.delete(projectId);
      unsavedNewCourseIdsRef.current.delete(projectId);
      setHasUnsavedChanges(dirtyProjectIdsRef.current.size > 0);
      if (companyId) {
        void clearCloudRecoveryDraft(companyId, projectId);
      }
      setProjects(prev => prev.filter(p => p.id !== projectId));
      if (activeProjectId === projectId) {
        setActiveProjectId(null);
        if (companyId) writeSessionActiveProjectId(companyId, null);
        setRouteState('dashboard');
      }
      if (isCloudMode) {
        void (async () => {
          try {
            const res = await apiFetch(`/api/v2/courses/${encodeURIComponent(projectId)}`, {
              method: 'DELETE',
            });
            const data = await parseApiJson<any>(res);
            if (!res.ok || !data.success) {
              throw new Error(data.error || 'Failed to delete course from cloud.');
            }
          } catch (err: any) {
            if (removed) {
              setProjects(prev => [removed, ...prev]);
            }
            setSaveError(err?.message || 'Failed to delete course from cloud.');
          }
        })();
      }
    },
    [projects, activeProjectId, isCloudMode, companyId]
  );

  const saveTemplate = useCallback(
    (tpl: CourseTemplate) => {
      const now = new Date().toISOString();
      const updatedTpl: CourseTemplate = {
        ...tpl,
        isSystemReference: false,
        visibility: 'company',
        updatedAt: now,
      };
      setCustomTemplates(prev => {
        const exists = prev.some(t => t.id === tpl.id && !t.isSystemReference);
        if (exists) {
          return prev.map(t => (t.id === tpl.id ? updatedTpl : t));
        }
        return [updatedTpl, ...prev];
      });
      if (isCloudMode) {
        void (async () => {
          try {
            const res = await apiFetch('/api/v2/templates', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ template: updatedTpl }),
            });
            const data = await parseApiJson<any>(res);
            if (!res.ok || !data.success) {
              throw new Error(data.error || 'Failed to save template to cloud.');
            }
          } catch (err: any) {
            setSaveError(err?.message || 'Failed to save template to cloud.');
          }
        })();
      }
    },
    [isCloudMode]
  );

  const duplicateTemplate = useCallback(
    (templateId: string) => {
      const found = allTemplates.find(t => t.id === templateId);
      if (!found) return null;
      const now = new Date().toISOString();
      const copy: CourseTemplate = {
        ...JSON.parse(JSON.stringify(found)),
        id: `tpl-custom-${Date.now()}`,
        name: `${found.name} (Copy)`,
        isSystemReference: false,
        visibility: 'company',
        createdAt: now,
        updatedAt: now,
      };
      setCustomTemplates(prev => [copy, ...prev]);
      if (isCloudMode) {
        void (async () => {
          try {
            const res = await apiFetch('/api/v2/templates', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ template: copy }),
            });
            const data = await parseApiJson<any>(res);
            if (!res.ok || !data.success) {
              throw new Error(data.error || 'Failed to save duplicated template to cloud.');
            }
          } catch (err: any) {
            setCustomTemplates(prev => prev.filter(t => t.id !== copy.id));
            setSaveError(err?.message || 'Failed to save duplicated template to cloud.');
          }
        })();
      }
      return copy;
    },
    [allTemplates, isCloudMode]
  );

  const deleteTemplate = useCallback(
    (templateId: string) => {
      const removed = customTemplates.find(t => t.id === templateId);
      setCustomTemplates(prev => prev.filter(t => t.id !== templateId));
      if (isCloudMode) {
        void (async () => {
          try {
            const res = await apiFetch(`/api/v2/templates/${encodeURIComponent(templateId)}`, {
              method: 'DELETE',
            });
            const data = await parseApiJson<any>(res);
            if (!res.ok || !data.success) {
              throw new Error(data.error || 'Failed to delete template from cloud.');
            }
          } catch (err: any) {
            if (removed) {
              setCustomTemplates(prev => [removed, ...prev]);
            }
            setSaveError(err?.message || 'Failed to delete template from cloud.');
          }
        })();
      }
    },
    [customTemplates, isCloudMode]
  );

  const exportWorkspaceJson = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      platform: 'eStudy Master Course Builder V2',
      projects,
      customTemplates,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `estudy-v2-workspace-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [projects, customTemplates]);

  const importWorkspaceJson = useCallback(
    (rawJson: string) => {
      const parsed = JSON.parse(rawJson);
      const importedProjects: CourseProject[] = [];
      const importedTemplates: CourseTemplate[] = [];

      if (Array.isArray(parsed?.projects)) {
        const existingIds = new Set(projects.map(p => p.id));
        const incoming = parsed.projects
          .filter((p: any) => p && p.id && !existingIds.has(p.id))
          .map(normalizeProjectSchema);
        importedProjects.push(...incoming);
        if (incoming.length > 0) {
          setProjects(prev => [...incoming, ...prev]);
        }
      }
      if (Array.isArray(parsed?.customTemplates)) {
        const existingIds = new Set(customTemplates.map(t => t.id));
        const incoming = parsed.customTemplates.filter(
          (t: CourseTemplate) => t?.id && !existingIds.has(t.id)
        );
        importedTemplates.push(...incoming);
        if (incoming.length > 0) {
          setCustomTemplates(prev => [...incoming, ...prev]);
        }
      }
      if (isCloudMode && (importedProjects.length > 0 || importedTemplates.length > 0)) {
        void (async () => {
          try {
            for (const tpl of importedTemplates) {
              const res = await apiFetch('/api/v2/courses/migrate-local', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projects: [], customTemplates: [tpl] }),
              });
              const data = await parseApiJson<any>(res);
              if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to import template to cloud.');
              }
            }
            for (const proj of importedProjects) {
              const compacted = compactProjectForCloudPayload(proj, 2_800_000).project;
              const res = await apiFetch('/api/v2/courses/migrate-local', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projects: [compacted], customTemplates: [] }),
              });
              const data = await parseApiJson<any>(res);
              if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to import course to cloud.');
              }
            }
            await reloadCloudWorkspace();
          } catch (err: any) {
            setSaveError(err?.message || 'Cloud import failed.');
          }
        })();
      }
    },
    [projects, customTemplates, isCloudMode, reloadCloudWorkspace]
  );

  return {
    projects,
    allTemplates,
    customTemplates,
    activeProject,
    route,
    setRoute,
    isLoaded,
    saveState,
    lastSavedAt,
    saveError,
    clearSaveError,
    hasUnsavedChanges,
    pendingLocalMigrationCount,
    pendingRecoveryDrafts,
    recoveryNotice,
    clearRecoveryNotice,
    restoreRecoveryDraft,
    discardRecoveryDraft,
    reloadCloudWorkspace,
    flushSaveNow,
    selectedProvider,
    selectedModel,
    availableModels,
    keysStatus,
    setProvider,
    setModel,
    createProject,
    openProject,
    updateProject,
    syncProjectFromServer,
    loadCourseVersions,
    restoreProjectVersion,
    duplicateProject,
    deleteProject,
    saveTemplate,
    duplicateTemplate,
    deleteTemplate,
    exportWorkspaceJson,
    importWorkspaceJson,
  };
}
