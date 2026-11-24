import React, { useState } from 'react';
import {
  ArrowLeft,
  Check,
  FileText,
  History,
  MessageSquare,
} from 'lucide-react';
import type {
  AIProvider,
  CopilotProposedChange,
  CourseProject,
  CourseTemplate,
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
  type ApplyProposalResult,
} from '../utils/copilotApply';

interface CourseWorkspaceProps {
  project: CourseProject;
  template: CourseTemplate | undefined;
  saveState: 'saved' | 'saving';
  selectedProvider: AIProvider;
  selectedModel: string;
  onBackToDashboard: () => void;
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
  { num: 7, label: '7. Publish & Export', desc: 'Word, PDF & LMS packages' },
];

export const CourseWorkspace: React.FC<CourseWorkspaceProps> = ({
  project,
  template,
  saveState,
  selectedProvider,
  selectedModel,
  onBackToDashboard,
  onUpdateProject,
  onRestoreVersion,
}) => {
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);
  const [isVersionsOpen, setIsVersionsOpen] = useState(false);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [sectionFocusContext, setSectionFocusContext] = useState<{
    stage: WorkflowStage;
    moduleNumber?: number;
    reason: string;
    source: 'qa' | 'copilot';
  } | null>(null);

  const setStage = (stage: WorkflowStage) => {
    if (stage === 6) setSectionFocusContext(null);
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
    if (stage === 6) return Boolean(project.latestQA?.humanSignOff.signedOff);
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

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-h-[calc(100vh-4rem)]">
      {/* Left Guided Stage Rail */}
      <aside className="w-full lg:w-64 bg-[#052B66] text-white shrink-0 flex flex-col justify-between border-r border-[#042150]">
        <div className="p-4 space-y-5">
          <button
            type="button"
            onClick={onBackToDashboard}
            className="text-xs font-semibold text-slate-300 hover:text-white flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Dashboard</span>
          </button>

          <div className="space-y-1">
            <div className="text-sm font-bold text-white truncate">
              {project.brief.title || 'Untitled Course'}
            </div>
            <div className="text-[11px] text-slate-300 truncate">
              {project.brief.code || 'Code TBC'} · {saveState === 'saving' ? 'Saving...' : 'Saved'}
            </div>
          </div>

          <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0">
            {STAGES.map(st => {
              const active = project.currentStage === st.num;
              const approved = isStageApproved(st.num);
              return (
                <button
                  key={st.num}
                  type="button"
                  onClick={() => setStage(st.num)}
                  className={`text-left px-3 py-2.5 rounded-lg transition-colors flex items-center justify-between gap-2 shrink-0 cursor-pointer ${
                    active
                      ? 'bg-white/15 text-white font-bold'
                      : 'text-slate-200 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-xs whitespace-nowrap">{st.label}</div>
                    <div className="text-[10px] text-slate-300 hidden lg:block truncate">
                      {st.desc}
                    </div>
                  </div>
                  {approved && <Check className="w-3.5 h-3.5 text-[#45CC42] shrink-0" />}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Workspace Utility Buttons */}
        <div className="p-4 bg-[#042150] border-t border-white/10 space-y-2">
          <button
            type="button"
            onClick={() => setIsSourcesOpen(true)}
            className="w-full py-2 px-3 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-semibold flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-[#45CC42]" />
              <span>Source Register</span>
            </span>
            <span className="font-mono">{project.sources.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setIsVersionsOpen(true)}
            className="w-full py-2 px-3 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-semibold flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <History className="w-3.5 h-3.5 text-[#45CC42]" />
              <span>Version History</span>
            </span>
            <span className="font-mono">{project.versions.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setIsCopilotOpen(!isCopilotOpen)}
            className="w-full py-2 px-3 rounded-lg bg-[#45CC42] hover:bg-[#3ab837] text-[#052B66] text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>{isCopilotOpen ? 'Hide Course Copilot' : 'Open Course Copilot'}</span>
          </button>
        </div>
      </aside>

      {/* Main Stage Content */}
      <main className="flex-1 p-5 sm:p-8 overflow-y-auto">
        <div className="max-w-5xl mx-auto">
          {sectionFocusContext &&
            sectionFocusContext.stage === project.currentStage &&
            project.currentStage !== 6 && (
              <div className="mb-5 p-4 bg-amber-50 border border-amber-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-amber-950 space-y-0.5">
                  <div className="font-bold">
                    {sectionFocusContext.source === 'qa'
                      ? 'Fixing Stage 6 QA Issue'
                      : 'Course Copilot · Action in Target Section'}
                    {sectionFocusContext.moduleNumber
                      ? ` (Module ${sectionFocusContext.moduleNumber})`
                      : ''}
                  </div>
                  <p className="text-amber-900">{sectionFocusContext.reason}</p>
                  <p className="text-[11px] text-amber-800">
                    {sectionFocusContext.source === 'qa'
                      ? 'Edit directly below or use the AI regenerate button on this stage, then return to Stage 6 to re-run QA.'
                      : 'Review your applied changes or click the AI regenerate button below, then proceed or re-run QA.'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {sectionFocusContext.source === 'qa' ? (
                    <button
                      type="button"
                      onClick={() => setStage(6)}
                      className="px-3 py-1.5 rounded-lg bg-[#052B66] hover:bg-[#042150] text-white text-xs font-bold cursor-pointer"
                    >
                      ← Back to Stage 6 QA
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsCopilotOpen(true)}
                      className="px-3 py-1.5 rounded-lg bg-[#052B66] hover:bg-[#042150] text-white text-xs font-bold cursor-pointer"
                    >
                      Open Copilot
                    </button>
                  )}
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

          {project.currentStage === 1 && (
            <Stage1Brief
              project={project}
              template={template}
              selectedProvider={selectedProvider}
              selectedModel={selectedModel}
              onUpdateProject={onUpdateProject}
              onOpenSources={() => setIsSourcesOpen(true)}
              onApproveAndContinue={() => setStage(2)}
            />
          )}
          {project.currentStage === 2 && (
            <Stage2Curriculum
              project={project}
              selectedProvider={selectedProvider}
              selectedModel={selectedModel}
              onUpdateProject={onUpdateProject}
              onApproveAndContinue={() => setStage(3)}
            />
          )}
          {project.currentStage === 3 && (
            <Stage3Outcomes
              project={project}
              selectedProvider={selectedProvider}
              selectedModel={selectedModel}
              onUpdateProject={onUpdateProject}
              onApproveAndContinue={() => setStage(4)}
            />
          )}
          {project.currentStage === 4 && (
            <Stage4Assessments
              project={project}
              selectedProvider={selectedProvider}
              selectedModel={selectedModel}
              onUpdateProject={onUpdateProject}
              onApproveAndContinue={() => setStage(5)}
            />
          )}
          {project.currentStage === 5 && (
            <Stage5Content
              project={project}
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
          {project.currentStage === 6 && (
            <Stage6QA
              project={project}
              selectedProvider={selectedProvider}
              selectedModel={selectedModel}
              onUpdateProject={onUpdateProject}
              onJumpToStage={handleJumpFromQA}
              onProceedToPublish={() => setStage(7)}
            />
          )}
          {project.currentStage === 7 && <Stage7Publish project={project} />}
        </div>
      </main>

      <SourceManagerModal
        isOpen={isSourcesOpen}
        project={project}
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        onClose={() => setIsSourcesOpen(false)}
        onUpdateProject={updater => onUpdateProject(updater)}
      />

      <VersionHistoryModal
        isOpen={isVersionsOpen}
        project={project}
        onClose={() => setIsVersionsOpen(false)}
        onSaveSnapshot={summary =>
          onUpdateProject(prev => prev, { trigger: 'manual_snapshot', summary })
        }
        onRestoreVersion={onRestoreVersion}
      />

      <CourseCopilotDrawer
        isOpen={isCopilotOpen}
        project={project}
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        onClose={() => setIsCopilotOpen(false)}
        onApplyProposedChange={handleApplyCopilotProposal}
        onApplyRegeneratedSection={handleApplyRegeneratedSection}
        onNavigateToSection={handleNavigateFromCopilot}
      />
    </div>
  );
};
