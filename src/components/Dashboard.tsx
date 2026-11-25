import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  CloudUpload,
  Copy,
  Download,
  FilePlus2,
  FolderOpen,
  Layers,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  CompanyWorkspace,
  CourseLifecycleStatus,
  CourseProject,
  CourseTemplate,
} from '../types';

interface DashboardProps {
  projects: CourseProject[];
  templates: CourseTemplate[];
  activeCompany?: CompanyWorkspace | null;
  pendingLocalMigrationCount?: number;
  onOpenLocalMigration?: () => void;
  onOpenProject: (projectId: string) => void;
  onCreateNewCourse: () => void;
  onDuplicateProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onOpenTemplates: () => void;
  onExportWorkspace: () => void;
  onImportWorkspace: (rawJson: string) => void;
}

const STAGE_LABELS: Record<number, string> = {
  1: '1. Course Brief',
  2: '2. Curriculum Architecture',
  3: '3. Learning Outcomes',
  4: '4. Assessment Design',
  5: '5. Learning Content',
  6: '6. Quality Assurance',
  7: '7. Publish & Export',
};

const STATUS_LABELS: Record<CourseLifecycleStatus, string> = {
  draft: 'Draft',
  in_development: 'In Development',
  awaiting_review: 'Awaiting Review',
  revision_required: 'Revision Required',
  completed: 'Completed',
};

