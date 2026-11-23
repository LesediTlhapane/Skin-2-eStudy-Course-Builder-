import React, { useRef, useState } from 'react';
import {
  FileText,
  FileUp,
  Loader2,
  Sparkles,
  Wrench,
  X,
  AlertTriangle,
} from 'lucide-react';
import type {
  AIProvider,
  CourseCreationMode,
  CourseProject,
  CourseTemplate,
  SourceDocument,
} from '../types';
import { BENCHMARK_PRESETS, createEmptyCourseProject } from '../data/benchmarks';

interface CreateCourseModalProps {
  isOpen: boolean;
  templates: CourseTemplate[];
  selectedProvider: AIProvider;
  selectedModel: string;
  initialTemplateId?: string;
  onClose: () => void;
  onCreateProject: (project: CourseProject) => void;
}

export const CreateCourseModal: React.FC<CreateCourseModalProps> = ({
  isOpen,
  templates,
  selectedProvider,
  selectedModel,
  initialTemplateId,
  onClose,
  onCreateProject,
}) => {
  const [mode, setMode] = useState<CourseCreationMode>('brief');
  const [templateId, setTemplateId] = useState<string>(
    initialTemplateId || templates[0]?.id || 'tpl-estudy-master-v9'
  );
  const [presetId, setPresetId] = useState<string>('');
  const [rawText, setRawText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const selectedTemplate = templates.find(t => t.id === templateId) || templates[0];

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
        const res = await fetch('/api/v2/sources/analyse', {
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
        const data = await res.json();
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
          verificationStatus: data.metadata?.verificationStatus || 'VERIFIED',
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
        const res = await fetch('/api/v2/improve/diagnose', {
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
        const data = await res.json();
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
            verificationStatus: 'VERIFIED',
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

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-slate-200 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#052B66]">Start a New Course Project</h2>
            <p className="text-xs text-slate-500">
              Choose how to initialise the 7-stage instructional design workspace
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

        <div className="p-6 space-y-6">
          {/* 3 Creation Modes */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                id: 'brief' as const,
                title: '1. From a Brief',
                desc: 'Define brief, audience, and topics in Stage 1.',
                icon: FileText,
              },
              {
                id: 'source' as const,
                title: '2. From Source Material',
                desc: 'Upload manuals, policies, or legislation for AI analysis.',
                icon: FileUp,
              },
              {
                id: 'improve' as const,
                title: '3. Improve Existing Course',
                desc: 'Diagnose weaknesses first while preserving curriculum.',
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
                  className={`p-3.5 rounded-lg border text-left transition-colors cursor-pointer ${
                    active
                      ? 'border-[#052B66] bg-[#052B66]/5'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <Icon className={`w-4 h-4 mb-2 ${active ? 'text-[#052B66]' : 'text-slate-500'}`} />
                  <div className="text-xs font-bold text-[#052B66]">{item.title}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{item.desc}</div>
                </button>
              );
            })}
          </div>

          {/* Template Selection */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-[#052B66]">
              Course Template
            </label>
            <select
              value={templateId}
              onChange={e => setTemplateId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-[#F5F7FA] focus:bg-white focus:outline-none focus:border-[#052B66]"
            >
              {templates.map(tpl => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name} ({tpl.category})
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500">{selectedTemplate?.description}</p>
          </div>

          {mode === 'brief' ? (
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
          ) : (
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

        <div className="px-6 py-4 border-t border-slate-200 bg-[#F5F7FA] flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            Cancel
          </button>
          {mode === 'brief' ? (
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
  );
};
