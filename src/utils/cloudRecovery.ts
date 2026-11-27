import type { CourseProject } from '../types';
import { compactProjectForCloudPayload } from './apiClient';

export const V2_IDB_NAME = 'estudy_course_builder_v2';
export const V2_IDB_VERSION = 2;
export const STORE_PROJECTS = 'projects';
export const STORE_TEMPLATES = 'templates';
export const STORE_CLOUD_RECOVERY = 'cloud_recovery';

const CLOUD_RECOVERY_LS_PREFIX = 'estudy_v2_cloud_recovery:';
const MAX_LS_RECOVERY_BYTES = 1_500_000;

export interface CloudRecoveryDraft {
  recoveryKey: string; // `${companyId}:${projectId}`
  companyId: string;
  projectId: string;
  baseServerUpdatedAt: string | null;
  isNewCourse: boolean;
  savedOfflineAt: string;
  lastSyncError?: string | null;
  project: CourseProject;
}

export interface ReconcileRecoveryResult {
  projects: CourseProject[];
  autoRecoveredIds: string[];
  autoRecoveredNewIds: string[];
  conflictingDrafts: CloudRecoveryDraft[];
  discardedKeys: Array<{ companyId: string; projectId: string }>;
}

export function buildCloudRecoveryKey(companyId: string, projectId: string): string {
  return `${companyId}:${projectId}`;
}

