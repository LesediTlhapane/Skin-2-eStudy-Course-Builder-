import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
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
  GeneratedLessonContent,
  GeneratedModuleContent,
  SourceVerificationStatus,
} from '../../types';
import { parseApiJson } from '../../utils/apiClient';

interface Stage5ContentProps {
  project: CourseProject;
  selectedProvider: AIProvider;
  selectedModel: string;
  initialModuleNumber?: number;
  initialGuidance?: string;
  onUpdateProject: (
    updater: (prev: CourseProject) => CourseProject,
    snapshot?: { trigger: 'stage_approval' | 'ai_generation'; summary: string }
  ) => void;
  onApproveAndContinue: () => void;
}

export const Stage5Content: React.FC<Stage5ContentProps> = ({
  project,
  selectedProvider,
  selectedModel,
  initialModuleNumber,
  initialGuidance,
  onUpdateProject,
  onApproveAndContinue,
}) => {
  const [activeModIdx, setActiveModIdx] = useState(0);
  const [generatingStatus, setGeneratingStatus] = useState<string | null>(null);
  const [regenBusyKey, setRegenBusyKey] = useState<string | null>(null);
  const [regenPrompt, setRegenPrompt] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const plannedModules = project.curriculum.modules;

  useEffect(() => {
    if (initialModuleNumber) {
      const idx = plannedModules.findIndex(m => m.order === initialModuleNumber);
      if (idx >= 0) setActiveModIdx(idx);
    }
    if (initialGuidance) {
      setRegenPrompt(initialGuidance);
    }
  }, [initialModuleNumber, initialGuidance, plannedModules]);
  const generatedModules = project.content.modules;
  const activePlan = plannedModules[activeModIdx];
  const activeGenerated = activePlan
    ? generatedModules.find(m => m.moduleId === activePlan.id)
    : undefined;

  const allOutcomes = useMemo(
    () => [...project.outcomes.courseOutcomes, ...project.outcomes.moduleOutcomes],
    [project.outcomes]
  );

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const saveModuleContentState = (
    modPlan: (typeof plannedModules)[number],
    modContent: GeneratedModuleContent,
    historyNote?: string
  ) => {
    onUpdateProject(
      prev => {
        const others = prev.content.modules.filter(m => m.moduleId !== modPlan.id);
        const nextMods = [...others, modContent].sort(
          (a, b) => a.moduleNumber - b.moduleNumber
        );
        return {
          ...prev,
          content: {
            ...prev.content,
            modules: nextMods,
            generationHistory: historyNote
              ? [
                  {
                    id: `gen-${Date.now()}`,
                    timestamp: new Date().toISOString(),
                    target: `Module ${modPlan.order}: ${modPlan.title}`,
                    provider: selectedProvider,
                    model: selectedModel,
                    status: 'success',
                    notes: historyNote,
                  },
                  ...prev.content.generationHistory,
                ]
              : prev.content.generationHistory,
            approval: { approved: false },
          },
        };
      },
      historyNote
        ? { trigger: 'ai_generation', summary: `Generated Module ${modPlan.order} learning content` }
        : undefined
    );
  };

  const generateSingleModule = async (modulePlanIndex: number, forceOverwrite = false) => {
    const modPlan = plannedModules[modulePlanIndex];
    if (!modPlan) return;
    setErrorMsg(null);

    const existing = forceOverwrite
      ? undefined
      : generatedModules.find(m => m.moduleId === modPlan.id);

    let workingModule: GeneratedModuleContent;

    if (!existing) {
      setGeneratingStatus(
        `Module ${modPlan.order}/${plannedModules.length}: Drafting overview, scenarios & knowledge checks...`
      );
      const scaffoldRes = await fetch('/api/v2/content/generate-module-scaffold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief: project.brief,
          modulePlan: modPlan,
          allModules: plannedModules,
          outcomes: project.outcomes,
          assessments: project.assessments.items,
          sources: project.sources,
          provider: selectedProvider,
          model: selectedModel,
        }),
      });
      const scaffoldData = await parseApiJson<any>(scaffoldRes);
      if (!scaffoldRes.ok || !scaffoldData.success) {
        throw new Error(
          scaffoldData.error || `Failed to generate overview for Module ${modPlan.order}.`
        );
      }
      workingModule = scaffoldData.moduleContent as GeneratedModuleContent;
      saveModuleContentState(modPlan, workingModule);
    } else {
      workingModule = {
        ...existing,
        lessons: [...existing.lessons],
      };
    }

    const plannedLessons = modPlan.lessons || [];
    for (let lIdx = 0; lIdx < plannedLessons.length; lIdx++) {
      const lp = plannedLessons[lIdx];
      const alreadyHasLesson = workingModule.lessons.some(
        l => l.lessonPlanId === lp.id || l.title === lp.title
      );
      if (alreadyHasLesson) continue;

      // Brief pacing pause between Groq requests to avoid bursting free-tier TPM/RPM
      await sleep(750);
      setGeneratingStatus(
        `Module ${modPlan.order}/${plannedModules.length} · Writing Lesson ${lIdx + 1}/${plannedLessons.length}: ${lp.title}...`
      );

      const lessonRes = await fetch('/api/v2/content/generate-lesson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief: project.brief,
          modulePlan: modPlan,
          lessonPlan: lp,
          lessonIndex: lIdx,
          outcomes: project.outcomes,
          sources: project.sources,
          provider: selectedProvider,
          model: selectedModel,
        }),
      });
      const lessonData = await parseApiJson<any>(lessonRes);
      if (!lessonRes.ok || !lessonData.success) {
        throw new Error(
          lessonData.error || `Failed to generate Lesson ${lIdx + 1} in Module ${modPlan.order}.`
        );
      }

      const generatedLesson: GeneratedLessonContent = lessonData.lesson;
      workingModule = {
        ...workingModule,
        lessons: [...workingModule.lessons, generatedLesson],
        lastGeneratedAt: new Date().toISOString(),
      };
      const isFinalLesson = lIdx === plannedLessons.length - 1;
      saveModuleContentState(
        modPlan,
        workingModule,
        isFinalLesson ? `${workingModule.lessons.length} lessons generated` : undefined
      );
    }

    if (plannedLessons.length === 0) {
      saveModuleContentState(modPlan, workingModule, 'Module overview generated');
    }
  };

  const isModuleComplete = (pm: (typeof plannedModules)[number]) => {
    const gm = generatedModules.find(m => m.moduleId === pm.id);
    if (!gm) return false;
    const expectedLessons = pm.lessons?.length || 0;
    return expectedLessons === 0 || gm.lessons.length >= expectedLessons;
  };

  const handleGenerateMissingModules = async () => {
    setErrorMsg(null);
    try {
      for (let i = 0; i < plannedModules.length; i++) {
        if (!isModuleComplete(plannedModules[i])) {
          setActiveModIdx(i);
          await generateSingleModule(i, false);
          if (i < plannedModules.length - 1) {
            await sleep(900);
          }
        }
      }
    } catch (err: any) {
      setErrorMsg(
        `${err?.message || 'Generation interrupted.'} Completed lessons & modules remain safely saved — click Generate Remaining to resume.`
      );
    } finally {
      setGeneratingStatus(null);
    }
  };

  const handleRegenerateCurrentModule = async () => {
    if (!activePlan) return;
    setErrorMsg(null);
    try {
      await generateSingleModule(activeModIdx, true);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Module regeneration failed.');
    } finally {
      setGeneratingStatus(null);
    }
  };

  const handleSelectiveRegen = async (
    targetType: 'lesson' | 'scenario' | 'case_study' | 'knowledge_check',
    targetId: string
  ) => {
    if (!activePlan || !activeGenerated) return;
    const busyKey = `${targetType}-${targetId}`;
    setRegenBusyKey(busyKey);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/v2/content/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project,
          targetType,
          moduleId: activePlan.id,
          targetId,
          instruction: regenPrompt.trim() || undefined,
          provider: selectedProvider,
          model: selectedModel,
        }),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Selective regeneration failed.');
      }
      const updated = data.updatedItem;
      onUpdateProject(
        prev => ({
          ...prev,
          content: {
            ...prev.content,
            modules: prev.content.modules.map(m => {
              if (m.moduleId !== activePlan.id) return m;
              if (targetType === 'lesson') {
                return {
                  ...m,
                  lessons: m.lessons.map(l =>
                    l.id === targetId ? { ...l, ...updated, editStatus: 'ai_draft' } : l
                  ),
                };
              }
              if (targetType === 'scenario') {
                return {
                  ...m,
                  scenarios: m.scenarios.map(s =>
                    s.id === targetId ? { ...s, ...updated } : s
                  ),
                };
              }
              if (targetType === 'case_study') {
                return {
                  ...m,
                  workplaceCaseStudies: m.workplaceCaseStudies.map(c =>
                    c.id === targetId ? { ...c, ...updated } : c
                  ),
                };
              }
              return {
                ...m,
                knowledgeChecks: m.knowledgeChecks.map(k =>
                  k.id === targetId ? { ...k, ...updated } : k
                ),
              };
            }),
            approval: { approved: false },
          },
        }),
        {
          trigger: 'ai_generation',
          summary: `Regenerated ${targetType} in Module ${activePlan.order}`,
        }
      );
      setRegenPrompt('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Selective regeneration failed.');
    } finally {
      setRegenBusyKey(null);
    }
  };

  const updateActiveModule = (patch: Partial<GeneratedModuleContent>) => {
    if (!activePlan) return;
    onUpdateProject(prev => ({
      ...prev,
      content: {
        ...prev.content,
        modules: prev.content.modules.map(m =>
          m.moduleId === activePlan.id
            ? { ...m, ...patch, editStatus: 'human_edited' }
            : m
        ),
        approval: { approved: false },
      },
    }));
  };

  const updateLesson = (lessonId: string, patch: Partial<GeneratedLessonContent>) => {
    if (!activeGenerated) return;
    updateActiveModule({
      lessons: activeGenerated.lessons.map(l =>
        l.id === lessonId ? { ...l, ...patch, editStatus: 'human_edited' } : l
      ),
    });
  };

  const remainingModuleCount = plannedModules.filter(pm => !isModuleComplete(pm)).length;
  const allModulesGenerated = plannedModules.length > 0 && remainingModuleCount === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-[#052B66]">
            Stage 5: Learning Content Generation & Editing
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Generated module-by-module from approved Stages 1–4. Edit lessons, terminology, worked examples, case studies, scenarios, claims, and knowledge checks inline or regenerate individually.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={Boolean(generatingStatus) || plannedModules.length === 0}
            onClick={handleGenerateMissingModules}
            className="px-4 py-2 rounded-lg bg-[#052B66] hover:bg-[#042150] disabled:opacity-60 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            {generatingStatus ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-[#45CC42]" />
            )}
            <span>
              {allModulesGenerated
                ? 'All Modules Generated'
                : `Generate Remaining (${remainingModuleCount})`}
            </span>
          </button>
        </div>
      </div>

      {generatingStatus && (
        <div className="p-3 bg-[#052B66] text-white rounded-lg text-xs font-semibold flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-[#45CC42]" />
          <span>{generatingStatus}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Module Selector Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {plannedModules.map((pm, idx) => {
          const isDone = isModuleComplete(pm);
          const hasPartial = !isDone && generatedModules.some(gm => gm.moduleId === pm.id);
          const isCurrent = idx === activeModIdx;
          return (
            <button
              key={pm.id}
              type="button"
              onClick={() => setActiveModIdx(idx)}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                isCurrent
                  ? 'bg-[#052B66] text-white border-[#052B66]'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-[#052B66]'
              }`}
            >
              M{pm.order}: {pm.title} {isDone ? '✓' : hasPartial ? '…' : ''}
            </button>
          );
        })}
      </div>

      {activePlan && !activeGenerated ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
          <h3 className="text-base font-bold text-[#052B66]">
            Module {activePlan.order}: {activePlan.title}
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Ready to generate lessons, worked examples, workplace scenarios, case studies, and knowledge checks aligned to Stage 3 & 4.
          </p>
          <button
            type="button"
            disabled={Boolean(generatingStatus)}
            onClick={handleRegenerateCurrentModule}
            className="px-4 py-2 rounded-lg bg-[#052B66] text-white text-xs font-bold cursor-pointer"
          >
            Generate Module {activePlan.order}
          </button>
        </div>
      ) : activePlan && activeGenerated ? (
        <div className="space-y-5">
          {/* Selective Regeneration Guidance Bar */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <input
              type="text"
              value={regenPrompt}
              onChange={e => setRegenPrompt(e.target.value)}
              placeholder="Optional guidance before clicking Regenerate on any lesson, scenario, case study, or quiz..."
              className="flex-1 px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
            />
            <button
              type="button"
              disabled={Boolean(generatingStatus)}
              onClick={handleRegenerateCurrentModule}
              className="px-3.5 py-1.5 text-xs font-bold border border-[#052B66] text-[#052B66] hover:bg-[#052B66]/5 rounded-lg flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Regenerate Full Module</span>
            </button>
          </div>

          {/* Module Intro & Objectives */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#052B66]">
                Module {activeGenerated.moduleNumber}: {activeGenerated.title}
              </h3>
              <span className="text-xs text-slate-500">
                Status: {activeGenerated.editStatus === 'human_edited' ? 'Human Edited' : 'AI Draft'}
              </span>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Module Introduction
              </label>
              <textarea
                rows={3}
                value={activeGenerated.introduction}
                onChange={e => updateActiveModule({ introduction: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700">
                  Module Learning Objectives ({activeGenerated.learningObjectives.length})
                </label>
                <button
                  type="button"
                  onClick={() =>
                    updateActiveModule({
                      learningObjectives: [...activeGenerated.learningObjectives, ''],
                    })
                  }
                  className="text-[11px] font-bold text-[#052B66] hover:underline cursor-pointer"
                >
                  + Add Objective
                </button>
              </div>
              {activeGenerated.learningObjectives.map((obj, oIdx) => (
                <div key={oIdx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={obj}
                    onChange={e => {
                      const next = [...activeGenerated.learningObjectives];
                      next[oIdx] = e.target.value;
                      updateActiveModule({ learningObjectives: next });
                    }}
                    className="flex-1 px-2.5 py-1 text-xs border border-slate-200 rounded"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      updateActiveModule({
                        learningObjectives: activeGenerated.learningObjectives.filter(
                          (_, i) => i !== oIdx
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
          </section>

          {/* Lessons with full inline editing */}
          {activeGenerated.lessons.map((lesson, idx) => {
            const linkedOutcomeIds =
              lesson.outcomeIds !== undefined
                ? lesson.outcomeIds
                : project.outcomes.moduleOutcomes
                    .filter(mo => mo.moduleId === activePlan.id)
                    .map(mo => mo.id);

            return (
              <section
                key={lesson.id}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <div className="flex flex-wrap items-center gap-2 flex-1">
                    <span className="text-xs font-mono font-bold text-[#052B66]">
                      L{idx + 1}
                    </span>
                    <input
                      type="text"
                      value={lesson.title}
                      onChange={e => updateLesson(lesson.id, { title: e.target.value })}
                      className="flex-1 min-w-[200px] px-2.5 py-1 text-sm font-bold text-[#052B66] border border-slate-200 rounded"
                    />
                    <input
                      type="number"
                      min={5}
                      value={lesson.durationMinutes}
                      onChange={e =>
                        updateLesson(lesson.id, {
                          durationMinutes: Number(e.target.value) || 30,
                        })
                      }
                      className="w-16 px-2 py-1 text-xs font-mono border border-slate-200 rounded"
                      title="Duration (minutes)"
                    />
                    <span className="text-xs text-slate-500">min</span>
                  </div>
                  <button
                    type="button"
                    disabled={regenBusyKey === `lesson-${lesson.id}`}
                    onClick={() => handleSelectiveRegen('lesson', lesson.id)}
                    className="px-3 py-1.5 text-xs font-bold border border-slate-200 hover:border-[#052B66] text-[#052B66] rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    {regenBusyKey === `lesson-${lesson.id}` ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    <span>Regenerate Lesson</span>
                  </button>
                </div>

                {/* Supported Outcomes Mapping */}
                <div className="space-y-1">
                  <span className="text-[11px] font-bold text-slate-600">
                    Supports Learning Outcomes (3-Way Alignment):
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {allOutcomes.map(out => {
                      const checked = linkedOutcomeIds.includes(out.id);
                      return (
                        <label
                          key={out.id}
                          className="inline-flex items-center gap-1 text-xs text-slate-700 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const nextIds = checked
                                ? linkedOutcomeIds.filter(id => id !== out.id)
                                : [...linkedOutcomeIds, out.id];
                              updateLesson(lesson.id, { outcomeIds: nextIds });
                            }}
                          />
                          <span className="font-mono">{out.code}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Core Subject Explanation
                    </label>
                    <textarea
                      rows={7}
                      value={lesson.explanation}
                      onChange={e => updateLesson(lesson.id, { explanation: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg leading-relaxed"
                    />
                  </div>

                  {/* Key Terminology Editor */}
                  <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#052B66]">
                        Key Terminology ({lesson.keyTerminology.length})
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateLesson(lesson.id, {
                            keyTerminology: [
                              ...lesson.keyTerminology,
                              { term: '', definition: '' },
                            ],
                          })
                        }
                        className="text-[11px] font-bold text-[#052B66] hover:underline cursor-pointer"
                      >
                        + Add Term
                      </button>
                    </div>
                    {lesson.keyTerminology.map((kt, tIdx) => (
                      <div key={tIdx} className="grid grid-cols-[1fr_2fr_auto] gap-2 items-center">
                        <input
                          type="text"
                          value={kt.term}
                          onChange={e => {
                            const next = lesson.keyTerminology.map((k, i) =>
                              i === tIdx ? { ...k, term: e.target.value } : k
                            );
                            updateLesson(lesson.id, { keyTerminology: next });
                          }}
                          placeholder="Term"
                          className="px-2 py-1 text-xs font-semibold bg-white border border-slate-200 rounded"
                        />
                        <input
                          type="text"
                          value={kt.definition}
                          onChange={e => {
                            const next = lesson.keyTerminology.map((k, i) =>
                              i === tIdx ? { ...k, definition: e.target.value } : k
                            );
                            updateLesson(lesson.id, { keyTerminology: next });
                          }}
                          placeholder="Definition"
                          className="px-2 py-1 text-xs bg-white border border-slate-200 rounded"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateLesson(lesson.id, {
                              keyTerminology: lesson.keyTerminology.filter((_, i) => i !== tIdx),
                            })
                          }
                          className="text-slate-400 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Worked Examples Editor */}
                  <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#052B66]">
                        Worked Examples ({lesson.workedExamples.length})
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateLesson(lesson.id, {
                            workedExamples: [...lesson.workedExamples, ''],
                          })
                        }
                        className="text-[11px] font-bold text-[#052B66] hover:underline cursor-pointer"
                      >
                        + Add Worked Example
                      </button>
                    </div>
                    {lesson.workedExamples.map((ex, eIdx) => (
                      <div key={eIdx} className="flex items-start gap-2">
                        <textarea
                          rows={3}
                          value={ex}
                          onChange={e => {
                            const next = [...lesson.workedExamples];
                            next[eIdx] = e.target.value;
                            updateLesson(lesson.id, { workedExamples: next });
                          }}
                          placeholder="Worked example, equation, calculation steps, or demonstration..."
                          className="flex-1 px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateLesson(lesson.id, {
                              workedExamples: lesson.workedExamples.filter((_, i) => i !== eIdx),
                            })
                          }
                          className="text-slate-400 hover:text-red-600 cursor-pointer mt-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Practical Application
                      </label>
                      <textarea
                        rows={3}
                        value={lesson.practicalApplication}
                        onChange={e =>
                          updateLesson(lesson.id, { practicalApplication: e.target.value })
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Guided Activity
                      </label>
                      <textarea
                        rows={3}
                        value={lesson.guidedActivity}
                        onChange={e =>
                          updateLesson(lesson.id, { guidedActivity: e.target.value })
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                      />
                    </div>
                  </div>

                  {/* Source Claims Grounding & Manual SME Status Override */}
                  <div className="p-3 rounded-lg bg-[#F5F7FA] border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#052B66]">
                        Source Grounding & Claim Verification ({lesson.sourceClaims?.length || 0})
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateLesson(lesson.id, {
                            sourceClaims: [
                              ...(lesson.sourceClaims || []),
                              {
                                id: `clm-${Date.now()}`,
                                claim: '',
                                sourceTitle: '',
                                status: 'NEEDS REVIEW',
                              },
                            ],
                          })
                        }
                        className="text-[11px] font-bold text-[#052B66] hover:underline cursor-pointer"
                      >
                        + Add Claim Reference
                      </button>
                    </div>
                    {(lesson.sourceClaims || []).map(cl => (
                      <div
                        key={cl.id}
                        className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_auto_auto] gap-2 items-center bg-white p-2 rounded border border-slate-200"
                      >
                        <input
                          type="text"
                          value={cl.claim}
                          onChange={e =>
                            updateLesson(lesson.id, {
                              sourceClaims: lesson.sourceClaims.map(x =>
                                x.id === cl.id ? { ...x, claim: e.target.value } : x
                              ),
                            })
                          }
                          placeholder="Technical or regulatory statement..."
                          className="px-2 py-1 text-xs border border-slate-200 rounded"
                        />
                        <input
                          type="text"
                          value={cl.sourceTitle || ''}
                          onChange={e =>
                            updateLesson(lesson.id, {
                              sourceClaims: lesson.sourceClaims.map(x =>
                                x.id === cl.id ? { ...x, sourceTitle: e.target.value } : x
                              ),
                            })
                          }
                          placeholder="Source reference"
                          className="px-2 py-1 text-xs border border-slate-200 rounded"
                        />
                        <select
                          value={cl.status}
                          onChange={e =>
                            updateLesson(lesson.id, {
                              sourceClaims: lesson.sourceClaims.map(x =>
                                x.id === cl.id
                                  ? { ...x, status: e.target.value as SourceVerificationStatus }
                                  : x
                              ),
                            })
                          }
                          className={`px-2 py-1 text-xs font-bold border rounded ${
                            cl.status === 'VERIFIED'
                              ? 'text-emerald-700 bg-emerald-50 border-emerald-300'
                              : cl.status === 'NEEDS REVIEW'
                              ? 'text-amber-700 bg-amber-50 border-amber-300'
                              : 'text-red-700 bg-red-50 border-red-300'
                          }`}
                        >
                          <option value="VERIFIED">VERIFIED</option>
                          <option value="NEEDS REVIEW">NEEDS REVIEW</option>
                          <option value="UNSUPPORTED">UNSUPPORTED</option>
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            updateLesson(lesson.id, {
                              sourceClaims: lesson.sourceClaims.filter(x => x.id !== cl.id),
                            })
                          }
                          className="text-slate-400 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            );
          })}

          {/* Workplace Case Studies (Full Inline Editor + Selective Regen) */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-[#052B66]">
                Workplace Case Studies ({activeGenerated.workplaceCaseStudies.length})
              </h4>
              <button
                type="button"
                onClick={() =>
                  updateActiveModule({
                    workplaceCaseStudies: [
                      ...activeGenerated.workplaceCaseStudies,
                      {
                        id: `cs-${Date.now()}`,
                        title: 'New Workplace Case Study',
                        background: '',
                        analysisQuestions: [''],
                        facilitatorNotes: '',
                      },
                    ],
                  })
                }
                className="px-3 py-1 text-xs font-bold bg-[#F5F7FA] border border-slate-200 rounded-lg flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>Add Case Study</span>
              </button>
            </div>

            {activeGenerated.workplaceCaseStudies.map(cs => (
              <div key={cs.id} className="p-4 border border-slate-200 rounded-lg space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={cs.title}
                    onChange={e =>
                      updateActiveModule({
                        workplaceCaseStudies: activeGenerated.workplaceCaseStudies.map(x =>
                          x.id === cs.id ? { ...x, title: e.target.value } : x
                        ),
                      })
                    }
                    className="flex-1 px-2.5 py-1 text-xs font-bold text-[#052B66] border border-slate-200 rounded"
                  />
                  <button
                    type="button"
                    disabled={regenBusyKey === `case_study-${cs.id}`}
                    onClick={() => handleSelectiveRegen('case_study', cs.id)}
                    className="px-2.5 py-1 text-xs font-semibold border border-slate-200 rounded flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Regenerate Case Study</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateActiveModule({
                        workplaceCaseStudies: activeGenerated.workplaceCaseStudies.filter(
                          x => x.id !== cs.id
                        ),
                      })
                    }
                    className="text-slate-400 hover:text-red-600 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <textarea
                  rows={3}
                  value={cs.background}
                  onChange={e =>
                    updateActiveModule({
                      workplaceCaseStudies: activeGenerated.workplaceCaseStudies.map(x =>
                        x.id === cs.id ? { ...x, background: e.target.value } : x
                      ),
                    })
                  }
                  placeholder="Workplace background & technical/operational context..."
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded"
                />

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Analysis Questions (one per line)
                  </label>
                  <textarea
                    rows={2}
                    value={cs.analysisQuestions.join('\n')}
                    onChange={e =>
                      updateActiveModule({
                        workplaceCaseStudies: activeGenerated.workplaceCaseStudies.map(x =>
                          x.id === cs.id
                            ? { ...x, analysisQuestions: e.target.value.split('\n') }
                            : x
                        ),
                      })
                    }
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Facilitator Notes & Model Analysis
                  </label>
                  <textarea
                    rows={2}
                    value={cs.facilitatorNotes}
                    onChange={e =>
                      updateActiveModule({
                        workplaceCaseStudies: activeGenerated.workplaceCaseStudies.map(x =>
                          x.id === cs.id ? { ...x, facilitatorNotes: e.target.value } : x
                        ),
                      })
                    }
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded bg-[#F5F7FA]"
                  />
                </div>
              </div>
            ))}
          </section>

          {/* Scenarios (All Fields Editable) */}
          {activeGenerated.scenarios.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <h4 className="text-sm font-bold text-[#052B66]">
                Workplace Scenarios ({activeGenerated.scenarios.length})
              </h4>
              {activeGenerated.scenarios.map(sc => (
                <div key={sc.id} className="p-4 border border-slate-200 rounded-lg space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={sc.title}
                      onChange={e =>
                        updateActiveModule({
                          scenarios: activeGenerated.scenarios.map(x =>
                            x.id === sc.id ? { ...x, title: e.target.value } : x
                          ),
                        })
                      }
                      className="flex-1 min-w-[180px] px-2.5 py-1 text-xs font-bold text-[#052B66] border border-slate-200 rounded"
                    />
                    <select
                      value={sc.contextType}
                      onChange={e =>
                        updateActiveModule({
                          scenarios: activeGenerated.scenarios.map(x =>
                            x.id === sc.id ? { ...x, contextType: e.target.value as any } : x
                          ),
                        })
                      }
                      className="px-2 py-1 text-xs border border-slate-200 rounded bg-[#F5F7FA]"
                    >
                      <option value="Workplace">Workplace</option>
                      <option value="Branching / Decision">Branching / Decision</option>
                      <option value="AI Application">AI Application</option>
                    </select>
                    <button
                      type="button"
                      disabled={regenBusyKey === `scenario-${sc.id}`}
                      onClick={() => handleSelectiveRegen('scenario', sc.id)}
                      className="px-2.5 py-1 text-xs font-semibold border border-slate-200 rounded flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Regenerate Scenario</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                        Situation
                      </label>
                      <textarea
                        rows={2}
                        value={sc.situation}
                        onChange={e =>
                          updateActiveModule({
                            scenarios: activeGenerated.scenarios.map(x =>
                              x.id === sc.id ? { ...x, situation: e.target.value } : x
                            ),
                          })
                        }
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                        Challenge / Constraint
                      </label>
                      <textarea
                        rows={2}
                        value={sc.challenge}
                        onChange={e =>
                          updateActiveModule({
                            scenarios: activeGenerated.scenarios.map(x =>
                              x.id === sc.id ? { ...x, challenge: e.target.value } : x
                            ),
                          })
                        }
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Decision Prompt
                    </label>
                    <textarea
                      rows={2}
                      value={sc.decisionPrompt}
                      onChange={e =>
                        updateActiveModule({
                          scenarios: activeGenerated.scenarios.map(x =>
                            x.id === sc.id ? { ...x, decisionPrompt: e.target.value } : x
                          ),
                        })
                      }
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                        Model Debrief
                      </label>
                      <textarea
                        rows={2}
                        value={sc.modelDebrief}
                        onChange={e =>
                          updateActiveModule({
                            scenarios: activeGenerated.scenarios.map(x =>
                              x.id === sc.id ? { ...x, modelDebrief: e.target.value } : x
                            ),
                          })
                        }
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded bg-[#F5F7FA]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                        Key Takeaway
                      </label>
                      <textarea
                        rows={2}
                        value={sc.keyTakeaway}
                        onChange={e =>
                          updateActiveModule({
                            scenarios: activeGenerated.scenarios.map(x =>
                              x.id === sc.id ? { ...x, keyTakeaway: e.target.value } : x
                            ),
                          })
                        }
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded bg-[#F5F7FA]"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* Knowledge Checks (Full Inline Editor) & Summary */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-[#052B66]">
                Module Knowledge Checks ({activeGenerated.knowledgeChecks.length}) & Summary
              </h4>
              <button
                type="button"
                onClick={() =>
                  updateActiveModule({
                    knowledgeChecks: [
                      ...activeGenerated.knowledgeChecks,
                      {
                        id: `kc-${Date.now()}`,
                        question: '',
                        options: ['Option A', 'Option B', 'Option C', 'Option D'],
                        correctIndex: 0,
                        explanation: '',
                        outcomeCode: allOutcomes[0]?.code || 'MLO-1',
                      },
                    ],
                  })
                }
                className="px-3 py-1 text-xs font-bold bg-[#F5F7FA] border border-slate-200 rounded-lg flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>Add Knowledge Check</span>
              </button>
            </div>

            {activeGenerated.knowledgeChecks.map((kc, kIdx) => (
              <div
                key={kc.id}
                className="p-3.5 bg-[#F5F7FA] border border-slate-200 rounded-lg space-y-2.5 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-bold text-[#052B66]">Q{kIdx + 1}</span>
                  <input
                    type="text"
                    value={kc.outcomeCode}
                    onChange={e =>
                      updateActiveModule({
                        knowledgeChecks: activeGenerated.knowledgeChecks.map(x =>
                          x.id === kc.id ? { ...x, outcomeCode: e.target.value } : x
                        ),
                      })
                    }
                    className="w-24 px-2 py-1 text-xs font-mono bg-white border border-slate-200 rounded"
                    title="Outcome Code"
                  />
                  <input
                    type="text"
                    value={kc.question}
                    onChange={e =>
                      updateActiveModule({
                        knowledgeChecks: activeGenerated.knowledgeChecks.map(x =>
                          x.id === kc.id ? { ...x, question: e.target.value } : x
                        ),
                      })
                    }
                    placeholder="Knowledge check question..."
                    className="flex-1 min-w-[200px] px-2.5 py-1 text-xs font-semibold bg-white border border-slate-200 rounded"
                  />
                  <button
                    type="button"
                    disabled={regenBusyKey === `knowledge_check-${kc.id}`}
                    onClick={() => handleSelectiveRegen('knowledge_check', kc.id)}
                    className="px-2 py-1 text-[11px] font-semibold bg-white border border-slate-200 rounded cursor-pointer shrink-0"
                  >
                    Regenerate
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateActiveModule({
                        knowledgeChecks: activeGenerated.knowledgeChecks.filter(
                          x => x.id !== kc.id
                        ),
                      })
                    }
                    className="text-slate-400 hover:text-red-600 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {kc.options.map((opt, oIdx) => (
                    <div key={oIdx} className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        name={`kc-key-${kc.id}`}
                        checked={kc.correctIndex === oIdx}
                        onChange={() =>
                          updateActiveModule({
                            knowledgeChecks: activeGenerated.knowledgeChecks.map(x =>
                              x.id === kc.id ? { ...x, correctIndex: oIdx } : x
                            ),
                          })
                        }
                        title="Set as correct answer"
                      />
                      <span className="font-mono font-bold">
                        {String.fromCharCode(65 + oIdx)})
                      </span>
                      <input
                        type="text"
                        value={opt}
                        onChange={e => {
                          const nextOpts = kc.options.map((o, i) =>
                            i === oIdx ? e.target.value : o
                          );
                          updateActiveModule({
                            knowledgeChecks: activeGenerated.knowledgeChecks.map(x =>
                              x.id === kc.id ? { ...x, options: nextOpts } : x
                            ),
                          });
                        }}
                        className="flex-1 px-2 py-1 bg-white border border-slate-200 rounded"
                      />
                    </div>
                  ))}
                </div>

                <input
                  type="text"
                  value={kc.explanation}
                  onChange={e =>
                    updateActiveModule({
                      knowledgeChecks: activeGenerated.knowledgeChecks.map(x =>
                        x.id === kc.id ? { ...x, explanation: e.target.value } : x
                      ),
                    })
                  }
                  placeholder="Explanation of correct answer and distractor reasoning..."
                  className="w-full px-2.5 py-1 bg-white border border-slate-200 rounded"
                />
              </div>
            ))}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Module Summary
              </label>
              <textarea
                rows={2}
                value={activeGenerated.summary}
                onChange={e => updateActiveModule({ summary: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Further Learning Resources (one per line)
              </label>
              <textarea
                rows={2}
                value={(activeGenerated.furtherLearningResources || []).join('\n')}
                onChange={e =>
                  updateActiveModule({
                    furtherLearningResources: e.target.value.split('\n'),
                  })
                }
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
              />
            </div>
          </section>
        </div>
      ) : null}

      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-xs text-slate-600">
          {allModulesGenerated
            ? 'All planned modules have generated content. Proceed to Quality Assurance.'
            : `Generated ${generatedModules.length} of ${plannedModules.length} modules.`}
        </div>
        <button
          type="button"
          disabled={!allModulesGenerated}
          onClick={() => {
            onUpdateProject(
              prev => ({
                ...prev,
                currentStage: 6,
                lifecycleStatus: 'awaiting_review',
                content: {
                  ...prev.content,
                  approval: {
                    approved: true,
                    approvedAt: new Date().toISOString(),
                    approvedBy: 'Course Developer',
                  },
                },
              }),
              { trigger: 'stage_approval', summary: 'Approved Stage 5 Learning Content for QA' }
            );
            onApproveAndContinue();
          }}
          className="px-5 py-2.5 rounded-lg bg-[#052B66] hover:bg-[#042150] disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
        >
          <CheckCircle2 className="w-4 h-4 text-[#45CC42]" />
          <span>Approve Content & Continue to Stage 6 QA</span>
        </button>
      </div>
    </div>
  );
};
