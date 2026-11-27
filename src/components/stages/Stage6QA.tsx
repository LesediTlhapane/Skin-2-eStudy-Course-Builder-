import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Eye,
  FlaskConical,
  Info,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Wrench,
  XCircle,
} from 'lucide-react';
import type {
  AIProvider,
  CompanyRole,
  CourseGovernanceApprovalRecord,
  CourseProject,
  GovernanceRole,
  QADimensionWeight,
  QAIssueItem,
  RoleSignOffRecord,
  WorkflowStage,
} from '../../types';
import { DEFAULT_QA_WEIGHTS } from '../../data/templates';
import { computeFullAlignmentReport } from '../../utils/alignmentHelpers';
import {
  runPreExportCompletenessCheck,
  runStructuralAndConsistencyAudit,
} from '../../utils/courseValidation';
import {
  runAccessibilityChecks,
  runTechnicalValidationChecks,
} from '../../utils/validationChecks';
import {
  apiFetch,
  apiFetchWithAiBackup,
  compactProjectForApi,
  formatAiErrorMessage,
  parseApiJson,
} from '../../utils/apiClient';
import {
  canApproveGovernanceRole,
  getRolePermissions,
  GOVERNANCE_ROLE_LABELS,
  hasGenuineHumanGovernanceSignOff,
  isAiPlaceholderReviewerName,
  uiKeyToGovernanceRole,
} from '../../utils/rbac';

interface Stage6QAProps {
  project: CourseProject;
  activeRole?: CompanyRole | null;
  activeGovernanceRoles?: GovernanceRole[];
  currentUserId?: string;
  currentUserName?: string;
  selectedProvider: AIProvider;
  selectedModel: string;
  onUpdateProject: (
    updater: (prev: CourseProject) => CourseProject,
    snapshot?: { trigger: 'stage_approval' | 'ai_generation'; summary: string }
  ) => void;
  onSyncServerProject?: (project: CourseProject) => void;
  onJumpToStage: (
    stage: WorkflowStage,
    context?: { moduleNumber?: number; reason?: string }
  ) => void;
  onProceedToPublish: () => void;
}

type RoleKey = 'sme' | 'instructionalDesigner' | 'complianceAuthorizer';

interface EligibleReviewerSummary {
  userId: string;
  fullName: string;
  email: string;
  role: CompanyRole;
  governanceRoles: GovernanceRole[];
}

const ROLE_DEFINITIONS: Array<{
  key: RoleKey;
  govRole: GovernanceRole;
  title: string;
  scope: string;
}> = [
  {
    key: 'sme',
    govRole: 'sme',
    title: '1. Subject-Matter Expert (SME)',
    scope: 'Approves technical accuracy, equations, units, assumptions, and workplace realism.',
  },
  {
    key: 'instructionalDesigner',
    govRole: 'instructional_designer',
    title: '2. Instructional Designer (ID)',
    scope: 'Approves constructive alignment, measurable outcomes, assessments, and accessibility.',
  },
  {
    key: 'complianceAuthorizer',
    govRole: 'compliance_authorizer',
    title: '3. Authorised Compliance Reviewer',
    scope: 'Approves regulatory/SA profile checks, source grounding, POPIA, and release clearance.',
  },
];