export function openCourseBuilderDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(V2_IDB_NAME, V2_IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_TEMPLATES)) {
        db.createObjectStore(STORE_TEMPLATES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CLOUD_RECOVERY)) {
        db.createObjectStore(STORE_CLOUD_RECOVERY, { keyPath: 'recoveryKey' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readLocalStorageRecoveryMap(companyId: string): Record<string, CloudRecoveryDraft> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(`${CLOUD_RECOVERY_LS_PREFIX}${companyId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalStorageRecoveryMap(
  companyId: string,
  map: Record<string, CloudRecoveryDraft>
): void {
  if (typeof localStorage === 'undefined') return;
  const key = `${CLOUD_RECOVERY_LS_PREFIX}${companyId}`;
  try {
    const entries = Object.entries(map);
    if (entries.length === 0) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    /* ignore localStorage quota or availability errors */
  }
}

export function saveCloudRecoveryDraftSync(draft: CloudRecoveryDraft): void {
  if (!draft.companyId || !draft.projectId) return;
  const compactedProject = compactProjectForCloudPayload(
    draft.project,
    MAX_LS_RECOVERY_BYTES
  ).project;
  const existingMap = readLocalStorageRecoveryMap(draft.companyId);
  existingMap[draft.projectId] = {
    ...draft,
    recoveryKey: buildCloudRecoveryKey(draft.companyId, draft.projectId),
    project: compactedProject,
  };
  writeLocalStorageRecoveryMap(draft.companyId, existingMap);
}

export function saveCloudRecoveryDraftsSync(drafts: CloudRecoveryDraft[]): void {
  const byCompany = new Map<string, CloudRecoveryDraft[]>();
  for (const draft of drafts) {
    if (!draft.companyId || !draft.projectId) continue;
    const list = byCompany.get(draft.companyId) || [];
    list.push(draft);
    byCompany.set(draft.companyId, list);
  }
  for (const [companyId, companyDrafts] of byCompany.entries()) {
    const map = readLocalStorageRecoveryMap(companyId);
    for (const draft of companyDrafts) {
      const compactedProject = compactProjectForCloudPayload(
        draft.project,
        MAX_LS_RECOVERY_BYTES
      ).project;
      map[draft.projectId] = {
        ...draft,
        recoveryKey: buildCloudRecoveryKey(companyId, draft.projectId),
        project: compactedProject,
      };
    }
    writeLocalStorageRecoveryMap(companyId, map);
  }
}

export async function saveCloudRecoveryDraft(draft: CloudRecoveryDraft): Promise<void> {
  if (!draft.companyId || !draft.projectId) return;
  const normalized: CloudRecoveryDraft = {
    ...draft,
    recoveryKey: buildCloudRecoveryKey(draft.companyId, draft.projectId),
  };

  // Always write synchronous compact copy first so abrupt tab close / session drop preserves it
  saveCloudRecoveryDraftSync(normalized);

  try {
    const db = await openCourseBuilderDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_RECOVERY, 'readwrite');
      tx.objectStore(STORE_CLOUD_RECOVERY).put(normalized);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* IndexedDB unavailable; localStorage fallback already persisted above */
  }
}

export async function clearCloudRecoveryDraft(
  companyId: string,
  projectId: string
): Promise<void> {
  if (!companyId || !projectId) return;
  const map = readLocalStorageRecoveryMap(companyId);
  if (projectId in map) {
    delete map[projectId];
    writeLocalStorageRecoveryMap(companyId, map);
  }

  try {
    const db = await openCourseBuilderDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_RECOVERY, 'readwrite');
      tx.objectStore(STORE_CLOUD_RECOVERY).delete(buildCloudRecoveryKey(companyId, projectId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore IDB unavailable */
  }
}

export async function loadCloudRecoveryDrafts(
  companyId: string
): Promise<CloudRecoveryDraft[]> {
  if (!companyId) return [];
  const merged = new Map<string, CloudRecoveryDraft>();

  const lsMap = readLocalStorageRecoveryMap(companyId);
  for (const draft of Object.values(lsMap)) {
    if (draft && draft.companyId === companyId && draft.projectId && draft.project) {
      merged.set(draft.projectId, draft);
    }
  }

  try {
    const db = await openCourseBuilderDB();
    const idbDrafts = await new Promise<CloudRecoveryDraft[]>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_RECOVERY, 'readonly');
      const req = tx.objectStore(STORE_CLOUD_RECOVERY).getAll();
      req.onsuccess = () => resolve((req.result || []) as CloudRecoveryDraft[]);
      req.onerror = () => reject(req.error);
    });

    for (const draft of idbDrafts) {
      if (!draft || draft.companyId !== companyId || !draft.projectId || !draft.project) {
        continue;
      }
      const existing = merged.get(draft.projectId);
      if (
        !existing ||
        String(draft.savedOfflineAt || '') >= String(existing.savedOfflineAt || '')
      ) {
        merged.set(draft.projectId, draft);
      }
    }
  } catch {
    /* ignore IDB unavailable */
  }

  return Array.from(merged.values()).sort((a, b) =>
    String(b.savedOfflineAt || '').localeCompare(String(a.savedOfflineAt || ''))
  );
}

/**
 * Reconciles unsaved local cloud recovery drafts against the latest server courses
 * fetched for a company workspace.
 * - Solo edits where the server copy hasn't moved (or unsaved newly created courses)
 *   are safely auto-restored and queued for cloud sync.
 * - Edits where the server copy changed independently (or was deleted) are surfaced
 *   as conflicts so the user can choose without silently overwriting a teammate's work.
 */
export function reconcileCloudRecoveryDrafts(
  serverProjects: CourseProject[],
  drafts: CloudRecoveryDraft[],
  normalizeProject: (raw: any) => CourseProject
): ReconcileRecoveryResult {
  const byId = new Map<string, CourseProject>();
  for (const proj of serverProjects) {
    byId.set(proj.id, proj);
  }

  const autoRecoveredIds: string[] = [];
  const autoRecoveredNewIds: string[] = [];
  const conflictingDrafts: CloudRecoveryDraft[] = [];
  const discardedKeys: Array<{ companyId: string; projectId: string }> = [];

  for (const draft of drafts) {
    if (!draft?.project || !draft.projectId || !draft.companyId) continue;
    const normalizedDraftProject = normalizeProject({
      ...draft.project,
      id: draft.projectId,
      companyId: draft.companyId,
    });

    const serverProj = byId.get(draft.projectId);
    if (!serverProj) {
      if (draft.isNewCourse) {
        byId.set(draft.projectId, normalizedDraftProject);
        autoRecoveredIds.push(draft.projectId);
        autoRecoveredNewIds.push(draft.projectId);
      } else {
        conflictingDrafts.push({
          ...draft,
          project: normalizedDraftProject,
          lastSyncError:
            draft.lastSyncError ||
            'This course is no longer on the server (it may have been deleted while you were offline).',
        });
      }
      continue;
    }

    const serverUpdatedAt = String(serverProj.updatedAt || '');
    const draftUpdatedAt = String(normalizedDraftProject.updatedAt || '');
    const baseUpdatedAt = draft.baseServerUpdatedAt ? String(draft.baseServerUpdatedAt) : null;

    if (baseUpdatedAt === serverUpdatedAt && draftUpdatedAt <= serverUpdatedAt) {
      discardedKeys.push({ companyId: draft.companyId, projectId: draft.projectId });
      continue;
    }

    if (baseUpdatedAt === serverUpdatedAt && draftUpdatedAt > serverUpdatedAt) {
      byId.set(draft.projectId, normalizedDraftProject);
      autoRecoveredIds.push(draft.projectId);
      continue;
    }

    conflictingDrafts.push({
      ...draft,
      project: normalizedDraftProject,
      lastSyncError:
        draft.lastSyncError ||
        'Another session updated this course in the cloud while your local changes were unsynced.',
    });
  }

  return {
    projects: Array.from(byId.values()).sort((a, b) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    ),
    autoRecoveredIds,
    autoRecoveredNewIds,
    conflictingDrafts,
    discardedKeys,
  };
}