export const Dashboard: React.FC<DashboardProps> = ({
  projects,
  templates,
  activeCompany,
  pendingLocalMigrationCount = 0,
  onOpenLocalMigration,
  onOpenProject,
  onCreateNewCourse,
  onDuplicateProject,
  onDeleteProject,
  onOpenTemplates,
  onExportWorkspace,
  onImportWorkspace,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | CourseLifecycleStatus>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [importFeedback, setImportFeedback] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const brandTitle = activeCompany?.companyName || 'eStudy South Africa';

  const counts = useMemo(() => {
    const map = {
      total: projects.length,
      draft: 0,
      in_development: 0,
      awaiting_review: 0,
      revision_required: 0,
      completed: 0,
      templates: templates.length,
    };
    for (const p of projects) {
      map[p.lifecycleStatus] = (map[p.lifecycleStatus] || 0) + 1;
    }
    return map;
  }, [projects, templates]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return projects.filter(p => {
      if (statusFilter !== 'all' && p.lifecycleStatus !== statusFilter) return false;
      if (!q) return true;
      return (
        (p.brief.title || '').toLowerCase().includes(q) ||
        (p.brief.code || '').toLowerCase().includes(q) ||
        (p.brief.industryDomain || '').toLowerCase().includes(q)
      );
    });
  }, [projects, searchQuery, statusFilter]);

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      onImportWorkspace(text);
      setImportFeedback(`Imported courses from ${file.name}`);
    } catch {
      setImportFeedback('Could not parse workspace JSON file.');
    }
    e.target.value = '';
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Hero Workspace Banner */}
      <section className="rounded-xl p-6 sm:p-8 bg-brand-gradient text-primary-contrast border border-slate-900/15 border-b-[3px] border-b-accent flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 shadow-xs">
        <div className="max-w-2xl space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider opacity-95">
            <span className="w-2.5 h-2.5 rounded-sm bg-accent shrink-0" />
            <span>{brandTitle} · Instructional Design Platform V2</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Course Development Workspace
          </h1>
          <p className="text-sm opacity-85 leading-relaxed">
            Build outcomes-based, subject-specific learning programmes through a structured 7-stage process with curriculum coverage verification, outcome-to-assessment alignment, source grounding, and weighted quality assurance.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onCreateNewCourse}
            className="px-5 py-3 rounded-lg bg-accent hover:bg-accent-dark text-accent-contrast font-bold text-sm flex items-center gap-2 whitespace-nowrap cursor-pointer transition-colors shadow-sm"
          >
            <FilePlus2 className="w-4 h-4" />
            <span>Create New Course</span>
          </button>
          <button
            type="button"
            onClick={onOpenTemplates}
            className="px-4 py-3 rounded-lg bg-white/12 hover:bg-white/20 border border-accent/60 text-primary-contrast font-semibold text-sm flex items-center gap-2 whitespace-nowrap cursor-pointer transition-colors"
          >
            <Layers className="w-4 h-4 text-accent" />
            <span>Manage Templates ({counts.templates})</span>
          </button>
        </div>
      </section>

      {pendingLocalMigrationCount > 0 && onOpenLocalMigration && (
        <section className="bg-white border border-amber-300 rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-700">
            <strong className="text-primary">
              {pendingLocalMigrationCount} local browser course project(s)
            </strong>{' '}
            were detected from previous local storage and have not yet been copied into{' '}
            <strong>{brandTitle}</strong>.
          </div>
          <button
            type="button"
            onClick={onOpenLocalMigration}
            className="px-3.5 py-1.5 rounded-lg bg-primary hover:bg-primary-dark text-primary-contrast text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <CloudUpload className="w-3.5 h-3.5 text-accent" />
            <span>Migrate Local Courses</span>
          </button>
        </section>
      )}

      {/* Practical Overview Strip */}
      <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: 'Total Courses', value: counts.total, highlight: true },
          { label: 'Draft', value: counts.draft, highlight: false },
          { label: 'In Development', value: counts.in_development, highlight: false },
          { label: 'Awaiting Review', value: counts.awaiting_review, highlight: false },
          { label: 'Revision Required', value: counts.revision_required, highlight: false },
          { label: 'Completed', value: counts.completed, highlight: true },
          { label: 'Saved Templates', value: counts.templates, highlight: true },
        ].map(stat => (
          <div
            key={stat.label}
            className={`rounded-lg px-4 py-3 border transition-colors ${
              stat.highlight
                ? 'bg-accent-tint/55 border-accent-border border-t-[3px] border-t-accent'
                : 'bg-white border-slate-200 border-t-[3px] border-t-primary/30'
            }`}
          >
            <div className="text-xs text-slate-600 font-medium truncate">{stat.label}</div>
            <div
              className={`text-2xl font-bold tabular-nums mt-0.5 ${
                stat.highlight ? 'text-accent-ink' : 'text-primary'
              }`}
            >
              {stat.value}
            </div>
          </div>
        ))}
      </section>

      {/* Filter & Backup Bar */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-accent-ink absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search title, code, or industry..."
              className="pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-surface focus:bg-white focus:outline-none focus:border-accent w-64 transition-colors"
            />
          </div>

          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            className={`px-3 py-2 text-sm border rounded-lg font-medium focus:outline-none focus:border-accent cursor-pointer ${
              statusFilter !== 'all'
                ? 'bg-accent-tint border-accent-border text-primary font-semibold'
                : 'bg-surface border-slate-200 text-slate-700'
            }`}
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="in_development">In Development</option>
            <option value="awaiting_review">Awaiting Review</option>
            <option value="revision_required">Revision Required</option>
            <option value="completed">Completed</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImportFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-2 text-xs font-semibold text-primary bg-surface hover:bg-accent-tint/60 border border-slate-200 hover:border-accent-border rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <Upload className="w-3.5 h-3.5 text-accent-ink" />
            <span>Import Backup</span>
          </button>
          <button
            type="button"
            onClick={onExportWorkspace}
            className="px-3 py-2 text-xs font-semibold text-primary bg-surface hover:bg-accent-tint/60 border border-slate-200 hover:border-accent-border rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-accent-ink" />
            <span>Export Backup</span>
          </button>
        </div>
      </section>

      {importFeedback && (
        <div className="bg-accent-tint border border-accent-border rounded-lg px-4 py-2.5 text-xs text-primary flex items-center justify-between">
          <span>{importFeedback}</span>
          <button
            type="button"
            onClick={() => setImportFeedback(null)}
            className="text-slate-600 hover:text-slate-900 font-semibold cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Course Cards Grid */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 border-t-[3px] border-t-accent rounded-xl p-12 text-center space-y-3">
          <FolderOpen className="w-10 h-10 text-accent-ink/60 mx-auto" />
          <h2 className="text-base font-bold text-primary">No matching course projects</h2>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            Create a new course from a brief, uploaded source material, or an existing course document to begin.
          </p>
          <button
            type="button"
            onClick={onCreateNewCourse}
            className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-dark text-accent-contrast text-xs font-bold cursor-pointer"
          >
            Create New Course
          </button>
        </div>
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map(project => {
            const approvedCount = [
              project.brief.approval.approved,
              project.curriculum.approval.approved,
              project.outcomes.approval.approved,
              project.assessments.approval.approved,
              project.content.approval.approved,
              Boolean(project.latestQA?.humanSignOff.signedOff),
            ].filter(Boolean).length;
            const progressPercent = Math.round((approvedCount / 6) * 100);
            const qaVerdict = project.latestQA?.verdict || 'Not Evaluated';

            return (
              <article
                key={project.id}
                className="bg-white border border-slate-200 border-t-[3px] border-t-accent rounded-xl p-5 flex flex-col justify-between gap-4 hover:border-primary/40 hover:border-t-primary transition-colors"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-primary truncate">
                        {project.brief.title || 'Untitled Course Project'}
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {project.brief.code || 'Code TBC'} · {project.brief.industryDomain || 'Domain TBC'}
                      </p>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                    {project.brief.purpose || 'Course brief pending completion.'}
                  </p>

                  <div className="text-xs text-slate-500 space-y-1 pt-1 border-t border-slate-100">
                    <div className="flex items-center justify-between">
                      <span>Stage:</span>
                      <span className="font-semibold text-slate-800">
                        {STAGE_LABELS[project.currentStage]}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Status:</span>
                      <span className="font-semibold text-accent-ink">
                        {STATUS_LABELS[project.lifecycleStatus]}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>QA Status:</span>
                      <span
                        className={`font-semibold ${
                          qaVerdict === 'PASS'
                            ? 'text-emerald-700'
                            : qaVerdict === 'FAIL'
                            ? 'text-red-700'
                            : qaVerdict === 'REVISION REQUIRED'
                            ? 'text-amber-700'
                            : 'text-slate-700'
                        }`}
                      >
                        {qaVerdict}
                        {project.latestQA ? ` (${project.latestQA.weightedScore}%)` : ''}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Modified:</span>
                      <span className="tabular-nums">
                        {new Date(project.updatedAt).toLocaleDateString('en-ZA')}
                      </span>
                    </div>
                  </div>

                  {/* Stage Approval Progress */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-600">
                      <span>Stage Approvals</span>
                      <span className="font-semibold text-accent-ink tabular-nums">
                        {progressPercent}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-primary-soft rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent transition-all"
                        style={{ width: `${Math.max(8, progressPercent)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Card Footer Actions */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenProject(project.id)}
                    className="px-3.5 py-2 rounded-lg bg-primary hover:bg-primary-dark text-primary-contrast text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <span>Open Workspace</span>
                    <ArrowRight className="w-3.5 h-3.5 text-accent" />
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Duplicate Course"
                      onClick={() => onDuplicateProject(project.id)}
                      className="p-2 text-slate-500 hover:text-primary rounded-lg hover:bg-accent-tint/60 cursor-pointer"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    {confirmDeleteId === project.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            onDeleteProject(project.id);
                            setConfirmDeleteId(null);
                          }}
                          className="px-2 py-1 text-[11px] font-bold bg-red-600 text-white rounded cursor-pointer"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1 text-[11px] text-slate-600 hover:text-slate-900 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        title="Delete Course"
                        onClick={() => setConfirmDeleteId(project.id)}
                        className="p-2 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
};
