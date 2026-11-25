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
import { apiFetch, parseApiJson } from '../utils/apiClient';

const DB_NAME = 'estudy_course_builder_v2';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_TEMPLATES = 'templates';
const FALLBACK_PROJECTS_KEY = 'estudy_v2_projects_fallback';
const FALLBACK_TEMPLATES_KEY = 'estudy_v2_templates_fallback';
const AI_PROVIDER_KEY = 'estudy_v2_ai_provider';
const AI_MODEL_KEY = 'estudy_v2_ai_model';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_TEMPLATES)) {
        db.createObjectStore(STORE_TEMPLATES, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result || []) as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function idbPutAll<T extends { id: string }>(storeName: string, items: T[]): Promise<void> {
  const db = await openDB();
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
  const [route, setRoute] = useState<AppRoute>('dashboard');
  const [isLoaded, setIsLoaded] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingLocalMigrationCount, setPendingLocalMigrationCount] = useState<number>(0);

  const [selectedProvider, setSelectedProviderState] = useState<AIProvider>('groq');

  const [selectedModel, setSelectedModelState] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(AI_MODEL_KEY);
      if (saved && !saved.toLowerCase().includes('gemini')) return saved;
    } catch {}
    return 'openai/gpt-oss-120b';
  });

  const [availableModels, setAvailableModels] = useState<AIModelMeta[]>([]);
  const [keysStatus, setKeysStatus] = useState<{ groq: boolean }>({
    groq: false,
  });

  const dirtyProjectIdsRef = useRef<Set<string>>(new Set());

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
      .catch(() => {});
  }, []);

  const reloadCloudWorkspace = useCallback(async () => {
    if (!isCloudMode || !companyId || !accessToken) return;
    setIsLoaded(false);
    setSaveError(null);
    dirtyProjectIdsRef.current.clear();

    try {
      const [coursesRes, templatesRes, localBackup] = await Promise.all([
        apiFetch('/api/v2/courses'),
        apiFetch('/api/v2/templates'),
        readLocalBackupSnapshot(),
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

      // Count local IndexedDB projects not yet mirrored in cloud workspace
      const cloudKnownIds = new Set(
        loadedCloudProjects.flatMap(p => [p.id, p.localSourceId].filter(Boolean) as string[])
      );
      const unmigratedLocal = (localBackup.projects || []).filter(
        p => !cloudKnownIds.has(p.id) && !(p.localSourceId && cloudKnownIds.has(p.localSourceId))
      );
      setPendingLocalMigrationCount(unmigratedLocal.length);

      setProjects(loadedCloudProjects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      setCustomTemplates(loadedCloudTemplates);
      setActiveProjectId(prev =>
        prev && loadedCloudProjects.some(p => p.id === prev) ? prev : null
      );
      setLastSavedAt(new Date().toISOString());
    } catch (err: any) {
      setSaveError(err?.message || 'Unable to load cloud workspace.');
    } finally {
      setIsLoaded(true);
    }
  }, [isCloudMode, companyId, accessToken]);

  // Initial load: Cloud mode (Supabase PostgreSQL via Express) OR legacy Local IndexedDB mode
  useEffect(() => {
    if (isCloudMode) {
      void reloadCloudWorkspace();
      return;
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
        } catch {}
      } finally {
        setIsLoaded(true);
      }
    })();
  }, [isCloudMode, reloadCloudWorkspace]);

  const persistNow = useCallback(
    async (projList: CourseProject[], tplList: CourseTemplate[]) => {
      setSaveState('saving');
      setSaveError(null);
      try {
        if (isCloudMode) {
          const dirtyIds = Array.from(dirtyProjectIdsRef.current);
          if (dirtyIds.length > 0) {
            dirtyProjectIdsRef.current.clear();
            for (const id of dirtyIds) {
              const target = projList.find(p => p.id === id);
              if (!target) continue;
              const res = await apiFetch(`/api/v2/courses/${encodeURIComponent(id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ project: target }),
              });
              const data = await parseApiJson<any>(res);
              if (!res.ok || !data.success) {
                throw new Error(data.error || 'Cloud save failed.');
              }
            }
          }
          setLastSavedAt(new Date().toISOString());
          return;
        }

        await Promise.all([
          idbPutAll(STORE_PROJECTS, projList),
          idbPutAll(STORE_TEMPLATES, tplList),
        ]);
        setLastSavedAt(new Date().toISOString());
      } catch (err: any) {
        if (!isCloudMode) {
          try {
            localStorage.setItem(FALLBACK_PROJECTS_KEY, JSON.stringify(projList));
            localStorage.setItem(FALLBACK_TEMPLATES_KEY, JSON.stringify(tplList));
            setLastSavedAt(new Date().toISOString());
            return;
          } catch {}
        }
        setSaveError(
          err?.message ||
            'Failed to save changes. Export a backup JSON file from the Dashboard as a precaution.'
        );
      } finally {
        setSaveState('saved');
      }
    },
    [isCloudMode]
  );

  // Persist projects cleanly with debounce
  useEffect(() => {
    if (!isLoaded) return;
    if (isCloudMode && dirtyProjectIdsRef.current.size === 0) return;

    setSaveState('saving');
    const timer = setTimeout(() => {
      void persistNow(projects, customTemplates);
    }, isCloudMode ? 450 : 250);
    return () => clearTimeout(timer);
  }, [projects, customTemplates, isLoaded, isCloudMode, persistNow]);

  // Warn before closing tab while save is in flight
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveState === 'saving') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [saveState]);

  const flushSaveNow = useCallback(async () => {
    if (isCloudMode && activeProjectId) {
      dirtyProjectIdsRef.current.add(activeProjectId);
    }
    await persistNow(projects, customTemplates);
  }, [persistNow, projects, customTemplates, isCloudMode, activeProjectId]);

  const allTemplates = [
    ...SYSTEM_TEMPLATES,
    ...customTemplates.filter(t => !SYSTEM_TEMPLATES.some(sys => sys.id === t.id)),
  ];
  const activeProject = projects.find(p => p.id === activeProjectId) || null;

  const setProvider = useCallback((_provider: AIProvider) => {
    setSelectedProviderState('groq');
    try {
      localStorage.setItem(AI_PROVIDER_KEY, 'groq');
    } catch {}
    const defaultModel = 'openai/gpt-oss-120b';
    setSelectedModelState(defaultModel);
    try {
      localStorage.setItem(AI_MODEL_KEY, defaultModel);
    } catch {}
  }, []);

  const setModel = useCallback((model: string) => {
    setSelectedModelState(model);
    try {
      localStorage.setItem(AI_MODEL_KEY, model);
    } catch {}
  }, []);

  const createProject = useCallback(
    (project: CourseProject) => {
      const enriched: CourseProject = isCloudMode && companyId ? { ...project, companyId } : project;
      setProjects(prev => [enriched, ...prev]);
      setActiveProjectId(enriched.id);
      setRoute('workspace');

      if (isCloudMode) {
        void (async () => {
          setSaveState('saving');
          try {
            const res = await apiFetch('/api/v2/courses', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ project: enriched }),
            });
            const data = await parseApiJson<any>(res);
            if (!res.ok || !data.success) {
              throw new Error(data.error || 'Failed to save new course to cloud.');
            }
            setLastSavedAt(new Date().toISOString());
          } catch (err: any) {
            setSaveError(err?.message || 'Failed to save new course.');
          } finally {
            setSaveState('saved');
          }
        })();
      }
    },
    [isCloudMode, companyId]
  );

  const openProject = useCallback(
    (projectId: string, stage?: WorkflowStage) => {
      setActiveProjectId(projectId);
      if (stage) {
        if (isCloudMode) dirtyProjectIdsRef.current.add(projectId);
        setProjects(prev =>
          prev.map(p => (p.id === projectId ? { ...p, currentStage: stage } : p))
        );
      }
      setRoute('workspace');
    },
    [isCloudMode]
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
      if (isCloudMode) dirtyProjectIdsRef.current.add(projectId);
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

      if (isCloudMode && snapshotOptions && createdSnapshot) {
        void apiFetch(`/api/v2/courses/${encodeURIComponent(projectId)}/versions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ snapshot: createdSnapshot }),
        }).catch(() => {});
      }
    },
    [isCloudMode]
  );

  const restoreProjectVersion = useCallback(
    (projectId: string, snapshotId: string) => {
      if (isCloudMode) dirtyProjectIdsRef.current.add(projectId);
      setProjects(prev =>
        prev.map(p => {
          if (p.id !== projectId) return p;
          const target = p.versions.find(v => v.id === snapshotId);
          if (!target) return p;
          const { versions: _curr, ...currentRest } = p;
          const backupBeforeRestore: CourseVersionSnapshot = {
            id: `ver-${Date.now()}`,
            versionNumber: p.versions.length + 1,
            createdAt: new Date().toISOString(),
            stage: p.currentStage,
            trigger: 'restore',
            summary: `Auto-saved before restoring v${target.versionNumber}`,
            data: JSON.parse(JSON.stringify(currentRest)),
          };
          const restored = JSON.parse(JSON.stringify(target.data)) as Omit<
            CourseProject,
            'versions'
          >;
          return {
            ...restored,
            updatedAt: new Date().toISOString(),
            versions: [backupBeforeRestore, ...p.versions].slice(0, 30),
          };
        })
      );
    },
    [isCloudMode]
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
      setProjects(prev => [copy, ...prev]);

      if (isCloudMode) {
        void apiFetch('/api/v2/courses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project: copy }),
        }).catch(() => {});
      }
    },
    [projects, isCloudMode]
  );

  const deleteProject = useCallback(
    (projectId: string) => {
      dirtyProjectIdsRef.current.delete(projectId);
      setProjects(prev => prev.filter(p => p.id !== projectId));
      if (activeProjectId === projectId) {
        setActiveProjectId(null);
        setRoute('dashboard');
      }
      if (isCloudMode) {
        void apiFetch(`/api/v2/courses/${encodeURIComponent(projectId)}`, {
          method: 'DELETE',
        }).catch(() => {});
      }
    },
    [activeProjectId, isCloudMode]
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
        void apiFetch('/api/v2/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ template: updatedTpl }),
        }).catch(() => {});
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
        void apiFetch('/api/v2/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ template: copy }),
        }).catch(() => {});
      }
      return copy;
    },
    [allTemplates, isCloudMode]
  );

  const deleteTemplate = useCallback(
    (templateId: string) => {
      setCustomTemplates(prev => prev.filter(t => t.id !== templateId));
      if (isCloudMode) {
        void apiFetch(`/api/v2/templates/${encodeURIComponent(templateId)}`, {
          method: 'DELETE',
        }).catch(() => {});
      }
    },
    [isCloudMode]
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
        setProjects(prev => {
          const ids = new Set(prev.map(p => p.id));
          const incoming = parsed.projects
            .filter((p: any) => p && p.id && !ids.has(p.id))
            .map(normalizeProjectSchema);
          importedProjects.push(...incoming);
          return [...incoming, ...prev];
        });
      }
      if (Array.isArray(parsed?.customTemplates)) {
        setCustomTemplates(prev => {
          const ids = new Set(prev.map(t => t.id));
          const incoming = parsed.customTemplates.filter(
            (t: CourseTemplate) => t.id && !ids.has(t.id)
          );
          importedTemplates.push(...incoming);
          return [...incoming, ...prev];
        });
      }
      if (isCloudMode && (importedProjects.length > 0 || importedTemplates.length > 0)) {
        void apiFetch('/api/v2/courses/migrate-local', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projects: importedProjects,
            customTemplates: importedTemplates,
          }),
        }).then(() => reloadCloudWorkspace());
      }
    },
    [isCloudMode, reloadCloudWorkspace]
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
    pendingLocalMigrationCount,
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
