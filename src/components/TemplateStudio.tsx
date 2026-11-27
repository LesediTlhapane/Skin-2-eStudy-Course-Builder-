import React, { useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  Eye,
  FileText,
  FileUp,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  AIProvider,
  CompanyRole,
  CompanyWorkspace,
  CourseProject,
  CourseTemplate,
  TemplateField,
  TemplateSection,
} from '../types';
import { apiFetch, parseApiJson } from '../utils/apiClient';
import { toExportBrandOptions } from '../utils/exportBranding';
import {
  exportTemplateAsDocx,
  uploadAndParseFilledTemplateFile,
} from '../utils/templateDocx';
import { TemplateCopilotDrawer } from './TemplateCopilotDrawer';
import { getRolePermissions } from '../utils/rbac';

interface TemplateStudioProps {
  templates: CourseTemplate[];
  activeCompany?: CompanyWorkspace | null;
  activeRole?: CompanyRole | null;
  selectedProvider: AIProvider;
  selectedModel: string;
  onSaveTemplate: (template: CourseTemplate) => void;
  onDuplicateTemplate: (templateId: string) => CourseTemplate | null;
  onDeleteTemplate: (templateId: string) => void;
  onUseTemplate: (templateId: string) => void;
  onCreateCourseFromFilledDoc?: (project: CourseProject) => void;
}

