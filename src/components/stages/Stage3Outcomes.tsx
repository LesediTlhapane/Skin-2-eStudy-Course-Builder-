import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { AIProvider, BloomLevel, CourseProject, LearningOutcome } from '../../types';
import { detectVagueOutcomeWarning } from '../../utils/alignmentHelpers';
import { parseApiJson } from '../../utils/apiClient';

interface Stage3OutcomesProps {
  project: CourseProject;
  selectedProvider: AIProvider;
  selectedModel: string;
  onUpdateProject: (
    updater: (prev: CourseProject) => CourseProject,
    snapshot?: { trigger: 'stage_approval' | 'ai_generation'; summary: string }
  ) => void;
  onApproveAndContinue: () => void;
}

const BLOOM_LEVELS: BloomLevel[] = [
  'Remember',
  'Understand',
  'Apply',
  'Analyze',
  'Evaluate',
  'Create',
];

export const Stage3Outcomes: React.FC<Stage3OutcomesProps> = ({
  project,
  selectedProvider,
  selectedModel,
  onUpdateProject,
  onApproveAndContinue,
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const outcomes = project.outcomes;

  const updateOutcomes = (patch: Partial<typeof outcomes>) => {
    onUpdateProject(prev => ({
      ...prev,
      outcomes: {
        ...prev.outcomes,
        ...patch,
        approval: { approved: false },
      },
    }));
  };

  const handleGenerateOutcomes = async () => {
    setIsGenerating(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/v2/outcomes/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief: project.brief,
          curriculum: project.curriculum,
          provider: selectedProvider,
          model: selectedModel,
        }),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to generate learning outcomes.');
      }
      onUpdateProject(
        prev => ({
          ...prev,
          outcomes: data.outcomes,
        }),
        { trigger: 'ai_generation', summary: 'Generated Stage 3 Learning Outcomes' }
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Outcome generation failed.');
    } finally {
      setIsGenerating(false);
    }
  };

  const addOutcome = (scope: 'course' | 'module', moduleId?: string) => {
    const list = scope === 'course' ? outcomes.courseOutcomes : outcomes.moduleOutcomes;
    const item: LearningOutcome = {
      id: `${scope === 'course' ? 'co' : 'mo'}-${Date.now()}`,
      scope,
      moduleId,
      code: scope === 'course' ? `CLO-${list.length + 1}` : `MLO-${list.length + 1}`,
      actionVerb: 'Demonstrate',
      bloomLevel: 'Apply',
      statement: '',
      workplacePerformance: '',
    };
    if (scope === 'course') {
      updateOutcomes({ courseOutcomes: [...outcomes.courseOutcomes, item] });
    } else {
      updateOutcomes({ moduleOutcomes: [...outcomes.moduleOutcomes, item] });
    }
  };

  const updateItem = (
    scope: 'course' | 'module',
    id: string,
    patch: Partial<LearningOutcome>
  ) => {
    if (scope === 'course') {
      updateOutcomes({
        courseOutcomes: outcomes.courseOutcomes.map(o =>
          o.id === id ? { ...o, ...patch } : o
        ),
      });
    } else {
      updateOutcomes({
        moduleOutcomes: outcomes.moduleOutcomes.map(o =>
          o.id === id ? { ...o, ...patch } : o
        ),
      });
    }
  };

  const removeItem = (scope: 'course' | 'module', id: string) => {
    if (scope === 'course') {
      updateOutcomes({
        courseOutcomes: outcomes.courseOutcomes.filter(o => o.id !== id),
      });
    } else {
      updateOutcomes({
        moduleOutcomes: outcomes.moduleOutcomes.filter(o => o.id !== id),
      });
    }
  };

  const allOutcomes = [...outcomes.courseOutcomes, ...outcomes.moduleOutcomes];
  const vagueWarnings = allOutcomes.filter(o => Boolean(detectVagueOutcomeWarning(o.statement)));
  const canApprove =
    allOutcomes.length > 0 &&
    allOutcomes.every(o => o.statement.trim().length > 5) &&
    vagueWarnings.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-[#052B66]">
            Stage 3: Measurable Learning Outcomes
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Define Bloom-aligned, workplace-connected outcomes realistic for {project.brief.estimatedDuration || 'course duration'}.
          </p>
        </div>

        <button
          type="button"
          disabled={isGenerating || project.curriculum.modules.length === 0}
          onClick={handleGenerateOutcomes}
          className="px-4 py-2 rounded-lg bg-[#052B66] hover:bg-[#042150] disabled:opacity-60 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
        >
          {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-[#45CC42]" />}
          <span>
            {outcomes.courseOutcomes.length > 0 || outcomes.moduleOutcomes.length > 0
              ? 'Regenerate Outcomes with AI'
              : 'Generate Measurable Outcomes'}
          </span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Course-Level Outcomes */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#052B66]">
            Course-Level Outcomes ({outcomes.courseOutcomes.length})
          </h3>
          <button
            type="button"
            onClick={() => addOutcome('course')}
            className="px-3 py-1.5 text-xs font-bold bg-[#F5F7FA] border border-slate-200 rounded-lg flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Course Outcome</span>
          </button>
        </div>

        {outcomes.courseOutcomes.map(out => {
          const vague = detectVagueOutcomeWarning(out.statement);
          return (
            <div key={out.id} className="p-3.5 border border-slate-200 rounded-lg space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={out.code}
                  onChange={e => updateItem('course', out.id, { code: e.target.value })}
                  className="w-20 px-2 py-1 text-xs font-mono font-bold border border-slate-200 rounded"
                />
                <select
                  value={out.bloomLevel}
                  onChange={e => updateItem('course', out.id, { bloomLevel: e.target.value as BloomLevel })}
                  className="px-2 py-1 text-xs border border-slate-200 rounded bg-[#F5F7FA]"
                >
                  {BLOOM_LEVELS.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={out.actionVerb}
                  onChange={e => updateItem('course', out.id, { actionVerb: e.target.value })}
                  placeholder="Action verb"
                  className="w-32 px-2 py-1 text-xs border border-slate-200 rounded"
                />
                <button
                  type="button"
                  onClick={() => removeItem('course', out.id)}
                  className="ml-auto text-slate-400 hover:text-red-600 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <input
                type="text"
                value={out.statement}
                onChange={e => updateItem('course', out.id, { statement: e.target.value })}
                placeholder="Measurable outcome statement..."
                className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded"
              />
              <input
                type="text"
                value={out.workplacePerformance}
                onChange={e => updateItem('course', out.id, { workplacePerformance: e.target.value })}
                placeholder="Workplace performance demonstration..."
                className="w-full px-3 py-1.5 text-xs text-slate-600 border border-slate-200 rounded bg-[#F5F7FA]"
              />
              {vague && (
                <p className="text-xs text-amber-700 font-medium">{vague}</p>
              )}
            </div>
          );
        })}
      </section>

      {/* Module-Level Outcomes */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#052B66]">
            Module-Level Outcomes ({outcomes.moduleOutcomes.length})
          </h3>
          <button
            type="button"
            onClick={() => addOutcome('module', project.curriculum.modules[0]?.id)}
            className="px-3 py-1.5 text-xs font-bold bg-[#F5F7FA] border border-slate-200 rounded-lg flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Module Outcome</span>
          </button>
        </div>

        {outcomes.moduleOutcomes.map(out => {
          const vague = detectVagueOutcomeWarning(out.statement);
          return (
            <div key={out.id} className="p-3.5 border border-slate-200 rounded-lg space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={out.code}
                  onChange={e => updateItem('module', out.id, { code: e.target.value })}
                  className="w-24 px-2 py-1 text-xs font-mono font-bold border border-slate-200 rounded"
                />
                <select
                  value={out.moduleId || ''}
                  onChange={e => updateItem('module', out.id, { moduleId: e.target.value })}
                  className="px-2 py-1 text-xs border border-slate-200 rounded bg-white max-w-[240px]"
                >
                  {project.curriculum.modules.map(m => (
                    <option key={m.id} value={m.id}>
                      M{m.order}: {m.title}
                    </option>
                  ))}
                </select>
                <select
                  value={out.bloomLevel}
                  onChange={e => updateItem('module', out.id, { bloomLevel: e.target.value as BloomLevel })}
                  className="px-2 py-1 text-xs border border-slate-200 rounded bg-[#F5F7FA]"
                >
                  {BLOOM_LEVELS.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeItem('module', out.id)}
                  className="ml-auto text-slate-400 hover:text-red-600 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <input
                type="text"
                value={out.statement}
                onChange={e => updateItem('module', out.id, { statement: e.target.value })}
                placeholder="Measurable module outcome..."
                className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded"
              />
              <input
                type="text"
                value={out.workplacePerformance}
                onChange={e => updateItem('module', out.id, { workplacePerformance: e.target.value })}
                placeholder="Observable workplace application..."
                className="w-full px-3 py-1.5 text-xs text-slate-600 border border-slate-200 rounded bg-[#F5F7FA]"
              />
              {vague && (
                <p className="text-xs text-amber-700 font-medium">{vague}</p>
              )}
            </div>
          );
        })}
      </section>

      {(outcomes.durationRealismNote || outcomes.nqfSummaryNote) && (
        <section className="bg-white border border-slate-200 rounded-xl p-4 text-xs text-slate-600 space-y-1">
          {outcomes.durationRealismNote && (
            <p><strong>Duration Realism:</strong> {outcomes.durationRealismNote}</p>
          )}
          {outcomes.nqfSummaryNote && (
            <p><strong>NQF / Standards Alignment Note:</strong> {outcomes.nqfSummaryNote}</p>
          )}
        </section>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-xs text-slate-600">
          {vagueWarnings.length > 0
            ? `${vagueWarnings.length} outcome(s) contain vague verbs (e.g. "understand"). Replace with measurable verbs.`
            : 'All outcomes must be measurable before designing assessments in Stage 4.'}
        </div>
        <button
          type="button"
          disabled={!canApprove}
          onClick={() => {
            onUpdateProject(
              prev => ({
                ...prev,
                currentStage: 4,
                outcomes: {
                  ...prev.outcomes,
                  approval: {
                    approved: true,
                    approvedAt: new Date().toISOString(),
                    approvedBy: 'Course Developer',
                  },
                },
              }),
              { trigger: 'stage_approval', summary: 'Approved Stage 3 Learning Outcomes' }
            );
            onApproveAndContinue();
          }}
          className="px-5 py-2.5 rounded-lg bg-[#052B66] hover:bg-[#042150] disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
        >
          <CheckCircle2 className="w-4 h-4 text-[#45CC42]" />
          <span>Approve Outcomes & Continue to Stage 4</span>
        </button>
      </div>
    </div>
  );
};
