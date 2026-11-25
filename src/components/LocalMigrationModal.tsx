import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  Database,
  Loader2,
  X,
} from 'lucide-react';
import type { CourseProject, CourseTemplate } from '../types';
import { apiFetch, parseApiJson } from '../utils/apiClient';

interface LocalMigrationModalProps {
  isOpen: boolean;
  companyName: string;
  readLocalBackup: () => Promise<{ projects: CourseProject[]; customTemplates: CourseTemplate[] }>;
  onClose: () => void;
  onMigrationComplete: () => Promise<void>;
}

export const LocalMigrationModal: React.FC<LocalMigrationModalProps> = ({
  isOpen,
  companyName,
  readLocalBackup,
  onClose,
  onMigrationComplete,
}) => {
  const [localProjects, setLocalProjects] = useState<CourseProject[]>([]);
  const [localTemplates, setLocalTemplates] = useState<CourseTemplate[]>([]);
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<{
    migratedCourses: number;
    skippedCourses: number;
    migratedTemplates: number;
    skippedTemplates: number;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoadingLocal(true);
    setErrorMsg(null);
    setResult(null);
    readLocalBackup()
      .then(data => {
        setLocalProjects(data.projects || []);
        setLocalTemplates(data.customTemplates || []);
      })
      .catch(() => {
        setErrorMsg('Could not read local browser IndexedDB/localStorage data.');
      })
      .finally(() => setLoadingLocal(false));
  }, [isOpen, readLocalBackup]);

  if (!isOpen) return null;

  const handleMigrate = async () => {
    setMigrating(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/v2/courses/migrate-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projects: localProjects,
          customTemplates: localTemplates,
        }),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Local workspace migration failed.');
      }
      setResult({
        migratedCourses: Number(data.migratedCourses || 0),
        skippedCourses: Number(data.skippedCourses || 0),
        migratedTemplates: Number(data.migratedTemplates || 0),
        skippedTemplates: Number(data.skippedTemplates || 0),
      });
      await onMigrationComplete();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Migration failed.');
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-slate-200 border-t-[3px] border-t-accent max-w-lg w-full shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-accent-ink" />
            <h2 className="text-base font-bold text-primary">
              Migrate Local Courses to Cloud
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 text-xs">
          <p className="text-slate-600 leading-relaxed">
            Safely copy existing courses and custom templates stored in this browser (IndexedDB /
            localStorage) into <strong>{companyName}</strong>. Local browser copies are preserved
            intact, and already-migrated items are skipped automatically to avoid duplicates.
          </p>

          {loadingLocal ? (
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Scanning local browser storage...</span>
            </div>
          ) : (
            <div className="p-4 bg-surface border border-slate-200 rounded-lg space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-600">Local Course Projects Found:</span>
                <strong className="text-primary tabular-nums">{localProjects.length}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Local Custom Templates Found:</span>
                <strong className="text-primary tabular-nums">{localTemplates.length}</strong>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {result && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Migration Complete</span>
              </div>
              <div>
                Migrated {result.migratedCourses} course(s) ({result.skippedCourses} already in cloud skipped).
              </div>
              <div>
                Migrated {result.migratedTemplates} template(s) ({result.skippedTemplates} skipped).
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 font-semibold cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              disabled={migrating || loadingLocal || (localProjects.length === 0 && localTemplates.length === 0)}
              onClick={() => void handleMigrate()}
              className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-dark disabled:opacity-50 text-primary-contrast font-bold flex items-center gap-1.5 cursor-pointer"
            >
              {migrating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudUpload className="w-3.5 h-3.5 text-accent" />}
              <span>{migrating ? 'Migrating...' : 'Migrate to Cloud Workspace'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