export const Stage6QA: React.FC<Stage6QAProps> = ({
  project,
  activeRole,
  activeGovernanceRoles,
  currentUserId,
  currentUserName,
  selectedProvider,
  selectedModel,
  onUpdateProject,
  onSyncServerProject,
  onJumpToStage,
  onProceedToPublish,
}) => {
  const perms = getRolePermissions(activeRole, activeGovernanceRoles);
  const isReadOnly = perms.isReadOnly;
  const isCompleted = project.lifecycleStatus === 'completed';

  const [weights, setWeights] = useState<QADimensionWeight[]>(() => {
    const saved = project.latestQA?.weights;
    return saved && saved.length === DEFAULT_QA_WEIGHTS.length ? saved : DEFAULT_QA_WEIGHTS;
  });
  const [isRunning, setIsRunning] = useState(false);
  const [isRemediating, setIsRemediating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [repairNotice, setRepairNotice] = useState<string | null>(null);
  const [remediationNotes, setRemediationNotes] = useState<string[] | null>(null);
  const [releaseFeedback, setReleaseFeedback] = useState<string | null>(null);
  const [govBusyRole, setGovBusyRole] = useState<GovernanceRole | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const qaInFlightRef = useRef(false);
  const remediateInFlightRef = useRef(false);
  const [eligibleReviewers, setEligibleReviewers] = useState<EligibleReviewerSummary[]>([]);
  const [serverHumanSignOff, setServerHumanSignOff] = useState<
    NonNullable<CourseProject['latestQA']>['humanSignOff'] | null
  >(null);
  const [serverApprovals, setServerApprovals] = useState<CourseGovernanceApprovalRecord[]>([]);
  const [roleNotes, setRoleNotes] = useState<Record<RoleKey, string>>({
    sme: '',
    instructionalDesigner: '',
    complianceAuthorizer: '',
  });

  const refreshGovernanceState = useCallback(async () => {
    if (!project.companyId) return;
    try {
      const res = await apiFetch(
        `/api/v2/courses/${encodeURIComponent(project.id)}/governance`
      );
      if (!res.ok) return;
      const data = await parseApiJson<any>(res);
      if (!data.success) return;
      if (Array.isArray(data.eligibleReviewers)) {
        setEligibleReviewers(data.eligibleReviewers);
      }
      if (Array.isArray(data.approvals)) {
        setServerApprovals(data.approvals);
      }
      if (data.humanSignOff) {
        setServerHumanSignOff(data.humanSignOff);
      }
    } catch {
      /* Ignore transient network fetch errors on initial governance sync */
    }
  }, [project.id, project.companyId]);

  useEffect(() => {
    setServerHumanSignOff(null);
    setServerApprovals([]);
    void refreshGovernanceState();
  }, [refreshGovernanceState, project.latestQA?.id, project.lifecycleStatus]);

  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
  const qa = project.latestQA;

  const liveAccessibility = useMemo(() => runAccessibilityChecks(project), [project]);
  const liveTechnical = useMemo(() => runTechnicalValidationChecks(project), [project]);
  const liveAlignment = useMemo(() => computeFullAlignmentReport(project), [project]);
  const liveStructural = useMemo(() => runStructuralAndConsistencyAudit(project), [project]);
  const preExportReport = useMemo(() => runPreExportCompletenessCheck(project), [project]);

  const isQaStale = Boolean(
    qa && (!qa.evaluatedDataSignature || qa.evaluatedDataSignature !== liveStructural.dataSignature)
  );

  // Merge live structural blockers with any AI-identified critical issues when QA is fresh
  const activeBlockingErrors: QAIssueItem[] = useMemo(() => {
    if (!qa) return liveStructural.blockingErrors;
    if (!isQaStale && Array.isArray(qa.blockingErrors)) {
      return qa.blockingErrors;
    }
    return liveStructural.blockingErrors;
  }, [qa, isQaStale, liveStructural.blockingErrors]);

  const activeWarnings: QAIssueItem[] = useMemo(() => {
    if (!qa || isQaStale || !Array.isArray(qa.warnings)) {
      return liveStructural.warnings;
    }
    return qa.warnings;
  }, [qa, isQaStale, liveStructural.warnings]);

  const activeInfo: QAIssueItem[] = useMemo(() => {
    if (!qa || isQaStale || !Array.isArray(qa.informationalFeedback)) {
      return liveStructural.informationalFeedback;
    }
    return qa.informationalFeedback;
  }, [qa, isQaStale, liveStructural.informationalFeedback]);

  const effectiveSignOff = serverHumanSignOff || qa?.humanSignOff;
  const roles = effectiveSignOff?.roles || {
    sme: { signedOff: false, reviewerName: '' },
    instructionalDesigner: { signedOff: false, reviewerName: '' },
    complianceAuthorizer: { signedOff: false, reviewerName: '' },
  };

  const handleSubmitGovernanceDecision = async (
    roleKey: RoleKey,
    decision: 'approved' | 'rejected'
  ) => {
    const govRole = uiKeyToGovernanceRole(roleKey);
    if (isCompleted || isReadOnly) return;
    setReleaseFeedback(null);
    setGovBusyRole(govRole);
    try {
      const notes = roleNotes[roleKey]?.trim() || roles[roleKey]?.notes || '';
      const res = await apiFetch(
        `/api/v2/courses/${encodeURIComponent(project.id)}/governance/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            governanceRole: govRole,
            decision,
            notes,
          }),
        }
      );
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success || !data.course) {
        throw new Error(data.error || 'Governance decision failed.');
      }
      if (Array.isArray(data.approvals)) {
        setServerApprovals(data.approvals);
      }
      setServerHumanSignOff(data.course.latestQA?.humanSignOff || null);
      onSyncServerProject?.(data.course);
    } catch (err: any) {
      setReleaseFeedback(err?.message || 'Unable to record governance decision.');
    } finally {
      setGovBusyRole(null);
    }
  };

  const handleRevokeGovernanceDecision = async (roleKey: RoleKey) => {
    const govRole = uiKeyToGovernanceRole(roleKey);
    if (isCompleted || isReadOnly) return;
    setReleaseFeedback(null);
    setGovBusyRole(govRole);
    try {
      const res = await apiFetch(
        `/api/v2/courses/${encodeURIComponent(project.id)}/governance/revoke`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ governanceRole: govRole }),
        }
      );
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success || !data.course) {
        throw new Error(data.error || 'Could not revoke governance approval.');
      }
      if (Array.isArray(data.approvals)) {
        setServerApprovals(data.approvals);
      }
      setServerHumanSignOff(data.course.latestQA?.humanSignOff || null);
      onSyncServerProject?.(data.course);
    } catch (err: any) {
      setReleaseFeedback(err?.message || 'Unable to revoke governance approval.');
    } finally {
      setGovBusyRole(null);
    }
  };

  const handleRunQA = async () => {
    if (qaInFlightRef.current) return;
    if (totalWeight !== 100) {
      setErrorMsg(`Dimension weights must sum to 100% (currently ${totalWeight}%).`);
      return;
    }
    qaInFlightRef.current = true;
    setIsRunning(true);
    setErrorMsg(null);
    setBackupNotice(null);
    try {
      const { res, data, usedBackupModel } = await apiFetchWithAiBackup<any>(
        '/api/v2/qa/evaluate',
        {
          project: compactProjectForApi(project),
          weights,
          provider: selectedProvider,
          model: selectedModel,
        }
      );
      if (!res.ok || !data.success) {
        throw new Error(
          formatAiErrorMessage(res, data, usedBackupModel, 'QA evaluation failed.')
        );
      }
      if (usedBackupModel) {
        setBackupNotice(
          'Primary AI request hit temporary capacity — backup AI model completed 12-dimension QA evaluation.'
        );
      }
      const report = data.report;
      onUpdateProject(
        prev => ({
          ...prev,
          latestQA: report,
          qaHistory: [report, ...prev.qaHistory],
          lifecycleStatus:
            report.verdict === 'FAIL'
              ? 'revision_required'
              : 'awaiting_review',
        }),
        {
          trigger: 'ai_generation',
          summary: `Executed Stage 6 QA: ${report.verdict} (${report.weightedScore}%)`,
        }
      );
      setRepairNotice(null);
    } catch (err: any) {
      setErrorMsg(err?.message || 'QA audit failed.');
    } finally {
      qaInFlightRef.current = false;
      setIsRunning(false);
    }
  };

  const handleGuidedRemediation = async () => {
    if (remediateInFlightRef.current) return;
    remediateInFlightRef.current = true;
    setIsRemediating(true);
    setErrorMsg(null);
    setBackupNotice(null);
    setRemediationNotes(null);
    try {
      const { res, data, usedBackupModel } = await apiFetchWithAiBackup<any>(
        '/api/v2/qa/remediate',
        {
          project: compactProjectForApi(project),
          provider: selectedProvider,
          model: selectedModel,
        }
      );
      if (!res.ok || !data.success || !data.updatedProject) {
        throw new Error(
          formatAiErrorMessage(res, data, usedBackupModel, 'Guided QA remediation failed.')
        );
      }
      if (usedBackupModel) {
        setBackupNotice(
          'Primary AI request hit temporary capacity — backup AI model completed Guided QA Remediation.'
        );
      }
      const changes: string[] = Array.isArray(data.changesSummary) ? data.changesSummary : [];
      onUpdateProject(
        prev => ({
          ...prev,
          brief: data.updatedProject.brief || prev.brief,
          curriculum: data.updatedProject.curriculum || prev.curriculum,
          assessments: data.updatedProject.assessments || prev.assessments,
          content: data.updatedProject.content || prev.content,
          updatedAt: new Date().toISOString(),
        }),
        {
          trigger: 'ai_generation',
          summary: `Applied Guided QA Remediation (${changes.length} targeted update(s))`,
        }
      );
      setRemediationNotes(changes);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Guided QA remediation failed.');
    } finally {
      remediateInFlightRef.current = false;
      setIsRemediating(false);
    }
  };

  const isRoleSignedHuman = (record?: RoleSignOffRecord | null): boolean =>
    Boolean(
      record &&
        record.signedOff &&
        record.status !== 'rejected' &&
        Boolean(record.reviewerUserId) &&
        Boolean(record.signedOffAt) &&
        Boolean(String(record.reviewerName || '').trim()) &&
        !isAiPlaceholderReviewerName(record.reviewerName)
    );

  const signOffCheck = hasGenuineHumanGovernanceSignOff(effectiveSignOff, {
    companyId: project.companyId,
    courseId: project.id,
  });
  const allThreeRolesApproved = signOffCheck.valid;

  const handleAutoRepairAlignment = () => {
    if (isReadOnly) return;
    setRepairNotice(null);
    onUpdateProject(prev => {
      const courseOutcomeIds = prev.outcomes.courseOutcomes.map(c => c.id);
      const modOutcomesByMod = new Map<string, string[]>();
      for (const mo of prev.outcomes.moduleOutcomes) {
        if (!mo.moduleId) continue;
        const list = modOutcomesByMod.get(mo.moduleId) || [];
        list.push(mo.id);
        modOutcomesByMod.set(mo.moduleId, list);
      }

      const nextCurriculumModules = prev.curriculum.modules.map(pm => {
        const modMos = modOutcomesByMod.get(pm.id) || [];
        const fallbackIds = Array.from(new Set([...modMos, ...courseOutcomeIds]));
        return {
          ...pm,
          lessons: pm.lessons.map(pl => ({
            ...pl,
            outcomeIds: Array.from(new Set([...(Array.isArray(pl.outcomeIds) ? pl.outcomeIds : []), ...fallbackIds])),
          })),
        };
      });

      const nextContentModules = prev.content.modules.map(cm => {
        const modMos = modOutcomesByMod.get(cm.moduleId) || [];
        const fallbackIds = Array.from(new Set([...modMos, ...courseOutcomeIds]));
        return {
          ...cm,
          lessons: cm.lessons.map(gl => ({
            ...gl,
            outcomeIds: Array.from(new Set([...(Array.isArray(gl.outcomeIds) ? gl.outcomeIds : []), ...fallbackIds])),
          })),
        };
      });

      const nextItems = [...prev.assessments.items];
      if (nextItems.length > 0) {
        const allOuts = [...prev.outcomes.courseOutcomes, ...prev.outcomes.moduleOutcomes];
        for (const out of allOuts) {
          const alreadyAssessed = nextItems.some(
            it => Array.isArray(it.outcomeIds) && it.outcomeIds.includes(out.id)
          );
          if (!alreadyAssessed) {
            const targetIdx = out.moduleId
              ? nextItems.findIndex(it => it.moduleId === out.moduleId)
              : 0;
            const idx = targetIdx >= 0 ? targetIdx : 0;
            const existingOutcomeIds = Array.isArray(nextItems[idx].outcomeIds)
              ? nextItems[idx].outcomeIds
              : [];
            nextItems[idx] = {
              ...nextItems[idx],
              outcomeIds: Array.from(new Set([...existingOutcomeIds, out.id])),
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
    });
    setRepairNotice(
      'Linked all course & module outcomes to lessons and assessments. Click "Re-run Quality Assurance" above to refresh your QA score and verdict.'
    );
  };

  const resolveDimensionStage = (dimId: string): WorkflowStage => {
    if (dimId === 'curriculum_coverage') return 2;
    if (dimId === 'learning_outcomes' || dimId === 'outcomes_alignment') return 3;
    if (dimId === 'instructional_alignment' || dimId === 'assessment_quality') return 4;
    if (dimId === 'source_credibility') return 1;
    return 5;
  };

  const renderSeverityAndOrigin = (issue: QAIssueItem) => {
    const sev = issue.prioritySeverity || (issue.severity === 'blocking' ? 'critical' : issue.severity === 'warning' ? 'medium' : 'low');
    const sevStyle =
      sev === 'critical'
        ? 'bg-red-100 text-red-900 border-red-300'
        : sev === 'high'
        ? 'bg-orange-100 text-orange-900 border-orange-300'
        : sev === 'medium'
        ? 'bg-amber-100 text-amber-900 border-amber-300'
        : 'bg-slate-100 text-slate-700 border-slate-300';

    const origin = issue.verificationOrigin || 'automated';
    const originLabel =
      origin === 'external_verified'
        ? 'Verified Source'
        : origin === 'unverified'
        ? 'Unverified'
        : origin === 'expert_review_required'
        ? 'Expert / Legal Review'
        : 'Automated Check';

    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 ml-2">
        <span className={`px-1.5 py-0.5 text-[10px] font-bold uppercase rounded border ${sevStyle}`}>
          {sev}
        </span>
        <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded border border-slate-200 bg-white text-slate-600">
          {originLabel}
        </span>
      </span>
    );
  };

  const isReleaseBlocked = isCompleted
    ? false
    : !qa ||
      isQaStale ||
      activeBlockingErrors.length > 0 ||
      qa.verdict === 'FAIL' ||
      !allThreeRolesApproved ||
      !perms.canPublishCourse ||
      isReadOnly;

  const getUnmetReleaseReasons = (): string[] => {
    const reasons: string[] = [];
    if (isReadOnly) {
      reasons.push('Viewer accounts have read-only access and cannot release courses.');
      return reasons;
    }
    if (!perms.canPublishCourse) {
      reasons.push(
        'Only a Reviewer (or a separately authorised Company Administrator) can complete and publish a course.'
      );
    }
    if (!qa) {
      reasons.push('Run Quality Assurance first.');
      return reasons;
    }
    if (isQaStale) {
      reasons.push('Course changed after the last audit — click "Re-run Quality Assurance" at the top.');
    }
    if (activeBlockingErrors.length > 0) {
      reasons.push(`${activeBlockingErrors.length} blocking error(s) must be fixed first.`);
    } else if (qa.verdict === 'FAIL') {
      reasons.push('QA Verdict is FAIL — address critical feedback and re-run Quality Assurance.');
    }
    if (!allThreeRolesApproved) {
      reasons.push(
        signOffCheck.reason ||
          'Three distinct authenticated human governance reviewers (SME, Instructional Designer, Compliance Authoriser) must approve before completion.'
      );
    }
    return reasons;
  };

  const handleReleaseCourse = async () => {
    if (isCompleted) {
      onUpdateProject(prev => ({ ...prev, currentStage: 7 }));
      onProceedToPublish();
      return;
    }
    if (isReleaseBlocked || !qa) {
      const reasons = getUnmetReleaseReasons();
      setReleaseFeedback(`Cannot release to Stage 7 yet: ${reasons.join(' ')}`);
      return;
    }
    setReleaseFeedback(null);
    setIsCompleting(true);
    try {
      const res = await apiFetch(
        `/api/v2/courses/${encodeURIComponent(project.id)}/complete`,
        { method: 'POST' }
      );
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success || !data.course) {
        throw new Error(data.error || 'Could not release course to Stage 7.');
      }
      onSyncServerProject?.(data.course);
      onProceedToPublish();
    } catch (err: any) {
      setReleaseFeedback(err?.message || 'Course completion failed.');
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-primary">
            Stage 6: Quality Assurance, Accessibility & Multi-Role Sign-Off
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Separates critical release blockers from high/medium/low advisories across the 12-dimension QA framework, with verification-origin tracking.
          </p>
        </div>

        {!isReadOnly && (
          <div className="flex flex-wrap items-center gap-2">
            {(activeBlockingErrors.length > 0 || activeWarnings.length > 0) && (
              <button
                type="button"
                disabled={isRemediating || isRunning}
                onClick={handleGuidedRemediation}
                className="px-3.5 py-2 rounded-lg bg-primary hover:bg-primary-dark disabled:opacity-60 text-primary-contrast border-b-2 border-accent text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                {isRemediating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                ) : (
                  <Wrench className="w-3.5 h-3.5 text-accent" />
                )}
                <span>
                  {isRemediating ? 'Applying Guided Fixes...' : 'Apply Guided QA Remediation'}
                </span>
              </button>
            )}
            <button
              type="button"
              disabled={isRunning || isRemediating || totalWeight !== 100}
              onClick={handleRunQA}
              className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-dark disabled:opacity-60 text-accent-contrast text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              {isRunning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
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
        )}
      </div>

      {isRunning && (
        <div className="p-3 bg-primary text-primary-contrast border-b-2 border-accent rounded-lg text-xs font-semibold flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-accent" />
          <span>Running 12-dimension AI Quality Assurance, regulatory, technical & alignment verification...</span>
        </div>
      )}

      {isRemediating && (
        <div className="p-3 bg-primary text-primary-contrast border-b-2 border-accent rounded-lg text-xs font-semibold flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-accent" />
          <span>Applying structure-preserving QA remediation (weights, duration, legal citations, hypothetical labels, ML accuracy & audience tone)...</span>
        </div>
      )}

      {backupNotice && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" />
          <span>{backupNotice}</span>
        </div>
      )}

      {remediationNotes && remediationNotes.length > 0 && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-xs text-emerald-950 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold">Guided QA Remediation Applied — Re-run Quality Assurance to verify updated score</span>
            <button
              type="button"
              onClick={handleRunQA}
              disabled={isRunning || totalWeight !== 100}
              className="px-3 py-1 rounded bg-primary text-primary-contrast font-bold cursor-pointer"
            >
              Re-run QA Now
            </button>
          </div>
          <ul className="list-disc pl-5 space-y-0.5 text-emerald-900">
            {remediationNotes.map((note, idx) => (
              <li key={idx}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Stale QA Banner */}
      {isQaStale && qa && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-950">
          <div className="flex items-start gap-2.5">
            <RefreshCw className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">Course Data Changed Since Last QA Audit</div>
              <p className="text-amber-900 mt-0.5">
                You edited course content, outcomes, assessments, or sources after the last QA evaluation ({new Date(qa.evaluatedAt).toLocaleTimeString('en-ZA')}). Re-run QA before releasing to Stage 7. Your reviewer names below are preserved.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isRunning || totalWeight !== 100}
            onClick={handleRunQA}
            className="px-3.5 py-2 rounded-lg bg-primary hover:bg-primary-dark text-primary-contrast border-b-2 border-accent font-bold shrink-0 cursor-pointer"
          >
            Re-run QA Now
          </button>
        </div>
      )}

      {/* Live Deterministic Readiness Strip (Blocking / Warnings / Info before & after AI QA) */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div
          className={`rounded-xl border p-4 space-y-2 ${
            activeBlockingErrors.length > 0
              ? 'bg-red-50/60 border-red-300'
              : 'bg-emerald-50/60 border-emerald-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-primary">A. Blocking Errors</span>
            <span
              className={`text-xs font-mono font-bold ${
                activeBlockingErrors.length > 0 ? 'text-red-700' : 'text-emerald-700'
              }`}
            >
              {activeBlockingErrors.length}
            </span>
          </div>
          <p className="text-[11px] text-slate-600">
            Issues that prevent Stage 7 publishing until resolved (missing mandatory metadata, untaught/unassessed outcomes, missing modules, placeholders).
          </p>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-primary">B. Advisory Warnings</span>
            <span className="text-xs font-mono font-bold text-amber-700">
              {activeWarnings.length}
            </span>
          </div>
          <p className="text-[11px] text-slate-600">
            Recommended improvements (duration variance, SME review queue, readability, optional weighting tips). <strong>Do not block publishing.</strong>
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-primary">C. Informational Notes</span>
            <span className="text-xs font-mono font-bold text-slate-700">
              {activeInfo.length}
            </span>
          </div>
          <p className="text-[11px] text-slate-600">
            Course readiness metrics, accessibility scope boundaries, and alignment governance notices.
          </p>
        </div>
      </section>

      {/* Pre-Export Completeness Validation Card */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-bold text-primary">
            Pre-Export Completeness Validation
          </div>
          <span
            className={`px-2 py-0.5 rounded font-bold text-[11px] border ${
              preExportReport.readyForExport
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            {preExportReport.summary}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
          <div className="p-2.5 rounded-lg bg-surface border border-slate-200">
            <div className="font-bold text-slate-800">
              Critical Release Blockers: {preExportReport.criticalBlockers.length}
            </div>
            {preExportReport.criticalBlockers.length === 0 ? (
              <div className="text-emerald-700 mt-0.5">None detected — structural &amp; assessment gates clear.</div>
            ) : (
              <ul className="list-disc pl-4 mt-1 text-red-700 space-y-0.5">
                {preExportReport.criticalBlockers.slice(0, 3).map(b => (
                  <li key={b.id}>{b.title} (Stage {b.stage})</li>
                ))}
              </ul>
            )}
          </div>
          <div className="p-2.5 rounded-lg bg-surface border border-slate-200">
            <div className="font-bold text-slate-800">
              Advisory Polish Items: {preExportReport.advisoryPolish.length}
            </div>
            {preExportReport.advisoryPolish.length === 0 ? (
              <div className="text-emerald-700 mt-0.5">All recommended pedagogical &amp; polish checks passed.</div>
            ) : (
              <ul className="list-disc pl-4 mt-1 text-amber-800 space-y-0.5">
                {preExportReport.advisoryPolish.slice(0, 3).map(a => (
                  <li key={a.id}>{a.title} (Stage {a.stage})</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* Duration, Assessment Weighting & Source Verification Validation Grid */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-primary">Duration Reconciliation</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                liveStructural.durationValidation.status === 'aligned'
                  ? 'bg-emerald-50 text-emerald-700'
                  : liveStructural.durationValidation.status === 'fail'
                  ? 'bg-red-50 text-red-700'
                  : 'bg-amber-50 text-amber-700'
              }`}
            >
              {liveStructural.durationValidation.status}
            </span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            {liveStructural.durationValidation.summary}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-primary">Assessment Weighting Math</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                liveStructural.assessmentValidation.status === 'aligned'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-red-50 text-red-700'
              }`}
            >
              {liveStructural.assessmentValidation.status}
            </span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Declared: {liveStructural.assessmentValidation.declaredKnowledgeWeight}% Knowledge /{' '}
            {liveStructural.assessmentValidation.declaredPracticalWeight}% Practical · Actual Items:{' '}
            {liveStructural.assessmentValidation.actualKnowledgeWeight}% +{' '}
            {liveStructural.assessmentValidation.actualPracticalWeight}% ={' '}
            {liveStructural.assessmentValidation.totalItemWeight}% (Pass{' '}
            {liveStructural.assessmentValidation.passRequirementPercent}%).
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-primary">Verification Origin Status</span>
            <span className="text-[11px] font-mono font-bold text-primary">
              {liveStructural.sourceVerificationSummary.verifiedSources}/
              {liveStructural.sourceVerificationSummary.totalSources} Verified
            </span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            {liveStructural.sourceVerificationSummary.externalVerificationNote}
          </p>
        </div>
      </section>

      {/* Blocking Errors List (shown immediately whenever any exist, even before running AI QA) */}
      {activeBlockingErrors.length > 0 && (
        <section className="bg-white border border-red-300 rounded-xl p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-red-800">
              Blocking Errors Preventing Release ({activeBlockingErrors.length})
            </h3>
            {!isReadOnly && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleAutoRepairAlignment}
                  className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-dark text-primary-contrast border-b-2 border-accent text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Wrench className="w-3.5 h-3.5 text-accent" />
                  <span>Auto-Link Unmapped Lessons & Outcomes</span>
                </button>
                <button
                  type="button"
                  onClick={() => onJumpToStage(4)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 hover:border-accent text-primary text-xs font-bold cursor-pointer"
                >
                  Edit Stage 4 Alignment
                </button>
              </div>
            )}
          </div>

          {repairNotice && (
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 font-medium">
              {repairNotice}
            </div>
          )}

          {activeBlockingErrors.map(err => (
            <div
              key={err.id}
              className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs flex flex-col sm:flex-row sm:items-start justify-between gap-2"
            >
              <div className="space-y-1">
                <div className="font-bold text-red-900">
                  {err.rule} ({err.affectedSection})
                  {renderSeverityAndOrigin(err)}
                </div>
                <div className="text-red-800">{err.description}</div>
                {err.exampleExcerpt && (
                  <div className="text-[11px] bg-white/80 border border-red-200 rounded px-2 py-1 text-slate-700 italic">
                    Excerpt: “{err.exampleExcerpt}”
                  </div>
                )}
                <div className="text-slate-700">
                  <strong>Recommended Fix:</strong> {err.recommendedFix}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onJumpToStage(err.stage, {
                    moduleNumber: err.moduleNumber,
                    reason: `${err.rule}: ${err.description}`,
                  })
                }
                className="px-3 py-1.5 rounded-lg bg-white border border-red-300 hover:border-accent text-primary text-[11px] font-bold flex items-center gap-1 shrink-0 cursor-pointer"
              >
                <span>Fix in Stage {err.stage}{err.moduleNumber ? ` · M${err.moduleNumber}` : ''}</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          ))}
        </section>
      )}

      {/* Advisory Warnings Panel (Non-Blocking) */}
      {activeWarnings.length > 0 && (
        <section className="bg-white border border-amber-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-amber-900">
              Advisory & High-Priority Warnings ({activeWarnings.length})
            </h3>
            <span className="text-[11px] font-semibold text-amber-700">High/Medium/Low improvements</span>
          </div>
          <div className="space-y-2">
            {activeWarnings.map(w => (
              <div
                key={w.id}
                className="p-3 bg-amber-50/60 border border-amber-200 rounded-lg text-xs flex flex-col sm:flex-row sm:items-start justify-between gap-2"
              >
                <div className="space-y-1">
                  <div className="font-bold text-amber-950">
                    {w.rule} ({w.affectedSection})
                    {renderSeverityAndOrigin(w)}
                  </div>
                  <div className="text-amber-900">{w.description}</div>
                  {w.exampleExcerpt && (
                    <div className="text-[11px] bg-white/80 border border-amber-200 rounded px-2 py-1 text-slate-700 italic">
                      Excerpt: “{w.exampleExcerpt}”
                    </div>
                  )}
                  <div className="text-slate-600">
                    <strong>Suggestion:</strong> {w.recommendedFix}
                  </div>
                </div>
                {w.stage !== 6 && (
                  <button
                    type="button"
                    onClick={() =>
                      onJumpToStage(w.stage, {
                        moduleNumber: w.moduleNumber,
                        reason: `${w.rule}: ${w.description}`,
                      })
                    }
                    className="px-2.5 py-1 rounded bg-white border border-amber-300 hover:border-accent text-primary text-[11px] font-bold shrink-0 cursor-pointer"
                  >
                    Review in Stage {w.stage} →
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Deterministic Accessibility & Technical Validation Pre-Audit Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-bold text-primary">
                Deterministic Accessibility & Readability Audit
              </h3>
            </div>
            <span className="text-xs font-mono font-bold text-primary">
              {liveAccessibility.scorePercent}% · {liveAccessibility.averageSentenceWords} words/sentence
            </span>
          </div>
          {liveAccessibility.limitationsNote && (
            <p className="text-[11px] text-slate-500 bg-surface p-2.5 rounded border border-slate-200 leading-relaxed">
              {liveAccessibility.limitationsNote}
            </p>
          )}
          <div className="space-y-2">
            {liveAccessibility.checks.map(chk => (
              <div
                key={chk.id}
                className="p-2.5 rounded-lg bg-surface border border-slate-200 text-xs space-y-1"
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
                {chk.status !== 'pass' && (
                  <button
                    type="button"
                    onClick={() => {
                      const targetStage: WorkflowStage = chk.id === 'acc-instructions' ? 4 : 5;
                      const modMatch = (chk.affectedSections[0] || '').match(/\b(?:Module|M)\s*(\d+)\b/i);
                      onJumpToStage(targetStage, {
                        moduleNumber: modMatch ? Number(modMatch[1]) : undefined,
                        reason: `${chk.label}: ${chk.details}`,
                      });
                    }}
                    className="mt-1 px-2.5 py-1 text-[11px] font-bold text-primary bg-white border border-slate-200 hover:border-accent rounded cursor-pointer"
                  >
                    Fix in Stage {chk.id === 'acc-instructions' ? 4 : 5} →
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-bold text-primary">
                Technical & Source Verification Summary
              </h3>
            </div>
            <span className="text-xs font-mono font-bold text-primary">
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
                className="p-2.5 rounded-lg bg-surface border border-slate-200 text-xs space-y-1"
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
                {chk.status !== 'pass' && chk.id !== 'tech-source-grounding' && (
                  <button
                    type="button"
                    onClick={() => {
                      const targetStage: WorkflowStage =
                        chk.id === 'tech-metadata-tbc' ? 1 : 5;
                      const modMatch = (chk.affectedSections[0] || '').match(/\b(?:Module|M)\s*(\d+)\b/i);
                      onJumpToStage(targetStage, {
                        moduleNumber: modMatch ? Number(modMatch[1]) : undefined,
                        reason: `${chk.label}: ${chk.details}`,
                      });
                    }}
                    className="mt-1 px-2.5 py-1 text-[11px] font-bold text-primary bg-white border border-slate-200 hover:border-accent rounded cursor-pointer"
                  >
                    {chk.id === 'tech-metadata-tbc'
                      ? 'Confirm Metadata in Stage 1 →'
                      : 'Review in Stage 5 →'}
                  </button>
                )}
              </div>
            ))}
          </div>

          {activeInfo.length > 0 && (
            <div className="pt-2 border-t border-slate-100 space-y-1.5">
              <div className="text-[11px] font-bold text-slate-600 flex items-center gap-1">
                <Info className="w-3.5 h-3.5 text-primary" />
                <span>Informational Feedback</span>
              </div>
              {activeInfo.map(info => (
                <div key={info.id} className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded border border-slate-200">
                  <strong>{info.rule}:</strong> {info.description}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Configurable Weights */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-primary">Configurable Dimension Weights</h3>
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
              className="p-2.5 bg-surface border border-slate-200 rounded-lg flex items-center justify-between gap-2"
            >
              <span className="text-xs text-slate-700 font-medium">{w.label}</span>
              <input
                type="number"
                min={0}
                max={100}
                disabled={isReadOnly}
                value={w.weight}
                onChange={e =>
                  setWeights(prev =>
                    prev.map(x =>
                      x.id === w.id ? { ...x, weight: Number(e.target.value) || 0 } : x
                    )
                  )
                }
                className="w-16 px-2 py-1 text-xs font-mono bg-white border border-slate-200 rounded text-right disabled:bg-slate-100"
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
        </div>
      )}

      {qa && (
        <>
          {/* Verdict Banner */}
          <section
            className={`p-5 rounded-xl border space-y-3 ${
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
              <div className="text-base font-bold text-primary">
                QA Outcome: {qa.verdict} {isQaStale ? '(Outdated — Re-run Required)' : ''}
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-primary">
                {qa.weightedScore}%
              </div>
            </div>
            <p className="text-xs text-slate-800 leading-relaxed">{qa.verdictExplanation}</p>
            {qa.verificationSummary && (
              <div className="flex flex-wrap gap-2 text-[11px] pt-1">
                <span className="px-2 py-0.5 rounded bg-white/80 border border-slate-200 font-semibold text-slate-700">
                  Automated Checks: {qa.verificationSummary.automatedCount}
                </span>
                <span className="px-2 py-0.5 rounded bg-white/80 border border-emerald-200 font-semibold text-emerald-800">
                  Verified Sources: {qa.verificationSummary.externalVerifiedCount}
                </span>
                <span className="px-2 py-0.5 rounded bg-white/80 border border-amber-200 font-semibold text-amber-800">
                  Unverified Findings: {qa.verificationSummary.unverifiedCount}
                </span>
                <span className="px-2 py-0.5 rounded bg-white/80 border border-purple-200 font-semibold text-purple-800">
                  Requires Expert/Legal Review: {qa.verificationSummary.expertReviewRequiredCount}
                </span>
              </div>
            )}
            {qa.humanReviewRequirements && qa.humanReviewRequirements.length > 0 && (
              <div className="p-3 bg-white/80 border border-slate-200 rounded-lg text-[11px] text-slate-700 space-y-1">
                <div className="font-bold text-primary">Required Human & Specialist Reviews</div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {qa.humanReviewRequirements.map((req, idx) => (
                    <li key={idx}>{req}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Dimension Breakdown */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-primary">Dimension Audit Breakdown</h3>
            <div className="space-y-3">
              {qa.dimensions.map(dim => (
                <div key={dim.id} className="border border-slate-200 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-primary">
                      {dim.label} (Weight {dim.weight}%)
                    </span>
                    <span className="text-sm font-mono font-bold tabular-nums text-primary">
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
                    <div className="text-xs text-primary flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <strong>Recommended Correction:</strong>{' '}
                        {dim.recommendedCorrections.join(' · ')}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const targetStage = resolveDimensionStage(dim.id);
                          const modMatch = (dim.affectedSections[0] || '').match(/\b(?:Module|M)\s*(\d+)\b/i);
                          onJumpToStage(targetStage, {
                            moduleNumber: modMatch ? Number(modMatch[1]) : undefined,
                            reason: `${dim.label} (${dim.score}%): ${
                              dim.recommendedCorrections[0] || dim.weaknesses[0] || ''
                            }`,
                          });
                        }}
                        className="px-2.5 py-1 text-[11px] font-bold bg-surface border border-slate-200 rounded hover:border-accent cursor-pointer"
                      >
                        Edit in Stage {resolveDimensionStage(dim.id)} →
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Multi-Role Mandatory Human Review Gates (Server-Verified Three-Person Rule) */}
          <section className="bg-white border border-slate-200 border-t-[3px] border-t-accent rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-accent-ink" />
                <div>
                  <h3 className="text-sm font-bold text-primary">
                    Multi-Role Human Governance &amp; Three-Person Sign-Off
                  </h3>
                  <p className="text-xs text-slate-500">
                    Each governance gate must be approved by a distinct authenticated user with explicit role authority. Signing off uses your verified session identity.
                  </p>
                </div>
              </div>
              {isCompleted && (
                <span className="px-2.5 py-1 rounded bg-emerald-100 border border-emerald-300 text-emerald-900 text-[11px] font-bold flex items-center gap-1 shrink-0">
                  <Lock className="w-3.5 h-3.5" />
                  <span>Governance Locked (Completed)</span>
                </span>
              )}
            </div>

            {!perms.canApproveGovernance && !isCompleted && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                Your account (<strong>{activeRole || 'viewer'}</strong>
                {perms.governanceRoles.length > 0
                  ? ` · ${perms.governanceRoles.map(r => GOVERNANCE_ROLE_LABELS[r]).join(', ')}`
                  : ' · No governance authority assigned'}
                ) cannot sign off governance roles directly. A Company Administrator can assign SME, Instructional Designer, or Compliance Authoriser permissions in Organisation Settings → Team &amp; Roles.
              </div>
            )}

            <div className="space-y-3">
              {ROLE_DEFINITIONS.map(roleDef => {
                const record = roles[roleDef.key];
                const isApproved = isRoleSignedHuman(record);
                const isRejected = record.status === 'rejected';
                const assignedList = eligibleReviewers.filter(r =>
                  r.governanceRoles.includes(roleDef.govRole)
                );
                const userAuthorisedForRole =
                  !isReadOnly &&
                  canApproveGovernanceRole(activeRole, activeGovernanceRoles, roleDef.govRole);
                const approvedOtherRole = ROLE_DEFINITIONS.find(
                  other =>
                    other.key !== roleDef.key &&
                    isRoleSignedHuman(roles[other.key]) &&
                    Boolean(currentUserId) &&
                    roles[other.key].reviewerUserId === currentUserId
                );
                const approvedByOtherUser =
                  isApproved &&
                  Boolean(currentUserId && record.reviewerUserId && record.reviewerUserId !== currentUserId);
                const isSignedByMe =
                  isApproved && Boolean(currentUserId && record.reviewerUserId === currentUserId);
                const isBusy = govBusyRole === roleDef.govRole;

                return (
                  <div
                    key={roleDef.key}
                    className={`p-4 rounded-lg border space-y-2.5 ${
                      isApproved
                        ? 'bg-emerald-50/50 border-emerald-200'
                        : isRejected
                        ? 'bg-red-50/50 border-red-200'
                        : 'bg-surface border-slate-200'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold text-primary">{roleDef.title}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${
                              isApproved
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                : isRejected
                                ? 'bg-red-100 text-red-800 border-red-300'
                                : 'bg-white text-slate-600 border-slate-300'
                            }`}
                          >
                            {isApproved ? 'Approved' : isRejected ? 'Revision Flagged' : 'Pending'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500">{roleDef.scope}</div>
                        <div className="text-[11px] text-slate-600">
                          <strong>Authorised Team Reviewers:</strong>{' '}
                          {assignedList.length > 0
                            ? assignedList.map(r => r.fullName).join(', ')
                            : 'None assigned yet in Team & Roles'}
                        </div>
                      </div>

                      {!isCompleted && !isReadOnly && (
                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          {isSignedByMe ? (
                            <button
                              type="button"
                              disabled={govBusyRole !== null}
                              onClick={() => void handleRevokeGovernanceDecision(roleDef.key)}
                              className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:border-red-400 text-slate-700 hover:text-red-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                              {isBusy ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="w-3.5 h-3.5" />
                              )}
                              <span>Revoke My Approval</span>
                            </button>
                          ) : userAuthorisedForRole ? (
                            <>
                              <button
                                type="button"
                                disabled={
                                  govBusyRole !== null ||
                                  Boolean(approvedOtherRole) ||
                                  approvedByOtherUser
                                }
                                onClick={() =>
                                  void handleSubmitGovernanceDecision(roleDef.key, 'approved')
                                }
                                className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-dark disabled:opacity-45 text-primary-contrast border-b-2 border-accent text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                              >
                                {isBusy ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                                ) : (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-accent" />
                                )}
                                <span>Approve as {currentUserName || 'Authenticated Reviewer'}</span>
                              </button>
                              <button
                                type="button"
                                disabled={govBusyRole !== null || approvedByOtherUser}
                                onClick={() =>
                                  void handleSubmitGovernanceDecision(roleDef.key, 'rejected')
                                }
                                className="px-2.5 py-1.5 rounded-lg bg-white border border-red-300 hover:bg-red-50 disabled:opacity-45 text-red-700 text-xs font-bold flex items-center gap-1 cursor-pointer"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                <span>Flag Revision</span>
                              </button>
                            </>
                          ) : (
                            <span className="px-2.5 py-1 rounded bg-slate-100 border border-slate-200 text-[11px] font-semibold text-slate-600">
                              Requires {GOVERNANCE_ROLE_LABELS[roleDef.govRole]} authority
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {isApproved || isRejected ? (
                      <div className="p-2.5 bg-white border border-slate-200 rounded text-xs flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-bold text-primary">
                            {isApproved ? 'Verified Approver:' : 'Reviewed by:'}{' '}
                            {record.reviewerName}
                          </span>
                          {record.reviewerUserId && (
                            <span className="text-[11px] text-slate-500 ml-2 font-mono">
                              Account {record.reviewerUserId.slice(0, 8)}
                            </span>
                          )}
                          {record.notes && (
                            <div className="text-[11px] text-slate-600 mt-0.5">
                              Notes: {record.notes}
                            </div>
                          )}
                        </div>
                        {record.signedOffAt && (
                          <span className="text-[11px] text-slate-500 tabular-nums">
                            {new Date(record.signedOffAt).toLocaleString('en-ZA')}
                          </span>
                        )}
                      </div>
                    ) : userAuthorisedForRole && !isCompleted && !isReadOnly ? (
                      <div className="space-y-1.5">
                        <input
                          type="text"
                          disabled={govBusyRole !== null || Boolean(approvedOtherRole)}
                          value={roleNotes[roleDef.key]}
                          onChange={e =>
                            setRoleNotes(prev => ({ ...prev, [roleDef.key]: e.target.value }))
                          }
                          placeholder="Optional verification notes for audit trail..."
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded disabled:bg-slate-100"
                        />
                        {approvedOtherRole && (
                          <div className="text-[11px] text-amber-800 font-medium">
                            Three-person governance rule: you already approved{' '}
                            <strong>{approvedOtherRole.title}</strong> on this course, so a different reviewer must approve this role.
                          </div>
                        )}
                      </div>
                    ) : null}

                    {approvedByOtherUser && !isSignedByMe && userAuthorisedForRole && !isCompleted && (
                      <div className="text-[11px] text-slate-600">
                        This gate is currently approved by <strong>{record.reviewerName}</strong>. Only that reviewer may revoke their approval.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {serverApprovals.length > 0 && (
              <div className="text-[11px] text-slate-500">
                Active database audit records synced: {serverApprovals.filter(a => a.active).length} role approval(s).
              </div>
            )}

            <div className="space-y-3 pt-2 border-t border-slate-100">
              {/* Release Gate Checklist */}
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span
                  className={`px-2 py-1 rounded border font-semibold ${
                    !isQaStale
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-amber-50 border-amber-200 text-amber-800'
                  }`}
                >
                  {!isQaStale ? '✓ QA Up-to-Date' : '⟳ QA Outdated (Re-run)'}
                </span>
                <span
                  className={`px-2 py-1 rounded border font-semibold ${
                    activeBlockingErrors.length === 0 && qa.verdict !== 'FAIL'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-red-50 border-red-200 text-red-800'
                  }`}
                >
                  {activeBlockingErrors.length === 0 && qa.verdict !== 'FAIL'
                    ? '✓ Zero Blocking Errors'
                    : `✕ ${activeBlockingErrors.length || 1} Blocking Error(s)`}
                </span>
                <span
                  className={`px-2 py-1 rounded border font-semibold ${
                    isRoleSignedHuman(roles.sme)
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-slate-50 border-slate-200 text-slate-600'
                  }`}
                >
                  {isRoleSignedHuman(roles.sme)
                    ? `✓ SME (${roles.sme.reviewerName})`
                    : '○ SME Approval Required'}
                </span>
                <span
                  className={`px-2 py-1 rounded border font-semibold ${
                    isRoleSignedHuman(roles.instructionalDesigner)
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-slate-50 border-slate-200 text-slate-600'
                  }`}
                >
                  {isRoleSignedHuman(roles.instructionalDesigner)
                    ? `✓ ID (${roles.instructionalDesigner.reviewerName})`
                    : '○ ID Approval Required'}
                </span>
                <span
                  className={`px-2 py-1 rounded border font-semibold ${
                    isRoleSignedHuman(roles.complianceAuthorizer)
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-slate-50 border-slate-200 text-slate-600'
                  }`}
                >
                  {isRoleSignedHuman(roles.complianceAuthorizer)
                    ? `✓ Compliance (${roles.complianceAuthorizer.reviewerName})`
                    : '○ Compliance Approval Required'}
                </span>
              </div>

              {releaseFeedback && (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-900 font-medium">
                  {releaseFeedback}
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <span className="text-xs text-slate-500">
                  {isCompleted
                    ? 'Course is formally completed with locked governance approvals.'
                    : isReadOnly
                    ? 'Viewer accounts cannot approve or release courses.'
                    : !perms.canPublishCourse
                    ? 'A Reviewer (or separately authorised Company Administrator) must complete formal release once all 3 distinct governance roles are approved.'
                    : isQaStale
                    ? 'Re-run Quality Assurance above so the audit reflects your latest course edits.'
                    : activeBlockingErrors.length > 0 || qa.verdict === 'FAIL'
                    ? 'Release is blocked until all blocking errors are fixed and QA re-runs.'
                    : allThreeRolesApproved
                    ? 'All blocking checks passed and 3 distinct authenticated governance reviewers approved. Ready for Stage 7 release.'
                    : signOffCheck.reason ||
                      'Three distinct authenticated human governance approvals are required before releasing this course to Stage 7.'}
                </span>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {activeBlockingErrors.length > 0 && !isReadOnly && (
                    <button
                      type="button"
                      onClick={() =>
                        onJumpToStage(activeBlockingErrors[0].stage, {
                          moduleNumber: activeBlockingErrors[0].moduleNumber,
                          reason: `${activeBlockingErrors[0].rule}: ${activeBlockingErrors[0].description}`,
                        })
                      }
                      className="px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>
                        Go Fix Blocking Issue (Stage {activeBlockingErrors[0].stage})
                      </span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {!isReadOnly && (
                    <button
                      type="button"
                      disabled={isReleaseBlocked || isCompleting}
                      onClick={() => void handleReleaseCourse()}
                      className={`px-5 py-2.5 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors ${
                        isReleaseBlocked
                          ? 'bg-slate-400 text-white cursor-not-allowed opacity-70'
                          : 'bg-primary hover:bg-primary-dark text-primary-contrast border-b-2 border-accent cursor-pointer'
                      }`}
                    >
                      {isCompleting ? (
                        <Loader2 className="w-4 h-4 animate-spin text-accent" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-accent" />
                      )}
                      <span>
                        {isCompleted
                          ? 'Continue to Stage 7 Publish'
                          : isCompleting
                          ? 'Completing & Publishing...'
                          : 'Release Course & Continue to Stage 7 Publish'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
};
