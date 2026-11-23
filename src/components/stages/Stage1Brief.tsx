import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Lock,
  Sparkles,
  Unlock,
  FileUp,
} from 'lucide-react';
import type {
  AIProvider,
  CourseProject,
  CourseTemplate,
  FieldStatus,
} from '../../types';
import { parseApiJson } from '../../utils/apiClient';

interface Stage1BriefProps {
  project: CourseProject;
  template: CourseTemplate | undefined;
  selectedProvider: AIProvider;
  selectedModel: string;
  onUpdateProject: (
    updater: (prev: CourseProject) => CourseProject,
    snapshot?: { trigger: 'stage_approval' | 'ai_generation'; summary: string }
  ) => void;
  onOpenSources: () => void;
  onApproveAndContinue: () => void;
}

const PROTECTED_KEYS = [
  { key: 'title', label: 'Course Title' },
  { key: 'code', label: 'Course Code / ID' },
  { key: 'industryDomain', label: 'Industry / Subject Domain' },
  { key: 'targetAudience', label: 'Target Audience' },
  { key: 'estimatedDuration', label: 'Estimated Duration' },
  { key: 'language', label: 'Delivery Language' },
] as const;

export const Stage1Brief: React.FC<Stage1BriefProps> = ({
  project,
  template,
  selectedProvider,
  selectedModel,
  onUpdateProject,
  onOpenSources,
  onApproveAndContinue,
}) => {
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [isCopilotDrafting, setIsCopilotDrafting] = useState(false);
  const [copilotBriefPrompt, setCopilotBriefPrompt] = useState('');
  const [copilotNotice, setCopilotNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const brief = project.brief;

  const handleCopilotAutoFillStage1 = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = copilotBriefPrompt.trim();
    if (!text || isCopilotDrafting) return;
    setIsCopilotDrafting(true);
    setErrorMsg(null);
    setCopilotNotice(null);
    try {
      const res = await fetch('/api/v2/copilot/draft-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: text,
          template,
          currentBrief: brief,
          currentModules: project.curriculum.modules,
          provider: selectedProvider,
          model: selectedModel,
        }),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Copilot could not draft Stage 1 placeholders.');
      }
      const drafted = data.brief || {};
      const protectedKeys = new Set([
        'title',
        'code',
        'industryDomain',
        'targetAudience',
        'estimatedDuration',
        'language',
      ]);

      onUpdateProject(
        prev => {
          const nextBrief = {
            ...prev.brief,
            templateFieldValues: {
              ...prev.brief.templateFieldValues,
              ...(drafted.templateFieldValues || {}),
            },
            fieldStatuses: {
              ...prev.brief.fieldStatuses,
              ...(drafted.fieldStatuses || {}),
            },
            approval: { approved: false },
          };
          for (const [k, v] of Object.entries(drafted)) {
            if (k === 'templateFieldValues' || k === 'fieldStatuses') continue;
            if (prev.brief.metadataLocked && protectedKeys.has(k)) continue;
            if (v !== undefined && v !== null && String(v).trim() !== '') {
              (nextBrief as any)[k] = v;
            }
          }

          const shouldSeedModules =
            prev.curriculum.modules.length === 0 &&
            Array.isArray(data.modules) &&
            data.modules.length > 0;

          return {
            ...prev,
            lifecycleStatus: prev.lifecycleStatus === 'draft' ? 'in_development' : prev.lifecycleStatus,
            brief: nextBrief,
            curriculum: shouldSeedModules
              ? {
                  ...prev.curriculum,
                  rationale: `Starter ${data.modules.length}-module structure drafted by Course Copilot.`,
                  modules: data.modules,
                  approval: { approved: false },
                }
              : prev.curriculum,
          };
        },
        { trigger: 'ai_generation', summary: 'Populated Stage 1 Brief & placeholders via Copilot' }
      );
      setCopilotBriefPrompt('');
      setCopilotNotice(
        data.modules?.length && project.curriculum.modules.length === 0
          ? `${data.reply || 'Drafted brief and template placeholders.'} (${data.modules.length} starter modules also added to Stage 2.)`
          : data.reply || 'Populated Stage 1 Brief and template placeholders.'
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Copilot auto-fill failed.');
    } finally {
      setIsCopilotDrafting(false);
    }
  };

  const updateBrief = (patch: Partial<typeof brief>) => {
    onUpdateProject(prev => ({
      ...prev,
      lifecycleStatus: prev.lifecycleStatus === 'draft' ? 'in_development' : prev.lifecycleStatus,
      brief: {
        ...prev.brief,
        ...patch,
        approval: { approved: false },
      },
    }));
  };

  const setFieldStatus = (field: string, status: FieldStatus) => {
    updateBrief({
      fieldStatuses: {
        ...brief.fieldStatuses,
        [field]: status,
      },
    });
  };

  const handleAnalyseBrief = async () => {
    setIsAnalysing(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/v2/brief/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief,
          sources: project.sources,
          provider: selectedProvider,
          model: selectedModel,
        }),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to analyse brief.');
      }
      onUpdateProject(
        prev => {
          const nextStatuses = { ...prev.brief.fieldStatuses };
          for (const item of data.analysis?.missingInformation || []) {
            if (!nextStatuses[item.field]) {
              nextStatuses[item.field] = item.recommendedStatus;
            }
          }
          return {
            ...prev,
            brief: {
              ...prev.brief,
              analysis: data.analysis,
              fieldStatuses: nextStatuses,
            },
          };
        },
        { trigger: 'ai_generation', summary: 'Stage 1 AI Brief Analysis completed' }
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Brief analysis failed.');
    } finally {
      setIsAnalysing(false);
    }
  };

  const handleApproveStage1 = () => {
    onUpdateProject(
      prev => ({
        ...prev,
        currentStage: 2,
        lifecycleStatus: 'in_development',
        brief: {
          ...prev.brief,
          metadataLocked: true,
          approval: {
            approved: true,
            approvedAt: new Date().toISOString(),
            approvedBy: 'Course Developer',
          },
        },
      }),
      { trigger: 'stage_approval', summary: 'Approved Stage 1 Course Brief & locked metadata' }
    );
    onApproveAndContinue();
  };

  const canApprove = Boolean(brief.title.trim() && brief.purpose.trim() && brief.targetAudience.trim());

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-[#052B66]">Stage 1: Course Brief & Metadata</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Template: {project.templateName} · Protected metadata cannot be altered silently by AI.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenSources}
            className="px-3.5 py-2 text-xs font-semibold bg-white border border-slate-200 hover:border-[#052B66] text-[#052B66] rounded-lg flex items-center gap-1.5 cursor-pointer"
          >
            <FileUp className="w-3.5 h-3.5" />
            <span>Sources ({project.sources.length})</span>
          </button>
          <button
            type="button"
            onClick={() => updateBrief({ metadataLocked: !brief.metadataLocked })}
            className={`px-3.5 py-2 text-xs font-semibold border rounded-lg flex items-center gap-1.5 cursor-pointer ${
              brief.metadataLocked
                ? 'bg-[#052B66]/5 border-[#052B66] text-[#052B66]'
                : 'bg-white border-slate-200 text-slate-700'
            }`}
          >
            {brief.metadataLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            <span>{brief.metadataLocked ? 'Metadata Locked' : 'Lock Metadata'}</span>
          </button>
        </div>
      </div>

      {/* Inline Copilot Auto-Fill Placeholders Bar */}
      <section className="bg-white border border-[#052B66]/20 rounded-xl p-4 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#45CC42]" />
            <h3 className="text-xs font-bold text-[#052B66]">
              Copilot Auto-Fill Helper — Fill Placeholders from Your Prompt
            </h3>
          </div>
          {brief.metadataLocked && (
            <span className="text-[11px] text-slate-500">
              Locked metadata stays protected
            </span>
          )}
        </div>
        <form onSubmit={handleCopilotAutoFillStage1} className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={copilotBriefPrompt}
            onChange={e => setCopilotBriefPrompt(e.target.value)}
            placeholder="Describe your course goal (e.g. 'Create a 6-module GEN AI course for non-technical business teams, 8 hours')..."
            className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg bg-[#F5F7FA] focus:bg-white focus:outline-none focus:border-[#052B66]"
          />
          <button
            type="submit"
            disabled={isCopilotDrafting || !copilotBriefPrompt.trim()}
            className="px-4 py-2 rounded-lg bg-[#052B66] hover:bg-[#042150] disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
          >
            {isCopilotDrafting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-[#45CC42]" />
            )}
            <span>{isCopilotDrafting ? 'Filling Placeholders...' : 'Fill Placeholders with Copilot'}</span>
          </button>
        </form>
        {copilotNotice && (
          <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
            {copilotNotice}
          </div>
        )}
      </section>

      {/* Mode 3 Diagnosis Panel (if Improve Existing Course) */}
      {project.creationMode === 'improve' && project.improveDiagnosis && (
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-[#052B66]">
              Existing Course Diagnostic Report (Preservation Mode)
            </h3>
            <p className="text-xs text-slate-600 mt-1">
              {project.improveDiagnosis.originalSummary}
            </p>
          </div>
          <div className="text-xs space-y-1">
            <span className="font-bold text-emerald-700">Preserved Curriculum & Strengths: </span>
            <span className="text-slate-700">
              {project.improveDiagnosis.preservedElements.join(' · ')}
            </span>
          </div>
          <div className="space-y-2">
            {project.improveDiagnosis.recommendations.map(rec => (
              <div
                key={rec.id}
                className="p-3 rounded-lg bg-[#F5F7FA] border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="text-xs font-bold text-[#052B66]">
                    [{rec.severity.toUpperCase()}] {rec.area}: {rec.weakness}
                  </div>
                  <div className="text-xs text-slate-600">{rec.recommendation}</div>
                  <div className="text-[11px] text-slate-500">
                    Preserved: {rec.preserveExistingNote}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateProject(prev => ({
                        ...prev,
                        improveDiagnosis: prev.improveDiagnosis
                          ? {
                              ...prev.improveDiagnosis,
                              recommendations: prev.improveDiagnosis.recommendations.map(r =>
                                r.id === rec.id ? { ...r, decision: 'accepted' } : r
                              ),
                            }
                          : undefined,
                      }))
                    }
                    className={`px-2.5 py-1 text-xs font-bold rounded cursor-pointer ${
                      rec.decision === 'accepted'
                        ? 'bg-[#45CC42] text-[#052B66]'
                        : 'bg-white border border-slate-300 text-slate-700'
                    }`}
                  >
                    Approve Change
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateProject(prev => ({
                        ...prev,
                        improveDiagnosis: prev.improveDiagnosis
                          ? {
                              ...prev.improveDiagnosis,
                              recommendations: prev.improveDiagnosis.recommendations.map(r =>
                                r.id === rec.id ? { ...r, decision: 'rejected' } : r
                              ),
                            }
                          : undefined,
                      }))
                    }
                    className={`px-2.5 py-1 text-xs font-semibold rounded cursor-pointer ${
                      rec.decision === 'rejected'
                        ? 'bg-slate-700 text-white'
                        : 'bg-white border border-slate-300 text-slate-600'
                    }`}
                  >
                    Keep Original
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Protected Metadata Grid */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#052B66]">
            1. Protected Course Identity & Metadata
          </h3>
          <span className="text-xs text-slate-500">
            Mark unverified items as To Be Confirmed or Requires SME Validation
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {PROTECTED_KEYS.map(({ key, label }) => {
            const val = brief[key] as string;
            const status = brief.fieldStatuses[key] || (val ? 'confirmed' : 'to_be_confirmed');
            return (
              <div key={key} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-bold text-slate-700">{label}</label>
                  <select
                    aria-label={`${label} verification status`}
                    value={status}
                    onChange={e => setFieldStatus(key, e.target.value as FieldStatus)}
                    className="text-[11px] text-slate-600 bg-[#F5F7FA] border border-slate-200 rounded px-1.5 py-0.5"
                  >
                    <option value="confirmed">Confirmed</option>
                    <option value="to_be_confirmed">To Be Confirmed</option>
                    <option value="requires_sme_validation">Requires SME Validation</option>
                  </select>
                </div>
                <input
                  type="text"
                  disabled={brief.metadataLocked}
                  value={val}
                  onChange={e => updateBrief({ [key]: e.target.value })}
                  placeholder={`Enter ${label.toLowerCase()}...`}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg disabled:bg-slate-100 disabled:text-slate-600 focus:outline-none focus:border-[#052B66]"
                />
              </div>
            );
          })}

          <div className="space-y-1">
            <label className="block text-xs font-bold text-slate-700">Experience Level</label>
            <select
              value={brief.experienceLevel}
              onChange={e => updateBrief({ experienceLevel: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-[#052B66]"
            >
              <option value="Entry / Foundational">Entry / Foundational</option>
              <option value="Intermediate">Intermediate</option>
              <option value="Advanced">Advanced</option>
              <option value="Executive / Specialist">Executive / Specialist</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-bold text-slate-700">Target Job Roles</label>
            <input
              type="text"
              value={brief.targetJobRoles}
              onChange={e => updateBrief({ targetJobRoles: e.target.value })}
              placeholder="e.g., Process Engineer, Branch Consultant, Sales Rep"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#052B66]"
            />
          </div>
        </div>
      </section>

      {/* Purpose, Problem & Authoritative Topics */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-[#052B66]">
          2. Purpose, Workplace Need & Subject Scope
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="block text-xs font-bold text-slate-700">Course Purpose</label>
            <textarea
              rows={3}
              value={brief.purpose}
              onChange={e => updateBrief({ purpose: e.target.value })}
              placeholder="What workplace capability will learners gain?"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#052B66]"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-bold text-slate-700">
              Workplace Problem / Development Need
            </label>
            <textarea
              rows={3}
              value={brief.workplaceProblem}
              onChange={e => updateBrief({ workplaceProblem: e.target.value })}
              placeholder="Describe the performance gap, risk, or operational need..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#052B66]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="block text-xs font-bold text-slate-700">
              Existing Knowledge & Prerequisites
            </label>
            <textarea
              rows={2}
              value={brief.prerequisites}
              onChange={e => updateBrief({ prerequisites: e.target.value })}
              placeholder="Required prior skills, qualifications, or numeracy/literacy baseline..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#052B66]"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-bold text-slate-700">Learning Requirements</label>
            <textarea
              rows={2}
              value={brief.learningRequirements}
              onChange={e => updateBrief({ learningRequirements: e.target.value })}
              placeholder="Pedagogical constraints, practical demonstrations, or technical rigour rules..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#052B66]"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-700">
            Mandatory Subject Topics & Curriculum Scope (one topic per line — preserved in Stage 2 Coverage Checker)
          </label>
          <textarea
            rows={5}
            value={brief.subjectTopicsInput}
            onChange={e => updateBrief({ subjectTopicsInput: e.target.value })}
            placeholder="List every topic, concept, or skill that MUST appear in the curriculum..."
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#052B66]"
          />
        </div>
      </section>

      {/* AI Integration & South African Compliance Opt-In */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-[#052B66]">
            3. AI Integration & South African Regulatory Alignment (Opt-In)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700">
                AI Integration Role in This Course
              </label>
              <select
                value={brief.aiIntegrationMode}
                onChange={e => updateBrief({ aiIntegrationMode: e.target.value as any })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                <option value="none">Not Applicable (No AI content injected)</option>
                <option value="optional">Optional Productivity Support</option>
                <option value="core">Core Subject Matter</option>
              </select>
            </div>
            {brief.aiIntegrationMode !== 'none' && (
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  AI Integration Requirements
                </label>
                <input
                  type="text"
                  value={brief.aiIntegrationRequirements}
                  onChange={e => updateBrief({ aiIntegrationRequirements: e.target.value })}
                  placeholder="Specify tools, governance boundaries, or validation workflows..."
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
            )}
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 space-y-3">
          <label className="flex items-center gap-2 text-xs font-bold text-[#052B66] cursor-pointer">
            <input
              type="checkbox"
              checked={brief.saCompliance.enabled}
              onChange={e =>
                updateBrief({
                  saCompliance: { ...brief.saCompliance, enabled: e.target.checked },
                })
              }
            />
            <span>Configure South African Workplace / Regulatory Alignment (only if applicable)</span>
          </label>

          {brief.saCompliance.enabled && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-[#F5F7FA] rounded-lg border border-slate-200">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">NQF Level</label>
                <input
                  type="text"
                  value={brief.saCompliance.nqfLevel}
                  onChange={e =>
                    updateBrief({
                      saCompliance: { ...brief.saCompliance, nqfLevel: e.target.value },
                    })
                  }
                  placeholder="e.g., Level 5 (or To Be Confirmed)"
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">SETA / Sector Body</label>
                <input
                  type="text"
                  value={brief.saCompliance.setaName}
                  onChange={e =>
                    updateBrief({
                      saCompliance: { ...brief.saCompliance, setaName: e.target.value },
                    })
                  }
                  placeholder="e.g., INSETA, CHIETA, MICT SETA"
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Professional Body CPD</label>
                <input
                  type="text"
                  value={brief.saCompliance.professionalBodyCpd}
                  onChange={e =>
                    updateBrief({
                      saCompliance: { ...brief.saCompliance, professionalBodyCpd: e.target.value },
                    })
                  }
                  placeholder="e.g., ICITP / ECSA / FSCA CPD"
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded"
                />
              </div>
              <div className="md:col-span-3 flex flex-wrap gap-4 text-xs text-slate-700">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={brief.saCompliance.saqaRelevant}
                    onChange={e =>
                      updateBrief({
                        saCompliance: { ...brief.saCompliance, saqaRelevant: e.target.checked },
                      })
                    }
                  />
                  SAQA Standards Alignment
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={brief.saCompliance.qctoRelevant}
                    onChange={e =>
                      updateBrief({
                        saCompliance: { ...brief.saCompliance, qctoRelevant: e.target.checked },
                      })
                    }
                  />
                  QCTO Occupational Framework
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={brief.saCompliance.qctoModulePattern}
                    onChange={e =>
                      updateBrief({
                        saCompliance: { ...brief.saCompliance, qctoModulePattern: e.target.checked },
                      })
                    }
                  />
                  Use Knowledge / Practical / Work Experience Modules
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={brief.saCompliance.popiaRelevant}
                    onChange={e =>
                      updateBrief({
                        saCompliance: { ...brief.saCompliance, popiaRelevant: e.target.checked },
                      })
                    }
                  />
                  POPIA Data Privacy Safeguards
                </label>
              </div>
              <div className="md:col-span-3">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Applicable Industry Legislation & Technical Standards
                </label>
                <input
                  type="text"
                  value={brief.saCompliance.industryLegislation}
                  onChange={e =>
                    updateBrief({
                      saCompliance: { ...brief.saCompliance, industryLegislation: e.target.value },
                    })
                  }
                  placeholder="Only cite legislation verified for this programme (e.g., NCA Act 34 of 2005, OHSA)"
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded"
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Template-Specific Fields */}
      {template && template.sections.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h3 className="text-sm font-bold text-[#052B66]">
            4. Template-Specific Fields ({template.name})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {template.sections.flatMap(s => s.fields).map(field => (
              <div key={field.id} className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  {field.label} {field.required ? '*' : ''}
                </label>
                <textarea
                  rows={2}
                  value={brief.templateFieldValues[field.key] || ''}
                  onChange={e =>
                    updateBrief({
                      templateFieldValues: {
                        ...brief.templateFieldValues,
                        [field.key]: e.target.value,
                      },
                    })
                  }
                  placeholder={field.placeholder}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-[#052B66]"
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* AI Brief Analysis Output */}
      {brief.analysis && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#052B66]">AI Brief Review Summary</h3>
            <span className="text-xs text-slate-500">
              Analysed {new Date(brief.analysis.analysedAt).toLocaleTimeString()}
            </span>
          </div>
          <p className="text-sm text-slate-700">{brief.analysis.summary}</p>
          {brief.analysis.contradictions.length > 0 && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
              <div className="font-bold">Flagged Contradictions:</div>
              <ul className="list-disc pl-4">
                {brief.analysis.contradictions.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {brief.analysis.missingInformation.length > 0 && (
            <div className="text-xs text-slate-600 space-y-1">
              <div className="font-bold text-[#052B66]">Items Requiring Confirmation:</div>
              <ul className="list-disc pl-4">
                {brief.analysis.missingInformation.map((m, i) => (
                  <li key={i}>
                    <strong>{m.field}</strong> ({m.recommendedStatus.replace(/_/g, ' ')}): {m.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Stage Footer Action Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <button
          type="button"
          disabled={isAnalysing}
          onClick={handleAnalyseBrief}
          className="px-4 py-2.5 rounded-lg border border-[#052B66] text-[#052B66] hover:bg-[#052B66]/5 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
        >
          {isAnalysing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-[#45CC42]" />}
          <span>Analyse Brief for Gaps & Contradictions</span>
        </button>

        <button
          type="button"
          disabled={!canApprove}
          onClick={handleApproveStage1}
          className="px-5 py-2.5 rounded-lg bg-[#052B66] hover:bg-[#042150] disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
        >
          <CheckCircle2 className="w-4 h-4 text-[#45CC42]" />
          <span>Approve Brief & Continue to Stage 2</span>
        </button>
      </div>
    </div>
  );
};
