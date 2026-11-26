import React, { useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  FileText,
  History,
  Lock,
  MessageSquare,
  Save,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  AIProvider,
  CompanyRole,
  CopilotProposedChange,
  CourseProject,
  CourseTemplate,
  CourseVersionSnapshot,
  SelectedTextContext,
  WorkflowStage,
} from '../types';
import { Stage1Brief } from './stages/Stage1Brief';
import { Stage2Curriculum } from './stages/Stage2Curriculum';
import { Stage3Outcomes } from './stages/Stage3Outcomes';
import { Stage4Assessments } from './stages/Stage4Assessments';
import { Stage5Content } from './stages/Stage5Content';
import { Stage6QA } from './stages/Stage6QA';
import { Stage7Publish } from './stages/Stage7Publish';
import { SourceManagerModal } from './SourceManagerModal';
import { VersionHistoryModal } from './VersionHistoryModal';
import { CourseCopilotDrawer } from './CourseCopilotDrawer';
import {
  applyCopilotProposal,
  applySelectedTextReplacement,
  type ApplyProposalResult,
} from '../utils/copilotApply';
import { computeCourseDataSignature } from '../utils/courseValidation';
import { getRolePermissions } from '../utils/rbac';

interface CourseWorkspaceProps {
  project: CourseProject;
  template: CourseTemplate | undefined;
  activeRole?: CompanyRole | null;
  saveState: 'saved' | 'saving';
  lastSavedAt?: string | null;
  saveError?: string | null;
  selectedProvider: AIProvider;
  selectedModel: string;
  onBackToDashboard: () => void;
  onFlushSaveNow?: () => Promise<void>;
  onLoadVersions?: (projectId: string) => Promise<CourseVersionSnapshot[] | void>;
  onUpdateProject: (
    updater: (prev: CourseProject) => CourseProject,
    snapshot?: {
      trigger: 'auto_save' | 'stage_approval' | 'ai_generation' | 'manual_snapshot' | 'restore';
      summary: string;
    }
  ) => void;
  onRestoreVersion: (snapshotId: string) => void;
}

const STAGES: Array<{ num: WorkflowStage; label: string; desc: string }> = [
  { num: 1, label: '1. Course Brief', desc: 'Metadata, audience & sources' },
  { num: 2, label: '2. Curriculum', desc: 'Modules, topics & coverage' },
  { num: 3, label: '3. Outcomes', desc: 'Measurable Bloom outcomes' },
  { num: 4, label: '4. Assessments', desc: 'Strategy, rubrics & alignment' },
  { num: 5, label: '5. Learning Content', desc: 'Modules, scenarios & editing' },
  { num: 6, label: '6. Quality Assurance', desc: '7-dimension audit & sign-off' },
  { num: 7, label: '7. Publish & Export', desc: 'Word, SCORM & LMS packages' },
];

