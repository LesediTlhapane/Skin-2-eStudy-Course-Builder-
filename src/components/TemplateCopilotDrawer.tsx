import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  FileCheck2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import type { AIProvider, CourseTemplate } from '../types';
import { apiFetch, parseApiJson } from '../utils/apiClient';

interface TemplateCopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  draftedTemplate?: CourseTemplate;
  suggestedFollowUps?: string[];
  errorPrompt?: string;
}

interface TemplateCopilotDrawerProps {
  isOpen: boolean;
  activeTemplate?: CourseTemplate;
  isEditingDraft: boolean;
  selectedProvider: AIProvider;
  selectedModel: string;
  onClose: () => void;
  onLoadDraftInStudio: (template: CourseTemplate) => void;
  onSaveTemplateFromCopilot: (template: CourseTemplate) => void;
  onDownloadDocx: (template: CourseTemplate) => Promise<void>;
}

const STARTER_PROMPTS = [
  'Create a South African Mining & OHS Safety Compliance course template with hazard matrix, DMR/MHSA references, and practical sign-off fields.',
  'Design an Engineering & Technical Apprenticeship template with governing equations, workshop lab steps, and assessor verification.',
  'Create a Corporate AI & Digital Transformation training template with prompt governance, POPIA data rules, and workplace ROI metrics.',
  'Build a Healthcare Clinical CPD Workshop template covering clinical scope, infection-control protocols, and case-review criteria.',
];

