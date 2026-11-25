import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  FileUp,
  Loader2,
  Send,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import type {
  AIProvider,
  CourseBrief,
  CourseCreationMode,
  CourseProject,
  CourseTemplate,
  CurriculumModulePlan,
  SourceDocument,
} from '../types';
import { BENCHMARK_PRESETS, createEmptyCourseProject } from '../data/benchmarks';
import { apiFetch, parseApiJson } from '../utils/apiClient';
import {
  exportTemplateAsDocx,
  uploadAndParseFilledTemplateFile,
} from '../utils/templateDocx';

interface CreateCourseModalProps {
  isOpen: boolean;
  templates: CourseTemplate[];
  selectedProvider: AIProvider;
  selectedModel: string;
  initialTemplateId?: string;
  onClose: () => void;
  onCreateProject: (project: CourseProject) => void;
}

interface ModalCopilotTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  followUps?: string[];
}

const QUICK_PROMPTS = [
  'Create a 6-module GEN AI course for business professionals (8 hours)',
  'Workplace Health, Safety & Hazard Reporting induction (4 modules)',
  'Consultative Customer Service & Complaint Resolution (5 modules)',
];

export const CreateCourseModal: React.FC<CreateCourseModalProps> = ({
  isOpen,
  templates,
  selectedProvider,
  selectedModel,
  initialTemplateId,
  onClose,
  onCreateProject,
}) => {
  const [mode, setMode] = useState<CourseCreationMode>('copilot');
  const [templateId, setTemplateId] = useState<string>(
    initialTemplateId || templates[0]?.id || 'tpl-estudy-master-v9'
  );
  useEffect(() => {
    if (isOpen) {
      setTemplateId(initialTemplateId || templates[0]?.id || 'tpl-estudy-master-v9');
      setErrorMsg(null);
    }
  }, [isOpen, initialTemplateId]);
  const [presetId, setPresetId] = useState<string>('');
  const [rawText, setRawText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filledDocFile, setFilledDocFile] = useState<File | null>(null);
  const [isDownloadingDocx, setIsDownloadingDocx] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const filledDocRef = useRef<HTMLInputElement>(null);

  // Copilot Guided Onboarding State
  const [copilotPrompt, setCopilotPrompt] = useState('');
  const [copilotHistory, setCopilotHistory] = useState<ModalCopilotTurn[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Describe the course you want to build (topic, audience, duration, or module count). I will automatically fill out the Stage 1 Course Brief, template placeholders, and a starter module plan so you never have to guess what goes into blank fields.',
      followUps: QUICK_PROMPTS,
    },
  ]);
  const [draftedBrief, setDraftedBrief] = useState<Partial<CourseBrief> | null>(null);
  const [draftedModules, setDraftedModules] = useState<CurriculumModulePlan[]>([]);
  const [includeDraftedModules, setIncludeDraftedModules] = useState(true);

  if (!isOpen) return null;

  const selectedTemplate = templates.find(t => t.id === templateId) || templates[0];
  const templateFields = selectedTemplate?.sections.flatMap(s => s.fields) || [];

  const readFilePayload = async (file: File) => {
    const isText =
      file.type.startsWith('text/') ||
      /\.(txt|md|csv|json)$/i.test(file.name);
    if (isText) {
      return { rawText: await file.text(), base64Data: undefined };
    }
    const base64Data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const s = String(reader.result || '');
        const idx = s.indexOf(',');
        resolve(idx >= 0 ? s.slice(idx + 1) : s);
      };
      reader.onerror = () => reject(new Error('Could not read file.'));
      reader.readAsDataURL(file);
    });
    return { rawText: undefined, base64Data };
  };

  const handleCopilotDraft = async (overridePrompt?: string) => {
    const promptText = (overridePrompt ?? copilotPrompt).trim();
    if (!promptText || isProcessing) return;

    const userTurn: ModalCopilotTurn = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: promptText,
    };
    const nextHistory = [...copilotHistory, userTurn];
    setCopilotHistory(nextHistory);
    if (!overridePrompt) setCopilotPrompt('');
    setIsProcessing(true);
    setErrorMsg(null);

    try {
      const res = await apiFetch('/api/v2/copilot/draft-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptText,
          template: selectedTemplate,
          currentBrief: draftedBrief || undefined,
          currentModules: draftedModules.length > 0 ? draftedModules : undefined,
          messages: nextHistory.map(m => ({ role: m.role, content: m.content })),
          provider: selectedProvider,
          model: selectedModel,
        }),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Copilot could not draft the course brief.');
      }

      const mergedBrief: Partial<CourseBrief> = {
        ...(draftedBrief || {}),
        ...(data.brief || {}),
        templateFieldValues: {
          ...(draftedBrief?.templateFieldValues || {}),
          ...(data.brief?.templateFieldValues || {}),
        },
        fieldStatuses: {
          ...(draftedBrief?.fieldStatuses || {}),
          ...(data.brief?.fieldStatuses || {}),
        },
      };

      setDraftedBrief(mergedBrief);
      if (Array.isArray(data.modules)) {
        setDraftedModules(data.modules);
      }

      setCopilotHistory(prev => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: data.reply || 'Draft updated. Review the filled fields on the right.',
          followUps: Array.isArray(data.suggestedFollowUps) ? data.suggestedFollowUps : [],
        },
      ]);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Copilot request failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCreateFromCopilot = () => {
    if (!draftedBrief) return;
    const project = createEmptyCourseProject({
      templateId: selectedTemplate.id,
      templateName: selectedTemplate.name,
      creationMode: 'copilot',
    });

    project.brief = {
      ...project.brief,
      ...draftedBrief,
      templateFieldValues: {
        ...project.brief.templateFieldValues,
        ...(draftedBrief.templateFieldValues || {}),
      },
      fieldStatuses: {
        ...project.brief.fieldStatuses,
        ...(draftedBrief.fieldStatuses || {}),
      },
      saCompliance: project.brief.saCompliance,
      metadataLocked: false,
      approval: { approved: false },
    };

    if (includeDraftedModules && draftedModules.length > 0) {
      project.curriculum = {
        ...project.curriculum,
        rationale: `Initial ${draftedModules.length}-module structure drafted by Course Copilot during project creation.`,
        modules: draftedModules,
        approval: { approved: false },
      };
    }

    onCreateProject(project);
    setDraftedBrief(null);
    setDraftedModules([]);
    setCopilotPrompt('');
    setCopilotHistory([
      {
        id: 'welcome',
        role: 'assistant',
        content:
          'Describe the course you want to build (topic, audience, duration, or module count). I will automatically fill out the Stage 1 Course Brief, template placeholders, and a starter module plan so you never have to guess what goes into blank fields.',
        followUps: QUICK_PROMPTS,
      },
    ]);
    onClose();
  };

  const handleStartBriefMode = () => {
    const preset = BENCHMARK_PRESETS.find(b => b.id === presetId);
    const tpl =
      (preset ? templates.find(t => t.id === preset.templateId) : null) ||
      selectedTemplate;
    const project = createEmptyCourseProject({
      templateId: tpl.id,
      templateName: tpl.name,
      creationMode: 'brief',
      preset,
    });
    if (!preset && tpl.defaultAiMode) {
      project.brief.aiIntegrationMode = tpl.defaultAiMode;
    }
    onCreateProject(project);
    onClose();
  };

  const handleSourceOrImproveMode = async () => {
    if (!selectedFile && !rawText.trim()) {
      setErrorMsg('Please upload a document (DOCX, PDF, TXT) or paste source/course text.');
      return;
    }
    setIsProcessing(true);
    setErrorMsg(null);
    try {
      let filePayload: { rawText?: string; base64Data?: string } = { rawText };
      if (selectedFile) {
        filePayload = await readFilePayload(selectedFile);
      }

      if (mode === 'source') {
        const res = await apiFetch('/api/v2/sources/analyse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: selectedFile?.name || 'Pasted Source Material.txt',
            mimeType: selectedFile?.type || 'text/plain',
            base64Data: filePayload.base64Data,
            rawText: filePayload.rawText,
            provider: selectedProvider,
            model: selectedModel,
          }),
        });
        const data = await parseApiJson<any>(res);
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to analyse source material.');
        }

        const project = createEmptyCourseProject({
          templateId: selectedTemplate.id,
          templateName: selectedTemplate.name,
          creationMode: 'source',
        });

        const srcDoc: SourceDocument = {
          id: `src-${Date.now()}`,
          title: data.metadata?.title || selectedFile?.name || 'Uploaded Source',
          authorOrOrganisation: data.metadata?.authorOrOrganisation || 'To Be Confirmed',
          publicationDate: data.metadata?.publicationDate || 'To Be Confirmed',
          version: data.metadata?.version || 'To Be Confirmed',
          referenceOrUrl: data.metadata?.referenceOrUrl || selectedFile?.name || 'Uploaded',
          fileName: selectedFile?.name,
          mimeType: selectedFile?.type,
          extractedText: data.extractedText || rawText,
          relevantSections: data.metadata?.relevantSections || ['Course Brief'],
          verificationStatus: 'NEEDS REVIEW',
          summary: data.metadata?.summary,
          keyTopics: data.metadata?.keyTopics || [],
          addedAt: new Date().toISOString(),
        };

        project.sources = [srcDoc];
        project.brief.title = data.briefSuggestions?.title || '';
        project.brief.industryDomain = data.briefSuggestions?.industryDomain || '';
        project.brief.purpose = data.briefSuggestions?.purpose || '';
        project.brief.targetAudience = data.briefSuggestions?.targetAudience || '';
        project.brief.subjectTopicsInput = data.briefSuggestions?.subjectTopicsInput || '';
        onCreateProject(project);
        onClose();
      } else {
        const res = await apiFetch('/api/v2/improve/diagnose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: selectedFile?.name || 'Existing Course.txt',
            mimeType: selectedFile?.type || 'text/plain',
            base64Data: filePayload.base64Data,
            rawText: filePayload.rawText,
            provider: selectedProvider,
            model: selectedModel,
          }),
        });
        const data = await parseApiJson<any>(res);
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to diagnose existing course.');
        }

        const project = createEmptyCourseProject({
          templateId: selectedTemplate.id,
          templateName: selectedTemplate.name,
          creationMode: 'improve',
        });
        project.improveDiagnosis = data.diagnosis;
        project.brief = {
          ...project.brief,
          ...(data.extractedBrief || {}),
        };
        project.curriculum.modules = Array.isArray(data.extractedModules)
          ? data.extractedModules
          : [];
        project.sources = [
          {
            id: `src-orig-${Date.now()}`,
            title: `Original Course: ${project.brief.title || selectedFile?.name || 'Existing Course'}`,
            authorOrOrganisation: 'eStudy Existing Course',
            publicationDate: 'To Be Confirmed',
            version: 'Baseline',
            referenceOrUrl: selectedFile?.name || 'Uploaded Draft',
            extractedText: data.extractedText || rawText,
            relevantSections: ['All Modules'],
            verificationStatus: 'NEEDS REVIEW',
            summary: data.diagnosis?.originalSummary,
            addedAt: new Date().toISOString(),
          },
        ];
        onCreateProject(project);
        onClose();
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Document processing failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadSelectedTemplateDocx = async () => {
    if (!selectedTemplate) return;
    setIsDownloadingDocx(true);
    setErrorMsg(null);
    try {
      await exportTemplateAsDocx(selectedTemplate);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not generate Word template.');
    } finally {
      setIsDownloadingDocx(false);
    }
  };

  const handleFilledTemplateUpload = async () => {
    if (!filledDocFile) {
      setErrorMsg('Please select a filled Word (.docx), PDF, or text template file to upload.');
      return;
    }
    setIsProcessing(true);
    setErrorMsg(null);
    try {
      const outcome = await uploadAndParseFilledTemplateFile({
        file: filledDocFile,
        templates,
        fallbackTemplateId: selectedTemplate?.id,
        provider: selectedProvider,
        model: selectedModel,
      });
      if (outcome.populatedFieldCount === 0 && outcome.suggestedModules.length === 0) {
        throw new Error(
          'No filled values were detected in this file. Replace the placeholder text inside the right-hand cells before uploading.'
        );
      }
      setFilledDocFile(null);
      onCreateProject(outcome.project);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not import filled Word template.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-slate-200 max-w-4xl w-full max-h-[92vh] flex flex-col shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-bold text-[#052B66]">Start a New Course Project</h2>
            <p className="text-xs text-slate-500">
              Use Course Copilot to populate brief & template placeholders from a prompt, or start from a blank brief or document.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* 5 Creation Modes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            {[
              {
                id: 'copilot' as const,
                title: '1. Course Copilot',
                desc: 'Prompt Copilot to fill Stage 1 & placeholders.',
                icon: Sparkles,
                accent: true,
              },
              {
                id: 'filled_template' as const,
                title: '2. Filled Word (.docx)',
                desc: 'Download Word form, fill offline & upload back.',
                icon: Download,
              },
              {
                id: 'brief' as const,
                title: '3. Blank / Preset Brief',
                desc: 'Fill fields manually or load a starter brief.',
                icon: FileText,
              },
              {
                id: 'source' as const,
                title: '4. From Source File',
                desc: 'Upload manuals or policies for AI analysis.',
                icon: FileUp,
              },
              {
                id: 'improve' as const,
                title: '5. Improve Course',
                desc: 'Diagnose an existing course & keep structure.',
                icon: Wrench,
              },
            ].map(item => {
              const Icon = item.icon;
              const active = mode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setMode(item.id);
                    setErrorMsg(null);
                  }}
                  className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                    active
                      ? 'border-[#052B66] bg-[#052B66]/5 ring-1 ring-[#052B66]/20'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 mb-1.5 ${
                      active
                        ? item.accent
                          ? 'text-[#45CC42]'
                          : 'text-[#052B66]'
                        : 'text-slate-500'
                    }`}
                  />
                  <div className="text-xs font-bold text-[#052B66]">{item.title}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{item.desc}</div>
                </button>
              );
            })}
          </div>

          {/* Template Selection */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-6 space-y-1">
              <label className="block text-xs font-bold text-[#052B66]">
                Course Template
              </label>
              <select
                value={templateId}
                onChange={e => setTemplateId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-[#F5F7FA] focus:bg-white focus:outline-none focus:border-[#052B66]"
              >
                {templates.map(tpl => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name} ({tpl.category})
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-3 text-[11px] text-slate-500 pb-2">
              {selectedTemplate?.sections.length || 0} sections · {templateFields.length} fields
            </div>
            <div className="md:col-span-3 flex justify-end">
              <button
                type="button"
                disabled={isDownloadingDocx || !selectedTemplate}
                onClick={() => void handleDownloadSelectedTemplateDocx()}
                className="w-full md:w-auto px-3 py-2 text-xs font-bold bg-[#F5F7FA] border border-slate-200 hover:border-[#052B66] text-[#052B66] rounded-lg flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {isDownloadingDocx ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                <span>Download Word (.docx)</span>
              </button>
            </div>
          </div>

          {mode === 'copilot' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
              {/* Left: Copilot Prompt & Conversation */}
              <div className="lg:col-span-6 border border-slate-200 rounded-xl flex flex-col bg-[#F5F7FA] overflow-hidden min-h-[340px]">
                <div className="px-4 py-2.5 bg-[#052B66] text-white flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#45CC42]" />
                    <span className="text-xs font-bold">Course Onboarding Copilot</span>
                  </div>
                  <span className="text-[11px] text-slate-300">Auto-fills placeholders</span>
                </div>

                <div className="flex-1 p-3.5 space-y-3 overflow-y-auto max-h-[260px]">
                  {copilotHistory.map(turn => (
                    <div
                      key={turn.id}
                      className={`space-y-1.5 ${turn.role === 'user' ? 'text-right' : 'text-left'}`}
                    >
                      <div
                        className={`inline-block max-w-[94%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                          turn.role === 'user'
                            ? 'bg-[#052B66] text-white text-left'
                            : 'bg-white border border-slate-200 text-slate-800'
                        }`}
                      >
                        {turn.content}
                      </div>
                      {turn.role === 'assistant' && turn.followUps && turn.followUps.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {turn.followUps.map(s => (
                            <button
                              key={s}
                              type="button"
                              disabled={isProcessing}
                              onClick={() => handleCopilotDraft(s)}
                              className="px-2.5 py-1 text-[11px] font-medium bg-white border border-slate-200 hover:border-[#052B66] text-[#052B66] rounded-md text-left cursor-pointer disabled:opacity-50"
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {isProcessing && (
                    <div className="flex items-center gap-2 text-xs text-slate-600">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#052B66]" />
                      <span>Drafting course brief, placeholders & module outline...</span>
                    </div>
                  )}
                </div>

                <form
                  onSubmit={e => {
                    e.preventDefault();
                    handleCopilotDraft();
                  }}
                  className="p-3 bg-white border-t border-slate-200 space-y-2"
                >
                  <textarea
                    rows={2}
                    value={copilotPrompt}
                    onChange={e => setCopilotPrompt(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleCopilotDraft();
                      }
                    }}
                    placeholder="e.g. Create a 6-module GEN AI course for non-technical managers, 8 hours, with practical prompt exercises..."
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-[#052B66]"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-500">
                      Press Enter or click Draft to populate fields
                    </span>
                    <button
                      type="submit"
                      disabled={isProcessing || !copilotPrompt.trim()}
                      className="px-3.5 py-1.5 rounded-lg bg-[#052B66] hover:bg-[#042150] disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      {isProcessing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5 text-[#45CC42]" />
                      )}
                      <span>{draftedBrief ? 'Refine Draft' : 'Draft Fields'}</span>
                    </button>
                  </div>
                </form>
              </div>

              {/* Right: Live Populated Placeholders Preview */}
              <div className="lg:col-span-6 border border-slate-200 rounded-xl bg-white flex flex-col overflow-hidden min-h-[340px]">
                <div className="px-4 py-2.5 border-b border-slate-200 bg-[#F5F7FA] flex items-center justify-between">
                  <span className="text-xs font-bold text-[#052B66]">
                    Drafted Brief & Placeholder Preview
                  </span>
                  {draftedBrief && (
                    <span className="text-[11px] font-semibold text-emerald-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Ready to Create
                    </span>
                  )}
                </div>

                {!draftedBrief ? (
                  <div className="flex-1 p-5 flex flex-col justify-center space-y-3 text-xs text-slate-600">
                    <p className="font-bold text-[#052B66]">
                      Copilot will automatically populate these fields for you:
                    </p>
                    <ul className="space-y-1.5 list-disc pl-4">
                      <li>Course Title, Code, Domain, Experience Level & Duration</li>
                      <li>Target Audience, Job Roles & Prerequisites</li>
                      <li>Course Purpose, Workplace Need & Learning Requirements</li>
                      <li>Mandatory Subject Topics list (Stage 2 Coverage Baseline)</li>
                      <li>
                        All {templateFields.length} template-specific placeholders for{' '}
                        <strong>{selectedTemplate?.name}</strong>
                      </li>
                      <li>Starter module sequence (matching any module count you specify)</li>
                    </ul>
                  </div>
                ) : (
                  <div className="flex-1 p-4 space-y-3 overflow-y-auto max-h-[340px] text-xs">
                    <div className="p-3 rounded-lg bg-[#F5F7FA] border border-slate-200 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <input
                          type="text"
                          value={draftedBrief.title || ''}
                          onChange={e =>
                            setDraftedBrief(prev => ({ ...(prev || {}), title: e.target.value }))
                          }
                          placeholder="Course Title"
                          className="flex-1 px-2.5 py-1 text-sm font-bold text-[#052B66] bg-white border border-slate-200 rounded"
                        />
                        <span className="text-[11px] font-mono text-slate-600 bg-white px-2 py-1 border border-slate-200 rounded">
                          {draftedBrief.code || 'Code TBC'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-700">
                        <div>
                          <strong>Domain:</strong> {draftedBrief.industryDomain || 'TBC'}
                        </div>
                        <div>
                          <strong>Duration:</strong> {draftedBrief.estimatedDuration || 'TBC'}
                        </div>
                        <div>
                          <strong>Level:</strong> {draftedBrief.experienceLevel || 'Intermediate'}
                        </div>
                        <div>
                          <strong>AI Mode:</strong> {draftedBrief.aiIntegrationMode || 'optional'}
                        </div>
                      </div>
                      <div className="text-[11px] text-slate-700">
                        <strong>Target Audience:</strong> {draftedBrief.targetAudience}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="text-[11px] font-bold text-[#052B66]">
                        Purpose & Workplace Need
                      </div>
                      <p className="text-[11px] text-slate-700 leading-relaxed">
                        {draftedBrief.purpose}
                      </p>
                      {draftedBrief.workplaceProblem && (
                        <p className="text-[11px] text-slate-500">
                          <strong>Need:</strong> {draftedBrief.workplaceProblem}
                        </p>
                      )}
                    </div>

                    {draftedBrief.subjectTopicsInput && (
                      <div className="space-y-1">
                        <div className="text-[11px] font-bold text-[#052B66]">
                          Mandatory Subject Topics
                        </div>
                        <div className="p-2.5 rounded bg-[#F5F7FA] border border-slate-200 text-[11px] text-slate-700 whitespace-pre-line">
                          {draftedBrief.subjectTopicsInput}
                        </div>
                      </div>
                    )}

                    {templateFields.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-bold text-[#052B66]">
                          Template Placeholders Filled ({templateFields.length})
                        </div>
                        <div className="space-y-1.5">
                          {templateFields.map(tf => (
                            <div
                              key={tf.id}
                              className="p-2 rounded border border-slate-200 bg-white space-y-0.5"
                            >
                              <div className="text-[11px] font-semibold text-slate-700">
                                {tf.label}
                              </div>
                              <div className="text-[11px] text-slate-600">
                                {draftedBrief.templateFieldValues?.[tf.key] ||
                                  'Pending refinement'}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {draftedModules.length > 0 && (
                      <div className="space-y-1.5 pt-1 border-t border-slate-200">
                        <label className="flex items-center justify-between text-[11px] font-bold text-[#052B66] cursor-pointer">
                          <span>
                            Starter Curriculum Outline ({draftedModules.length} Modules)
                          </span>
                          <span className="flex items-center gap-1.5 font-normal text-slate-600">
                            <input
                              type="checkbox"
                              checked={includeDraftedModules}
                              onChange={e => setIncludeDraftedModules(e.target.checked)}
                            />
                            Pre-fill Stage 2
                          </span>
                        </label>
                        <div className="space-y-1">
                          {draftedModules.map(m => (
                            <div
                              key={m.id}
                              className="px-2.5 py-1.5 rounded bg-[#F5F7FA] border border-slate-200 text-[11px] text-slate-800"
                            >
                              <strong className="text-[#052B66]">M{m.order}:</strong> {m.title}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {mode === 'filled_template' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-[#052B66]/20 bg-[#F5F7FA] space-y-2.5">
                <div className="text-xs font-bold text-[#052B66]">
                  Step 1: Download "{selectedTemplate?.name}" as a Fillable Word Document
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Download the selected template as a structured Word (.docx) document, fill in your course details inside the right-hand cells offline in Microsoft Word or Google Docs, and upload it back below.
                </p>
                <button
                  type="button"
                  disabled={isDownloadingDocx || !selectedTemplate}
                  onClick={() => void handleDownloadSelectedTemplateDocx()}
                  className="px-4 py-2 text-xs font-bold bg-white border border-[#052B66] text-[#052B66] hover:bg-slate-50 rounded-lg inline-flex items-center gap-2 cursor-pointer"
                >
                  {isDownloadingDocx ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  <span>Download "{selectedTemplate?.name}" (.docx)</span>
                </button>
              </div>

              <div className="border border-dashed border-slate-300 rounded-xl p-5 bg-white space-y-3">
                <div className="text-xs font-bold text-[#052B66]">
                  Step 2: Upload Your Filled Word Template (.docx)
                </div>
                <input
                  ref={filledDocRef}
                  type="file"
                  accept=".docx,.pdf,.txt,.md"
                  onChange={e => setFilledDocFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-slate-600">
                    {filledDocFile ? (
                      <span className="font-semibold text-[#052B66]">{filledDocFile.name}</span>
                    ) : (
                      'Select the filled .docx Word template (or any filled course brief document)'
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => filledDocRef.current?.click()}
                    className="px-3.5 py-2 text-xs font-bold bg-[#F5F7FA] border border-slate-300 rounded-lg hover:border-[#052B66] text-[#052B66] cursor-pointer"
                  >
                    Choose Filled File
                  </button>
                </div>
              </div>
            </div>
          )}

          {mode === 'brief' && (
            <div className="space-y-2">
              <label className="block text-xs font-bold text-[#052B66]">
                Optional Benchmark Starter Brief (for rapid testing)
              </label>
              <select
                value={presetId}
                onChange={e => setPresetId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-[#F5F7FA] focus:bg-white focus:outline-none focus:border-[#052B66]"
              >
                <option value="">Start with a blank Stage 1 Course Brief</option>
                {BENCHMARK_PRESETS.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.label} — {b.category}
                  </option>
                ))}
              </select>
            </div>
          )}

          {(mode === 'source' || mode === 'improve') && (
            <div className="space-y-3">
              <div className="border border-dashed border-slate-300 rounded-lg p-4 bg-[#F5F7FA] space-y-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.docx,.txt,.md,.csv,.json"
                  onChange={e => setSelectedFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-slate-600">
                    {selectedFile ? (
                      <span className="font-semibold text-[#052B66]">{selectedFile.name}</span>
                    ) : (
                      'Upload PDF, DOCX, TXT, or Markdown document'
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="px-3 py-1.5 text-xs font-bold bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    Choose File
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Or paste source / existing course text directly
                </label>
                <textarea
                  rows={5}
                  value={rawText}
                  onChange={e => setRawText(e.target.value)}
                  placeholder={
                    mode === 'source'
                      ? 'Paste policy text, technical manual excerpt, or legislation...'
                      : 'Paste existing course outline, outcomes, and module content to audit...'
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-[#052B66]"
                />
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-[#F5F7FA] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div>
            {mode === 'copilot' && (
              <button
                type="button"
                onClick={handleStartBriefMode}
                className="text-xs font-semibold text-[#052B66] hover:underline cursor-pointer"
              >
                Or open blank Stage 1 Brief without Copilot
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              Cancel
            </button>

            {mode === 'copilot' ? (
              <button
                type="button"
                disabled={!draftedBrief}
                onClick={handleCreateFromCopilot}
                className="px-5 py-2.5 rounded-lg bg-[#45CC42] hover:bg-[#3ab837] disabled:opacity-50 text-[#052B66] text-xs font-bold flex items-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Create Course with Drafted Fields</span>
              </button>
            ) : mode === 'filled_template' ? (
              <button
                type="button"
                disabled={isProcessing || !filledDocFile}
                onClick={() => void handleFilledTemplateUpload()}
                className="px-5 py-2.5 rounded-lg bg-[#45CC42] hover:bg-[#3ab837] disabled:opacity-50 text-[#052B66] text-xs font-bold flex items-center gap-2 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Importing Filled Template...</span>
                  </>
                ) : (
                  <>
                    <FileUp className="w-4 h-4" />
                    <span>Import Word & Create Course</span>
                  </>
                )}
              </button>
            ) : mode === 'brief' ? (
              <button
                type="button"
                onClick={handleStartBriefMode}
                className="px-5 py-2.5 rounded-lg bg-[#052B66] hover:bg-[#042150] text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
              >
                <span>Open Course Brief</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={isProcessing}
                onClick={handleSourceOrImproveMode}
                className="px-5 py-2.5 rounded-lg bg-[#052B66] hover:bg-[#042150] disabled:opacity-60 text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{mode === 'source' ? 'Analysing Source...' : 'Diagnosing Course...'}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-[#45CC42]" />
                    <span>{mode === 'source' ? 'Analyse Source & Start' : 'Run Diagnosis & Start'}</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
