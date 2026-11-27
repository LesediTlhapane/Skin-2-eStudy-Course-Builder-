import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileCode,
  FileText,
  Loader2,
  Printer,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type {
  CompanyRole,
  CourseProject,
  GovernanceRole,
  WorkflowStage,
} from '../../types';
import {
  type DeliverableType,
  type ExportBrandOptions,
  exportDeliverableDocx,
  exportDeliverableHtmlOrPrint,
  exportLmsPackageJson,
  exportScorm12PackageZip,
} from '../../utils/exportDeliverables';
import { apiFetch, parseApiJson } from '../../utils/apiClient';
import {
  runPreExportCompletenessCheck,
  runStructuralAndConsistencyAudit,
} from '../../utils/courseValidation';
import {
  getRolePermissions,
  GOVERNANCE_ROLE_LABELS,
  hasGenuineHumanGovernanceSignOff,
} from '../../utils/rbac';

interface Stage7PublishProps {
  project: CourseProject;
  exportBrand?: ExportBrandOptions;
  companyName?: string;
  activeRole?: CompanyRole | null;
  activeGovernanceRoles?: GovernanceRole[];
  onSyncServerProject?: (project: CourseProject) => void;
  onJumpToStage?: (stage: WorkflowStage, context?: { moduleNumber?: number; reason?: string }) => void;
}

const DELIVERABLES: Array<{
  type: DeliverableType;
  title: string;
  description: string;
}> = [
  {
    type: 'learner_manual',
    title: 'Learner Course Manual',
    description: 'Complete module lessons, worked examples, scenarios, activities, and knowledge checks.',
  },
  {
    type: 'facilitator_guide',
    title: 'Facilitator Guide',
    description: 'Includes facilitator debrief notes, case study discussion prompts, and answer keys.',
  },
  {
    type: 'assessment_document',
    title: 'Assessment Document',
    description: 'Learner-facing formative and summative assessment prompts and instructions.',
  },
  {
    type: 'marking_guide',
    title: 'Assessment Marking Guide & Rubrics',
    description: 'Model answers, assessor marking criteria, feedback, and weighted rubrics.',
  },
  {
    type: 'curriculum_overview',
    title: 'Curriculum Overview & Coverage Audit',
    description: 'Approved module structure, competencies, and brief-to-curriculum coverage matrix.',
  },
  {
    type: 'alignment_matrix',
    title: 'Learning Outcome & Assessment Alignment Matrix',
    description: 'Traceability table linking every outcome to learning activities and assessments.',
  },
  {
    type: 'qa_report',
    title: 'Quality Assurance Report',
    description: '7-dimension scores, blocking/warning breakdown, accessibility scope, and human sign-off record.',
  },
  {
    type: 'source_register',
    title: 'Source Register',
    description: 'Authoritative sources, metadata, verifier names/dates, and verification statuses.',
  },
  {
    type: 'lms_package',
    title: 'LMS & SCORM Packages',
    description: 'Download either a genuine SCORM 1.2 (.zip) archive with imsmanifest.xml or structured JSON course data.',
  },
];