export const TemplateCopilotDrawer: React.FC<TemplateCopilotDrawerProps> = ({
  isOpen,
  activeTemplate,
  isEditingDraft,
  selectedProvider,
  selectedModel,
  onClose,
  onLoadDraftInStudio,
  onSaveTemplateFromCopilot,
  onDownloadDocx,
}) => {
  const [messages, setMessages] = useState<TemplateCopilotMessage[]>([
    {
      id: 'tpl-copilot-welcome',
      role: 'assistant',
      timestamp: new Date().toISOString(),
      content:
        'Describe the course template you want to build — industry, standards, sections, field types, or compliance rules — and I will architect a reusable template you can edit, save, preview, and download in eStudy Master v9.0 Word (.docx) format.',
    },
  ]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'new' | 'refine'>('new');
  const [latestDraft, setLatestDraft] = useState<CourseTemplate | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<Record<string, string>>({});
  const [downloadingMsgId, setDownloadingMsgId] = useState<string | null>(null);

  if (!isOpen) return null;

  const targetTemplateForRefinement =
    mode === 'refine'
      ? latestDraft || activeTemplate || null
      : latestDraft && messages.length > 1
        ? latestDraft
        : null;

  const resetConversation = () => {
    setLatestDraft(null);
    setActionFeedback({});
    setMode('new');
    setMessages([
      {
        id: `tpl-copilot-reset-${Date.now()}`,
        role: 'assistant',
        timestamp: new Date().toISOString(),
        content:
          'Started a fresh Template Copilot session. Describe the new template you want to create, or switch to Refine mode to update an existing template.',
      },
    ]);
  };

  const sendPrompt = async (promptOverride?: string) => {
    const prompt = (promptOverride ?? input).trim();
    if (!prompt || isSending) return;

    const userMsg: TemplateCopilotMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: new Date().toISOString(),
    };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    if (!promptOverride) setInput('');
    setIsSending(true);

    try {
      const res = await apiFetch('/api/v2/templates/copilot-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          currentTemplate: targetTemplateForRefinement,
          messages: nextHistory
            .filter(m => !m.errorPrompt)
            .map(m => ({ role: m.role, content: m.content })),
          provider: selectedProvider,
          model: selectedModel,
        }),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success || !data.template) {
        throw new Error(data.error || 'Template Copilot could not generate the template.');
      }

      const generatedTemplate: CourseTemplate = data.template;
      setLatestDraft(generatedTemplate);

      setMessages(prev => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content:
            data.reply ||
            `Drafted "${generatedTemplate.name}" with ${generatedTemplate.sections.length} sections.`,
          timestamp: new Date().toISOString(),
          draftedTemplate: generatedTemplate,
          suggestedFollowUps: Array.isArray(data.suggestedFollowUps)
            ? data.suggestedFollowUps
            : [],
        },
      ]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: err?.message || 'Template Copilot request failed.',
          timestamp: new Date().toISOString(),
          errorPrompt: prompt,
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[480px] bg-white border-l border-slate-200 shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="px-4 py-3.5 bg-brand-gradient text-primary-contrast border-b-2 border-accent flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" />
          <div>
            <h2 className="text-sm font-bold">Template Copilot</h2>
            <p className="text-[11px] opacity-80">
              Prompt AI to design or refine custom course templates
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={resetConversation}
            title="Start a new template prompt"
            className="px-2 py-1 text-[11px] font-semibold opacity-85 hover:opacity-100 hover:bg-white/10 rounded flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>New</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 cursor-pointer"
            aria-label="Close Template Copilot"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mode Strip */}
      <div className="px-4 py-2 bg-surface border-b border-slate-200 space-y-1.5">
        <div className="flex items-center gap-2 text-[11px]">
          <button
            type="button"
            onClick={() => {
              setMode('new');
              if (messages.length <= 1) setLatestDraft(null);
            }}
            className={`px-2.5 py-1 rounded font-semibold cursor-pointer transition-colors ${
              mode === 'new'
                ? 'bg-accent text-accent-contrast font-bold'
                : 'bg-white border border-slate-200 text-slate-600 hover:border-accent-border'
            }`}
          >
            Create New Template
          </button>
          {activeTemplate && (
            <button
              type="button"
              onClick={() => setMode('refine')}
              className={`px-2.5 py-1 rounded font-semibold cursor-pointer transition-colors truncate max-w-[240px] ${
                mode === 'refine'
                  ? 'bg-accent text-accent-contrast font-bold'
                  : 'bg-white border border-slate-200 text-slate-600 hover:border-accent-border'
              }`}
              title={`Refine "${activeTemplate.name}"`}
            >
              Refine: {activeTemplate.name}
            </button>
          )}
        </div>
        <div className="text-[11px] text-slate-500">
          {mode === 'refine' && activeTemplate
            ? `Refining ${isEditingDraft ? 'current editor draft' : `"${activeTemplate.name}"`}. Creating a copy preserves system reference templates.`
            : latestDraft
              ? `Iterating on "${latestDraft.name}". Follow-up prompts update this draft.`
              : 'Describe your domain, required sections, standards, and field types.'}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-surface">
        {messages.map(msg => {
          const tpl = msg.draftedTemplate;
          const totalFields = tpl
            ? tpl.sections.reduce((sum, s) => sum + s.fields.length, 0)
            : 0;
          const feedback = actionFeedback[msg.id];

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[94%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-contrast'
                    : msg.errorPrompt
                      ? 'bg-red-50 border border-red-200 text-red-800'
                      : 'bg-white border border-slate-200 text-slate-800 shadow-xs'
                }`}
              >
                {msg.errorPrompt ? (
                  <div className="space-y-2">
                    <div className="flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
                      <span>{msg.content}</span>
                    </div>
                    <button
                      type="button"
                      disabled={isSending}
                      onClick={() => void sendPrompt(msg.errorPrompt)}
                      className="px-2.5 py-1 text-[11px] font-bold bg-white border border-red-300 text-red-700 hover:bg-red-100 rounded flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Retry</span>
                    </button>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                )}

                {/* Generated Template Summary & Actions Card */}
                {tpl && (
                  <div className="mt-3 p-3 bg-[#F8FAFC] border border-slate-200 border-t-2 border-t-[#B68D2C] rounded-lg space-y-2.5">
                    <div>
                      <div className="text-xs font-bold text-[#1B365D]">{tpl.name}</div>
                      <div className="text-[11px] text-[#2C6B74] font-medium">
                        {tpl.category} · {tpl.version} · {tpl.sections.length} sections · {totalFields} fields
                      </div>
                      <p className="text-[11px] text-slate-600 mt-1">{tpl.description}</p>
                    </div>

                    <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                      {tpl.sections.map(sec => (
                        <div
                          key={sec.id}
                          className="text-[11px] bg-white border border-slate-200 rounded px-2.5 py-1.5 flex items-center justify-between gap-2"
                        >
                          <span className="font-semibold text-primary truncate">
                            {sec.title}
                          </span>
                          <span className="text-[10px] text-slate-500 shrink-0">
                            {sec.fields.length} fields{sec.required ? ' · Req' : ''}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          onLoadDraftInStudio(tpl);
                          setActionFeedback(prev => ({
                            ...prev,
                            [msg.id]: 'Loaded into Template Studio editor for review & editing.',
                          }));
                        }}
                        className="px-2.5 py-1.5 text-[11px] font-bold bg-primary hover:bg-primary-dark text-primary-contrast rounded flex items-center gap-1 cursor-pointer"
                      >
                        <FileCheck2 className="w-3 h-3 text-accent" />
                        <span>Load in Editor</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          onSaveTemplateFromCopilot(tpl);
                          setActionFeedback(prev => ({
                            ...prev,
                            [msg.id]: `Saved "${tpl.name}" to your Template Library.`,
                          }));
                        }}
                        className="px-2.5 py-1.5 text-[11px] font-bold bg-accent hover:bg-accent-dark text-accent-contrast rounded flex items-center gap-1 cursor-pointer"
                      >
                        <Save className="w-3 h-3" />
                        <span>Save to Library</span>
                      </button>

                      <button
                        type="button"
                        disabled={downloadingMsgId === msg.id}
                        onClick={async () => {
                          setDownloadingMsgId(msg.id);
                          try {
                            await onDownloadDocx(tpl);
                            setActionFeedback(prev => ({
                              ...prev,
                              [msg.id]: 'Downloaded Word (.docx) template in Master v9.0 theme.',
                            }));
                          } finally {
                            setDownloadingMsgId(null);
                          }
                        }}
                        className="px-2.5 py-1.5 text-[11px] font-semibold bg-white border border-slate-200 hover:border-accent-border text-primary rounded flex items-center gap-1 cursor-pointer disabled:opacity-60"
                      >
                        {downloadingMsgId === msg.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Download className="w-3 h-3 text-accent-ink" />
                        )}
                        <span>Word (.docx)</span>
                      </button>
                    </div>

                    {feedback && (
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                        <Check className="w-3 h-3 shrink-0" />
                        <span>{feedback}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Follow-up Suggestion Chips */}
                {msg.suggestedFollowUps && msg.suggestedFollowUps.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {msg.suggestedFollowUps.map((followUp, idx) => (
                      <button
                        key={idx}
                        type="button"
                        disabled={isSending}
                        onClick={() => void sendPrompt(followUp)}
                        className="text-left px-2 py-1 text-[10px] font-semibold bg-surface hover:bg-accent-tint border border-slate-200 hover:border-accent-border text-primary rounded cursor-pointer disabled:opacity-50"
                      >
                        + {followUp}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Initial Starter Ideas */}
        {messages.length === 1 && (
          <div className="bg-white border border-slate-200 border-t-2 border-t-accent rounded-xl p-3 space-y-2">
            <div className="text-[11px] font-bold text-primary">
              Quick Template Ideas (click to generate)
            </div>
            <div className="space-y-1.5">
              {STARTER_PROMPTS.map((starter, idx) => (
                <button
                  key={idx}
                  type="button"
                  disabled={isSending}
                  onClick={() => void sendPrompt(starter)}
                  className="w-full text-left px-2.5 py-2 text-[11px] text-slate-700 bg-surface hover:bg-accent-tint/60 border border-slate-200 hover:border-accent-border rounded-lg cursor-pointer transition-colors"
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>
        )}

        {isSending && (
          <div className="flex items-center gap-2 text-xs text-primary bg-white border border-accent-border rounded-xl px-3.5 py-2.5 w-fit">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-ink" />
            <span>Designing your custom template structure...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={e => {
          e.preventDefault();
          void sendPrompt();
        }}
        className="p-3 bg-white border-t border-slate-200 space-y-2"
      >
        <div className="flex items-end gap-2">
          <textarea
            rows={2}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendPrompt();
              }
            }}
            placeholder={
              mode === 'refine' && activeTemplate
                ? `How should Copilot update "${activeTemplate.name}"?`
                : 'Describe the template you want (industry, compliance rules, sections, fields)...'
            }
            className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-accent resize-none"
          />
          <button
            type="submit"
            disabled={isSending || !input.trim()}
            className="px-3.5 py-2.5 bg-accent hover:bg-accent-dark disabled:opacity-50 text-accent-contrast rounded-lg flex items-center gap-1.5 text-xs font-bold cursor-pointer"
          >
            {isSending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            <span>{latestDraft || mode === 'refine' ? 'Update' : 'Create'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
