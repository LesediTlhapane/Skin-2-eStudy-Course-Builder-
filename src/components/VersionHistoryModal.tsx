import React, { useEffect, useState } from 'react';
import { AlertTriangle, History, Loader2, RotateCcw, Save, X } from 'lucide-react';
import type { CourseProject, CourseVersionSnapshot } from '../types';

interface VersionHistoryModalProps {
  isOpen: boolean;
  project: CourseProject;
  readOnly?: boolean;
  onLoadVersions?: (projectId: string) => Promise<CourseVersionSnapshot[] | void>;
  onClose: () => void;
  onSaveSnapshot: (summary: string) => void;
  onRestoreVersion: (snapshotId: string) => void;
}

export const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
  isOpen,
  project,
  readOnly = false,
  onLoadVersions,
  onClose,
  onSaveSnapshot,
  onRestoreVersion,
}) => {
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !onLoadVersions) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    onLoadVersions(project.id)
      .catch((err: any) => {
        if (!cancelled) {
          setLoadError(err?.message || 'Unable to load cloud version history.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, project.id, onLoadVersions]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-slate-200 max-w-2xl w-full max-h-[85vh] flex flex-col shadow-xl">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-accent-ink" />
            <h2 className="text-base font-bold text-primary">
              Version History & Stage Records
            </h2>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {!readOnly && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Snapshot note (e.g. 'Before SME curriculum review')..."
                className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => {
                  onSaveSnapshot(note.trim() || 'Manual developer snapshot');
                  setNote('');
                }}
                className="px-3.5 py-2 rounded-lg bg-primary hover:bg-primary-dark text-primary-contrast text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5 text-accent" />
                <span>Save Snapshot</span>
              </button>
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin text-accent-ink" />
              <span>Synchronising version history from cloud...</span>
            </div>
          )}

          {loadError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{loadError}</span>
            </div>
          )}

          {project.versions.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-6">
              Snapshots are created automatically upon stage approvals, AI generations, or manual saves.
            </p>
          ) : (
            <div className="space-y-2.5">
              {project.versions.map(ver => (
                <div
                  key={ver.id}
                  className="p-3.5 border border-slate-200 rounded-lg flex items-center justify-between gap-3"
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-xs font-bold text-primary">
                      v{ver.versionNumber} · {ver.summary}
                    </div>
                    <div className="text-[11px] text-slate-500 tabular-nums">
                      Stage {ver.stage} · {ver.trigger.replace(/_/g, ' ')} ·{' '}
                      {new Date(ver.createdAt).toLocaleString('en-ZA')}
                    </div>
                  </div>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        onRestoreVersion(ver.id);
                        onClose();
                      }}
                      className="px-3 py-1.5 text-xs font-bold border border-slate-200 hover:border-accent-border text-primary rounded-lg flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-accent-ink" />
                      <span>Restore</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
