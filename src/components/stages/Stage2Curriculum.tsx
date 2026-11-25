import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  AIProvider,
  CourseProject,
  CurriculumModulePlan,
} from '../../types';
import { apiFetch, compactSourcesForApi, parseApiJson } from '../../utils/apiClient';

interface Stage2CurriculumProps {
  project: CourseProject;
  selectedProvider: AIProvider;
  selectedModel: string;
  onUpdateProject: (
    updater: (prev: CourseProject) => CourseProject,
    snapshot?: { trigger: 'stage_approval' | 'ai_generation'; summary: string }
  ) => void;
  onApproveAndContinue: () => void;
}

export const Stage2Curriculum: React.FC<Stage2CurriculumProps> = ({
  project,
  selectedProvider,
  selectedModel,
  onUpdateProject,
  onApproveAndContinue,
}) => {
  const [desiredCount, setDesiredCount] = useState<string>('');
  const [isProposing, setIsProposing] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [isAuditing, setIsAuditing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const curriculum = project.curriculum;

  const updateCurriculum = (patch: Partial<typeof curriculum>) => {
    onUpdateProject(prev => ({
      ...prev,
      curriculum: {
        ...prev.curriculum,
        ...patch,
        approval: { approved: false },
      },
    }));
  };

  const handleProposeCurriculum = async (confirmed = false) => {
    if (curriculum.modules.length > 0 && !confirmed) {
      setConfirmOverwrite(true);
      return;
    }
    setConfirmOverwrite(false);
    setIsProposing(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/v2/curriculum/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief: project.brief,
          sources: compactSourcesForApi(project.sources),
          desiredModuleCount: desiredCount ? Number(desiredCount) : undefined,
          existingModules: curriculum.modules.length > 0 ? curriculum.modules : undefined,
          provider: selectedProvider,
          model: selectedModel,
        }),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to propose curriculum.');
      }
      onUpdateProject(
        prev => ({
          ...prev,
          curriculum: data.curriculum,
        }),
        { trigger: 'ai_generation', summary: 'Generated Stage 2 Curriculum Architecture' }
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to propose curriculum.');
    } finally {
      setIsProposing(false);
    }
  };

  const handleCheckCoverage = async () => {
    setIsAuditing(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/v2/curriculum/check-coverage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief: project.brief,
          sources: compactSourcesForApi(project.sources),
          curriculum,
          provider: selectedProvider,
          model: selectedModel,
        }),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Coverage check failed.');
      }
      updateCurriculum({
        coverageChecks: data.coverageChecks || [],
        conflicts: data.conflicts || [],
      });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Coverage check failed.');
    } finally {
      setIsAuditing(false);
    }
  };

  const addModule = () => {
    const order = curriculum.modules.length + 1;
    const mod: CurriculumModulePlan = {
      id: `mod-${Date.now()}`,
      order,
      title: `Module ${order}: New Module`,
      qctoModuleType: project.brief.saCompliance.qctoModulePattern ? 'Knowledge Module' : 'Standard Module',
      purpose: '',
      objectives: [''],
      competencies: [''],
      topics: [{ id: `top-${Date.now()}`, title: 'Core Topic', subtopics: [] }],
      lessons: [
        {
          id: `les-${Date.now()}`,
          title: 'Lesson 1',
          durationMinutes: 35,
          purpose: '',
          keyTerms: [],
        },
      ],
    };
    updateCurriculum({ modules: [...curriculum.modules, mod] });
  };

  const updateModule = (idx: number, patch: Partial<CurriculumModulePlan>) => {
    const next = curriculum.modules.map((m, i) => (i === idx ? { ...m, ...patch } : m));
    updateCurriculum({ modules: next });
  };

  const moveModule = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= curriculum.modules.length) return;
    const next = [...curriculum.modules];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    updateCurriculum({ modules: next.map((m, i) => ({ ...m, order: i + 1 })) });
  };

  const removeModule = (idx: number) => {
    const next = curriculum.modules
      .filter((_, i) => i !== idx)
      .map((m, i) => ({ ...m, order: i + 1 }));
    updateCurriculum({ modules: next });
  };

  const omittedCount = curriculum.coverageChecks.filter(c => c.status === 'omitted').length;
  const unresolvedConflicts = curriculum.conflicts.filter(c => !c.resolved).length;
  const canApprove =
    curriculum.modules.length > 0 && omittedCount === 0 && unresolvedConflicts === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-primary">
            Stage 2: Curriculum Architecture & Preservation
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Define modules, topics, lessons, and verify zero silent omission against the Course Brief.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={1}
            max={12}
            value={desiredCount}
            onChange={e => setDesiredCount(e.target.value)}
            placeholder="Modules (auto)"
            className="w-32 px-2.5 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-accent"
          />
          <button
            type="button"
            disabled={isProposing}
            onClick={() => handleProposeCurriculum(false)}
            className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-dark disabled:opacity-60 text-accent-contrast text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            {isProposing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            <span>{curriculum.modules.length > 0 ? 'Regenerate Proposal' : 'Propose Curriculum'}</span>
          </button>
        </div>
      </div>

      {confirmOverwrite && (
        <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-950">
          <div>
            <strong>Confirm Curriculum Regeneration:</strong> Re-proposing will replace the current {curriculum.modules.length} module(s) and clear Stage 2 approval. A version snapshot is saved automatically beforehand.
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleProposeCurriculum(true)}
              className="px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-bold cursor-pointer"
            >
              Confirm Regenerate
            </button>
            <button
              type="button"
              onClick={() => setConfirmOverwrite(false)}
              className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-900 font-semibold cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Rationale & Add Module */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-primary">
            Curriculum Structure ({curriculum.modules.length} Modules)
          </h3>
          <button
            type="button"
            onClick={addModule}
            className="px-3 py-1.5 text-xs font-bold bg-accent-tint hover:bg-accent-soft border border-accent-border text-primary rounded-lg flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-accent-ink" />
            <span>Add Module</span>
          </button>
        </div>
        {curriculum.rationale && (
          <p className="text-xs text-slate-600 bg-surface p-3 rounded-lg border border-slate-200">
            {curriculum.rationale}
          </p>
        )}

        {curriculum.modules.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">
            Click <strong>Propose Curriculum</strong> to analyse your Stage 1 brief and sources, or click <strong>Add Module</strong> to structure manually.
          </div>
        ) : (
          <div className="space-y-4">
            {curriculum.modules.map((mod, mIdx) => (
              <div key={mod.id} className="border border-slate-200 border-t-[3px] border-t-accent rounded-lg p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-mono font-bold text-accent-ink bg-accent-tint px-1.5 py-0.5 rounded">M{mod.order}</span>
                  <input
                    type="text"
                    value={mod.title}
                    onChange={e => updateModule(mIdx, { title: e.target.value })}
                    className="flex-1 min-w-[200px] px-3 py-1.5 text-sm font-bold text-primary border border-slate-200 rounded focus:outline-none focus:border-accent"
                  />
                  {project.brief.saCompliance.qctoModulePattern && (
                    <select
                      value={mod.qctoModuleType || 'Knowledge Module'}
                      onChange={e => updateModule(mIdx, { qctoModuleType: e.target.value as any })}
                      className="px-2 py-1.5 text-xs border border-slate-200 rounded bg-surface"
                    >
                      <option value="Knowledge Module">Knowledge Module</option>
                      <option value="Practical Skill Module">Practical Skill Module</option>
                      <option value="Work Experience Module">Work Experience Module</option>
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={() => moveModule(mIdx, -1)}
                    className="p-1.5 text-slate-500 hover:text-primary cursor-pointer"
                    title="Move Up"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveModule(mIdx, 1)}
                    className="p-1.5 text-slate-500 hover:text-primary cursor-pointer"
                    title="Move Down"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeModule(mIdx)}
                    className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                    title="Remove Module"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Module Purpose
                    </label>
                    <textarea
                      rows={2}
                      value={mod.purpose}
                      onChange={e => updateModule(mIdx, { purpose: e.target.value })}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Subject Competencies (comma-separated)
                    </label>
                    <textarea
                      rows={2}
                      value={mod.competencies.join(', ')}
                      onChange={e =>
                        updateModule(mIdx, {
                          competencies: e.target.value
                            .split(',')
                            .map(s => s.trim())
                            .filter(Boolean),
                        })
                      }
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded"
                    />
                  </div>
                </div>

                {/* Topics & Lessons */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-primary">
                        Topics & Subtopics ({mod.topics.length})
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateModule(mIdx, {
                            topics: [
                              ...mod.topics,
                              { id: `top-${Date.now()}`, title: 'New Topic', subtopics: [] },
                            ],
                          })
                        }
                        className="text-[11px] font-semibold text-accent-ink hover:underline cursor-pointer"
                      >
                        + Add Topic
                      </button>
                    </div>
                    {mod.topics.map((top, tIdx) => (
                      <div key={top.id} className="bg-surface p-2.5 rounded border border-slate-200 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={top.title}
                            onChange={e => {
                              const nextTopics = mod.topics.map((t, i) =>
                                i === tIdx ? { ...t, title: e.target.value } : t
                              );
                              updateModule(mIdx, { topics: nextTopics });
                            }}
                            className="flex-1 px-2 py-1 text-xs font-semibold bg-white border border-slate-200 rounded"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              updateModule(mIdx, {
                                topics: mod.topics.filter((_, i) => i !== tIdx),
                              })
                            }
                            className="text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        <input
                          type="text"
                          value={top.subtopics.join(', ')}
                          onChange={e => {
                            const nextTopics = mod.topics.map((t, i) =>
                              i === tIdx
                                ? {
                                    ...t,
                                    subtopics: e.target.value
                                      .split(',')
                                      .map(s => s.trim())
                                      .filter(Boolean),
                                  }
                                : t
                            );
                            updateModule(mIdx, { topics: nextTopics });
                          }}
                          placeholder="Subtopics (comma-separated)..."
                          className="w-full px-2 py-1 text-[11px] bg-white border border-slate-200 rounded"
                        />
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-primary">
                        Lessons ({mod.lessons.length})
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateModule(mIdx, {
                            lessons: [
                              ...mod.lessons,
                              {
                                id: `les-${Date.now()}`,
                                title: `Lesson ${mod.lessons.length + 1}`,
                                durationMinutes: 30,
                                purpose: '',
                                keyTerms: [],
                              },
                            ],
                          })
                        }
                        className="text-[11px] font-semibold text-accent-ink hover:underline cursor-pointer"
                      >
                        + Add Lesson
                      </button>
                    </div>
                    {mod.lessons.map((les, lIdx) => (
                      <div key={les.id} className="bg-surface p-2.5 rounded border border-slate-200 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={les.title}
                            onChange={e => {
                              const nextLessons = mod.lessons.map((l, i) =>
                                i === lIdx ? { ...l, title: e.target.value } : l
                              );
                              updateModule(mIdx, { lessons: nextLessons });
                            }}
                            className="flex-1 px-2 py-1 text-xs font-semibold bg-white border border-slate-200 rounded"
                          />
                          <input
                            type="number"
                            value={les.durationMinutes}
                            onChange={e => {
                              const nextLessons = mod.lessons.map((l, i) =>
                                i === lIdx ? { ...l, durationMinutes: Number(e.target.value) || 30 } : l
                              );
                              updateModule(mIdx, { lessons: nextLessons });
                            }}
                            className="w-16 px-1.5 py-1 text-xs font-mono bg-white border border-slate-200 rounded"
                            title="Minutes"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              updateModule(mIdx, {
                                lessons: mod.lessons.filter((_, i) => i !== lIdx),
                              })
                            }
                            className="text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        <input
                          type="text"
                          value={les.purpose}
                          onChange={e => {
                            const nextLessons = mod.lessons.map((l, i) =>
                              i === lIdx ? { ...l, purpose: e.target.value } : l
                            );
                            updateModule(mIdx, { lessons: nextLessons });
                          }}
                          placeholder="Lesson purpose / focus..."
                          className="w-full px-2 py-1 text-[11px] bg-white border border-slate-200 rounded"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Curriculum Coverage Checker */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-primary">
              Curriculum Coverage & Preservation Checker
            </h3>
            <p className="text-xs text-slate-500">
              Compares supplied brief & source topics against your current curriculum edits.
            </p>
          </div>
          <button
            type="button"
            disabled={isAuditing || curriculum.modules.length === 0}
            onClick={handleCheckCoverage}
            className="px-3.5 py-2 text-xs font-bold border border-primary/30 text-primary hover:bg-accent-tint/50 disabled:opacity-50 rounded-lg flex items-center gap-1.5 cursor-pointer"
          >
            {isAuditing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 text-accent-ink" />}
            <span>Re-run Coverage Check</span>
          </button>
        </div>

        {curriculum.coverageChecks.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-bold">Original Topic</th>
                  <th className="py-2 px-3 font-bold">Status</th>
                  <th className="py-2 px-3 font-bold">Mapped Location</th>
                  <th className="py-2 pl-3 font-bold">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {curriculum.coverageChecks.map(item => (
                  <tr key={item.id}>
                    <td className="py-2.5 pr-3 font-medium text-slate-800">{item.originalTopic}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`font-bold uppercase text-[11px] ${
                          item.status === 'mapped'
                            ? 'text-emerald-700'
                            : item.status === 'omitted'
                            ? 'text-red-700'
                            : item.status === 'generalised' || item.status === 'clarification_needed'
                            ? 'text-amber-700'
                            : 'text-primary'
                        }`}
                      >
                        {item.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-700">{item.mappedLocation}</td>
                    <td className="py-2.5 pl-3 text-slate-600">{item.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            No coverage audit rows yet. Propose curriculum or run coverage check after editing modules.
          </p>
        )}

        {curriculum.conflicts.length > 0 && (
          <div className="space-y-2 pt-2">
            <h4 className="text-xs font-bold text-amber-800">
              Source / Scope Conflicts Requiring Developer Decision
            </h4>
            {curriculum.conflicts.map((conf, idx) => (
              <div key={conf.id} className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                <div className="text-xs text-amber-900 font-medium">{conf.description}</div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={conf.decision || ''}
                    onChange={e => {
                      const next = curriculum.conflicts.map((c, i) =>
                        i === idx ? { ...c, decision: e.target.value } : c
                      );
                      updateCurriculum({ conflicts: next });
                    }}
                    placeholder="Document your resolution decision..."
                    className="flex-1 px-2.5 py-1 text-xs bg-white border border-amber-300 rounded"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const next = curriculum.conflicts.map((c, i) =>
                        i === idx ? { ...c, resolved: !c.resolved } : c
                      );
                      updateCurriculum({ conflicts: next });
                    }}
                    className={`px-3 py-1 text-xs font-bold rounded cursor-pointer ${
                      conf.resolved ? 'bg-emerald-600 text-white' : 'bg-white border border-amber-400 text-amber-900'
                    }`}
                  >
                    {conf.resolved ? 'Resolved' : 'Mark Resolved'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Approval Gate */}
      <div className="bg-white border border-slate-200 border-t-[3px] border-t-accent rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-xs text-slate-600">
          {omittedCount > 0
            ? `${omittedCount} omitted topic(s) must be mapped before approving.`
            : unresolvedConflicts > 0
            ? `${unresolvedConflicts} conflict(s) require resolution before approving.`
            : 'Verify module sequence and topic coverage before generating outcomes.'}
        </div>
        <button
          type="button"
          disabled={!canApprove}
          onClick={() => {
            onUpdateProject(
              prev => ({
                ...prev,
                currentStage: 3,
                curriculum: {
                  ...prev.curriculum,
                  approval: {
                    approved: true,
                    approvedAt: new Date().toISOString(),
                    approvedBy: 'Course Developer',
                  },
                },
              }),
              { trigger: 'stage_approval', summary: 'Approved Stage 2 Curriculum Architecture' }
            );
            onApproveAndContinue();
          }}
          className="px-5 py-2.5 rounded-lg bg-primary hover:bg-primary-dark disabled:opacity-50 text-primary-contrast border-b-2 border-accent text-xs font-bold flex items-center gap-2 cursor-pointer"
        >
          <CheckCircle2 className="w-4 h-4 text-accent" />
          <span>Approve Curriculum & Continue to Stage 3</span>
        </button>
      </div>
    </div>
  );
};
