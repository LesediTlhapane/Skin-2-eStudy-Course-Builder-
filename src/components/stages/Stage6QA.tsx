import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Eye,
  FlaskConical,
  Loader2,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type {
  AIProvider,
  CourseProject,
  QADimensionWeight,
  RoleSignOffRecord,
  WorkflowStage,
} from '../../types';
import { DEFAULT_QA_WEIGHTS } from '../../data/templates';
import { computeFullAlignmentReport } from '../../utils/alignmentHelpers';
import {
  runAccessibilityChecks,
  runTechnicalValidationChecks,
} from '../../utils/validationChecks';
import { parseApiJson } from '../../utils/apiClient';

interface Stage6QAProps {
  project: CourseProject;
  selectedProvider: AIProvider;
  selectedModel: string;
  onUpdateProject: (
    updater: (prev: CourseProject) => CourseProject,
    snapshot?: { trigger: 'stage_approval' | 'ai_generation'; summary: string }
  ) => void;
  onJumpToStage: (stage: WorkflowStage) => void;
  onProceedToPublish: () => void;
}

type RoleKey = 'sme' | 'instructionalDesigner' | 'complianceAuthorizer';

const ROLE_DEFINITIONS: Array<{
  key: RoleKey;
  title: string;
  scope: string;
}> = [
  {
    key: 'sme',
    title: '1. Subject-Matter Expert (SME)',
    scope: 'Approves technical accuracy, equations, units, assumptions, and workplace realism.',
  },
  {
    key: 'instructionalDesigner',
    title: '2. Instructional Designer (ID)',
    scope: 'Approves constructive alignment, measurable outcomes, assessments, and accessibility.',
  },
  {
    key: 'complianceAuthorizer',
    title: '3. Authorised Compliance Reviewer',
    scope: 'Approves regulatory/SA profile checks, source grounding, POPIA, and release clearance.',
  },
];

