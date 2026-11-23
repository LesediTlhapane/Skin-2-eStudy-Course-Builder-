import React, { useState } from 'react';
import { Check, Copy, Loader2, Send, Sparkles, X } from 'lucide-react';
import type {
  AIProvider,
  CopilotMessage,
  CopilotProposedChange,
  CourseProject,
} from '../types';
import { parseApiJson } from '../utils/apiClient';

interface CourseCopilotDrawerProps {
  isOpen: boolean;
  project: CourseProject;
  selectedProvider: AIProvider;
  selectedModel: string;
  onClose: () => void;
  onApplyProposedChange: (proposal: CopilotProposedChange) => void;
}

export const CourseCopilotDrawer: React.FC<CourseCopilotDrawerProps> = ({
  isOpen,
  project,
  selectedProvider,
  selectedModel,
  onClose,
  onApplyProposedChange,
}) => {
  const [messages, setMessages] = useState<CopilotMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      timestamp: new Date().toISOString(),
      content:
        'I am your Course Copilot. I can help refine learning outcomes, strengthen scenarios, improve rubrics, spot missing curriculum coverage, or explain QA findings. Any suggested edits appear as Accept/Reject proposals so your approved data is never changed silently.',
    },
  ]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!isOpen) return null;

  const sendMessage = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || isSending) return;
    const userMsg: CopilotMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    if (!textOverride) setInput('');
    setIsSending(true);

    try {
      const res = await fetch('/api/v2/copilot/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project,
          messages: nextHistory.map(m => ({ role: m.role, content: m.content })),
          userMessage: text,
          provider: selectedProvider,
          model: selectedModel,
        }),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Copilot request failed.');
      }
      const assistantMsg: CopilotMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: data.reply,
        timestamp: new Date().toISOString(),
        proposedChanges: data.proposedChanges || [],
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
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

  const handleProposalDecision = (
    msgId: string,
    prop: CopilotProposedChange,
    decision: 'accepted' | 'rejected'
  ) => {
    if (decision === 'accepted') {
      onApplyProposedChange(prop);
    }
    setMessages(prev =>
      prev.map(m =>
        m.id === msgId
          ? {
              ...m,
              proposedChanges: (m.proposedChanges || []).map(p =>
                p.id === prop.id ? { ...p, status: decision } : p
              ),
            }
          : m
      )
    );
  };

  const copyText = (id: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <aside className="fixed right-0 top-16 bottom-0 z-40 w-full sm:w-[420px] bg-white border-l border-slate-200 shadow-2xl flex flex-col">
      <div className="px-4 py-3 bg-[#052B66] text-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#45CC42]" />
          <div>
            <div className="text-xs font-bold">Course Copilot</div>
            <div className="text-[11px] text-slate-300">Stage {project.currentStage} Assistant</div>
          </div>
        </div>
        <button type="button" onClick={onClose} className="p-1 text-slate-300 hover:text-white cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Quick Prompts */}
      <div className="px-3 py-2 border-b border-slate-200 bg-[#F5F7FA] flex items-center gap-1.5 overflow-x-auto">
        {[
          'Check missing curriculum coverage',
          'Improve weakest learning outcome',
          'Explain QA findings',
          'Suggest better workplace scenario',
        ].map(q => (
          <button
            key={q}
            type="button"
            onClick={() => sendMessage(q)}
            className="px-2.5 py-1 text-[11px] font-semibold bg-white border border-slate-200 rounded-md hover:border-[#052B66] text-[#052B66] whitespace-nowrap shrink-0 cursor-pointer"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Messages (select-text enabled!) */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 select-text">
        {messages.map(msg => (
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
              {msg.role === 'assistant' && (
                <div className="mt-2 pt-1.5 border-t border-slate-200/70 flex justify-end">
                  <button
                    type="button"
                    onClick={() => copyText(msg.id, msg.content)}
                    className="text-[11px] text-slate-500 hover:text-[#052B66] flex items-center gap-1 cursor-pointer"
                  >
                    {copiedId === msg.id ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedId === msg.id ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              )}
            </div>

            {msg.proposedChanges && msg.proposedChanges.length > 0 && (
              <div className="space-y-2 text-left">
                {msg.proposedChanges.map(prop => (
                  <div
                    key={prop.id}
                    className="p-3 rounded-lg border border-slate-200 bg-white space-y-2 text-xs"
                  >
                    <div className="font-bold text-[#052B66]">{prop.title}</div>
                    <p className="text-[11px] text-slate-600">{prop.rationale}</p>
                    <div className="p-2 rounded bg-[#F5F7FA] border border-slate-200 text-[11px] text-slate-800 select-text whitespace-pre-wrap">
                      {prop.afterPreview}
                    </div>
                    {prop.status === 'pending' ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleProposalDecision(msg.id, prop, 'accepted')}
                          className="px-3 py-1 bg-[#45CC42] text-[#052B66] font-bold rounded cursor-pointer"
                        >
                          Accept Change
                        </button>
                        <button
                          type="button"
                          onClick={() => handleProposalDecision(msg.id, prop, 'rejected')}
                          className="px-3 py-1 bg-slate-100 text-slate-700 font-semibold rounded cursor-pointer"
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <div className="text-[11px] font-bold text-slate-500 uppercase">
                        {prop.status}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
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
          sendMessage();
        }}
        className="p-3 border-t border-slate-200 bg-white flex items-center gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask Copilot about curriculum, outcomes, QA..."
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