export const Stage7Publish: React.FC<Stage7PublishProps> = ({
  project,
  exportBrand: exportBrandProp,
  companyName,
  activeRole,
  activeGovernanceRoles,
  onSyncServerProject,
  onJumpToStage,
}) => {
  const [busyType, setBusyType] = useState<string | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const perms = getRolePermissions(activeRole, activeGovernanceRoles);
  const isViewer = perms.isReadOnly;
  const isCompleted = project.lifecycleStatus === 'completed';

  const structuralAudit = useMemo(() => runStructuralAndConsistencyAudit(project), [project]);
  const preExportReport = useMemo(() => runPreExportCompletenessCheck(project), [project]);
  const exportBrand = useMemo(
    () => exportBrandProp || (companyName ? { companyName } : undefined),
    [exportBrandProp, companyName]
  );
  const qa = project.latestQA;
  const isQaStale = Boolean(
    qa?.evaluatedDataSignature && qa.evaluatedDataSignature !== structuralAudit.dataSignature
  );
  const signOffCheck = hasGenuineHumanGovernanceSignOff(qa?.humanSignOff, {
    companyId: project.companyId,
    courseId: project.id,
  });
  const allRolesSigned = signOffCheck.valid;

  const handleCompleteCourse = async () => {
    setCompletionError(null);
    setExportNotice(null);
    setIsCompleting(true);
    try {
      const res = await apiFetch(
        `/api/v2/courses/${encodeURIComponent(project.id)}/complete`,
        { method: 'POST' }
      );
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success || !data.course) {
        throw new Error(data.error || 'Could not complete and publish this course.');
      }
      onSyncServerProject?.(data.course);
      setExportNotice('Course formally approved and published with verified three-person governance sign-off.');
    } catch (err: any) {
      setCompletionError(err?.message || 'Course completion failed.');
    } finally {
      setIsCompleting(false);
    }
  };

  const handleDocx = async (type: DeliverableType) => {
    setBusyType(type);
    setExportNotice(null);
    try {
      await exportDeliverableDocx(project, type, exportBrand);
      setExportNotice(`Generated ${type.replace(/_/g, ' ')} Word (.docx) with company branding from latest saved project state.`);
    } finally {
      setBusyType(null);
    }
  };

  const handleHtmlOrPrint = async (
    type: DeliverableType,
    mode: 'print' | 'download_html',
    label?: string
  ) => {
    const key = `${type}:${mode}`;
    setBusyType(key);
    setExportNotice(null);
    try {
      await exportDeliverableHtmlOrPrint(project, type, mode, exportBrand);
      if (mode === 'download_html') {
        setExportNotice(`Downloaded ${label || type.replace(/_/g, ' ')} standalone HTML file.`);
      }
    } finally {
      setBusyType(null);
    }
  };

  const handleScormZip = async () => {
    setBusyType('scorm_zip');
    setExportNotice(null);
    try {
      await exportScorm12PackageZip(project, exportBrand);
      setExportNotice('Downloaded SCORM 1.2 (.zip) package containing imsmanifest.xml, company branding assets, and module SCO pages.');
    } finally {
      setBusyType(null);
    }
  };

  const handleLmsJson = async () => {
    setBusyType('lms_json');
    setExportNotice(null);
    try {
      await exportLmsPackageJson(project, exportBrand);
      setExportNotice('Downloaded LMS-compatible structured data (.json).');
    } finally {
      setBusyType(null);
    }
  };

  const signOffRoles = qa?.humanSignOff?.roles;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-primary">
            Stage 7: Publish & Export Deliverables
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            All exports read directly from your latest saved project data: Word (.docx), Print/PDF, HTML, SCORM 1.2 (.zip), and LMS Data (.json).
          </p>
        </div>

        {onJumpToStage && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onJumpToStage(6)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 hover:border-accent text-primary text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-accent-ink" />
              <span>Return to Stage 6 QA</span>
            </button>
            {!isViewer && (
              <button
                type="button"
                onClick={() => onJumpToStage(1)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 hover:border-primary text-slate-700 text-xs font-semibold cursor-pointer"
              >
                Edit Stage 1 Brief
              </button>
            )}
          </div>
        )}
      </div>

      {/* Pre-Publish Governance & Placeholder Audit Summary */}
      <section className="bg-white border border-slate-200 border-t-[3px] border-t-accent rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-accent-ink" />
            <h3 className="text-sm font-bold text-primary">
              Pre-Publish Readiness &amp; Governance Record
            </h3>
          </div>
          <span className="text-[11px] text-slate-500">
            Status: <strong className="text-primary">{isCompleted ? 'Published / Completed' : project.lifecycleStatus}</strong> · Last saved: {new Date(project.updatedAt).toLocaleString('en-ZA')}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-surface border border-slate-200">
            <div className="text-[11px] text-slate-500">QA Evaluation</div>
            <div className="font-bold text-primary mt-0.5">
              {qa ? `${qa.verdict} (${qa.weightedScore}%)` : 'Not Run'}
            </div>
            {isQaStale && (
              <div className="text-[11px] text-amber-700 font-semibold mt-1">
                Stale — course edited since QA
              </div>
            )}
          </div>
          <div className="p-3 rounded-lg bg-surface border border-slate-200">
            <div className="text-[11px] text-slate-500">Three-Person Sign-Off</div>
            <div
              className={`font-bold mt-0.5 ${
                allRolesSigned ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {allRolesSigned ? 'All 3 Distinct Reviewers Signed' : 'Pending Distinct Governance Approvals'}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-surface border border-slate-200">
            <div className="text-[11px] text-slate-500">Unresolved Placeholders</div>
            <div
              className={`font-bold mt-0.5 ${
                structuralAudit.unresolvedPlaceholders.length === 0
                  ? 'text-emerald-700'
                  : 'text-red-700'
              }`}
            >
              {structuralAudit.unresolvedPlaceholders.length === 0
                ? '0 Detected'
                : `${structuralAudit.unresolvedPlaceholders.length} Remaining`}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-accent-tint/55 border border-accent-border">
            <div className="text-[11px] text-slate-500">Course Scope Ready</div>
            <div className="font-bold text-primary mt-0.5">
              {project.content.modules.length} Modules · {project.assessments.items.length} Assessments
            </div>
          </div>
        </div>

        {signOffRoles && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
            {(
              [
                ['sme', GOVERNANCE_ROLE_LABELS.sme, signOffRoles.sme],
                [
                  'instructional_designer',
                  GOVERNANCE_ROLE_LABELS.instructional_designer,
                  signOffRoles.instructionalDesigner,
                ],
                [
                  'compliance_authorizer',
                  GOVERNANCE_ROLE_LABELS.compliance_authorizer,
                  signOffRoles.complianceAuthorizer,
                ],
              ] as const
            ).map(([govKey, label, rec]) => {
              const verified = Boolean(rec?.signedOff && rec?.reviewerUserId && rec?.signedOffAt);
              return (
                <div
                  key={govKey}
                  className={`p-2.5 rounded-lg border ${
                    verified
                      ? 'bg-emerald-50/70 border-emerald-200'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="font-bold text-primary">{label}</div>
                  {verified ? (
                    <div className="text-[11px] text-emerald-800 mt-0.5 space-y-0.5">
                      <div>Approved by {rec.reviewerName}</div>
                      <div className="text-slate-500">
                        {new Date(rec.signedOffAt!).toLocaleString('en-ZA')}
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {rec?.status === 'rejected'
                        ? `Revision requested by ${rec.reviewerName || 'Reviewer'}`
                        : 'Pending verified sign-off'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!isCompleted && !isViewer && (
          <div className="p-3.5 rounded-lg bg-surface border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="text-slate-700">
              {!perms.canPublishCourse ? (
                <span>
                  Course completion and formal publication are restricted to <strong>Reviewer</strong> accounts (or explicitly authorised <strong>Company Administrators</strong>) after all 3 distinct human governance roles sign off.
                </span>
              ) : allRolesSigned && !isQaStale && structuralAudit.blockingErrors.length === 0 && qa?.verdict !== 'FAIL' ? (
                <span>
                  All 3 distinct human governance approvals are verified. Publish and lock governance status now.
                </span>
              ) : (
                <span>
                  {signOffCheck.reason || 'Complete all QA checks and 3-person governance approvals in Stage 6 before formal publication.'}
                </span>
              )}
            </div>
            {perms.canPublishCourse && (
              <button
                type="button"
                disabled={
                  isCompleting ||
                  !allRolesSigned ||
                  isQaStale ||
                  structuralAudit.blockingErrors.length > 0 ||
                  qa?.verdict === 'FAIL'
                }
                onClick={() => void handleCompleteCourse()}
                className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-dark disabled:opacity-50 text-primary-contrast border-b-2 border-accent font-bold shrink-0 flex items-center gap-1.5 cursor-pointer"
              >
                {isCompleting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-accent" />
                )}
                <span>{isCompleting ? 'Publishing...' : 'Complete & Publish Course'}</span>
              </button>
            )}
          </div>
        )}

        {completionError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{completionError}</span>
          </div>
        )}

        {(isQaStale || structuralAudit.blockingErrors.length > 0 || structuralAudit.unresolvedPlaceholders.length > 0) && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
              <div>
                {isQaStale
                  ? 'Course content changed after your last Stage 6 QA run. Re-run QA before final distribution.'
                  : `${structuralAudit.blockingErrors.length} blocking issue(s) or ${structuralAudit.unresolvedPlaceholders.length} placeholder(s) detected in current draft.`}
              </div>
            </div>
            {onJumpToStage && (
              <button
                type="button"
                onClick={() => onJumpToStage(6)}
                className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-primary font-bold shrink-0 cursor-pointer"
              >
                Re-verify in Stage 6 QA
              </button>
            )}
          </div>
        )}

        {/* Pre-Export Completeness Validation: Critical Blockers vs Advisory Polish */}
        <div className="pt-3 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div
            className={`p-3 rounded-lg border space-y-1.5 ${
              preExportReport.criticalBlockers.length === 0
                ? 'bg-emerald-50/60 border-emerald-200'
                : 'bg-red-50/70 border-red-200'
            }`}
          >
            <div className="flex items-center justify-between font-bold text-primary">
              <span>Critical Release Blockers</span>
              <span className="font-mono">{preExportReport.criticalBlockers.length}</span>
            </div>
            {preExportReport.criticalBlockers.length === 0 ? (
              <p className="text-[11px] text-emerald-800">
                All structural, outcome-alignment, and key checks passed.
              </p>
            ) : (
              <ul className="space-y-1 text-[11px] text-red-900">
                {preExportReport.criticalBlockers.slice(0, 4).map(issue => (
                  <li key={issue.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{issue.title}: {issue.description}</span>
                    {onJumpToStage && (
                      <button
                        type="button"
                        onClick={() => onJumpToStage(issue.stage)}
                        className="px-2 py-0.5 rounded bg-white border border-red-200 text-red-800 font-semibold shrink-0 cursor-pointer"
                      >
                        Stage {issue.stage}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="p-3 rounded-lg border border-slate-200 bg-surface space-y-1.5">
            <div className="flex items-center justify-between font-bold text-primary">
              <span>Advisory Polish Items</span>
              <span className="font-mono">{preExportReport.advisoryPolish.length}</span>
            </div>
            {preExportReport.advisoryPolish.length === 0 ? (
              <p className="text-[11px] text-emerald-700">
                Zero advisory polish recommendations outstanding.
              </p>
            ) : (
              <ul className="space-y-1 text-[11px] text-slate-700">
                {preExportReport.advisoryPolish.slice(0, 4).map(issue => (
                  <li key={issue.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{issue.title}</span>
                    {onJumpToStage && (
                      <button
                        type="button"
                        onClick={() => onJumpToStage(issue.stage)}
                        className="px-2 py-0.5 rounded bg-white border border-slate-200 text-primary font-semibold shrink-0 cursor-pointer"
                      >
                        Stage {issue.stage}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* Non-accreditation safeguard notice */}
      <div className="p-4 bg-white border border-slate-200 rounded-xl flex items-start gap-3 text-xs text-slate-700">
        <ShieldAlert className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div>
          <strong>Standards & Accreditation Notice:</strong> Aligning a programme to NQF, SAQA, QCTO, SETA, or CPD guidelines prepares the programme for formal review and does not declare formal accreditation.
        </div>
      </div>

      {exportNotice && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center gap-2 font-medium">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" />
          <span>{exportNotice}</span>
        </div>
      )}

      {isViewer && (
        <div className="p-3.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-700">
          <strong>Viewer Read-Only Mode:</strong> You can inspect readiness metrics above. Publishing and deliverable downloads are restricted to Authors, Reviewers, and Company Administrators.
        </div>
      )}

      {/* Featured Master Export: Complete Created Course Document */}
      <fieldset disabled={isViewer} className="space-y-4 disabled:opacity-60">
      <section className="bg-white border border-slate-200 border-t-[3px] border-t-primary rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5 max-w-3xl">
          <h3 className="text-base font-bold text-primary">
            Complete Course Document
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            Download the entire created course compiled into one master document — including the Course Brief, Curriculum Architecture, Learning Outcomes &amp; Alignment Matrix, all Modules and Lessons, Case Studies, Scenarios, Knowledge Checks, Assessments, Marking Rubrics, Quality Assurance Summary, and Source Register.
          </p>
          <p className="text-[11px] text-slate-500">
            Brief &amp; Curriculum · {project.content.modules.length} Modules · {project.assessments.items.length} Assessments · {project.sources.length} Sources
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={busyType === 'complete_course'}
            onClick={() => handleDocx('complete_course')}
            className="py-2.5 px-4 rounded-lg bg-accent hover:bg-accent-dark disabled:opacity-60 text-accent-contrast text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>{busyType === 'complete_course' ? 'Exporting...' : 'Download Full Course (.docx)'}</span>
          </button>
          <button
            type="button"
            disabled={busyType === 'complete_course:print'}
            onClick={() => void handleHtmlOrPrint('complete_course', 'print', 'Complete Course Document')}
            className="py-2.5 px-3.5 rounded-lg border border-slate-200 hover:border-accent disabled:opacity-60 text-primary text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            title="Print or Save Complete Course as PDF"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>PDF</span>
          </button>
          <button
            type="button"
            disabled={busyType === 'complete_course:download_html'}
            onClick={() => void handleHtmlOrPrint('complete_course', 'download_html', 'Complete Course Document')}
            className="py-2.5 px-3.5 rounded-lg border border-slate-200 hover:border-accent disabled:opacity-60 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            title="Download standalone Complete Course HTML"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>HTML</span>
          </button>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {DELIVERABLES.map(item => (
          <div
            key={item.type}
            className="bg-white border border-slate-200 border-t-[3px] border-t-accent/70 hover:border-t-primary rounded-xl p-5 flex flex-col justify-between gap-4 transition-colors"
          >
            <div className="space-y-1.5">
              <h3 className="text-sm font-bold text-primary">{item.title}</h3>
              <p className="text-xs text-slate-600 leading-relaxed">{item.description}</p>
            </div>

            {item.type === 'lms_package' ? (
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={busyType === 'scorm_zip'}
                  onClick={() => void handleScormZip()}
                  className="w-full py-2 px-3 rounded-lg bg-accent hover:bg-accent-dark disabled:opacity-60 text-accent-contrast text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Archive className="w-3.5 h-3.5" />
                  <span>{busyType === 'scorm_zip' ? 'Packaging...' : 'SCORM 1.2 Package (.zip)'}</span>
                </button>
                <button
                  type="button"
                  disabled={busyType === 'lms_json'}
                  onClick={() => void handleLmsJson()}
                  className="w-full py-2 px-3 rounded-lg border border-slate-200 hover:border-accent disabled:opacity-60 text-primary text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <FileCode className="w-3.5 h-3.5 text-accent-ink" />
                  <span>{busyType === 'lms_json' ? 'Exporting...' : 'LMS Data Export (.json)'}</span>
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busyType === item.type}
                  onClick={() => void handleDocx(item.type)}
                  className="flex-1 py-2 px-3 rounded-lg bg-primary hover:bg-primary-dark text-primary-contrast border-b-2 border-accent text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-accent" />
                  <span>{busyType === item.type ? 'Exporting...' : 'Word (.docx)'}</span>
                </button>
                <button
                  type="button"
                  disabled={busyType === `${item.type}:print`}
                  onClick={() => void handleHtmlOrPrint(item.type, 'print', item.title)}
                  className="py-2 px-3 rounded-lg border border-slate-200 hover:border-accent disabled:opacity-60 text-primary text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                  title="Print or Save as PDF"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>PDF</span>
                </button>
                <button
                  type="button"
                  disabled={busyType === `${item.type}:download_html`}
                  onClick={() => void handleHtmlOrPrint(item.type, 'download_html', item.title)}
                  className="py-2 px-2.5 rounded-lg border border-slate-200 hover:border-accent disabled:opacity-60 text-slate-700 text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                  title="Download standalone HTML"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>HTML</span>
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      </fieldset>
    </div>
  );
};