export const Stage6QA: React.FC<Stage6QAProps> = ({
  project,
  selectedProvider,
  selectedModel,
  onUpdateProject,
  onJumpToStage,
  onProceedToPublish,
}) => {
  const [weights, setWeights] = useState<QADimensionWeight[]>(
    project.latestQA?.weights || DEFAULT_QA_WEIGHTS
  );
  const [isRunning, setIsRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [repairNotice, setRepairNotice] = useState<string | null>(null);

  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
  const qa = project.latestQA;

  const liveAccessibility = useMemo(() => runAccessibilityChecks(project), [project]);
  const liveTechnical = useMemo(() => runTechnicalValidationChecks(project), [project]);
  const liveAlignment = useMemo(() => computeFullAlignmentReport(project), [project]);

  const roles = qa?.humanSignOff.roles || {
    sme: { signedOff: false, reviewerName: '' },
    instructionalDesigner: { signedOff: false, reviewerName: '' },
    complianceAuthorizer: { signedOff: false, reviewerName: '' },
  };

  const updateRoleSignOff = (key: RoleKey, patch: Partial<RoleSignOffRecord>) => {
    if (!qa) return;
    onUpdateProject(prev => {
      if (!prev.latestQA) return prev;
      const currentRoles = prev.latestQA.humanSignOff.roles || {
        sme: { signedOff: false, reviewerName: '' },
        instructionalDesigner: { signedOff: false, reviewerName: '' },
        complianceAuthorizer: { signedOff: false, reviewerName: '' },
      };
      const updatedRoles = {
        ...currentRoles,
        [key]: { ...currentRoles[key], ...patch },
      };
      const allRolesSigned =
        updatedRoles.sme.signedOff &&
        updatedRoles.instructionalDesigner.signedOff &&
        updatedRoles.complianceAuthorizer.signedOff;

      const combinedNames = [
        updatedRoles.sme.reviewerName && `SME: ${updatedRoles.sme.reviewerName}`,
        updatedRoles.instructionalDesigner.reviewerName &&
          `ID: ${updatedRoles.instructionalDesigner.reviewerName}`,
        updatedRoles.complianceAuthorizer.reviewerName &&
          `Compliance: ${updatedRoles.complianceAuthorizer.reviewerName}`,
      ]
        .filter(Boolean)
        .join(' | ');

      return {
        ...prev,
        latestQA: {
          ...prev.latestQA,
          humanSignOff: {
            ...prev.latestQA.humanSignOff,
            signedOff: allRolesSigned,
            reviewerName: combinedNames || prev.latestQA.humanSignOff.reviewerName,
            signedOffAt: allRolesSigned ? new Date().toISOString() : undefined,
            roles: updatedRoles,
          },
        },
      };
    });
  };

  const handleRunQA = async () => {
    if (totalWeight !== 100) {
      setErrorMsg(`Dimension weights must sum to 100% (currently ${totalWeight}%).`);
      return;
    }
    setIsRunning(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/v2/qa/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project,
          weights,
          provider: selectedProvider,
          model: selectedModel,
        }),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'QA evaluation failed.');
      }
      const report = data.report;
      onUpdateProject(
        prev => ({
          ...prev,
          latestQA: report,
          qaHistory: [report, ...prev.qaHistory],
          lifecycleStatus:
            report.verdict === 'FAIL' || report.verdict === 'REVISION REQUIRED'
              ? 'revision_required'
              : 'awaiting_review',
        }),
        {
          trigger: 'ai_generation',
          summary: `Executed Stage 6 QA: ${report.verdict} (${report.weightedScore}%)`,
        }
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'QA audit failed.');
    } finally {
      setIsRunning(false);
    }
  };

  const allThreeRolesApproved =
    roles.sme.signedOff &&
    Boolean(roles.sme.reviewerName.trim()) &&
    roles.instructionalDesigner.signedOff &&
    Boolean(roles.instructionalDesigner.reviewerName.trim()) &&
    roles.complianceAuthorizer.signedOff &&
    Boolean(roles.complianceAuthorizer.reviewerName.trim());

  const handleAutoRepairAlignment = () => {
    setRepairNotice(null);
    onUpdateProject(
      prev => {
        const courseOutcomeIds = prev.outcomes.courseOutcomes.map(c => c.id);
        const modOutcomesByMod = new Map<string, string[]>();
        for (const mo of prev.outcomes.moduleOutcomes) {
          if (!mo.moduleId) continue;
          const list = modOutcomesByMod.get(mo.moduleId) || [];
          list.push(mo.id);
          modOutcomesByMod.set(mo.moduleId, list);
        }

        const nextCurriculumModules = prev.curriculum.modules.map(pm => {
          const fallbackIds = Array.from(
            new Set([...(modOutcomesByMod.get(pm.id) || []), ...courseOutcomeIds.slice(0, 2)])
          );
          return {
            ...pm,
            lessons: pm.lessons.map(pl => ({
              ...pl,
              outcomeIds: Array.from(new Set([...(pl.outcomeIds || []), ...fallbackIds])),
            })),
          };
        });

        const nextContentModules = prev.content.modules.map(cm => {
          const fallbackIds = Array.from(
            new Set([...(modOutcomesByMod.get(cm.moduleId) || []), ...courseOutcomeIds.slice(0, 2)])
          );
          return {
            ...cm,
            lessons: cm.lessons.map(gl => ({
              ...gl,
              outcomeIds: Array.from(new Set([...(gl.outcomeIds || []), ...fallbackIds])),
            })),
          };
        });

        // Also ensure every outcome has at least one assessment linked (if assessments exist)
        const nextItems = [...prev.assessments.items];
        if (nextItems.length > 0) {
          const allOuts = [...prev.outcomes.courseOutcomes, ...prev.outcomes.moduleOutcomes];
          for (const out of allOuts) {
            const alreadyAssessed = nextItems.some(it => it.outcomeIds.includes(out.id));
            if (!alreadyAssessed) {
              const targetIdx =
                out.moduleId
                  ? nextItems.findIndex(it => it.moduleId === out.moduleId)
                  : 0;
              const idx = targetIdx >= 0 ? targetIdx : 0;
              nextItems[idx] = {
                ...nextItems[idx],
                outcomeIds: Array.from(new Set([...nextItems[idx].outcomeIds, out.id])),
              };
            }
          }
        }

        const updated: CourseProject = {
          ...prev,
          curriculum: { ...prev.curriculum, modules: nextCurriculumModules },
          content: { ...prev.content, modules: nextContentModules },
          assessments: { ...prev.assessments, items: nextItems },
        };
        const report = computeFullAlignmentReport(updated);
        updated.assessments.alignmentFlags = report.flags;
        updated.assessments.alignmentScorePercent = report.scorePercent;
        return updated;
      }
    );
    setRepairNotice(
      'Updated missing lesson-to-outcome and assessment-to-outcome links. Click "Re-run Quality Assurance" above to refresh your QA verdict.'
    );
  };

  const handleReleaseCourse = () => {
    if (!qa || qa.verdict === 'FAIL' || !allThreeRolesApproved) return;
    onUpdateProject(
      prev => ({
        ...prev,
        currentStage: 7,
        lifecycleStatus: 'completed',
      }),
      {
        trigger: 'stage_approval',
        summary: `Multi-role QA release approved (${roles.sme.reviewerName} / ${roles.instructionalDesigner.reviewerName} / ${roles.complianceAuthorizer.reviewerName})`,
      }
    );
    onProceedToPublish();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-[#052B66]">
            Stage 6: Quality Assurance, Accessibility & Multi-Role Sign-Off
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Combines deterministic accessibility, technical source-claim, and 3-way alignment diagnostics with the 7-dimension AI QA framework.
          </p>
        </div>

        <button
          type="button"
          disabled={isRunning || totalWeight !== 100}
          onClick={handleRunQA}
          className="px-4 py-2 rounded-lg bg-[#052B66] hover:bg-[#042150] disabled:opacity-60 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
        >
          {isRunning ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5 text-[#45CC42]" />
          )}
          <span>
            {isRunning
              ? 'Evaluating QA...'
              : qa
              ? 'Re-run Quality Assurance'
              : 'Run Quality Assurance'}
          </span>
        </button>
      </div>

      {isRunning && (
        <div className="p-3 bg-[#052B66] text-white rounded-lg text-xs font-semibold flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-[#45CC42]" />
          <span>Running 7-dimension AI Quality Assurance & alignment verification...</span>
        </div>
      )}

      {/* Deterministic Accessibility & Technical Validation Pre-Audit Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-[#052B66]" />
              <h3 className="text-sm font-bold text-[#052B66]">
                Deterministic Accessibility & Readability Audit
              </h3>
            </div>
            <span className="text-xs font-mono font-bold text-[#052B66]">
              {liveAccessibility.scorePercent}% · {liveAccessibility.averageSentenceWords} words/sentence
            </span>
          </div>
          <div className="space-y-2">
            {liveAccessibility.checks.map(chk => (
              <div
                key={chk.id}
                className="p-2.5 rounded-lg bg-[#F5F7FA] border border-slate-200 text-xs space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-800">{chk.label}</span>
                  <span
                    className={`font-bold uppercase text-[10px] ${
                      chk.status === 'pass'
                        ? 'text-emerald-700'
                        : chk.status === 'warning'
                        ? 'text-amber-700'
                        : 'text-red-700'
                    }`}
                  >
                    {chk.status}
                  </span>
                </div>
                <p className="text-slate-600">{chk.details}</p>
                {chk.affectedSections.length > 0 && (
                  <p className="text-[11px] text-slate-500">
                    Affected: {chk.affectedSections.slice(0, 4).join(', ')}
                    {chk.affectedSections.length > 4 ? '...' : ''}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-[#052B66]" />
              <h3 className="text-sm font-bold text-[#052B66]">
                Technical & Regulatory Validation Summary
              </h3>
            </div>
            <span className="text-xs font-mono font-bold text-[#052B66]">
              Alignment {liveAlignment.scorePercent}%
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="p-2 rounded bg-emerald-50 border border-emerald-200">
              <div className="font-mono font-bold text-emerald-800">
                {liveTechnical.verifiedClaimsCount}
              </div>
              <div className="text-[10px] text-emerald-700">Verified Claims</div>
            </div>
            <div className="p-2 rounded bg-amber-50 border border-amber-200">
              <div className="font-mono font-bold text-amber-800">
                {liveTechnical.needsReviewClaimsCount}
              </div>
              <div className="text-[10px] text-amber-700">Needs SME Review</div>
            </div>
            <div className="p-2 rounded bg-red-50 border border-red-200">
              <div className="font-mono font-bold text-red-800">
                {liveTechnical.unsupportedClaimsCount}
              </div>
              <div className="text-[10px] text-red-700">Unsupported</div>
            </div>
          </div>
          <div className="space-y-2">
            {liveTechnical.checks.map(chk => (
              <div
                key={chk.id}
                className="p-2.5 rounded-lg bg-[#F5F7FA] border border-slate-200 text-xs space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-800">{chk.label}</span>
                  <span
                    className={`font-bold uppercase text-[10px] ${
                      chk.status === 'pass'
                        ? 'text-emerald-700'
                        : chk.status === 'warning'
                        ? 'text-amber-700'
                        : 'text-red-700'
                    }`}
                  >
                    {chk.status}
                  </span>
                </div>
                <p className="text-slate-600">{chk.details}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Configurable Weights */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#052B66]">Configurable Dimension Weights</h3>
          <span
            className={`text-xs font-mono font-bold ${
              totalWeight === 100 ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            Total: {totalWeight}%
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {weights.map(w => (
            <div
              key={w.id}
              className="p-2.5 bg-[#F5F7FA] border border-slate-200 rounded-lg flex items-center justify-between gap-2"
            >
              <span className="text-xs text-slate-700 font-medium">{w.label}</span>
              <input
                type="number"
                min={0}
                max={100}
                value={w.weight}
                onChange={e =>
                  setWeights(prev =>
                    prev.map(x =>
                      x.id === w.id ? { ...x, weight: Number(e.target.value) || 0 } : x
                    )
                  )
                }
                className="w-16 px-2 py-1 text-xs font-mono bg-white border border-slate-200 rounded text-right"
              />
            </div>
          ))}
        </div>
      </section>

      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 space-y-1">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          {errorMsg.toLowerCase().includes('rate limit') && (
            <p className="text-[11px] text-red-600 pl-6">
              Groq Cloud free-tier token-per-minute window resets quickly. Wait 10–15 seconds before clicking again, or switch to Qwen 3.8 27B / GPT OSS 20B in the model selector above.
            </p>
          )}
        </div>
      )}

      {qa && (
        <>
          {/* Verdict Banner */}
          <section
            className={`p-5 rounded-xl border space-y-2 ${
              qa.verdict === 'PASS'
                ? 'bg-emerald-50 border-emerald-200'
                : qa.verdict === 'PASS WITH RECOMMENDATIONS'
                ? 'bg-blue-50 border-blue-200'
                : qa.verdict === 'REVISION REQUIRED'
                ? 'bg-amber-50 border-amber-200'
                : 'bg-red-50 border-red-200'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-base font-bold text-[#052B66]">
                QA Outcome: {qa.verdict}
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-[#052B66]">
                {qa.weightedScore}%
              </div>
            </div>
            <p className="text-xs text-slate-800 leading-relaxed">{qa.verdictExplanation}</p>
          </section>

          {/* Critical Failures */}
          {qa.criticalFailures.length > 0 && (
            <section className="bg-white border border-red-300 rounded-xl p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-red-800">
                  Critical Failures Blocking Release ({qa.criticalFailures.length})
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAutoRepairAlignment}
                    className="px-3 py-1.5 rounded-lg bg-[#052B66] hover:bg-[#042150] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Wrench className="w-3.5 h-3.5 text-[#45CC42]" />
                    <span>Auto-Link Unmapped Lessons & Outcomes</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onJumpToStage(4)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 hover:border-[#052B66] text-[#052B66] text-xs font-bold cursor-pointer"
                  >
                    Edit Stage 4 Alignment
                  </button>
                </div>
              </div>
              {repairNotice && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 font-medium">
                  {repairNotice}
                </div>
              )}
              {qa.criticalFailures.map(f => (
                <div
                  key={f.id}
                  className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs space-y-1"
                >
                  <div className="font-bold text-red-900">
                    {f.rule} ({f.affectedSection})
                  </div>
                  <div className="text-red-800">{f.description}</div>
                  <div className="text-slate-700">
                    <strong>Recommended Fix:</strong> {f.recommendedFix}
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* Dimension Breakdown */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-[#052B66]">Dimension Audit Breakdown</h3>
            <div className="space-y-3">
              {qa.dimensions.map(dim => (
                <div key={dim.id} className="border border-slate-200 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-[#052B66]">
                      {dim.label} (Weight {dim.weight}%)
                    </span>
                    <span className="text-sm font-mono font-bold tabular-nums text-[#052B66]">
                      {dim.score}%
                    </span>
                  </div>
                  {dim.supportingEvidence.length > 0 && (
                    <div className="text-xs text-slate-600">
                      <strong>Evidence:</strong> {dim.supportingEvidence.join(' · ')}
                    </div>
                  )}
                  {dim.weaknesses.length > 0 && (
                    <div className="text-xs text-amber-800">
                      <strong>Weaknesses:</strong> {dim.weaknesses.join(' · ')}
                    </div>
                  )}
                  {dim.recommendedCorrections.length > 0 && (
                    <div className="text-xs text-[#052B66] flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <strong>Recommended Correction:</strong>{' '}
                        {dim.recommendedCorrections.join(' · ')}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onJumpToStage(
                            dim.id === 'curriculum_coverage'
                              ? 2
                              : dim.id === 'outcomes_alignment'
                              ? 3
                              : dim.id === 'assessment_quality'
                              ? 4
                              : 5
                          )
                        }
                        className="px-2.5 py-1 text-[11px] font-bold bg-[#F5F7FA] border border-slate-200 rounded hover:border-[#052B66] cursor-pointer"
                      >
                        Go Fix Affected Stage
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Multi-Role Mandatory Human Review Gates */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#052B66]" />
              <div>
                <h3 className="text-sm font-bold text-[#052B66]">
                  Multi-Role Governance & Release Sign-Off
                </h3>
                <p className="text-xs text-slate-500">
                  Separate human approvals required across Subject-Matter Expert, Instructional Designer, and Compliance Authoriser.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {ROLE_DEFINITIONS.map(roleDef => {
                const record = roles[roleDef.key];
                return (
                  <div
                    key={roleDef.key}
                    className={`p-3.5 rounded-lg border space-y-2.5 ${
                      record.signedOff
                        ? 'bg-emerald-50/50 border-emerald-200'
                        : 'bg-[#F5F7FA] border-slate-200'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-[#052B66]">
                          {roleDef.title}
                        </div>
                        <div className="text-[11px] text-slate-500">{roleDef.scope}</div>
                      </div>
                      <button
                        type="button"
                        disabled={!record.reviewerName.trim()}
                        onClick={() =>
                          updateRoleSignOff(roleDef.key, {
                            signedOff: !record.signedOff,
                            signedOffAt: !record.signedOff
                              ? new Date().toISOString()
                              : undefined,
                          })
                        }
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50 ${
                          record.signedOff
                            ? 'bg-[#45CC42] text-[#052B66]'
                            : 'bg-white border border-[#052B66] text-[#052B66]'
                        }`}
                      >
                        {record.signedOff ? 'Approved ✓' : 'Sign Off Role'}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      <input
                        type="text"
                        value={record.reviewerName}
                        onChange={e =>
                          updateRoleSignOff(roleDef.key, {
                            reviewerName: e.target.value,
                            signedOff: false,
                          })
                        }
                        placeholder="Reviewer full name..."
                        className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded"
                      />
                      <input
                        type="text"
                        value={record.notes || ''}
                        onChange={e =>
                          updateRoleSignOff(roleDef.key, { notes: e.target.value })
                        }
                        placeholder="Verification notes or reference..."
                        className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="space-y-3 pt-2 border-t border-slate-100">
              {/* Release Gate Checklist */}
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span
                  className={`px-2 py-1 rounded border font-semibold ${
                    qa.verdict !== 'FAIL'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-red-50 border-red-200 text-red-800'
                  }`}
                >
                  {qa.verdict !== 'FAIL' ? '✓ QA Verdict Passed' : '✕ QA Verdict is FAIL'}
                </span>
                <span
                  className={`px-2 py-1 rounded border font-semibold ${
                    roles.sme.signedOff && roles.sme.reviewerName.trim()
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-slate-50 border-slate-200 text-slate-600'
                  }`}
                >
                  {roles.sme.signedOff && roles.sme.reviewerName.trim()
                    ? '✓ SME Signed Off'
                    : '○ SME Name & Sign-Off'}
                </span>
                <span
                  className={`px-2 py-1 rounded border font-semibold ${
                    roles.instructionalDesigner.signedOff &&
                    roles.instructionalDesigner.reviewerName.trim()
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-slate-50 border-slate-200 text-slate-600'
                  }`}
                >
                  {roles.instructionalDesigner.signedOff &&
                  roles.instructionalDesigner.reviewerName.trim()
                    ? '✓ ID Signed Off'
                    : '○ ID Name & Sign-Off'}
                </span>
                <span
                  className={`px-2 py-1 rounded border font-semibold ${
                    roles.complianceAuthorizer.signedOff &&
                    roles.complianceAuthorizer.reviewerName.trim()
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-slate-50 border-slate-200 text-slate-600'
                  }`}
                >
                  {roles.complianceAuthorizer.signedOff &&
                  roles.complianceAuthorizer.reviewerName.trim()
                    ? '✓ Compliance Signed Off'
                    : '○ Compliance Name & Sign-Off'}
                </span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <span className="text-xs text-slate-500">
                  {qa.verdict === 'FAIL'
                    ? 'Official release is blocked while QA verdict is FAIL. Fix critical failures above and click Re-run Quality Assurance (or export drafts below).'
                    : allThreeRolesApproved
                    ? 'All 3 governance roles signed off. Ready for official Stage 7 release.'
                    : 'Enter reviewer names and click "Sign Off Role" on all 3 roles above to unlock official release.'}
                </span>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={onProceedToPublish}
                    className="px-4 py-2.5 rounded-lg border border-[#052B66] text-[#052B66] hover:bg-[#052B66]/5 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Preview / Export Draft in Stage 7</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={qa.verdict === 'FAIL' || !allThreeRolesApproved}
                    onClick={handleReleaseCourse}
                    className="px-5 py-2.5 rounded-lg bg-[#052B66] hover:bg-[#042150] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4 text-[#45CC42]" />
                    <span>Release Course & Continue to Stage 7 Publish</span>
                  </button>
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
};
