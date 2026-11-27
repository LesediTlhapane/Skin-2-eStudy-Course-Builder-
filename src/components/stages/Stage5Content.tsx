import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  AIProvider,
  CourseIntroduction,
  CourseProject,
  GeneratedLessonContent,
  GeneratedModuleContent,
  SourceVerificationStatus,
} from '../../types';
import {
  apiFetchWithAiBackup,
  compactProjectForApi,
  compactSourcesForApi,
  formatAiErrorMessage,
} from '../../utils/apiClient';
import { computeUpstreamStageSignatures } from '../../utils/courseValidation';
import { generateUniqueId } from '../../utils/id';

interface Stage5ContentProps {
  project: CourseProject;
  readOnly?: boolean;
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
  readOnly = false,
  selectedProvider,
  selectedModel,
  initialModuleNumber,
  initialGuidance,
  onUpdateProject,
  onApproveAndContinue,
}) => {
  const [activeModIdx, setActiveModIdx] = useState(0);
  const [generatingStatus, setGeneratingStatus] = useState<string | null>(null);
  const [confirmModuleOverwrite, setConfirmModuleOverwrite] = useState(false);
  const [regenBusyKey, setRegenBusyKey] = useState<string | null>(null);
  const [regenPrompt, setRegenPrompt] = useState<string>('');
  const [regenSuccessMsg, setRegenSuccessMsg] = useState<string | null>(null);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isIntroOpen, setIsIntroOpen] = useState(true);
  const [isDraftingIntro, setIsDraftingIntro] = useState(false);
  const bulkInFlightRef = useRef(false);
  const introInFlightRef = useRef(false);
  const selectiveInFlightRef = useRef<Set<string>>(new Set());

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

  const upstreamSigs = useMemo(
    () => computeUpstreamStageSignatures(project),
    [project]
  );

  const hasUpstreamChange = Boolean(
    generatedModules.length > 0 &&
      ((project.content.upstreamCurriculumSignature &&
        project.content.upstreamCurriculumSignature !== upstreamSigs.curriculumSignature) ||
        (project.content.upstreamOutcomesSignature &&
          project.content.upstreamOutcomesSignature !== upstreamSigs.outcomesSignature))
  );

  const courseIntro: CourseIntroduction = project.content.courseIntroduction || {
    whyThisMatters: '',
    intendedLearners: '',
    prerequisitesSummary: '',
    outcomesOverview: '',
    structureRoadmap: '',
    assessmentOverview: '',
  };

  const hasCompleteIntro = Boolean(
    courseIntro.whyThisMatters.trim() &&
      courseIntro.intendedLearners.trim() &&
      courseIntro.outcomesOverview.trim() &&
      courseIntro.structureRoadmap.trim() &&
      courseIntro.assessmentOverview.trim()
  );

  const updateCourseIntroduction = (patch: Partial<CourseIntroduction>) => {
    onUpdateProject(prev => {
      const sigs = computeUpstreamStageSignatures(prev);
      const current = prev.content.courseIntroduction || {
        whyThisMatters: '',
        intendedLearners: '',
        prerequisitesSummary: '',
        outcomesOverview: '',
        structureRoadmap: '',
        assessmentOverview: '',
      };
      return {
        ...prev,
        content: {
          ...prev.content,
          upstreamCurriculumSignature: sigs.curriculumSignature,
          upstreamOutcomesSignature: sigs.outcomesSignature,
          courseIntroduction: {
            ...current,
            ...patch,
            editStatus: 'human_edited',
          },
          approval: { approved: false },
        },
      };
    });
  };

  const handleDraftCourseIntro = async () => {
    if (introInFlightRef.current) return;
    introInFlightRef.current = true;
    setIsDraftingIntro(true);
    setErrorMsg(null);
    setBackupNotice(null);
    try {
      const { res, data, usedBackupModel } = await apiFetchWithAiBackup<any>(
        '/api/v2/content/generate-course-intro',
        {
          brief: project.brief,
          curriculum: project.curriculum,
          outcomes: project.outcomes,
          assessments: project.assessments,
          provider: selectedProvider,
          model: selectedModel,
        }
      );
      if (!res.ok || !data.success || !data.courseIntroduction) {
        throw new Error(
          formatAiErrorMessage(
            res,
            data,
            usedBackupModel,
            'Could not draft Course Introduction. Existing text was preserved.'
          )
        );
      }
      if (usedBackupModel) {
        setBackupNotice(
          'Primary AI request hit temporary capacity — backup AI model drafted the Course Introduction.'
        );
      }
      onUpdateProject(
        prev => {
          const sigs = computeUpstreamStageSignatures(prev);
          return {
            ...prev,
            content: {
              ...prev.content,
              upstreamCurriculumSignature: sigs.curriculumSignature,
              upstreamOutcomesSignature: sigs.outcomesSignature,
              courseIntroduction: data.courseIntroduction,
              approval: { approved: false },
            },
          };
        },
        { trigger: 'ai_generation', summary: 'Drafted 6-part Course Introduction' }
      );
      setIsIntroOpen(true);
      setRegenSuccessMsg('Drafted structured 6-part Course Introduction.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Course Introduction generation failed.');
    } finally {
      introInFlightRef.current = false;
      setIsDraftingIntro(false);
    }
  };

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const saveModuleContentState = (
    modPlan: (typeof plannedModules)[number],
    modContent: GeneratedModuleContent,
    historyNote?: string
  ) => {
    onUpdateProject(
      prev => {
        const sigs = computeUpstreamStageSignatures(prev);
        const others = prev.content.modules.filter(m => m.moduleId !== modPlan.id);
        const nextMods = [...others, modContent].sort(
          (a, b) => a.moduleNumber - b.moduleNumber
        );
        return {
          ...prev,
          content: {
            ...prev.content,
            upstreamCurriculumSignature: sigs.curriculumSignature,
            upstreamOutcomesSignature: sigs.outcomesSignature,
            modules: nextMods,
            generationHistory: historyNote
              ? [
                  {
                    id: generateUniqueId('gen'),
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
      const { res: scaffoldRes, data: scaffoldData, usedBackupModel } = await apiFetchWithAiBackup<any>(
        '/api/v2/content/generate-module-scaffold',
        {
          brief: project.brief,
          modulePlan: modPlan,
          allModules: plannedModules,
          outcomes: project.outcomes,
          assessments: project.assessments.items,
          sources: compactSourcesForApi(project.sources),
          provider: selectedProvider,
          model: selectedModel,
        },
        {
          onBackupFailover: () =>
            setGeneratingStatus(
              `Module ${modPlan.order}/${plannedModules.length}: Switching to backup AI model for overview...`
            ),
        }
      );
      if (!scaffoldRes.ok || !scaffoldData.success) {
        throw new Error(
          formatAiErrorMessage(
            scaffoldRes,
            scaffoldData,
            usedBackupModel,
            `Failed to generate overview for Module ${modPlan.order}. Existing content was preserved.`
          )
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

      const { res: lessonRes, data: lessonData, usedBackupModel: usedLessonBackup } = await apiFetchWithAiBackup<any>(
        '/api/v2/content/generate-lesson',
        {
          brief: project.brief,
          modulePlan: modPlan,
          lessonPlan: lp,
          lessonIndex: lIdx,
          outcomes: project.outcomes,
          sources: compactSourcesForApi(project.sources),
          provider: selectedProvider,
          model: selectedModel,
        },
        {
          onBackupFailover: () =>
            setGeneratingStatus(
              `Module ${modPlan.order}/${plannedModules.length} · Backup AI model writing Lesson ${lIdx + 1}/${plannedLessons.length}: ${lp.title}...`
            ),
        }
      );
      if (!lessonRes.ok || !lessonData.success) {
        throw new Error(
          formatAiErrorMessage(
            lessonRes,
            lessonData,
            usedLessonBackup,
            `Failed to generate Lesson ${lIdx + 1} in Module ${modPlan.order}. Existing content was preserved.`
          )
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
    if (bulkInFlightRef.current) return;
    bulkInFlightRef.current = true;
    setErrorMsg(null);
    setRegenSuccessMsg(null);
    setBackupNotice(null);
    try {
      if (!project.content.courseIntroduction?.whyThisMatters?.trim()) {
        setGeneratingStatus('Drafting 6-part Course Introduction...');
        try {
          const { res: introRes, data: introData } = await apiFetchWithAiBackup<any>(
            '/api/v2/content/generate-course-intro',
            {
              brief: project.brief,
              curriculum: project.curriculum,
              outcomes: project.outcomes,
              assessments: project.assessments,
              provider: selectedProvider,
              model: selectedModel,
            }
          );
          if (introRes.ok && introData?.success && introData.courseIntroduction) {
            onUpdateProject(prev => {
              const sigs = computeUpstreamStageSignatures(prev);
              return {
                ...prev,
                content: {
                  ...prev.content,
                  upstreamCurriculumSignature: sigs.curriculumSignature,
                  upstreamOutcomesSignature: sigs.outcomesSignature,
                  courseIntroduction: introData.courseIntroduction,
                },
              };
            });
            await sleep(750);
          }
        } catch {
          /* Allow module generation to continue even if optional auto-intro encounters a transient error */
        }
      }
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
      bulkInFlightRef.current = false;
      setGeneratingStatus(null);
    }
  };

  const handleRegenerateCurrentModule = async (confirmed = false) => {
    if (!activePlan || bulkInFlightRef.current) return;
    if (activeGenerated && !confirmed) {
      setConfirmModuleOverwrite(true);
      return;
    }
    bulkInFlightRef.current = true;
    setConfirmModuleOverwrite(false);
    setErrorMsg(null);
    setRegenSuccessMsg(null);
    try {
      await generateSingleModule(activeModIdx, true);
      setRegenSuccessMsg(
        `Regenerated Module ${activePlan.order}: ${activePlan.title}. You can return to Stage 6 to re-run QA or continue editing.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Module regeneration failed. Existing module content was preserved.');
    } finally {
      bulkInFlightRef.current = false;
      setGeneratingStatus(null);
    }
  };

  const handleSelectiveRegen = async (
    targetType: 'lesson' | 'scenario' | 'case_study' | 'knowledge_check',
    targetId: string
  ) => {
    if (!activePlan || !activeGenerated) return;
    const busyKey = `${targetType}-${targetId}`;
    if (selectiveInFlightRef.current.has(busyKey)) return;
    selectiveInFlightRef.current.add(busyKey);
    setRegenBusyKey(busyKey);
    setErrorMsg(null);
    setRegenSuccessMsg(null);
    try {
      const { res, data, usedBackupModel } = await apiFetchWithAiBackup<any>(
        '/api/v2/content/regenerate',
        {
          project: compactProjectForApi(project, { onlyModuleId: activePlan.id }),
          targetType,
          moduleId: activePlan.id,
          targetId,
          instruction: regenPrompt.trim() || undefined,
          provider: selectedProvider,
          model: selectedModel,
        }
      );
      if (!res.ok || !data.success) {
        throw new Error(
          formatAiErrorMessage(
            res,
            data,
            usedBackupModel,
            'Selective regeneration failed. Existing content was preserved.'
          )
        );
      }
      const updated = data.updatedItem;
      onUpdateProject(
        prev => {
          const sigs = computeUpstreamStageSignatures(prev);
          return {
            ...prev,
            content: {
              ...prev.content,
              upstreamCurriculumSignature: sigs.curriculumSignature,
              upstreamOutcomesSignature: sigs.outcomesSignature,
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
          };
        },
        {
          trigger: 'ai_generation',
          summary: `Regenerated ${targetType} in Module ${activePlan.order}`,
        }
      );
      setRegenPrompt('');
      setRegenSuccessMsg(
        `Regenerated ${targetType.replace('_', ' ')} in Module ${activePlan.order}${
          usedBackupModel ? ' (via backup AI model)' : ''
        }. Return to Stage 6 to re-run QA or continue editing.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Selective regeneration failed. Existing content was preserved.');
    } finally {
      selectiveInFlightRef.current.delete(busyKey);
      setRegenBusyKey(null);
    }
  };

  const updateActiveModule = (patch: Partial<GeneratedModuleContent>) => {
    if (!activePlan) return;
    onUpdateProject(prev => {
      const sigs = computeUpstreamStageSignatures(prev);
      return {
        ...prev,
        content: {
          ...prev.content,
          upstreamCurriculumSignature: sigs.curriculumSignature,
          upstreamOutcomesSignature: sigs.outcomesSignature,
          modules: prev.content.modules.map(m =>
            m.moduleId === activePlan.id
              ? { ...m, ...patch, editStatus: 'human_edited' }
              : m
          ),
          approval: { approved: false },
        },
      };
    });
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
          <h2 className="text-xl font-bold text-primary">
            Stage 5: Learning Content Generation & Editing
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Generated module-by-module from approved Stages 1–4. Edit lessons, terminology, worked examples, case studies, scenarios, claims, and knowledge checks inline or regenerate individually.
          </p>
        </div>

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={Boolean(generatingStatus) || plannedModules.length === 0}
              onClick={handleGenerateMissingModules}
            className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-dark disabled:opacity-60 text-accent-contrast text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            {generatingStatus ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span>
              {allModulesGenerated
                ? 'All Modules Generated'
                : `Generate Remaining (${remainingModuleCount})`}
            </span>
          </button>
        </div>
        )}
      </div>

      {generatingStatus && (
        <div className="p-3 bg-primary text-primary-contrast border-b-2 border-accent rounded-lg text-xs font-semibold flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-accent" />
          <span>{generatingStatus}</span>
        </div>
      )}

      {hasUpstreamChange && (
        <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-950">
          <div>
            <strong>Upstream Brief, Curriculum, or Outcomes Changed:</strong> Existing Stage 5 modules and edits remain safely intact. Review affected modules below or regenerate selectively where needed.
          </div>
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {activePlan && (
                <button
                  type="button"
                  disabled={Boolean(generatingStatus)}
                  onClick={() => handleRegenerateCurrentModule(false)}
                  className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-dark text-primary-contrast font-bold cursor-pointer"
                >
                  Regenerate M{activePlan.order}
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  onUpdateProject(prev => ({
                    ...prev,
                    content: {
                      ...prev.content,
                      upstreamCurriculumSignature: upstreamSigs.curriculumSignature,
                      upstreamOutcomesSignature: upstreamSigs.outcomesSignature,
                    },
                  }))
                }
                className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-900 font-semibold cursor-pointer"
              >
                Keep Existing Content &amp; Mark Synced
              </button>
            </div>
          )}
        </div>
      )}

      {backupNotice && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" />
          <span>{backupNotice}</span>
        </div>
      )}

      {regenSuccessMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" />
          <span>{regenSuccessMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Structured 6-Part Course Introduction Panel */}
      <section className="bg-white border border-slate-200 border-t-[3px] border-t-primary rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 bg-surface border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setIsIntroOpen(!isIntroOpen)}
            className="flex items-center gap-2 text-left cursor-pointer"
          >
            <BookOpen className="w-4 h-4 text-primary shrink-0" />
            <div>
              <h3 className="text-sm font-bold text-primary flex items-center gap-2">
                <span>Course Introduction (6-Part Learning Journey)</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                    hasCompleteIntro
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-amber-50 border-amber-200 text-amber-800'
                  }`}
                >
                  {hasCompleteIntro ? 'Complete' : 'Incomplete'}
                </span>
              </h3>
              <p className="text-[11px] text-slate-500">
                Included in Full Course, Learner Manual, Facilitator Guide &amp; SCORM overview (distinct from brief summary).
              </p>
            </div>
            {isIntroOpen ? (
              <ChevronUp className="w-4 h-4 text-slate-500 ml-1" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-500 ml-1" />
            )}
          </button>

          {!readOnly && (
            <button
              type="button"
              disabled={isDraftingIntro || Boolean(generatingStatus)}
              onClick={() => void handleDraftCourseIntro()}
              className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-dark disabled:opacity-60 text-primary-contrast border-b-2 border-accent text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              {isDraftingIntro ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-accent" />
              )}
              <span>{isDraftingIntro ? 'Drafting Intro...' : 'Draft Course Introduction with AI'}</span>
            </button>
          )}
        </div>

        {isIntroOpen && (
          <fieldset disabled={readOnly} className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                1. Why This Matters &amp; Workplace Relevance
              </label>
              <textarea
                rows={3}
                value={courseIntro.whyThisMatters}
                onChange={e => updateCourseIntroduction({ whyThisMatters: e.target.value })}
                placeholder="Explain the operational risk, opportunity, or real workplace stakes..."
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                2. Intended Learners &amp; Roles
              </label>
              <textarea
                rows={3}
                value={courseIntro.intendedLearners}
                onChange={e => updateCourseIntroduction({ intendedLearners: e.target.value })}
                placeholder="Clarify who benefits most and the job decisions they make..."
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                3. Prerequisites &amp; Entry Baseline
              </label>
              <textarea
                rows={2}
                value={courseIntro.prerequisitesSummary}
                onChange={e => updateCourseIntroduction({ prerequisitesSummary: e.target.value })}
                placeholder="State prior skills, tools, or induction baseline expected..."
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                4. Learning Outcomes Overview
              </label>
              <textarea
                rows={2}
                value={courseIntro.outcomesOverview}
                onChange={e => updateCourseIntroduction({ outcomesOverview: e.target.value })}
                placeholder="Summarise measurable workplace capabilities learners gain..."
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                5. Course Structure &amp; Module Roadmap
              </label>
              <textarea
                rows={2}
                value={courseIntro.structureRoadmap}
                onChange={e => updateCourseIntroduction({ structureRoadmap: e.target.value })}
                placeholder="Explain how modules progress logically from foundations to mastery..."
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                6. Assessment &amp; Completion Expectations
              </label>
              <textarea
                rows={2}
                value={courseIntro.assessmentOverview}
                onChange={e => updateCourseIntroduction({ assessmentOverview: e.target.value })}
                placeholder="Explain knowledge checks, practical tasks, and how competence is demonstrated..."
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-accent"
              />
            </div>
          </fieldset>
        )}
      </section>

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
                  ? 'bg-primary text-primary-contrast border-primary border-b-2 border-b-accent'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-accent'
              }`}
            >
              M{pm.order}: {pm.title} {isDone ? '✓' : hasPartial ? '…' : ''}
            </button>
          );
        })}
      </div>

      {activePlan && !activeGenerated ? (
        <div className="bg-white border border-slate-200 border-t-[3px] border-t-accent rounded-xl p-10 text-center space-y-3">
          <h3 className="text-base font-bold text-primary">
            Module {activePlan.order}: {activePlan.title}
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Ready to generate lessons, worked examples, workplace scenarios, case studies, and knowledge checks aligned to Stage 3 & 4.
          </p>
          <button
            type="button"
            disabled={Boolean(generatingStatus)}
            onClick={() => handleRegenerateCurrentModule(true)}
            className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-dark text-accent-contrast text-xs font-bold cursor-pointer"
          >
            Generate Module {activePlan.order}
          </button>
        </div>
      ) : activePlan && activeGenerated ? (
        <fieldset disabled={readOnly} className="space-y-5">
          {/* Selective Regeneration Guidance Bar */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <input
                type="text"
                value={regenPrompt}
                onChange={e => setRegenPrompt(e.target.value)}
                placeholder="Optional guidance before clicking Regenerate on any lesson, scenario, case study, or quiz..."
                className="flex-1 px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-accent"
              />
              <button
                type="button"
                disabled={Boolean(generatingStatus)}
                onClick={() => handleRegenerateCurrentModule(false)}
                className="px-3.5 py-1.5 text-xs font-bold border border-primary/30 text-primary hover:bg-accent-tint/50 rounded-lg flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-accent-ink" />
                <span>Regenerate Full Module</span>
              </button>
            </div>
            {confirmModuleOverwrite && (
              <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-amber-950">
                <span>
                  <strong>Confirm Full Module Overwrite:</strong> Regenerating Module {activePlan.order} will replace all {activeGenerated.lessons.length} lessons, scenarios, and knowledge checks in this module.
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleRegenerateCurrentModule(true)}
                    className="px-3 py-1.5 rounded bg-amber-700 hover:bg-amber-800 text-white font-bold cursor-pointer"
                  >
                    Confirm Overwrite
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmModuleOverwrite(false)}
                    className="px-3 py-1.5 rounded bg-white border border-amber-300 text-amber-900 font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Module Intro & Objectives */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-primary">
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
                  className="text-[11px] font-bold text-accent-ink hover:underline cursor-pointer"
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
                className="bg-white border border-slate-200 border-t-[3px] border-t-accent/70 rounded-xl p-5 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <div className="flex flex-wrap items-center gap-2 flex-1">
                    <span className="text-xs font-mono font-bold text-accent-ink bg-accent-tint px-1.5 py-0.5 rounded">
                      L{idx + 1}
                    </span>
                    <input
                      type="text"
                      value={lesson.title}
                      onChange={e => updateLesson(lesson.id, { title: e.target.value })}
                      className="flex-1 min-w-[200px] px-2.5 py-1 text-sm font-bold text-primary border border-slate-200 rounded focus:outline-none focus:border-accent"
                    />
                    <div className="flex items-center gap-1.5 shrink-0">
                      <label
                        htmlFor={`stage5-duration-${lesson.id}`}
                        className="text-[11px] font-semibold text-slate-600 whitespace-nowrap"
                      >
                        Duration (minutes)
                      </label>
                      <input
                        id={`stage5-duration-${lesson.id}`}
                        type="number"
                        min={5}
                        max={480}
                        value={lesson.durationMinutes}
                        onChange={e => {
                          const raw = e.target.value === '' ? 0 : Number(e.target.value);
                          updateLesson(lesson.id, {
                            durationMinutes: Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 30,
                          });
                        }}
                        onBlur={e => {
                          const parsed = Number(e.target.value);
                          const clamped = Number.isFinite(parsed) && parsed > 0
                            ? Math.min(480, Math.max(5, Math.round(parsed)))
                            : 30;
                          if (clamped !== lesson.durationMinutes) {
                            updateLesson(lesson.id, { durationMinutes: clamped });
                          }
                        }}
                        className="w-16 px-2 py-1 text-xs font-mono border border-slate-200 rounded"
                      />
                      <span className="text-xs text-slate-500">min</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={regenBusyKey === `lesson-${lesson.id}`}
                    onClick={() => handleSelectiveRegen('lesson', lesson.id)}
                    className="px-3 py-1.5 text-xs font-bold border border-slate-200 hover:border-accent text-primary rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    {regenBusyKey === `lesson-${lesson.id}` ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5 text-accent-ink" />
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
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg leading-relaxed focus:outline-none focus:border-accent"
                    />
                  </div>

                  {/* Key Terminology Editor */}
                  <div className="p-3 bg-surface border border-slate-200 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-primary">
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
                        className="text-[11px] font-bold text-accent-ink hover:underline cursor-pointer"
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
                  <div className="p-3 bg-surface border border-slate-200 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-primary">
                        Worked Examples ({lesson.workedExamples.length})
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateLesson(lesson.id, {
                            workedExamples: [...lesson.workedExamples, ''],
                          })
                        }
                        className="text-[11px] font-bold text-accent-ink hover:underline cursor-pointer"
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
                  <div className="p-3 rounded-lg bg-surface border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-primary">
                        Source Grounding & Claim Verification ({lesson.sourceClaims?.length || 0})
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateLesson(lesson.id, {
                            sourceClaims: [
                              ...(lesson.sourceClaims || []),
                              {
                                id: generateUniqueId('clm'),
                                claim: '',
                                sourceTitle: '',
                                status: 'NEEDS REVIEW',
                              },
                            ],
                          })
                        }
                        className="text-[11px] font-bold text-accent-ink hover:underline cursor-pointer"
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
              <h4 className="text-sm font-bold text-primary">
                Workplace Case Studies ({activeGenerated.workplaceCaseStudies.length})
              </h4>
              <button
                type="button"
                onClick={() =>
                  updateActiveModule({
                    workplaceCaseStudies: [
                      ...activeGenerated.workplaceCaseStudies,
                      {
                        id: generateUniqueId('cs'),
                        title: 'New Workplace Case Study',
                        background: '',
                        analysisQuestions: [''],
                        facilitatorNotes: '',
                      },
                    ],
                  })
                }
                className="px-3 py-1 text-xs font-bold bg-accent-tint hover:bg-accent-soft border border-accent-border text-primary rounded-lg flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3 h-3 text-accent-ink" />
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
                    className="flex-1 px-2.5 py-1 text-xs font-bold text-primary border border-slate-200 rounded"
                  />
                  <button
                    type="button"
                    disabled={regenBusyKey === `case_study-${cs.id}`}
                    onClick={() => handleSelectiveRegen('case_study', cs.id)}
                    className="px-2.5 py-1 text-xs font-semibold border border-slate-200 hover:border-accent rounded flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3 text-accent-ink" />
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
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded bg-surface"
                  />
                </div>
              </div>
            ))}
          </section>

          {/* Scenarios (All Fields Editable) */}
          {activeGenerated.scenarios.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <h4 className="text-sm font-bold text-primary">
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
                      className="flex-1 min-w-[180px] px-2.5 py-1 text-xs font-bold text-primary border border-slate-200 rounded"
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
                      className="px-2 py-1 text-xs border border-slate-200 rounded bg-surface"
                    >
                      <option value="Workplace">Workplace</option>
                      <option value="Branching / Decision">Branching / Decision</option>
                      <option value="AI Application">AI Application</option>
                    </select>
                    <button
                      type="button"
                      disabled={regenBusyKey === `scenario-${sc.id}`}
                      onClick={() => handleSelectiveRegen('scenario', sc.id)}
                      className="px-2.5 py-1 text-xs font-semibold border border-slate-200 hover:border-accent rounded flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3 text-accent-ink" />
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
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded bg-surface"
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
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded bg-surface"
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
              <h4 className="text-sm font-bold text-primary">
                Module Knowledge Checks ({activeGenerated.knowledgeChecks.length}) & Summary
              </h4>
              <button
                type="button"
                onClick={() =>
                  updateActiveModule({
                    knowledgeChecks: [
                      ...activeGenerated.knowledgeChecks,
                      {
                        id: generateUniqueId('kc'),
                        question: '',
                        options: ['Option A', 'Option B', 'Option C', 'Option D'],
                        correctIndex: 0,
                        explanation: '',
                        outcomeCode: allOutcomes[0]?.code || 'MLO-1',
                      },
                    ],
                  })
                }
                className="px-3 py-1 text-xs font-bold bg-accent-tint hover:bg-accent-soft border border-accent-border text-primary rounded-lg flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3 h-3 text-accent-ink" />
                <span>Add Knowledge Check</span>
              </button>
            </div>

            {activeGenerated.knowledgeChecks.map((kc, kIdx) => (
              <div
                key={kc.id}
                className="p-3.5 bg-surface border border-slate-200 rounded-lg space-y-2.5 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-bold text-primary">Q{kIdx + 1}</span>
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
        </fieldset>
      ) : null}

      <div className="bg-white border border-slate-200 border-t-[3px] border-t-accent rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-xs text-slate-600">
          {allModulesGenerated
            ? 'All planned modules have generated content. Proceed to Quality Assurance.'
            : `Generated ${generatedModules.length} of ${plannedModules.length} modules.`}
        </div>
        {!readOnly && (
        <button
          type="button"
          disabled={!allModulesGenerated}
          onClick={() => {
            onUpdateProject(
              prev => {
                const sigs = computeUpstreamStageSignatures(prev);
                return {
                  ...prev,
                  currentStage: 6,
                  lifecycleStatus: 'awaiting_review',
                  content: {
                    ...prev.content,
                    upstreamCurriculumSignature: sigs.curriculumSignature,
                    upstreamOutcomesSignature: sigs.outcomesSignature,
                    approval: {
                      approved: true,
                      approvedAt: new Date().toISOString(),
                      approvedBy: 'Course Developer',
                    },
                  },
                };
              },
              { trigger: 'stage_approval', summary: 'Approved Stage 5 Learning Content for QA' }
            );
            onApproveAndContinue();
          }}
          className="px-5 py-2.5 rounded-lg bg-primary hover:bg-primary-dark disabled:opacity-50 text-primary-contrast border-b-2 border-accent text-xs font-bold flex items-center gap-2 cursor-pointer"
        >
          <CheckCircle2 className="w-4 h-4 text-accent" />
          <span>Approve Content & Continue to Stage 6 QA</span>
        </button>
        )}
      </div>
    </div>
  );
};
