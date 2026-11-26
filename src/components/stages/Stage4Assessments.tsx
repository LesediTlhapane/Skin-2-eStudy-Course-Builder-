import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  AIProvider,
  AssessmentItem,
  AssessmentItemType,
  CourseProject,
} from '../../types';
import { computeFullAlignmentReport } from '../../utils/alignmentHelpers';
import { apiFetch, parseApiJson } from '../../utils/apiClient';

interface Stage4AssessmentsProps {
  project: CourseProject;
  readOnly?: boolean;
  selectedProvider: AIProvider;
  selectedModel: string;
  onUpdateProject: (
    updater: (prev: CourseProject) => CourseProject,
    snapshot?: { trigger: 'stage_approval' | 'ai_generation'; summary: string }
  ) => void;
  onApproveAndContinue: () => void;
}

const ITEM_TYPES: Array<{ value: AssessmentItemType; label: string }> = [
  { value: 'mcq', label: 'Multiple Choice (MCQ)' },
  { value: 'multi_response', label: 'Multiple Response' },
  { value: 'matching', label: 'Matching Exercise' },
  { value: 'sequencing', label: 'Sequencing Question' },
  { value: 'short_answer', label: 'Short Answer' },
  { value: 'case_study', label: 'Case Study' },
  { value: 'branching_scenario', label: 'Branching Scenario' },
  { value: 'problem_solving', label: 'Problem-Solving Activity' },
  { value: 'practical_task', label: 'Practical Workplace Task' },
  { value: 'competency_demo', label: 'Competency Demonstration' },
  { value: 'reflection', label: 'Reflective Activity' },
];

