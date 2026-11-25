import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  FileText,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  AIProvider,
  CopilotMessage,
  CopilotProposedChange,
  CourseProject,
  SelectedTextContext,
  WorkflowStage,
} from '../types';
import { apiFetch, compactProjectForApi, parseApiJson } from '../utils/apiClient';
import {
  resolveProposalTargetLocation,
  type ApplyProposalResult,
} from '../utils/copilotApply';

interface CourseCopilotDrawerProps {
  isOpen: boolean;
  project: CourseProject;
  selectedProvider: AIProvider;
  selectedModel: string;
  selectedTextContext?: SelectedTextContext | null;
  queuedSelectionPrompt?: {
    ctx: SelectedTextContext;
    prompt: string;
    nonce: number;
  } | null;
  onClearSelectedTextContext?: () => void;
  onClose: () => void;
  onApplyProposedChange: (proposal: CopilotProposedChange) => ApplyProposalResult;
  onApplySelectedTextReplacement?: (
    ctx: SelectedTextContext,
    replacementText: string
  ) => { applied: boolean; detail: string };
  onApplyRegeneratedSection: (params: {
    targetType: 'lesson' | 'scenario' | 'case_study' | 'knowledge_check';
    moduleId: string;
    targetId: string;
    updatedItem: any;
    title: string;
  }) => void;
  onNavigateToSection: (
    stage: WorkflowStage,
    context?: { moduleNumber?: number; reason?: string }
  ) => void;
}

const REGENERABLE_STAGE5_TYPES = new Set([
  'lesson',
  'scenario',
  'case_study',
  'knowledge_check',
]);

function findStage5Target(
  project: CourseProject,
  prop: CopilotProposedChange
): {
  targetType: 'lesson' | 'scenario' | 'case_study' | 'knowledge_check';
  moduleId: string;
  targetId: string;
  moduleNumber: number;
} | null {
  if (!REGENERABLE_STAGE5_TYPES.has(prop.targetType)) return null;
  const targetType = prop.targetType as
    | 'lesson'
    | 'scenario'
    | 'case_study'
    | 'knowledge_check';
  const loc = resolveProposalTargetLocation(project, prop);
  const tid = (prop.targetId || '').trim().toLowerCase();
  const titleNorm = prop.title.trim().toLowerCase();

  const orderedMods =
    loc.moduleId || loc.moduleNumber
      ? [
          ...project.content.modules.filter(
            m => m.moduleId === loc.moduleId || m.moduleNumber === loc.moduleNumber
          ),
          ...project.content.modules.filter(
            m => m.moduleId !== loc.moduleId && m.moduleNumber !== loc.moduleNumber
          ),
        ]
      : project.content.modules;

  for (const mod of orderedMods) {
    if (targetType === 'lesson') {
      const hit = mod.lessons.find(
        l =>
          (tid &&
            (l.id.toLowerCase() === tid ||
              (l.lessonPlanId && l.lessonPlanId.toLowerCase() === tid) ||
              l.title.toLowerCase() === tid)) ||
          (l.title.length >= 6 && titleNorm.includes(l.title.toLowerCase()))
      );
      if (hit) {
        return { targetType, moduleId: mod.moduleId, targetId: hit.id, moduleNumber: mod.moduleNumber };
      }
    } else if (targetType === 'scenario') {
      const hit =
        mod.scenarios.find(
          s =>
            (tid && s.id.toLowerCase() === tid) ||
            (s.title.length >= 5 && titleNorm.includes(s.title.toLowerCase()))
        ) || (mod.moduleId === loc.moduleId && mod.scenarios.length === 1 ? mod.scenarios[0] : undefined);
      if (hit) {
        return { targetType, moduleId: mod.moduleId, targetId: hit.id, moduleNumber: mod.moduleNumber };
      }
    } else if (targetType === 'case_study') {
      const hit =
        mod.workplaceCaseStudies.find(
          c =>
            (tid && c.id.toLowerCase() === tid) ||
            (c.title.length >= 5 && titleNorm.includes(c.title.toLowerCase()))
        ) ||
        (mod.moduleId === loc.moduleId && mod.workplaceCaseStudies.length === 1
          ? mod.workplaceCaseStudies[0]
          : undefined);
      if (hit) {
        return { targetType, moduleId: mod.moduleId, targetId: hit.id, moduleNumber: mod.moduleNumber };
      }
    } else if (targetType === 'knowledge_check') {
      const hit = mod.knowledgeChecks.find(
        k =>
          (tid && (k.id.toLowerCase() === tid || k.outcomeCode.toLowerCase() === tid)) ||
          (k.question && titleNorm.includes(k.question.slice(0, 20).toLowerCase()))
      );
      if (hit) {
        return { targetType, moduleId: mod.moduleId, targetId: hit.id, moduleNumber: mod.moduleNumber };
      }
    }
  }
  return null;
}