export const TemplateStudio: React.FC<TemplateStudioProps> = ({
  templates,
  activeCompany,
  activeRole,
  selectedProvider,
  selectedModel,
  onSaveTemplate,
  onDuplicateTemplate,
  onDeleteTemplate,
  onUseTemplate,
  onCreateCourseFromFilledDoc,
}) => {
  const perms = getRolePermissions(activeRole);
  const canManageTemplates = perms.canManageTemplates;
  const canCreateCourse = perms.canCreateOrDeleteCourse;

  const [selectedId, setSelectedId] = useState<string>(templates[0]?.id || '');
  const [draft, setDraft] = useState<CourseTemplate | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isImportingFilled, setIsImportingFilled] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const filledDocRef = useRef<HTMLInputElement>(null);

  const activeTemplate =
    draft || templates.find(t => t.id === selectedId) || templates[0];

  const beginEdit = (tpl: CourseTemplate) => {
    setSelectedId(tpl.id);
    if (tpl.isSystemReference) {
      // Editing a system reference duplicates it into a customizable draft
      setDraft({
        ...JSON.parse(JSON.stringify(tpl)),
        id: `tpl-custom-${Date.now()}`,
        name: `${tpl.name} (Custom Copy)`,
        isSystemReference: false,
      });
    } else {
      setDraft(JSON.parse(JSON.stringify(tpl)));
    }
    setPreviewMode(false);
    setSaveNotice(null);
  };

  const handleCreateBlank = () => {
    const now = new Date().toISOString();
    const blank: CourseTemplate = {
      id: `tpl-custom-${Date.now()}`,
      name: 'New Custom Course Template',
      category: 'Custom',
      description: 'Reusable structural template for eStudy course projects.',
      version: 'v1.0',
      isSystemReference: false,
      defaultAiMode: 'optional',
      qualityRules: ['Verify all metadata and learning outcome alignment before export.'],
      sections: [
        {
          id: `sec-${Date.now()}`,
          title: '1. Context & Requirements',
          description: 'Essential context fields for this programme type.',
          required: true,
          order: 1,
          fields: [
            {
              id: `fld-${Date.now()}`,
              key: 'contextNotes',
              label: 'Programme Context',
              placeholder: '{{Insert programme-specific context}}',
              fieldType: 'textarea',
              required: true,
            },
          ],
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    setDraft(blank);
    setSelectedId(blank.id);
    setPreviewMode(false);
  };

  const handleUploadTemplateFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      const isText = file.type.startsWith('text/') || /\.(txt|md|json)$/i.test(file.name);
      let rawText: string | undefined;
      let base64Data: string | undefined;
      if (isText) {
        rawText = await file.text();
      } else {
        base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const s = String(reader.result || '');
            resolve(s.includes(',') ? s.split(',')[1] : s);
          };
          reader.onerror = () => reject(new Error('File read error'));
          reader.readAsDataURL(file);
        });
      }
      const res = await apiFetch('/api/v2/templates/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          base64Data,
          rawText,
          provider: selectedProvider,
          model: selectedModel,
        }),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to extract template.');
      }
      const now = new Date().toISOString();
      const extracted: CourseTemplate = {
        id: `tpl-custom-${Date.now()}`,
        name: data.template?.name || file.name.replace(/\.[^.]+$/, ''),
        category: data.template?.category || 'Imported Template',
        description: data.template?.description || `Extracted from ${file.name}`,
        version: data.template?.version || 'v1.0',
        isSystemReference: false,
        defaultAiMode: data.template?.defaultAiMode || 'optional',
        qualityRules: data.template?.qualityRules || [],
        sections: Array.isArray(data.template?.sections) ? data.template.sections : [],
        createdAt: now,
        updatedAt: now,
      };
      setDraft(extracted);
      setSelectedId(extracted.id);
      setPreviewMode(false);
    } catch (err: any) {
      setUploadError(err?.message || 'Could not extract template.');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleDownloadDocx = async (tpl: CourseTemplate) => {
    setDownloadingId(tpl.id);
    setUploadError(null);
    try {
      await exportTemplateAsDocx(tpl, undefined, toExportBrandOptions(activeCompany));
      setSaveNotice(
        `Downloaded "${tpl.name}" as a fillable Word (.docx) document. Fill in the right-hand cells and upload it back to create your course.`
      );
    } catch (err: any) {
      setUploadError(err?.message || 'Could not generate Word template.');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleUploadFilledWordCourse = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onCreateCourseFromFilledDoc) return;
    setIsImportingFilled(true);
    setUploadError(null);
    setSaveNotice(null);
    try {
      const outcome = await uploadAndParseFilledTemplateFile({
        file,
        templates,
        fallbackTemplateId: activeTemplate?.id,
        provider: selectedProvider,
        model: selectedModel,
      });
      if (outcome.populatedFieldCount === 0 && outcome.suggestedModules.length === 0) {
        throw new Error(
          'No filled fields were detected in this Word document. Replace the placeholder text inside the right-hand cells before uploading.'
        );
      }
      onCreateCourseFromFilledDoc(outcome.project);
    } catch (err: any) {
      setUploadError(err?.message || 'Could not import filled Word template.');
    } finally {
      setIsImportingFilled(false);
      e.target.value = '';
    }
  };

  const currentEditable = draft;

  const updateSection = (secIdx: number, patch: Partial<TemplateSection>) => {
    if (!currentEditable) return;
    const sections = currentEditable.sections.map((s, i) =>
      i === secIdx ? { ...s, ...patch } : s
    );
    setDraft({ ...currentEditable, sections });
  };

  const moveSection = (idx: number, dir: -1 | 1) => {
    if (!currentEditable) return;
    const target = idx + dir;
    if (target < 0 || target >= currentEditable.sections.length) return;
    const next = [...currentEditable.sections];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    setDraft({
      ...currentEditable,
      sections: next.map((s, i) => ({ ...s, order: i + 1 })),
    });
  };

  const addSection = () => {
    if (!currentEditable) return;
    const nextOrder = currentEditable.sections.length + 1;
    setDraft({
      ...currentEditable,
      sections: [
        ...currentEditable.sections,
        {
          id: `sec-${Date.now()}`,
          title: `${nextOrder}. New Template Section`,
          description: '',
          required: false,
          order: nextOrder,
          fields: [],
        },
      ],
    });
  };

  const removeSection = (idx: number) => {
    if (!currentEditable) return;
    const next = currentEditable.sections
      .filter((_, i) => i !== idx)
      .map((s, i) => ({ ...s, order: i + 1 }));
    setDraft({ ...currentEditable, sections: next });
  };

  const addField = (secIdx: number) => {
    if (!currentEditable) return;
    const newField: TemplateField = {
      id: `fld-${Date.now()}`,
      key: `field_${Date.now().toString().slice(-4)}`,
      label: 'New Field',
      placeholder: '{{Insert value}}',
      fieldType: 'textarea',
      required: false,
    };
    const sections = currentEditable.sections.map((s, i) =>
      i === secIdx ? { ...s, fields: [...s.fields, newField] } : s
    );
    setDraft({ ...currentEditable, sections });
  };

  const updateField = (secIdx: number, fldIdx: number, patch: Partial<TemplateField>) => {
    if (!currentEditable) return;
    const sections = currentEditable.sections.map((s, i) =>
      i === secIdx
        ? {
            ...s,
            fields: s.fields.map((f, fi) => (fi === fldIdx ? { ...f, ...patch } : f)),
          }
        : s
    );
    setDraft({ ...currentEditable, sections });
  };

  const removeField = (secIdx: number, fldIdx: number) => {
    if (!currentEditable) return;
    const sections = currentEditable.sections.map((s, i) =>
      i === secIdx ? { ...s, fields: s.fields.filter((_, fi) => fi !== fldIdx) } : s
    );
    setDraft({ ...currentEditable, sections });
  };

  const handleSave = () => {
    if (!currentEditable) return;
    onSaveTemplate(currentEditable);
    setSelectedId(currentEditable.id);
    setDraft(null);
    setSaveNotice(`Saved template "${currentEditable.name}".`);
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-primary">Course Template Studio</h1>
          <p className="text-sm text-slate-500">
            Create, upload, edit, reorder, preview, and duplicate reusable instructional-design templates separate from active courses.
          </p>
        </div>

        {canManageTemplates && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,.json"
              onChange={handleUploadTemplateFile}
              className="hidden"
            />
            <input
              ref={filledDocRef}
              type="file"
              accept=".docx,.pdf,.txt,.md"
              onChange={handleUploadFilledWordCourse}
              className="hidden"
            />
            {onCreateCourseFromFilledDoc && canCreateCourse && (
              <button
                type="button"
                disabled={isImportingFilled}
                onClick={() => filledDocRef.current?.click()}
                className="px-3.5 py-2 text-xs font-bold bg-accent hover:bg-accent-dark text-accent-contrast rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-60 shadow-xs transition-colors"
              >
                {isImportingFilled ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileText className="w-3.5 h-3.5" />
                )}
                <span>Upload Filled Word (.docx)</span>
              </button>
            )}
            <button
              type="button"
              disabled={isUploading}
              onClick={() => fileRef.current?.click()}
              className="px-3.5 py-2 text-xs font-bold bg-white border border-slate-200 hover:border-accent-border text-primary rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileUp className="w-3.5 h-3.5 text-accent-ink" />}
              <span>Import Structure</span>
            </button>
            <button
              type="button"
              onClick={() => setIsCopilotOpen(!isCopilotOpen)}
              className="px-3.5 py-2 text-xs font-bold bg-primary hover:bg-primary-dark text-primary-contrast rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-accent" />
              <span>Template Copilot</span>
            </button>
            <button
              type="button"
              onClick={handleCreateBlank}
              className="px-3.5 py-2 text-xs font-bold bg-white border border-slate-200 hover:border-accent-border text-primary rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-accent-ink" />
              <span>New Template</span>
            </button>
          </div>
        )}
      </div>

      {uploadError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          {uploadError}
        </div>
      )}
      {saveNotice && (
        <div className="p-3 bg-accent-tint border border-accent-border rounded-lg text-xs text-primary">
          {saveNotice}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Template Library List */}
        <aside className="lg:col-span-4 space-y-2.5">
          {templates.map(tpl => {
            const isActive = activeTemplate?.id === tpl.id && !draft;
            return (
              <div
                key={tpl.id}
                onClick={() => {
                  setDraft(null);
                  setSelectedId(tpl.id);
                  setPreviewMode(false);
                }}
                className={`p-4 rounded-xl border cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-accent-tint/55 border-accent border-t-[3px] border-t-accent ring-1 ring-accent/25'
                    : 'bg-white border-slate-200 hover:border-accent-border'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-primary truncate">{tpl.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {tpl.category} · {tpl.version} · {tpl.sections.length} sections
                    </div>
                  </div>
                </div>
                <p className="text-xs text-slate-600 mt-2 line-clamp-2">{tpl.description}</p>
                <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-2">
                  {canCreateCourse && (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onUseTemplate(tpl.id);
                      }}
                      className="px-2.5 py-1 text-[11px] font-bold bg-accent hover:bg-accent-dark text-accent-contrast rounded cursor-pointer transition-colors"
                    >
                      Use Template
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={downloadingId === tpl.id}
                    onClick={e => {
                      e.stopPropagation();
                      void handleDownloadDocx(tpl);
                    }}
                    className="px-2.5 py-1 text-[11px] font-semibold bg-surface border border-slate-200 hover:border-accent-border text-primary rounded flex items-center gap-1 cursor-pointer disabled:opacity-60"
                    title="Download fillable Word (.docx) template"
                  >
                    {downloadingId === tpl.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Download className="w-3 h-3 text-accent-ink" />
                    )}
                    <span>Word (.docx)</span>
                  </button>
                  {canManageTemplates && (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        const copy = onDuplicateTemplate(tpl.id);
                        if (copy) {
                          setSelectedId(copy.id);
                          setDraft(copy);
                        }
                      }}
                      className="px-2 py-1 text-[11px] font-semibold text-slate-600 hover:text-primary flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Duplicate</span>
                    </button>
                  )}
                  {canManageTemplates && !tpl.isSystemReference && (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onDeleteTemplate(tpl.id);
                      }}
                      className="ml-auto p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                      title="Delete Custom Template"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </aside>

        {/* Template Viewer / Editor */}
        <section className="lg:col-span-8 bg-white border border-slate-200 border-t-[3px] border-t-accent rounded-xl p-6 space-y-6">
          {activeTemplate && (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
                <div>
                  <h2 className="text-lg font-bold text-primary">
                    {draft ? `Editing: ${draft.name}` : activeTemplate.name}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {activeTemplate.isSystemReference
                      ? 'System Reference Template (click Edit Copy to customise)'
                      : 'Custom Workspace Template'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={downloadingId === activeTemplate.id}
                    onClick={() => void handleDownloadDocx(activeTemplate)}
                    className="px-3 py-1.5 text-xs font-bold border border-accent-border bg-surface hover:border-accent text-primary rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    {downloadingId === activeTemplate.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5 text-accent-ink" />
                    )}
                    <span>Download Word (.docx)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode(!previewMode)}
                    className="px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>{previewMode ? 'Back to Structure' : 'Preview'}</span>
                  </button>
                  {canManageTemplates && (
                    !draft ? (
                      <button
                        type="button"
                        onClick={() => beginEdit(activeTemplate)}
                        className="px-3.5 py-1.5 text-xs font-bold bg-primary hover:bg-primary-dark text-primary-contrast rounded-lg cursor-pointer"
                      >
                        {activeTemplate.isSystemReference ? 'Edit Copy' : 'Edit Template'}
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setDraft(null)}
                          className="px-3 py-1.5 text-xs font-semibold text-slate-600 cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSave}
                          className="px-4 py-1.5 text-xs font-bold bg-accent hover:bg-accent-dark text-accent-contrast rounded-lg flex items-center gap-1.5 cursor-pointer"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>Save Template</span>
                        </button>
                      </>
                    )
                  )}
                </div>
              </div>

              {previewMode ? (
                <div className="space-y-5 bg-[#F8FAFC] p-4 sm:p-6 rounded-xl border border-slate-200">
                  {/* eStudy South Africa Executive Cover Header */}
                  <div className="bg-white border border-slate-200 border-b-4 border-b-[#B68D2C] rounded-lg px-6 py-6 text-center space-y-2 shadow-xs">
                    <div className="text-base font-extrabold tracking-wide text-[#1B365D]">
                      eStudy South Africa
                    </div>
                    <div className="text-lg font-extrabold uppercase tracking-wider text-[#B68D2C]">
                      {activeTemplate.name}
                    </div>
                    <div className="text-xs italic font-medium text-[#2C6B74]">
                      {activeTemplate.category} · Version {activeTemplate.version} · Universal Fillable Word Template
                    </div>
                    <p className="text-xs text-slate-600 max-w-2xl mx-auto pt-1 leading-relaxed">
                      {activeTemplate.description}
                    </p>
                  </div>

                  {/* Green Global Rule Callout */}
                  <div className="bg-[#ECF5F0] border-l-4 border-[#1E6F5C] px-4 py-3 rounded-r text-xs text-[#1B365D] leading-relaxed">
                    <span className="font-bold text-[#1E6F5C]">HOW TO USE THIS TEMPLATE: </span>
                    Download as Word (.docx), replace each highlighted{' '}
                    <span className="font-semibold text-[#1D4ED8]">[INSERT: ...]</span> block with your course
                    details while keeping the section layout intact, then upload the completed document to
                    auto-populate Stage 1 Brief, custom template fields, and starter modules.
                  </div>

                  {/* Section Banners + Pale-Blue Fillable Fields */}
                  {activeTemplate.sections.map((sec, sIdx) => (
                    <div key={sec.id} className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
                      <div className="bg-[#1B365D] px-4 py-2.5 flex items-center justify-between border-b-2 border-[#B68D2C]">
                        <h3 className="text-xs sm:text-sm font-bold tracking-wide text-white uppercase">
                          {sIdx + 1}. {sec.title.replace(/^\d+\.\s*/, '')}
                        </h3>
                        <span className="text-[11px] font-semibold text-[#FDE68A]">
                          {sec.required ? 'REQUIRED' : 'OPTIONAL'}
                        </span>
                      </div>
                      <div className="p-4 space-y-3">
                        <p className="text-xs text-slate-600 italic border-b border-slate-100 pb-2">
                          {sec.description}
                        </p>
                        <div className="space-y-3">
                          {sec.fields.map(f => (
                            <div key={f.id} className="space-y-1">
                              <label className="block text-xs font-bold text-[#1B365D]">
                                {f.label}{' '}
                                <span className={f.required ? 'text-[#B68D2C]' : 'text-slate-400 font-normal'}>
                                  {f.required ? '*' : '(Optional)'}
                                </span>
                              </label>
                              <div className="px-3.5 py-2.5 text-xs italic text-[#1D4ED8] bg-[#EBF3FC] border border-[#BFDBFE] border-l-4 border-l-[#2B6CB0] rounded-r">
                                {f.placeholder?.trim().startsWith('[')
                                  ? f.placeholder
                                  : `[INSERT: ${(f.placeholder || f.label).toUpperCase()}]`}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : draft ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-primary mb-1">
                        Template Name
                      </label>
                      <input
                        type="text"
                        value={draft.name}
                        onChange={e => setDraft({ ...draft, name: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-primary mb-1">
                        Category
                      </label>
                      <input
                        type="text"
                        value={draft.category}
                        onChange={e => setDraft({ ...draft, category: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-accent"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-primary mb-1">
                      Description
                    </label>
                    <textarea
                      rows={2}
                      value={draft.description}
                      onChange={e => setDraft({ ...draft, description: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-accent"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <h3 className="text-sm font-bold text-primary">
                      Template Sections ({draft.sections.length})
                    </h3>
                    <button
                      type="button"
                      onClick={addSection}
                      className="px-3 py-1.5 text-xs font-bold bg-accent-tint/60 text-accent-ink border border-accent-border rounded-lg hover:bg-accent-tint flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Section</span>
                    </button>
                  </div>

                  <div className="space-y-4">
                    {draft.sections.map((sec, sIdx) => (
                      <div key={sec.id} className="border border-slate-200 border-l-[3px] border-l-accent rounded-lg p-4 space-y-3 bg-surface/70">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={sec.title}
                            onChange={e => updateSection(sIdx, { title: e.target.value })}
                            className="flex-1 px-3 py-1.5 text-sm font-bold text-primary bg-white border border-slate-200 rounded focus:outline-none focus:border-accent"
                          />
                          <label className="flex items-center gap-1.5 text-xs text-slate-700">
                            <input
                              type="checkbox"
                              checked={sec.required}
                              onChange={e => updateSection(sIdx, { required: e.target.checked })}
                            />
                            Required
                          </label>
                          <button
                            type="button"
                            onClick={() => moveSection(sIdx, -1)}
                            className="p-1.5 text-slate-500 hover:text-primary cursor-pointer"
                            title="Move Up"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveSection(sIdx, 1)}
                            className="p-1.5 text-slate-500 hover:text-primary cursor-pointer"
                            title="Move Down"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeSection(sIdx)}
                            className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                            title="Remove Section"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="space-y-2 pl-2 border-l border-accent-border">
                          {sec.fields.map((fld, fIdx) => (
                            <div key={fld.id} className="bg-white border border-slate-200 rounded p-3 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                              <input
                                type="text"
                                value={fld.label}
                                onChange={e => updateField(sIdx, fIdx, { label: e.target.value })}
                                placeholder="Field label"
                                className="sm:col-span-4 px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:border-accent"
                              />
                              <input
                                type="text"
                                value={fld.placeholder}
                                onChange={e => updateField(sIdx, fIdx, { placeholder: e.target.value })}
                                placeholder="{{Placeholder}}"
                                className="sm:col-span-5 px-2 py-1 text-xs font-mono border border-slate-200 rounded focus:outline-none focus:border-accent"
                              />
                              <label className="sm:col-span-2 flex items-center gap-1 text-xs text-slate-600">
                                <input
                                  type="checkbox"
                                  checked={fld.required}
                                  onChange={e => updateField(sIdx, fIdx, { required: e.target.checked })}
                                />
                                Req
                              </label>
                              <button
                                type="button"
                                onClick={() => removeField(sIdx, fIdx)}
                                className="sm:col-span-1 text-slate-400 hover:text-red-600 justify-self-end cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => addField(sIdx)}
                            className="text-xs font-semibold text-accent-ink hover:underline cursor-pointer"
                          >
                            + Add Field / Placeholder
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-slate-600">{activeTemplate.description}</p>
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold text-primary uppercase tracking-wider">
                      Quality Rules
                    </h3>
                    <ul className="list-disc pl-5 text-xs text-slate-600 space-y-1">
                      {activeTemplate.qualityRules.map((rule, i) => (
                        <li key={i}>{rule}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="space-y-2.5">
                    <h3 className="text-xs font-bold text-primary uppercase tracking-wider">
                      Template Sections ({activeTemplate.sections.length})
                    </h3>
                    {activeTemplate.sections.map(sec => (
                      <div key={sec.id} className="border border-slate-200 border-l-[3px] border-l-accent rounded-lg p-3.5">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-bold text-primary">{sec.title}</span>
                          <span className="text-xs text-slate-500">
                            {sec.required ? 'Required' : 'Optional'} · {sec.fields.length} field(s)
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">{sec.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <TemplateCopilotDrawer
        isOpen={isCopilotOpen}
        activeTemplate={activeTemplate}
        isEditingDraft={Boolean(draft)}
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        onClose={() => setIsCopilotOpen(false)}
        onLoadDraftInStudio={tpl => {
          setDraft(tpl);
          setSelectedId(tpl.id);
          setPreviewMode(false);
          setSaveNotice(`Loaded "${tpl.name}" from Template Copilot. Review or edit sections and click Save Template.`);
        }}
        onSaveTemplateFromCopilot={tpl => {
          onSaveTemplate(tpl);
          setSelectedId(tpl.id);
          setDraft(null);
          setPreviewMode(false);
          setSaveNotice(`Saved "${tpl.name}" to your Template Library.`);
        }}
        onDownloadDocx={handleDownloadDocx}
      />
    </main>
  );
};
