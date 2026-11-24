import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileCode,
  FileText,
  Printer,
  ShieldAlert,
} from 'lucide-react';
import type { CourseProject, WorkflowStage } from '../../types';
import {
  type DeliverableType,
  exportDeliverableDocx,
  exportDeliverableHtmlOrPrint,
  exportLmsPackageJson,
  exportScorm12PackageZip,
} from '../../utils/exportDeliverables';
import { runStructuralAndConsistencyAudit } from '../../utils/courseValidation';

interface Stage7PublishProps {
  project: CourseProject;
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

export const Stage7Publish: React.FC<Stage7PublishProps> = ({ project, onJumpToStage }) => {
  const [busyType, setBusyType] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const structuralAudit = useMemo(() => runStructuralAndConsistencyAudit(project), [project]);
  const qa = project.latestQA;
  const isQaStale = Boolean(
    qa?.evaluatedDataSignature && qa.evaluatedDataSignature !== structuralAudit.dataSignature
  );
  const roles = qa?.humanSignOff?.roles;
  const allRolesSigned = Boolean(
    roles?.sme.signedOff &&
      roles.sme.reviewerName.trim() &&
      roles?.instructionalDesigner.signedOff &&
      roles.instructionalDesigner.reviewerName.trim() &&
      roles?.complianceAuthorizer.signedOff &&
      roles.complianceAuthorizer.reviewerName.trim()
  );

  const handleDocx = async (type: DeliverableType) => {
    setBusyType(type);
    setExportNotice(null);
    try {
      await exportDeliverableDocx(project, type);
      setExportNotice(`Generated ${type.replace(/_/g, ' ')} Word (.docx) from latest saved project state.`);
    } finally {
      setBusyType(null);
    }
  };

  const handleScormZip = () => {
    exportScorm12PackageZip(project);
    setExportNotice('Downloaded SCORM 1.2 (.zip) package containing imsmanifest.xml and module SCO pages.');
  };

  const handleLmsJson = () => {
    exportLmsPackageJson(project);
    setExportNotice('Downloaded LMS-compatible structured data (.json).');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-[#052B66]">
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
              className="px-3 py-1.5 rounded-lg border border-slate-200 hover:border-[#052B66] text-[#052B66] text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Return to Stage 6 QA</span>
            </button>
            <button
              type="button"
              onClick={() => onJumpToStage(1)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 hover:border-[#052B66] text-slate-700 text-xs font-semibold cursor-pointer"
            >
              Edit Stage 1 Brief
            </button>
          </div>
        )}
      </div>

      {/* Pre-Publish Governance & Placeholder Audit Summary */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[#052B66]">
            Pre-Publish Readiness & Integrity Summary
          </h3>
          <span className="text-[11px] text-slate-500">
            Last saved: {new Date(project.updatedAt).toLocaleString('en-ZA')}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-[#F5F7FA] border border-slate-200">
            <div className="text-[11px] text-slate-500">QA Evaluation</div>
            <div className="font-bold text-[#052B66] mt-0.5">
              {qa ? `${qa.verdict} (${qa.weightedScore}%)` : 'Not Run'}
            </div>
            {isQaStale && (
              <div className="text-[11px] text-amber-700 font-semibold mt-1">
                Stale — course edited since QA
              </div>
            )}
          </div>
          <div className="p-3 rounded-lg bg-[#F5F7FA] border border-slate-200">
            <div className="text-[11px] text-slate-500">Multi-Role Sign-Off</div>
            <div className={`font-bold mt-0.5 ${allRolesSigned ? 'text-emerald-700' : 'text-amber-700'}`}>
              {allRolesSigned ? 'All 3 Roles Approved' : 'Pending Full Sign-Off'}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-[#F5F7FA] border border-slate-200">
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
          <div className="p-3 rounded-lg bg-[#F5F7FA] border border-slate-200">
            <div className="text-[11px] text-slate-500">Course Scope Ready</div>
            <div className="font-bold text-[#052B66] mt-0.5">
              {project.content.modules.length} Modules · {project.assessments.items.length} Assessments
            </div>
          </div>
        </div>

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
                className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-[#052B66] font-bold shrink-0 cursor-pointer"
              >
                Re-verify in Stage 6 QA
              </button>
            )}
          </div>
        )}
      </section>

      {/* Non-accreditation safeguard notice */}
      <div className="p-4 bg-white border border-slate-200 rounded-xl flex items-start gap-3 text-xs text-slate-700">
        <ShieldAlert className="w-4 h-4 text-[#052B66] shrink-0 mt-0.5" />
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {DELIVERABLES.map(item => (
          <div
            key={item.type}
            className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4"
          >
            <div className="space-y-1.5">
              <h3 className="text-sm font-bold text-[#052B66]">{item.title}</h3>
              <p className="text-xs text-slate-600 leading-relaxed">{item.description}</p>
            </div>

            {item.type === 'lms_package' ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleScormZip}
                  className="w-full py-2 px-3 rounded-lg bg-[#052B66] hover:bg-[#042150] text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Archive className="w-3.5 h-3.5 text-[#45CC42]" />
                  <span>SCORM 1.2 Package (.zip)</span>
                </button>
                <button
                  type="button"
                  onClick={handleLmsJson}
                  className="w-full py-2 px-3 rounded-lg border border-slate-200 hover:border-[#052B66] text-[#052B66] text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <FileCode className="w-3.5 h-3.5" />
                  <span>LMS Data Export (.json)</span>
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busyType === item.type}
                  onClick={() => handleDocx(item.type)}
                  className="flex-1 py-2 px-3 rounded-lg bg-[#052B66] hover:bg-[#042150] text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-[#45CC42]" />
                  <span>{busyType === item.type ? 'Exporting...' : 'Word (.docx)'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => exportDeliverableHtmlOrPrint(project, item.type, 'print')}
                  className="py-2 px-3 rounded-lg border border-slate-200 hover:border-[#052B66] text-[#052B66] text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                  title="Print or Save as PDF"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    exportDeliverableHtmlOrPrint(project, item.type, 'download_html');
                    setExportNotice(`Downloaded ${item.title} HTML file.`);
                  }}
                  className="py-2 px-2.5 rounded-lg border border-slate-200 hover:border-[#052B66] text-slate-700 text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
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
    </div>
  );
};