export const CourseWorkspace: React.FC<CourseWorkspaceProps> = ({
  project,
  template,
  activeRole,
  saveState,
  lastSavedAt,
  saveError,
  selectedProvider,
  selectedModel,
  onBackToDashboard,
  onFlushSaveNow,
  onLoadVersions,
  onUpdateProject,
  onRestoreVersion,
}) => {
  const perms = getRolePermissions(activeRole);
  const isReadOnly = perms.isReadOnly;
  const [viewerStage, setViewerStage] = useState<WorkflowStage>(project.currentStage);
  const effectiveStage = isReadOnly ? viewerStage : project.currentStage;

  const [isSourcesOpen, setIsSourcesOpen] = useState(false);
  const [isVersionsOpen, setIsVersionsOpen] = useState(false);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [pendingSelectionText, setPendingSelectionText] = useState('');
  const [selectedTextContext, setSelectedTextContext] = useState<SelectedTextContext | null>(null);
  const [queuedSelectionPrompt, setQueuedSelectionPrompt] = useState<{
    ctx: SelectedTextContext;
    prompt: string;
    nonce: number;
  } | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const [sectionFocusContext, setSectionFocusContext] = useState<{
    stage: WorkflowStage;
    moduleNumber?: number;
    reason: string;
    source: 'qa' | 'copilot';
  } | null>(null);

  const qa = project.latestQA;
  const isQaStale = Boolean(
    qa?.evaluatedDataSignature && qa.evaluatedDataSignature !== computeCourseDataSignature(project)
  );
  const isStage7Unlocked = Boolean(
    qa &&
      !isQaStale &&
      qa.verdict !== 'FAIL' &&
      (!qa.blockingErrors || qa.blockingErrors.length === 0)
  );

  const getStage7BlockReason = (): string => {
    if (!qa) {
      return 'Run Stage 6 Quality Assurance before accessing Stage 7 Publish.';
    }
    if (isQaStale) {
      return 'Course content changed since the last QA evaluation. Re-run Stage 6 QA before publishing.';
    }
    if (qa.blockingErrors && qa.blockingErrors.length > 0) {
      return `${qa.blockingErrors.length} blocking error(s) in Stage 6 must be resolved before publishing.`;
    }
    return 'QA Outcome is FAIL. Resolve critical issues and re-run Stage 6 QA before publishing.';
  };

  const setStage = (stage: WorkflowStage) => {
    if (isReadOnly) {
      if (stage === 7 && !isStage7Unlocked) return;
      setViewerStage(stage);
      return;
    }
    if (stage === 7 && !isStage7Unlocked) {
      setSectionFocusContext({
        stage: 6,
        reason: getStage7BlockReason(),
        source: 'qa',
      });
      onUpdateProject(prev => ({ ...prev, currentStage: 6 }));
      return;
    }
    if (stage === 6 && isStage7Unlocked) {
      setSectionFocusContext(null);
    } else if (stage !== 6) {
      setSectionFocusContext(null);
    }
    onUpdateProject(prev => ({ ...prev, currentStage: stage }));
  };

  const handleJumpFromQA = (
    stage: WorkflowStage,
    context?: { moduleNumber?: number; reason?: string }
  ) => {
    if (context?.reason || context?.moduleNumber) {
      setSectionFocusContext({
        stage,
        moduleNumber: context.moduleNumber,
        reason: context.reason || `Address Stage 6 QA issue in Stage ${stage}.`,
        source: 'qa',
      });
    } else {
      setSectionFocusContext(null);
    }
    onUpdateProject(prev => ({ ...prev, currentStage: stage }));
  };

  const handleNavigateFromCopilot = (
    stage: WorkflowStage,
    context?: { moduleNumber?: number; reason?: string }
  ) => {
    if (stage === 7 && !isStage7Unlocked) {
      setIsCopilotOpen(false);
      setSectionFocusContext({
        stage: 6,
        reason: getStage7BlockReason(),
        source: 'qa',
      });
      onUpdateProject(prev => ({ ...prev, currentStage: 6 }));
      return;
    }
    if (context?.reason || context?.moduleNumber) {
      setSectionFocusContext({
        stage,
        moduleNumber: context.moduleNumber,
        reason: context.reason || `Review or regenerate this section in Stage ${stage}.`,
        source: 'copilot',
      });
    } else {
      setSectionFocusContext(null);
    }
    setIsCopilotOpen(false);
    onUpdateProject(prev => ({ ...prev, currentStage: stage }));
  };

  const isStageApproved = (stage: WorkflowStage): boolean => {
    if (stage === 1) return project.brief.approval.approved;
    if (stage === 2) return project.curriculum.approval.approved;
    if (stage === 3) return project.outcomes.approval.approved;
    if (stage === 4) return project.assessments.approval.approved;
    if (stage === 5) return project.content.approval.approved;
    if (stage === 6) return isStage7Unlocked;
    return project.lifecycleStatus === 'completed';
  };

  const handleApplyCopilotProposal = (proposal: CopilotProposedChange): ApplyProposalResult => {
    const check = applyCopilotProposal(project, proposal);
    if (!check.applied) {
      return check;
    }
    onUpdateProject(
      prev => applyCopilotProposal(prev, proposal).nextProject,
      { trigger: 'manual_snapshot', summary: `Applied Copilot proposal: ${proposal.title}` }
    );
    return check;
  };

  const handleApplySelectedTextReplacement = (
    ctx: SelectedTextContext,
    replacementText: string
  ): { applied: boolean; detail: string } => {
    const check = applySelectedTextReplacement(project, ctx, replacementText);
    if (!check.applied) {
      return { applied: false, detail: check.detail };
    }
    onUpdateProject(
      prev => applySelectedTextReplacement(prev, ctx, replacementText).nextProject,
      { trigger: 'manual_snapshot', summary: `Applied Copilot selection edit (${ctx.action || 'rewrite'})` }
    );
    return { applied: true, detail: check.detail };
  };

  const handleApplyRegeneratedSection = (params: {
    targetType: 'lesson' | 'scenario' | 'case_study' | 'knowledge_check';
    moduleId: string;
    targetId: string;
    updatedItem: any;
    title: string;
  }) => {
    onUpdateProject(
      prev => ({
        ...prev,
        content: {
          ...prev.content,
          modules: prev.content.modules.map(m => {
            if (m.moduleId !== params.moduleId) return m;
            if (params.targetType === 'lesson') {
              return {
                ...m,
                lessons: m.lessons.map(l =>
                  l.id === params.targetId ? { ...l, ...params.updatedItem, editStatus: 'ai_draft' } : l
                ),
              };
            }
            if (params.targetType === 'scenario') {
              return {
                ...m,
                scenarios: m.scenarios.map(s =>
                  s.id === params.targetId ? { ...s, ...params.updatedItem } : s
                ),
              };
            }
            if (params.targetType === 'case_study') {
              return {
                ...m,
                workplaceCaseStudies: m.workplaceCaseStudies.map(c =>
                  c.id === params.targetId ? { ...c, ...params.updatedItem } : c
                ),
              };
            }
            return {
              ...m,
              knowledgeChecks: m.knowledgeChecks.map(k =>
                k.id === params.targetId ? { ...k, ...params.updatedItem } : k
              ),
            };
          }),
          approval: { approved: false },
        },
      }),
      { trigger: 'ai_generation', summary: `Regenerated ${params.targetType} via Copilot: ${params.title}` }
    );
  };

  const handleSelectionCapture = () => {
    const active = document.activeElement;
    if (
      active &&
      mainRef.current?.contains(active) &&
      (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)
    ) {
      const start = active.selectionStart;
      const end = active.selectionEnd;
      if (typeof start === 'number' && typeof end === 'number' && end - start >= 10) {
        const snippet = active.value.slice(start, end).trim();
        if (snippet.length >= 10) {
          setPendingSelectionText(snippet.slice(0, 1500));
          return;
        }
      }
    }

    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.anchorNode && mainRef.current?.contains(sel.anchorNode)) {
      const snippet = sel.toString().trim();
      if (snippet.length >= 10) {
        setPendingSelectionText(snippet.slice(0, 1500));
        return;
      }
    }
  };

  const triggerSelectionAction = (
    action: SelectedTextContext['action'],
    promptInstruction: string
  ) => {
    const stageMeta = STAGES.find(s => s.num === project.currentStage);
    const ctx: SelectedTextContext = {
      text: pendingSelectionText,
      stage: project.currentStage,
      sectionLabel: stageMeta?.label || `Stage ${project.currentStage}`,
      action,
    };
    setSelectedTextContext(ctx);
    setPendingSelectionText('');
    setIsCopilotOpen(true);
    setQueuedSelectionPrompt({
      ctx,
      prompt: promptInstruction,
      nonce: Date.now(),
    });
  };

  const formattedSavedTime = lastSavedAt
    ? new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-h-[calc(100vh-4rem)]">
      {/* Left Guided Stage Rail */}
      <aside className="w-full lg:w-64 bg-brand-gradient text-primary-contrast shrink-0 flex flex-col justify-between border-r border-primary-dark">
        <div className="p-4 space-y-5">
          <button
            type="button"
            onClick={onBackToDashboard}
            className="text-xs font-semibold opacity-80 hover:opacity-100 flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-accent" />
            <span>Back to Dashboard</span>
          </button>

          <div className="space-y-1.5 pb-3 border-b border-white/15">
            <div className="text-sm font-bold truncate">
              {project.brief.title || 'Untitled Course'}
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px] opacity-80">
              <span className="truncate">
                {project.brief.code || 'Code TBC'} ·{' '}
                {saveState === 'saving'
                  ? 'Saving...'
                  : formattedSavedTime
                  ? `Saved ${formattedSavedTime}`
                  : 'Saved'}
              </span>
              {onFlushSaveNow && !isReadOnly && (
                <button
                  type="button"
                  onClick={() => void onFlushSaveNow()}
                  title="Flush workspace to cloud storage immediately"
                  className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[10px] font-semibold flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <Save className="w-2.5 h-2.5 text-accent" />
                  <span>Save</span>
                </button>
              )}
            </div>
            {saveError && (
              <div className="p-2 rounded bg-red-950/70 border border-red-400/50 text-[10px] text-red-100">
                {saveError}
              </div>
            )}
          </div>

          <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0">
            {STAGES.map(st => {
              const active = effectiveStage === st.num;
              const approved = isStageApproved(st.num);
              const lockedStage7 = st.num === 7 && !isStage7Unlocked;
              return (
                <button
                  key={st.num}
                  type="button"
                  onClick={() => setStage(st.num)}
                  title={lockedStage7 ? getStage7BlockReason() : st.desc}
                  className={`text-left px-3 py-2.5 rounded-lg transition-colors flex items-center justify-between gap-2 shrink-0 cursor-pointer ${
                    active
                      ? 'bg-accent-soft border-l-[3px] border-l-accent font-bold shadow-xs'
                      : lockedStage7
                      ? 'opacity-55 hover:bg-white/5'
                      : 'opacity-85 hover:bg-white/10 hover:opacity-100'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-xs whitespace-nowrap">{st.label}</div>
                    <div className="text-[10px] opacity-75 hidden lg:block truncate">
                      {st.desc}
                    </div>
                  </div>
                  {lockedStage7 ? (
                    <Lock className="w-3.5 h-3.5 opacity-60 shrink-0" />
                  ) : approved ? (
                    <span className="w-5 h-5 rounded-full bg-accent text-accent-contrast flex items-center justify-center shrink-0">
                      <Check className="w-3 h-3 stroke-[2.5]" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Workspace Utility Buttons */}
        <div className="p-4 bg-black/20 border-t border-white/15 space-y-2">
          <button
            type="button"
            onClick={() => setIsSourcesOpen(true)}
            className="w-full py-2 px-3 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold flex items-center justify-between cursor-pointer transition-colors"
          >
            <span className="flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-accent" />
              <span>Source Register</span>
            </span>
            <span className="font-mono text-accent font-bold tabular-nums">{project.sources.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setIsVersionsOpen(true)}
            className="w-full py-2 px-3 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold flex items-center justify-between cursor-pointer transition-colors"
          >
            <span className="flex items-center gap-2">
              <History className="w-3.5 h-3.5 text-accent" />
              <span>Version History</span>
            </span>
            <span className="font-mono text-accent font-bold tabular-nums">{project.versions.length}</span>
          </button>
          {!isReadOnly && (
            <button
              type="button"
              onClick={() => setIsCopilotOpen(!isCopilotOpen)}
              className="w-full py-2.5 px-3 rounded-lg bg-accent hover:bg-accent-dark text-accent-contrast text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-xs"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>{isCopilotOpen ? 'Hide Course Copilot' : 'Open Course Copilot'}</span>
            </button>
          )}
        </div>
      </aside>

      {/* Main Stage Content */}
      <main
        ref={mainRef}
        onMouseUp={!isReadOnly ? handleSelectionCapture : undefined}
        onKeyUp={!isReadOnly ? handleSelectionCapture : undefined}
        className="flex-1 p-5 sm:p-8 overflow-y-auto relative"
      >
        <div className="max-w-5xl mx-auto">
          {isReadOnly && (
            <div className="mb-5 p-3.5 bg-slate-100 border border-slate-300 rounded-xl text-xs text-slate-700 flex items-center justify-between gap-2">
              <span>
                <strong>Viewer Read-Only Mode:</strong> You can navigate stages, review content, and inspect QA &amp; Version History records. Editing, AI generation, sign-offs, and exports are disabled for Viewer accounts.
              </span>
            </div>
          )}

          {sectionFocusContext && sectionFocusContext.stage === effectiveStage && (
            <div className="mb-5 p-4 bg-amber-50 border border-amber-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-amber-950 space-y-0.5">
                <div className="font-bold">
                  {effectiveStage === 6
                    ? 'Stage 7 Publish Gate · Action Required in Stage 6 QA'
                    : sectionFocusContext.source === 'qa'
                    ? 'Fixing Stage 6 QA Issue'
                    : 'Course Copilot · Action in Target Section'}
                  {sectionFocusContext.moduleNumber
                    ? ` (Module ${sectionFocusContext.moduleNumber})`
                    : ''}
                </div>
                <p className="text-amber-900">{sectionFocusContext.reason}</p>
                {effectiveStage !== 6 && (
                  <p className="text-[11px] text-amber-800">
                    {sectionFocusContext.source === 'qa'
                      ? 'Edit directly below or use the AI regenerate button on this stage, then return to Stage 6 to re-run QA.'
                      : 'Review your applied changes or click the AI regenerate button below, then proceed or re-run QA.'}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {effectiveStage !== 6 && sectionFocusContext.source === 'qa' ? (
                  <button
                    type="button"
                    onClick={() => setStage(6)}
                    className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-dark text-primary-contrast text-xs font-bold cursor-pointer"
                  >
                    ← Back to Stage 6 QA
                  </button>
                ) : effectiveStage !== 6 && !isReadOnly ? (
                  <button
                    type="button"
                    onClick={() => setIsCopilotOpen(true)}
                    className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-dark text-primary-contrast text-xs font-bold cursor-pointer"
                  >
                    Open Copilot
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setSectionFocusContext(null)}
                  className="px-2 py-1.5 text-xs font-semibold text-amber-800 hover:text-amber-950 cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {effectiveStage === 1 && (
            <Stage1Brief
              project={project}
              template={template}
              readOnly={isReadOnly}
              selectedProvider={selectedProvider}
              selectedModel={selectedModel}
              onUpdateProject={onUpdateProject}
              onOpenSources={() => setIsSourcesOpen(true)}
              onApproveAndContinue={() => setStage(2)}
            />
          )}
          {effectiveStage === 2 && (
            <Stage2Curriculum
              project={project}
              readOnly={isReadOnly}
              selectedProvider={selectedProvider}
              selectedModel={selectedModel}
              onUpdateProject={onUpdateProject}
              onApproveAndContinue={() => setStage(3)}
            />
          )}
          {effectiveStage === 3 && (
            <Stage3Outcomes
              project={project}
              readOnly={isReadOnly}
              selectedProvider={selectedProvider}
              selectedModel={selectedModel}
              onUpdateProject={onUpdateProject}
              onApproveAndContinue={() => setStage(4)}
            />
          )}
          {effectiveStage === 4 && (
            <Stage4Assessments
              project={project}
              readOnly={isReadOnly}
              selectedProvider={selectedProvider}
              selectedModel={selectedModel}
              onUpdateProject={onUpdateProject}
              onApproveAndContinue={() => setStage(5)}
            />
          )}
          {effectiveStage === 5 && (
            <Stage5Content
              project={project}
              readOnly={isReadOnly}
              selectedProvider={selectedProvider}
              selectedModel={selectedModel}
              initialModuleNumber={
                sectionFocusContext?.stage === 5 ? sectionFocusContext.moduleNumber : undefined
              }
              initialGuidance={
                sectionFocusContext?.stage === 5 ? sectionFocusContext.reason : undefined
              }
              onUpdateProject={onUpdateProject}
              onApproveAndContinue={() => setStage(6)}
            />
          )}
          {effectiveStage === 6 && (
            <Stage6QA
              project={project}
              activeRole={activeRole}
              selectedProvider={selectedProvider}
              selectedModel={selectedModel}
              onUpdateProject={onUpdateProject}
              onJumpToStage={handleJumpFromQA}
              onProceedToPublish={() => setSectionFocusContext(null)}
            />
          )}
          {effectiveStage === 7 && (
            <Stage7Publish
              project={project}
              activeRole={activeRole}
              onJumpToStage={handleJumpFromQA}
            />
          )}
        </div>

        {/* Floating Selection Action Bar for Highlighted Workspace Text */}
        {!isReadOnly && pendingSelectionText.length >= 10 && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 max-w-[94vw] bg-primary text-primary-contrast px-3 py-2 rounded-xl shadow-2xl border border-accent/60 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="inline-flex items-center gap-1 font-bold text-accent pr-1.5 border-r border-white/20">
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                {effectiveStage >= 6
                  ? `Ask Copilot (${pendingSelectionText.length} chars):`
                  : `AI Selection (${pendingSelectionText.length} chars):`}
              </span>
            </span>
            {(effectiveStage >= 6
              ? ([
                  ['explain', 'Explain', 'Explain what this selected QA/publish item or guidance means and what action I should take next.'],
                  ['fix_clarity', 'Suggest Course Fix', 'Based on this selected QA/publish item, suggest concrete fixes in the relevant authoring stage (Stages 1–5) without modifying UI labels.'],
                ] as const)
              : ([
                  ['rewrite', 'Rewrite', 'Rewrite the selected text so it is sharper, clearer, and instructionally engaging while preserving factual accuracy.'],
                  ['simplify', 'Simplify', 'Simplify the selected text for plain-language clarity without losing essential technical accuracy.'],
                  ['expand', 'Expand', 'Expand the selected text with concrete workplace examples and deeper practical explanation.'],
                  ['fix_clarity', 'Fix Clarity', 'Fix clarity, sentence flow, and structure in the selected text while keeping approved metadata intact.'],
                  ['change_tone', 'Change Tone', 'Adjust the tone of the selected text to an authoritative, practical professional coaching style.'],
                  ['explain', 'Explain', 'Explain what this selected text means pedagogically or point out any improvements needed without altering data.'],
                ] as const)
            ).map(([action, label, promptInstruction]) => (
              <button
                key={action}
                type="button"
                onClick={() => triggerSelectionAction(action, promptInstruction)}
                className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 font-semibold cursor-pointer"
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPendingSelectionText('')}
              className="p-1 text-slate-300 hover:text-white cursor-pointer"
              title="Dismiss selection toolbar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </main>

      <SourceManagerModal
        isOpen={isSourcesOpen}
        project={project}
        readOnly={isReadOnly}
        canDeleteSource={perms.canDeleteSource}
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        onClose={() => setIsSourcesOpen(false)}
        onUpdateProject={updater => onUpdateProject(updater)}
      />

      <VersionHistoryModal
        isOpen={isVersionsOpen}
        project={project}
        readOnly={isReadOnly}
        onLoadVersions={onLoadVersions}
        onClose={() => setIsVersionsOpen(false)}
        onSaveSnapshot={summary =>
          onUpdateProject(prev => prev, { trigger: 'manual_snapshot', summary })
        }
        onRestoreVersion={onRestoreVersion}
      />

      {!isReadOnly && (
        <CourseCopilotDrawer
          isOpen={isCopilotOpen}
          project={project}
          selectedProvider={selectedProvider}
          selectedModel={selectedModel}
          selectedTextContext={selectedTextContext}
          queuedSelectionPrompt={queuedSelectionPrompt}
          onClearSelectedTextContext={() => setSelectedTextContext(null)}
          onClose={() => setIsCopilotOpen(false)}
          onApplyProposedChange={handleApplyCopilotProposal}
          onApplySelectedTextReplacement={handleApplySelectedTextReplacement}
          onApplyRegeneratedSection={handleApplyRegeneratedSection}
          onNavigateToSection={handleNavigateFromCopilot}
        />
      )}
    </div>
  );
};