export const Stage4Assessments: React.FC<Stage4AssessmentsProps> = ({
  project,
  readOnly = false,
  selectedProvider,
  selectedModel,
  onUpdateProject,
  onApproveAndContinue,
}) => {
  const [isDesigning, setIsDesigning] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [showLessonLinker, setShowLessonLinker] = useState(false);

  const assessments = project.assessments;
  const allOutcomes = useMemo(
    () => [...project.outcomes.courseOutcomes, ...project.outcomes.moduleOutcomes],
    [project.outcomes]
  );

  const alignmentReport = useMemo(
    () => computeFullAlignmentReport(project),
    [project]
  );

  const liveFlags = alignmentReport.flags;

  const updateAssessments = (patch: Partial<typeof assessments>) => {
    onUpdateProject(prev => {
      const nextProject: CourseProject = {
        ...prev,
        assessments: {
          ...prev.assessments,
          ...patch,
          approval: { approved: false },
        },
      };
      const report = computeFullAlignmentReport(nextProject);
      nextProject.assessments.alignmentFlags = report.flags;
      nextProject.assessments.alignmentScorePercent = report.scorePercent;
      return nextProject;
    });
  };

  const toggleLessonOutcomeLink = (moduleId: string, lessonId: string, outcomeId: string) => {
    onUpdateProject(prev => {
      const nextModules = prev.curriculum.modules.map(m => {
        if (m.id !== moduleId) return m;
        return {
          ...m,
          lessons: m.lessons.map(l => {
            if (l.id !== lessonId) return l;
            const current =
              l.outcomeIds !== undefined
                ? l.outcomeIds
                : prev.outcomes.moduleOutcomes
                    .filter(mo => mo.moduleId === moduleId)
                    .map(mo => mo.id);
            const nextIds = current.includes(outcomeId)
              ? current.filter(id => id !== outcomeId)
              : [...current, outcomeId];
            return { ...l, outcomeIds: nextIds };
          }),
        };
      });
      const nextContentMods = prev.content.modules.map(cm => {
        if (cm.moduleId !== moduleId) return cm;
        return {
          ...cm,
          lessons: cm.lessons.map(gl => {
            if (gl.lessonPlanId !== lessonId && gl.id !== lessonId) return gl;
            const current = gl.outcomeIds !== undefined ? gl.outcomeIds : [];
            const nextIds = current.includes(outcomeId)
              ? current.filter(id => id !== outcomeId)
              : [...current, outcomeId];
            return { ...gl, outcomeIds: nextIds };
          }),
        };
      });
      const updated: CourseProject = {
        ...prev,
        curriculum: { ...prev.curriculum, modules: nextModules },
        content: { ...prev.content, modules: nextContentMods },
        assessments: { ...prev.assessments, approval: { approved: false } },
      };
      const report = computeFullAlignmentReport(updated);
      updated.assessments.alignmentFlags = report.flags;
      updated.assessments.alignmentScorePercent = report.scorePercent;
      return updated;
    });
  };

  const handleDesignWithAI = async (confirmed = false) => {
    if (assessments.items.length > 0 && !confirmed) {
      setConfirmOverwrite(true);
      return;
    }
    setConfirmOverwrite(false);
    setIsDesigning(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/v2/assessments/design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief: project.brief,
          curriculum: project.curriculum,
          outcomes: project.outcomes,
          provider: selectedProvider,
          model: selectedModel,
        }),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Assessment design failed.');
      }
      const items: AssessmentItem[] = Array.isArray(data.items) ? data.items : [];
      onUpdateProject(
        prev => {
          const nextProj: CourseProject = {
            ...prev,
            assessments: {
              strategySummary: data.strategySummary || '',
              passRequirementPercent: data.passRequirementPercent ?? 70,
              knowledgeWeightPercent: data.knowledgeWeightPercent ?? 50,
              practicalWeightPercent: data.practicalWeightPercent ?? 50,
              items,
              alignmentFlags: [],
              approval: { approved: false },
            },
          };
          const report = computeFullAlignmentReport(nextProj);
          nextProj.assessments.alignmentFlags = report.flags;
          nextProj.assessments.alignmentScorePercent = report.scorePercent;
          return nextProj;
        },
        { trigger: 'ai_generation', summary: 'Designed Stage 4 Assessment Strategy & Items' }
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Assessment design failed.');
    } finally {
      setIsDesigning(false);
    }
  };

  const addAssessmentItem = () => {
    const id = `assess-${Date.now()}`;
    const newItem: AssessmentItem = {
      id,
      moduleId: project.curriculum.modules[0]?.id,
      title: 'New Workplace Assessment',
      type: 'practical_task',
      assessmentDomain: 'practical',
      classification: 'summative',
      outcomeIds: allOutcomes[0] ? [allOutcomes[0].id] : [],
      weightingPercent: 20,
      objective: '',
      instructions: '',
      promptOrQuestion: '',
      options: ['Option A', 'Option B', 'Option C', 'Option D'],
      correctIndices: [0],
      matchingPairs: [{ prompt: '', match: '' }],
      sequenceSteps: ['Step 1', 'Step 2'],
      modelAnswer: '',
      explanation: '',
      feedbackCorrect: '',
      feedbackIncorrect: '',
      markingGuide: '',
      rubric: [
        {
          criterion: 'Competency Standard',
          weightPercent: 100,
          competentStandard: 'Executes task accurately and safely',
          notYetCompetentIndicator: 'Misses critical steps or accuracy threshold',
        },
      ],
    };
    setExpandedItems(prev => ({ ...prev, [id]: true }));
    updateAssessments({ items: [...assessments.items, newItem] });
  };

  const updateItem = (id: string, patch: Partial<AssessmentItem>) => {
    updateAssessments({
      items: assessments.items.map(it => (it.id === id ? { ...it, ...patch } : it)),
    });
  };

  const toggleOutcomeLink = (item: AssessmentItem, outcomeId: string) => {
    const existingIds = Array.isArray(item.outcomeIds) ? item.outcomeIds : [];
    const exists = existingIds.includes(outcomeId);
    const nextIds = exists
      ? existingIds.filter(id => id !== outcomeId)
      : [...existingIds, outcomeId];
    updateItem(item.id, { outcomeIds: nextIds });
  };

  const criticalFlags = liveFlags.filter(f => f.severity === 'critical');
  const canApprove = !readOnly && assessments.items.length > 0 && criticalFlags.length === 0;

  return (
    <fieldset disabled={readOnly} className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-primary">
            Stage 4: Assessment Design & 3-Way Alignment Engine
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Verify Outcome → Learning Activity → Assessment Evidence traceability and edit every instrument, key, feedback, and rubric inline.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={readOnly || isDesigning || allOutcomes.length === 0}
            onClick={() => handleDesignWithAI(false)}
            className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-dark disabled:opacity-60 text-accent-contrast text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            {isDesigning ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span>
              {assessments.items.length > 0
                ? 'Regenerate Assessments with AI'
                : 'Design Assessments with AI'}
            </span>
          </button>
        </div>
      </div>

      {confirmOverwrite && (
        <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-950">
          <div>
            <strong>Confirm Assessment Regeneration:</strong> Regenerating will replace your existing {assessments.items.length} assessment item(s) and rubrics. A version snapshot is created automatically.
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleDesignWithAI(true)}
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

      {/* Strategy & Weightings */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-bold text-primary">Assessment Strategy & Pass Rules</h3>
        <textarea
          rows={2}
          value={assessments.strategySummary}
          onChange={e => updateAssessments({ strategySummary: e.target.value })}
          placeholder="Describe balance between knowledge checks, practical tasks, formative coaching, and summative evaluation..."
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-accent"
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Pass Requirement (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={assessments.passRequirementPercent}
              onChange={e => updateAssessments({ passRequirementPercent: Number(e.target.value) })}
              className="w-full px-3 py-1.5 text-sm font-mono border border-slate-200 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Knowledge Assessment Weight (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={assessments.knowledgeWeightPercent}
              onChange={e => updateAssessments({ knowledgeWeightPercent: Number(e.target.value) })}
              className="w-full px-3 py-1.5 text-sm font-mono border border-slate-200 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Practical Competence Weight (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={assessments.practicalWeightPercent}
              onChange={e => updateAssessments({ practicalWeightPercent: Number(e.target.value) })}
              className="w-full px-3 py-1.5 text-sm font-mono border border-slate-200 rounded-lg"
            />
          </div>
        </div>
        {(() => {
          const actualK = assessments.items
            .filter(it => it.assessmentDomain === 'knowledge')
            .reduce((s, it) => s + (Number(it.weightingPercent) || 0), 0);
          const actualP = assessments.items
            .filter(it => it.assessmentDomain === 'practical')
            .reduce((s, it) => s + (Number(it.weightingPercent) || 0), 0);
          const totalItemsW = actualK + actualP;
          const domainSumOk =
            assessments.knowledgeWeightPercent + assessments.practicalWeightPercent === 100;
          const itemsOk =
            assessments.items.length === 0 ||
            (totalItemsW === 100 &&
              actualK === assessments.knowledgeWeightPercent &&
              actualP === assessments.practicalWeightPercent);
          return (
            <div
              className={`px-3 py-2 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-2 ${
                domainSumOk && itemsOk
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}
            >
              <span>
                <strong>Weighting Reconciliation:</strong> Declared {assessments.knowledgeWeightPercent}% Knowledge + {assessments.practicalWeightPercent}% Practical · Actual Items: {actualK}% Knowledge + {actualP}% Practical = {totalItemsW}%
              </span>
              <span className="font-bold">
                {domainSumOk && itemsOk ? 'Balanced (100%)' : 'Mismatch — Must Equal 100% & Match Splits'}
              </span>
            </div>
          );
        })()}
      </section>

      {/* 3-Way Alignment Score & Constructive Alignment Matrix */}
      <section className="bg-white border border-slate-200 border-t-[3px] border-t-accent rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-bold text-primary">
              3-Way Constructive Alignment Matrix & Score
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">{alignmentReport.explanation}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{alignmentReport.disclaimer}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div
              className={`px-3.5 py-2 rounded-lg border text-right ${
                alignmentReport.scorePercent >= 85 && criticalFlags.length === 0
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : criticalFlags.length > 0
                  ? 'bg-red-50 border-red-200 text-red-800'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider">Alignment Score</div>
              <div className="text-lg font-mono font-bold tabular-nums">
                {alignmentReport.scorePercent}%
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowLessonLinker(v => !v)}
              className="px-3 py-2 text-xs font-bold border border-slate-200 hover:border-accent text-primary rounded-lg cursor-pointer"
            >
              {showLessonLinker ? 'Hide Lesson Links' : 'Edit Lesson-to-Outcome Links'}
            </button>
          </div>
        </div>

        {/* Optional Lesson-to-Outcome Linker Panel */}
        {showLessonLinker && (
          <div className="p-4 bg-surface border border-slate-200 rounded-lg space-y-3">
            <div className="text-xs font-bold text-primary">
              Map Planned Lessons / Learning Activities to Outcomes
            </div>
            <div className="space-y-2.5">
              {project.curriculum.modules.map(mod =>
                mod.lessons.map(les => {
                  const activeIds =
                    les.outcomeIds !== undefined
                      ? les.outcomeIds
                      : project.outcomes.moduleOutcomes
                          .filter(mo => mo.moduleId === mod.id)
                          .map(mo => mo.id);
                  return (
                    <div
                      key={les.id}
                      className="p-2.5 bg-white border border-slate-200 rounded-lg space-y-1.5"
                    >
                      <div className="text-xs font-bold text-slate-800">
                        M{mod.order}: {les.title}
                        {activeIds.length === 0 && (
                          <span className="ml-2 text-amber-700 font-semibold">
                            (Unmapped / Orphan lesson)
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {allOutcomes.map(out => (
                          <label
                            key={out.id}
                            className="inline-flex items-center gap-1 text-[11px] text-slate-700 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={activeIds.includes(out.id)}
                              onChange={() =>
                                toggleLessonOutcomeLink(mod.id, les.id, out.id)
                              }
                            />
                            <span className="font-mono">{out.code}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-3 font-bold">Learning Outcome</th>
                <th className="py-2 px-3 font-bold">Bloom</th>
                <th className="py-2 px-3 font-bold">Learning Activity / Lesson</th>
                <th className="py-2 px-3 font-bold">Assessment Evidence</th>
                <th className="py-2 pl-3 font-bold">Alignment Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {alignmentReport.rows.map(row => (
                <tr key={row.outcomeId}>
                  <td className="py-2.5 pr-3 font-medium text-slate-800">
                    <span className="font-mono font-bold text-primary">
                      {row.outcomeCode}
                    </span>{' '}
                    — {row.outcomeStatement}
                  </td>
                  <td className="py-2.5 px-3 text-slate-600">{row.bloomLevel}</td>
                  <td className="py-2.5 px-3 text-slate-700">
                    {row.learningActivities.length > 0 ? (
                      row.learningActivities.map(a => a.title).join(', ')
                    ) : (
                      <span className="font-bold text-red-700">No teaching activity</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-slate-700">
                    {row.assessmentEvidence.length > 0 ? (
                      row.assessmentEvidence
                        .map(m => `${m.title} (${m.domain})`)
                        .join(', ')
                    ) : (
                      <span className="font-bold text-red-700">None</span>
                    )}
                  </td>
                  <td className="py-2.5 pl-3">
                    {row.status === 'aligned' ? (
                      <span className="font-bold text-emerald-700">Aligned</span>
                    ) : row.status === 'critical' ? (
                      <span className="font-bold text-red-700">{row.gapReason}</span>
                    ) : (
                      <span className="font-bold text-amber-700">{row.gapReason}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {liveFlags.length > 0 && (
          <div className="space-y-1.5 pt-2">
            {liveFlags.map(flag => (
              <div
                key={flag.id}
                className={`px-3 py-2 rounded-lg text-xs border ${
                  flag.severity === 'critical'
                    ? 'bg-red-50 border-red-200 text-red-800'
                    : 'bg-amber-50 border-amber-200 text-amber-800'
                }`}
              >
                <strong>[{flag.severity.toUpperCase()}]</strong> {flag.message}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Assessment Items List with Complete Inline Editors */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-primary">
            Assessment Instruments ({assessments.items.length})
          </h3>
          <button
            type="button"
            onClick={addAssessmentItem}
            className="px-3 py-1.5 text-xs font-bold bg-accent-tint hover:bg-accent-soft border border-accent-border text-primary rounded-lg flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-accent-ink" />
            <span>Add Assessment Item</span>
          </button>
        </div>

        <div className="space-y-4">
          {assessments.items.map(item => {
            const isExpanded = expandedItems[item.id] ?? true;
            const rubricTotal = (item.rubric || []).reduce(
              (sum, r) => sum + (Number(r.weightPercent) || 0),
              0
            );
            const showOptionsEditor = item.type === 'mcq' || item.type === 'multi_response';
            const showMatchingEditor = item.type === 'matching';
            const showSequenceEditor = item.type === 'sequencing';

            return (
              <div key={item.id} className="border border-slate-200 border-t-[3px] border-t-accent/70 rounded-lg p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={item.title}
                    onChange={e => updateItem(item.id, { title: e.target.value })}
                    className="flex-1 min-w-[200px] px-2.5 py-1.5 text-sm font-bold text-primary border border-slate-200 rounded focus:outline-none focus:border-accent"
                  />
                  <select
                    value={item.type}
                    onChange={e =>
                      updateItem(item.id, { type: e.target.value as AssessmentItemType })
                    }
                    className="px-2 py-1.5 text-xs border border-slate-200 rounded bg-white"
                  >
                    {ITEM_TYPES.map(t => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={item.assessmentDomain}
                    onChange={e =>
                      updateItem(item.id, { assessmentDomain: e.target.value as any })
                    }
                    className="px-2 py-1.5 text-xs border border-slate-200 rounded bg-surface"
                  >
                    <option value="knowledge">Knowledge</option>
                    <option value="practical">Practical Competence</option>
                  </select>
                  <select
                    value={item.classification}
                    onChange={e =>
                      updateItem(item.id, { classification: e.target.value as any })
                    }
                    className="px-2 py-1.5 text-xs border border-slate-200 rounded bg-surface"
                  >
                    <option value="formative">Formative</option>
                    <option value="summative">Summative</option>
                  </select>
                  <input
                    type="number"
                    value={item.weightingPercent}
                    onChange={e =>
                      updateItem(item.id, { weightingPercent: Number(e.target.value) })
                    }
                    className="w-16 px-2 py-1.5 text-xs font-mono border border-slate-200 rounded"
                    title="Weight %"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedItems(prev => ({ ...prev, [item.id]: !isExpanded }))
                    }
                    className="p-1.5 text-slate-500 hover:text-primary cursor-pointer"
                    title={isExpanded ? 'Collapse Details' : 'Expand Details'}
                  >
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateAssessments({
                        items: assessments.items.filter(x => x.id !== item.id),
                      })
                    }
                    className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Outcome Links */}
                <div className="space-y-1">
                  <span className="text-[11px] font-bold text-slate-600">Mapped Outcomes:</span>
                  <div className="flex flex-wrap gap-2">
                    {allOutcomes.map(out => {
                      const checked = Array.isArray(item.outcomeIds) && item.outcomeIds.includes(out.id);
                      return (
                        <label
                          key={out.id}
                          className="inline-flex items-center gap-1 text-xs text-slate-700 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleOutcomeLink(item, out.id)}
                          />
                          <span className="font-mono">{out.code}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {isExpanded && (
                  <div className="space-y-3 pt-2 border-t border-slate-100">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          Assessment Objective
                        </label>
                        <input
                          type="text"
                          value={item.objective || ''}
                          onChange={e => updateItem(item.id, { objective: e.target.value })}
                          placeholder="What competence or concept this verifies..."
                          className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          Learner Instructions
                        </label>
                        <input
                          type="text"
                          value={item.instructions || ''}
                          onChange={e => updateItem(item.id, { instructions: e.target.value })}
                          placeholder="Clear instructions for candidate..."
                          className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                        Prompt / Question / Task
                      </label>
                      <textarea
                        rows={3}
                        value={item.promptOrQuestion}
                        onChange={e => updateItem(item.id, { promptOrQuestion: e.target.value })}
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded"
                      />
                    </div>

                    {/* MCQ / Multiple Response Options & Key Editor */}
                    {showOptionsEditor && (
                      <div className="p-3 bg-surface border border-slate-200 rounded-lg space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-primary">
                            Answer Options & Correct Answer Key ({item.type === 'mcq' ? 'Single Correct' : 'Multi-Select'})
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              updateItem(item.id, {
                                options: [...(item.options || []), `Option ${(item.options?.length || 0) + 1}`],
                              })
                            }
                            className="text-[11px] font-bold text-accent-ink hover:underline cursor-pointer"
                          >
                            + Add Option
                          </button>
                        </div>
                        {(item.options || []).map((opt, oIdx) => {
                          const isCorrect = (item.correctIndices || []).includes(oIdx);
                          return (
                            <div key={oIdx} className="flex items-center gap-2">
                              <input
                                type={item.type === 'mcq' ? 'radio' : 'checkbox'}
                                name={`key-${item.id}`}
                                checked={isCorrect}
                                onChange={() => {
                                  if (item.type === 'mcq') {
                                    updateItem(item.id, { correctIndices: [oIdx] });
                                  } else {
                                    const current = item.correctIndices || [];
                                    updateItem(item.id, {
                                      correctIndices: isCorrect
                                        ? current.filter(i => i !== oIdx)
                                        : [...current, oIdx].sort((a, b) => a - b),
                                    });
                                  }
                                }}
                                title="Mark as correct option"
                              />
                              <span className="text-xs font-mono font-bold w-5">
                                {String.fromCharCode(65 + oIdx)})
                              </span>
                              <input
                                type="text"
                                value={opt}
                                onChange={e => {
                                  const next = [...(item.options || [])];
                                  next[oIdx] = e.target.value;
                                  updateItem(item.id, { options: next });
                                }}
                                className="flex-1 px-2 py-1 text-xs bg-white border border-slate-200 rounded"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const nextOpts = (item.options || []).filter((_, i) => i !== oIdx);
                                  const nextKeys = (item.correctIndices || [])
                                    .filter(k => k !== oIdx)
                                    .map(k => (k > oIdx ? k - 1 : k));
                                  updateItem(item.id, {
                                    options: nextOpts,
                                    correctIndices: nextKeys,
                                  });
                                }}
                                className="text-slate-400 hover:text-red-600 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Matching Pairs Editor */}
                    {showMatchingEditor && (
                      <div className="p-3 bg-surface border border-slate-200 rounded-lg space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-primary">Matching Pairs</span>
                          <button
                            type="button"
                            onClick={() =>
                              updateItem(item.id, {
                                matchingPairs: [
                                  ...(item.matchingPairs || []),
                                  { prompt: '', match: '' },
                                ],
                              })
                            }
                            className="text-[11px] font-bold text-accent-ink hover:underline cursor-pointer"
                          >
                            + Add Pair
                          </button>
                        </div>
                        {(item.matchingPairs || []).map((pair, pIdx) => (
                          <div key={pIdx} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                            <input
                              type="text"
                              value={pair.prompt}
                              onChange={e => {
                                const next = (item.matchingPairs || []).map((p, i) =>
                                  i === pIdx ? { ...p, prompt: e.target.value } : p
                                );
                                updateItem(item.id, { matchingPairs: next });
                              }}
                              placeholder="Prompt / Term"
                              className="px-2 py-1 text-xs bg-white border border-slate-200 rounded"
                            />
                            <input
                              type="text"
                              value={pair.match}
                              onChange={e => {
                                const next = (item.matchingPairs || []).map((p, i) =>
                                  i === pIdx ? { ...p, match: e.target.value } : p
                                );
                                updateItem(item.id, { matchingPairs: next });
                              }}
                              placeholder="Correct Match"
                              className="px-2 py-1 text-xs bg-white border border-slate-200 rounded"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                updateItem(item.id, {
                                  matchingPairs: (item.matchingPairs || []).filter(
                                    (_, i) => i !== pIdx
                                  ),
                                })
                              }
                              className="text-slate-400 hover:text-red-600 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Sequencing Steps Editor */}
                    {showSequenceEditor && (
                      <div className="p-3 bg-surface border border-slate-200 rounded-lg space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-primary">
                            Correct Sequence Order
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              updateItem(item.id, {
                                sequenceSteps: [
                                  ...(item.sequenceSteps || []),
                                  `Step ${(item.sequenceSteps?.length || 0) + 1}`,
                                ],
                              })
                            }
                            className="text-[11px] font-bold text-accent-ink hover:underline cursor-pointer"
                          >
                            + Add Step
                          </button>
                        </div>
                        {(item.sequenceSteps || []).map((step, sIdx) => (
                          <div key={sIdx} className="flex items-center gap-2">
                            <span className="text-xs font-mono font-bold w-6">{sIdx + 1}.</span>
                            <input
                              type="text"
                              value={step}
                              onChange={e => {
                                const next = [...(item.sequenceSteps || [])];
                                next[sIdx] = e.target.value;
                                updateItem(item.id, { sequenceSteps: next });
                              }}
                              className="flex-1 px-2 py-1 text-xs bg-white border border-slate-200 rounded"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                updateItem(item.id, {
                                  sequenceSteps: (item.sequenceSteps || []).filter(
                                    (_, i) => i !== sIdx
                                  ),
                                })
                              }
                              className="text-slate-400 hover:text-red-600 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          Model Answer
                        </label>
                        <textarea
                          rows={2}
                          value={item.modelAnswer}
                          onChange={e => updateItem(item.id, { modelAnswer: e.target.value })}
                          className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          Assessor Marking Guide
                        </label>
                        <textarea
                          rows={2}
                          value={item.markingGuide || ''}
                          onChange={e => updateItem(item.id, { markingGuide: e.target.value })}
                          placeholder="Scoring rules, evidence requirements, and critical safety/accuracy checks..."
                          className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          Feedback (Correct Response)
                        </label>
                        <input
                          type="text"
                          value={item.feedbackCorrect || ''}
                          onChange={e => updateItem(item.id, { feedbackCorrect: e.target.value })}
                          placeholder="Confirmation & reinforcement feedback..."
                          className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          Feedback (Incorrect Response)
                        </label>
                        <input
                          type="text"
                          value={item.feedbackIncorrect || ''}
                          onChange={e => updateItem(item.id, { feedbackIncorrect: e.target.value })}
                          placeholder="Diagnostic remediation guidance..."
                          className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded"
                        />
                      </div>
                    </div>

                    {/* Inline Rubric Criteria Editor */}
                    <div className="p-3 bg-surface border border-slate-200 rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-primary">
                          Evaluation Rubric ({(item.rubric || []).length} criteria · Total Weight:{' '}
                          {rubricTotal}%)
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            updateItem(item.id, {
                              rubric: [
                                ...(item.rubric || []),
                                {
                                  criterion: 'New Criterion',
                                  weightPercent: 25,
                                  competentStandard: '',
                                  notYetCompetentIndicator: '',
                                },
                              ],
                            })
                          }
                          className="text-[11px] font-bold text-accent-ink hover:underline cursor-pointer"
                        >
                          + Add Rubric Criterion
                        </button>
                      </div>

                      {(item.rubric || []).map((row, rIdx) => (
                        <div
                          key={rIdx}
                          className="p-2.5 bg-white border border-slate-200 rounded space-y-2"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={row.criterion}
                              onChange={e => {
                                const next = (item.rubric || []).map((r, i) =>
                                  i === rIdx ? { ...r, criterion: e.target.value } : r
                                );
                                updateItem(item.id, { rubric: next });
                              }}
                              placeholder="Criterion name"
                              className="flex-1 px-2 py-1 text-xs font-semibold border border-slate-200 rounded"
                            />
                            <input
                              type="number"
                              value={row.weightPercent}
                              onChange={e => {
                                const next = (item.rubric || []).map((r, i) =>
                                  i === rIdx
                                    ? { ...r, weightPercent: Number(e.target.value) || 0 }
                                    : r
                                );
                                updateItem(item.id, { rubric: next });
                              }}
                              className="w-16 px-2 py-1 text-xs font-mono border border-slate-200 rounded"
                              title="Criterion Weight %"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                updateItem(item.id, {
                                  rubric: (item.rubric || []).filter((_, i) => i !== rIdx),
                                })
                              }
                              className="text-slate-400 hover:text-red-600 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input
                              type="text"
                              value={row.competentStandard}
                              onChange={e => {
                                const next = (item.rubric || []).map((r, i) =>
                                  i === rIdx
                                    ? { ...r, competentStandard: e.target.value }
                                    : r
                                );
                                updateItem(item.id, { rubric: next });
                              }}
                              placeholder="Competent standard..."
                              className="px-2 py-1 text-[11px] border border-slate-200 rounded"
                            />
                            <input
                              type="text"
                              value={row.notYetCompetentIndicator}
                              onChange={e => {
                                const next = (item.rubric || []).map((r, i) =>
                                  i === rIdx
                                    ? { ...r, notYetCompetentIndicator: e.target.value }
                                    : r
                                );
                                updateItem(item.id, { rubric: next });
                              }}
                              placeholder="Not yet competent indicator..."
                              className="px-2 py-1 text-[11px] border border-slate-200 rounded"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="bg-white border border-slate-200 border-t-[3px] border-t-accent rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-xs text-slate-600">
          {criticalFlags.length > 0
            ? 'Resolve all critical 3-way alignment flags before proceeding to content generation.'
            : `3-Way Alignment Score: ${alignmentReport.scorePercent}% · Assessment strategy ready for approval.`}
        </div>
        <button
          type="button"
          disabled={!canApprove}
          onClick={() => {
            onUpdateProject(
              prev => ({
                ...prev,
                currentStage: 5,
                assessments: {
                  ...prev.assessments,
                  alignmentFlags: liveFlags,
                  alignmentScorePercent: alignmentReport.scorePercent,
                  approval: {
                    approved: true,
                    approvedAt: new Date().toISOString(),
                    approvedBy: 'Course Developer',
                  },
                },
              }),
              { trigger: 'stage_approval', summary: 'Approved Stage 4 Assessment Design & 3-Way Alignment' }
            );
            onApproveAndContinue();
          }}
          className="px-5 py-2.5 rounded-lg bg-primary hover:bg-primary-dark disabled:opacity-50 text-primary-contrast border-b-2 border-accent text-xs font-bold flex items-center gap-2 cursor-pointer"
        >
          <CheckCircle2 className="w-4 h-4 text-accent" />
          <span>Approve Assessments & Continue to Stage 5</span>
        </button>
      </div>
    </fieldset>
  );
};