function detectStageHintInText(text: string): { stage: WorkflowStage; moduleNumber?: number; label: string } | null {
  const modMatch = text.match(/\b(?:Module|M)\s*(\d+)\b/i) || text.match(/\bMLO-(\d+)\.\d+\b/i);
  const stageMatch = text.match(/\bStage\s*([1-6])\b/i);
  if (stageMatch) {
    const stage = Number(stageMatch[1]) as WorkflowStage;
    const moduleNumber = modMatch ? Number(modMatch[1]) : undefined;
    return {
      stage,
      moduleNumber,
      label: stage === 5 && moduleNumber ? `Stage 5 · Module ${moduleNumber}` : `Stage ${stage}`,
    };
  }
  if (modMatch) {
    const moduleNumber = Number(modMatch[1]);
    return {
      stage: 5,
      moduleNumber,
      label: `Stage 5 · Module ${moduleNumber}`,
    };
  }
  return null;
}

export const CourseCopilotDrawer: React.FC<CourseCopilotDrawerProps> = ({
  isOpen,
  project,
  selectedProvider,
  selectedModel,
  selectedTextContext,
  queuedSelectionPrompt,
  onClearSelectedTextContext,
  onClose,
  onApplyProposedChange,
  onApplySelectedTextReplacement,
  onApplyRegeneratedSection,
  onNavigateToSection,
}) => {
  const [messages, setMessages] = useState<CopilotMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      timestamp: new Date().toISOString(),
      content:
        'I am your Course Copilot. I can read your Course Brief, curriculum, outcomes, assessments, Stage 5 lessons, QA findings, and uploaded reference source excerpts. Highlight any text in the workspace for instant Rewrite / Simplify / Expand / Fix Clarity / Explain actions, or ask below.',
    },
  ]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [autoApplyMinorEdits, setAutoApplyMinorEdits] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [proposalFeedback, setProposalFeedback] = useState<
    Record<string, { ok: boolean; message: string }>
  >({});
  const [regenProposalId, setRegenProposalId] = useState<string | null>(null);
  const [lastHandledNonce, setLastHandledNonce] = useState<number>(0);
  const [lastFailedRequest, setLastFailedRequest] = useState<{
    text: string;
    ctx: SelectedTextContext | null | undefined;
  } | null>(null);

  const sendMessage = async (
    textOverride?: string,
    ctxOverride?: SelectedTextContext | null
  ) => {
    const text = (textOverride ?? input).trim();
    const activeSelectionCtx = ctxOverride !== undefined ? ctxOverride : selectedTextContext;
    if (!text || isSending) return;
    const userMsg: CopilotMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: activeSelectionCtx?.text
        ? `${text}\n\n[Selected excerpt (${activeSelectionCtx.sectionLabel || `Stage ${activeSelectionCtx.stage}`}): "${activeSelectionCtx.text.slice(0, 140)}${activeSelectionCtx.text.length > 140 ? '...' : ''}"]`
        : text,
      timestamp: new Date().toISOString(),
    };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    if (!textOverride) setInput('');
    setIsSending(true);

    try {
      const focusModuleId =
        activeSelectionCtx?.moduleId || project.content.modules[0]?.moduleId;
      const res = await apiFetch('/api/v2/copilot/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: compactProjectForApi(project, {
            focusModuleId,
            includeLessonText: false,
          }),
          messages: nextHistory.map(m => ({ role: m.role, content: m.content })),
          userMessage: text,
          selectedTextContext: activeSelectionCtx || undefined,
          activeModuleId: focusModuleId,
          provider: selectedProvider,
          model: selectedModel,
        }),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Copilot request failed.');
      }

      const incomingProposals: CopilotProposedChange[] = Array.isArray(data.proposedChanges)
        ? data.proposedChanges
        : [];
      const feedbackAdditions: Record<string, { ok: boolean; message: string }> = {};

      // Controlled execution: if user explicitly enabled minor scoped auto-apply, apply only direct proposals (or selection replacement if direct)
      const processedProposals: CopilotProposedChange[] = incomingProposals.map(prop => {
        if (autoApplyMinorEdits && prop.executionMode === 'direct') {
          const appliedRes = onApplyProposedChange(prop);
          if (appliedRes.applied) {
            feedbackAdditions[prop.id] = {
              ok: true,
              message: `Auto-applied scoped edit: ${appliedRes.detail}`,
            };
            return { ...prop, status: 'accepted' };
          }
          if (activeSelectionCtx && onApplySelectedTextReplacement && prop.afterPreview) {
            const selRes = onApplySelectedTextReplacement(activeSelectionCtx, prop.afterPreview);
            if (selRes.applied) {
              feedbackAdditions[prop.id] = {
                ok: true,
                message: `Auto-applied to selection: ${selRes.detail}`,
              };
              return { ...prop, status: 'accepted' };
            }
          }
        }
        return prop;
      });

      if (Object.keys(feedbackAdditions).length > 0) {
        setProposalFeedback(prev => ({ ...prev, ...feedbackAdditions }));
      }

      const assistantMsg: CopilotMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: data.reply,
        timestamp: new Date().toISOString(),
        proposedChanges: processedProposals,
      };
      setLastFailedRequest(null);
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      setLastFailedRequest({ text, ctx: activeSelectionCtx });
      setMessages(prev => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `Error: ${err?.message || 'Unable to reach Copilot AI service.'}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  useEffect(() => {
    if (
      isOpen &&
      queuedSelectionPrompt &&
      queuedSelectionPrompt.nonce !== lastHandledNonce &&
      !isSending
    ) {
      setLastHandledNonce(queuedSelectionPrompt.nonce);
      void sendMessage(queuedSelectionPrompt.prompt, queuedSelectionPrompt.ctx);
    }
  }, [isOpen, queuedSelectionPrompt, lastHandledNonce, isSending]);

  if (!isOpen) return null;

  const updateProposalStatus = (
    msgId: string,
    propId: string,
    decision: 'accepted' | 'rejected'
  ) => {
    setMessages(prev =>
      prev.map(m =>
        m.id === msgId
          ? {
              ...m,
              proposedChanges: (m.proposedChanges || []).map(p =>
                p.id === propId ? { ...p, status: decision } : p
              ),
            }
          : m
      )
    );
  };

  const handleProposalDecision = (
    msgId: string,
    prop: CopilotProposedChange,
    decision: 'accepted' | 'rejected'
  ) => {
    if (decision === 'rejected') {
      updateProposalStatus(msgId, prop.id, 'rejected');
      setProposalFeedback(prev => ({
        ...prev,
        [prop.id]: { ok: true, message: 'Proposal dismissed.' },
      }));
      return;
    }

    const result = onApplyProposedChange(prop);
    if (result.applied) {
      updateProposalStatus(msgId, prop.id, 'accepted');
      setProposalFeedback(prev => ({
        ...prev,
        [prop.id]: { ok: true, message: result.detail },
      }));
    } else if (selectedTextContext && onApplySelectedTextReplacement && prop.afterPreview) {
      const selResult = onApplySelectedTextReplacement(selectedTextContext, prop.afterPreview);
      if (selResult.applied) {
        updateProposalStatus(msgId, prop.id, 'accepted');
        setProposalFeedback(prev => ({
          ...prev,
          [prop.id]: { ok: true, message: selResult.detail },
        }));
      } else {
        setProposalFeedback(prev => ({
          ...prev,
          [prop.id]: { ok: false, message: result.detail },
        }));
      }
    } else {
      setProposalFeedback(prev => ({
        ...prev,
        [prop.id]: { ok: false, message: result.detail },
      }));
    }
  };

  const handleBatchAcceptPending = (msg: CopilotMessage) => {
    const pending = (msg.proposedChanges || []).filter(p => p.status === 'pending');
    for (const prop of pending) {
      handleProposalDecision(msg.id, prop, 'accepted');
    }
  };

  const handleRegenerateTargetSection = async (
    msgId: string,
    prop: CopilotProposedChange
  ) => {
    const target = findStage5Target(project, prop);
    if (!target) return;
    setRegenProposalId(prop.id);
    setProposalFeedback(prev => {
      const next = { ...prev };
      delete next[prop.id];
      return next;
    });
    try {
      const res = await apiFetch('/api/v2/content/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: compactProjectForApi(project, { onlyModuleId: target.moduleId }),
          targetType: target.targetType,
          moduleId: target.moduleId,
          targetId: target.targetId,
          instruction: `${prop.title}. ${prop.rationale}\nTarget guidance: ${prop.afterPreview}`,
          provider: selectedProvider,
          model: selectedModel,
        }),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Section regeneration failed.');
      }
      onApplyRegeneratedSection({
        targetType: target.targetType,
        moduleId: target.moduleId,
        targetId: target.targetId,
        updatedItem: data.updatedItem,
        title: prop.title,
      });
      updateProposalStatus(msgId, prop.id, 'accepted');
      setProposalFeedback(prev => ({
        ...prev,
        [prop.id]: {
          ok: true,
          message: `Regenerated ${target.targetType.replace('_', ' ')} in Stage 5 · Module ${target.moduleNumber} with AI.`,
        },
      }));
    } catch (err: any) {
      setProposalFeedback(prev => ({
        ...prev,
        [prop.id]: {
          ok: false,
          message: err?.message || 'Section regeneration failed.',
        },
      }));
    } finally {
      setRegenProposalId(null);
    }
  };

  const copyText = (id: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const readableSourcesCount = project.sources.filter(
    s => (s.extractedText || s.summary || '').trim().length > 20
  ).length;

  return (
    <aside className="fixed right-0 top-16 bottom-0 z-40 w-full sm:w-[440px] bg-white border-l border-slate-200 shadow-2xl flex flex-col">
      <div className="px-4 py-3 bg-[#052B66] text-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#45CC42]" />
          <div>
            <div className="text-xs font-bold">Course Copilot</div>
            <div className="text-[11px] text-slate-300 flex items-center gap-2">
              <span>Stage {project.currentStage} Assistant</span>
              <span className="inline-flex items-center gap-1 text-slate-200">
                <FileText className="w-3 h-3 text-[#45CC42]" />
                <span>{readableSourcesCount} source doc(s) indexed</span>
              </span>
            </div>
          </div>
        </div>
        <button type="button" onClick={onClose} className="p-1 text-slate-300 hover:text-white cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Execution Mode Toggle + Quick Prompts */}
      <div className="px-3 py-2 border-b border-slate-200 bg-[#F5F7FA] space-y-2">
        <label className="flex items-center justify-between text-[11px] text-slate-700 cursor-pointer">
          <span className="font-semibold">
            Auto-apply minor scoped text edits (major changes still confirm)
          </span>
          <input
            type="checkbox"
            checked={autoApplyMinorEdits}
            onChange={e => setAutoApplyMinorEdits(e.target.checked)}
          />
        </label>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {[
            'Fix failing QA issues',
            'Verify against reference sources',
            'Improve weakest learning outcome',
            'Suggest better workplace scenario',
          ].map(q => (
            <button
              key={q}
              type="button"
              onClick={() => void sendMessage(q)}
              className="px-2.5 py-1 text-[11px] font-semibold bg-white border border-slate-200 rounded-md hover:border-[#052B66] text-[#052B66] whitespace-nowrap shrink-0 cursor-pointer"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Pinned Selected Text Context */}
      {selectedTextContext?.text && (
        <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 text-xs space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-amber-950">
              Selected Text Context ({selectedTextContext.sectionLabel || `Stage ${selectedTextContext.stage}`})
            </span>
            {onClearSelectedTextContext && (
              <button
                type="button"
                onClick={onClearSelectedTextContext}
                className="text-[11px] text-amber-800 hover:text-amber-950 font-semibold cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
          <p className="text-[11px] text-amber-900 line-clamp-2 italic">
            "{selectedTextContext.text}"
          </p>
        </div>
      )}

      {/* Messages (select-text enabled!) */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 select-text">
        {messages.map(msg => {
          const textHint =
            msg.role === 'assistant' && (!msg.proposedChanges || msg.proposedChanges.length === 0)
              ? detectStageHintInText(msg.content)
              : null;
          const pendingProps = (msg.proposedChanges || []).filter(p => p.status === 'pending');

          return (
            <div
              key={msg.id}
              className={`space-y-2 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}
            >
              <div
                className={`inline-block max-w-[92%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed select-text ${
                  msg.role === 'user'
                    ? 'bg-[#052B66] text-white text-left'
                    : 'bg-[#F5F7FA] border border-slate-200 text-slate-800'
                }`}
              >
                <div className="whitespace-pre-wrap select-text">{msg.content}</div>
                {msg.id.startsWith('err-') && lastFailedRequest && (
                  <div className="mt-2">
                    <button
                      type="button"
                      disabled={isSending}
                      onClick={() => void sendMessage(lastFailedRequest.text, lastFailedRequest.ctx)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#052B66] text-white text-[11px] font-semibold hover:bg-[#042150] disabled:opacity-50 cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Retry Request</span>
                    </button>
                  </div>
                )}
                {msg.role === 'assistant' && (
                  <div className="mt-2 pt-1.5 border-t border-slate-200/70 flex items-center justify-between gap-2">
                    {textHint ? (
                      <button
                        type="button"
                        onClick={() =>
                          onNavigateToSection(textHint.stage, {
                            moduleNumber: textHint.moduleNumber,
                            reason: msg.content.slice(0, 220),
                          })
                        }
                        className="text-[11px] font-bold text-[#052B66] hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <span>Go to {textHint.label}</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      onClick={() => copyText(msg.id, msg.content)}
                      className="text-[11px] text-slate-500 hover:text-[#052B66] flex items-center gap-1 cursor-pointer"
                    >
                      {copiedId === msg.id ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>{copiedId === msg.id ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                )}
              </div>

              {msg.proposedChanges && msg.proposedChanges.length > 0 && (
                <div className="space-y-2.5 text-left">
                  {pendingProps.length > 1 && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleBatchAcceptPending(msg)}
                        className="px-2.5 py-1 rounded bg-[#45CC42] hover:bg-[#3ab837] text-[#052B66] text-[11px] font-bold cursor-pointer"
                      >
                        Accept & Apply All Pending ({pendingProps.length})
                      </button>
                    </div>
                  )}

                  {msg.proposedChanges.map(prop => {
                    const loc = resolveProposalTargetLocation(project, prop);
                    const stage5Target = findStage5Target(project, prop);
                    const fb = proposalFeedback[prop.id];
                    const isRegenBusy = regenProposalId === prop.id;

                    return (
                      <div
                        key={prop.id}
                        className="p-3 rounded-lg border border-slate-200 bg-white space-y-2 text-xs shadow-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                            {loc.stageLabel} · {prop.targetType.replace('_', ' ')}
                          </span>
                          {prop.status === 'accepted' && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Applied</span>
                            </span>
                          )}
                          {prop.status === 'rejected' && (
                            <span className="text-[11px] font-bold text-slate-400 uppercase">
                              Rejected
                            </span>
                          )}
                        </div>

                        <div className="font-bold text-[#052B66]">{prop.title}</div>
                        <p className="text-[11px] text-slate-600">{prop.rationale}</p>
                        <div className="p-2 rounded bg-[#F5F7FA] border border-slate-200 text-[11px] text-slate-800 select-text whitespace-pre-wrap max-h-40 overflow-y-auto">
                          {prop.afterPreview}
                        </div>

                        {fb && (
                          <div
                            className={`p-2 rounded border text-[11px] flex items-start gap-1.5 ${
                              fb.ok
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                : 'bg-amber-50 border-amber-300 text-amber-900'
                            }`}
                          >
                            {fb.ok ? (
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            ) : (
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            )}
                            <span>{fb.message}</span>
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          {prop.status === 'pending' && (
                            <>
                              <button
                                type="button"
                                disabled={isRegenBusy}
                                onClick={() => handleProposalDecision(msg.id, prop, 'accepted')}
                                className="px-2.5 py-1.5 bg-[#45CC42] hover:bg-[#3ab837] text-[#052B66] font-bold rounded cursor-pointer disabled:opacity-50"
                              >
                                Accept & Apply
                              </button>
                              <button
                                type="button"
                                disabled={isRegenBusy}
                                onClick={() => handleProposalDecision(msg.id, prop, 'rejected')}
                                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded cursor-pointer disabled:opacity-50"
                              >
                                Reject
                              </button>
                            </>
                          )}

                          {selectedTextContext?.text &&
                            prop.afterPreview &&
                            onApplySelectedTextReplacement &&
                            prop.status === 'pending' && (
                              <button
                                type="button"
                                onClick={() => {
                                  const res = onApplySelectedTextReplacement(
                                    selectedTextContext,
                                    prop.afterPreview
                                  );
                                  if (res.applied) {
                                    updateProposalStatus(msg.id, prop.id, 'accepted');
                                  }
                                  setProposalFeedback(prev => ({
                                    ...prev,
                                    [prop.id]: { ok: res.applied, message: res.detail },
                                  }));
                                }}
                                className="px-2.5 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-950 font-semibold rounded cursor-pointer"
                              >
                                Replace Selection
                              </button>
                            )}

                          {stage5Target && prop.status !== 'rejected' && (
                            <button
                              type="button"
                              disabled={isRegenBusy}
                              onClick={() => handleRegenerateTargetSection(msg.id, prop)}
                              className="px-2.5 py-1.5 bg-[#052B66] hover:bg-[#042150] text-white font-semibold rounded flex items-center gap-1 cursor-pointer disabled:opacity-60"
                            >
                              {isRegenBusy ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <RefreshCw className="w-3 h-3 text-[#45CC42]" />
                              )}
                              <span>Regenerate with AI</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              onNavigateToSection(loc.stage, {
                                moduleNumber: loc.moduleNumber,
                                reason: `${prop.title}: ${prop.rationale}`,
                              })
                            }
                            className="px-2.5 py-1.5 bg-white border border-slate-300 hover:border-[#052B66] text-[#052B66] font-semibold rounded flex items-center gap-1 cursor-pointer"
                          >
                            <span>Go to {loc.stageLabel}</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {isSending && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#052B66]" />
            <span>Thinking...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={e => {
          e.preventDefault();
          void sendMessage();
        }}
        className="p-3 border-t border-slate-200 bg-white flex items-center gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask Copilot to fix QA, outcomes, sources, or selection..."
          className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-[#052B66]"
        />
        <button
          type="submit"
          disabled={isSending || !input.trim()}
          className="p-2 rounded-lg bg-[#052B66] hover:bg-[#042150] disabled:opacity-50 text-white cursor-pointer"
        >
          <Send className="w-4 h-4 text-[#45CC42]" />
        </button>
      </form>
    </aside>
  );
};
