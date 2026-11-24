import React, { useState } from 'react';
import { Download, FileCode, Printer, ShieldAlert } from 'lucide-react';
import type { CourseProject } from '../../types';
import {
  type DeliverableType,
  exportDeliverableDocx,
  exportDeliverableHtmlOrPrint,
} from '../../utils/exportDeliverables';

interface Stage7PublishProps {
  project: CourseProject;
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
    description: 'Traceability table linking every outcome to assessment instruments.',
  },
  {
    type: 'qa_report',
    title: 'Quality Assurance Report',
    description: '7-dimension scores, critical failure audit, and human review sign-off record.',
  },
  {
    type: 'source_register',
    title: 'Source Register',
    description: 'Authoritative sources, metadata, relevant sections, and verification statuses.',
  },
  {
    type: 'lms_package',
    title: 'LMS-Ready Structured Package',
    description: 'Machine-readable JSON/SCORM-ready course manifest for LMS import.',
  },
];

export const Stage7Publish: React.FC<Stage7PublishProps> = ({ project }) => {
  const [busyType, setBusyType] = useState<string | null>(null);

  const handleDocx = async (type: DeliverableType) => {
    setBusyType(type);
    try {
      await exportDeliverableDocx(project, type);
    } finally {
      setBusyType(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-slate-200">
        <h2 className="text-xl font-bold text-[#052B66]">
          Stage 7: Publish & Export Deliverables
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Generate eStudy-branded Word (.docx), Print/PDF, HTML, and LMS-ready exports.
        </p>
      </div>

      {/* Draft / Release status notice */}
      {(!project.latestQA ||
        project.latestQA.verdict === 'FAIL' ||
        !project.latestQA.humanSignOff?.signedOff) && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3 text-xs text-amber-900">
          <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <strong>Draft Export Mode:</strong> Formal Stage 6 Quality Assurance & 3-role sign-off is not yet completed. You can download and inspect all draft deliverables below, then complete Stage 6 sign-off for final release.
          </div>
        </div>
      )}

      {/* Non-accreditation safeguard notice */}
      <div className="p-4 bg-white border border-slate-200 rounded-xl flex items-start gap-3 text-xs text-slate-700">
        <ShieldAlert className="w-4 h-4 text-[#052B66] shrink-0 mt-0.5" />
        <div>
          <strong>Standards & Accreditation Notice:</strong> Aligning a programme to NQF, SAQA, QCTO, SETA, or CPD guidelines prepares the programme for formal review and does not declare formal accreditation.
        </div>
      </div>

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
              <button
                type="button"
                onClick={() => handleDocx('lms_package')}
                className="w-full py-2 px-3 rounded-lg bg-[#052B66] hover:bg-[#042150] text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <FileCode className="w-3.5 h-3.5 text-[#45CC42]" />
                <span>Download LMS JSON</span>
              </button>
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
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
