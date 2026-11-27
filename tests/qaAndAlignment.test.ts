import { describe, expect, it } from 'vitest';
import { computeFullAlignmentReport } from '../src/utils/alignmentHelpers.js';
import { runStructuralAndConsistencyAudit } from '../src/utils/courseValidation.js';
import {
  getRolePermissions,
  hasGenuineHumanGovernanceSignOff,
  isAiPlaceholderReviewerName,
  validateCourseGovernanceMutation,
} from '../src/utils/rbac.js';
import {
  computeAssessmentValidation,
  computeDurationValidation,
  runDomainQualityChecks,
} from '../src/utils/validationChecks.js';
import {
  detectUnsupportedComplianceClaims,
  getTrackedComplianceRequirements,
} from '../src/utils/complianceGovernance.js';
import {
  buildGenuineHumanSignOff,
  buildSampleCourseProject,
  buildSampleQAReport,
  COMPANY_A_ID,
  COMPANY_B_ID,
} from './helpers/testFixtures.js';

describe('QA, Regulatory Alignment & Governance Validation Regressions', () => {
  it('handles missing or undefined outcomeIds on lessons and assessments without throwing', () => {
    const project = buildSampleCourseProject();
    // Simulate legacy imported data with undefined outcomeIds
    (project.curriculum.modules[0].lessons[0] as any).outcomeIds = undefined;
    (project.content.modules[0].lessons[0] as any).outcomeIds = undefined;
    (project.assessments.items[0] as any).outcomeIds = undefined;

    expect(() => computeFullAlignmentReport(project)).not.toThrow();
    const report = computeFullAlignmentReport(project);
    expect(report.rows.length).toBeGreaterThan(0);
    expect(typeof report.scorePercent).toBe('number');
  });

  it('passes aligned POPIA course through structural, duration, assessment, and domain QA checks', () => {
    const project = buildSampleCourseProject();
    const assessmentCheck = computeAssessmentValidation(project);
    expect(assessmentCheck.status).toBe('aligned');
    expect(assessmentCheck.issues).toEqual([]);

    const durationCheck = computeDurationValidation(project);
    expect(durationCheck.status).toBe('aligned');

    const audit = runStructuralAndConsistencyAudit(project);
    expect(audit.blockingErrors).toEqual([]);
  });

  it('flags inaccurate POPIA consent-only statements in domain quality checks', () => {
    const project = buildSampleCourseProject();
    project.content.modules[0].lessons[0].explanation =
      'Under POPIA, consent is the only lawful basis for processing personal information in South Africa.';

    const domainAudit = runDomainQualityChecks(project);
    const hasConsentWarning = domainAudit.issues.some(i =>
      `${i.rule} ${i.description}`.toLowerCase().includes('consent')
    );
    expect(hasConsentWarning).toBe(true);
  });

  it('enforces identity-bound 3-person human governance approvals and aligned RBAC permissions', () => {
    expect(isAiPlaceholderReviewerName('AI QA Auto-Sign-Off (Provisional)')).toBe(true);
    expect(isAiPlaceholderReviewerName('Pending Human Review')).toBe(true);
    expect(isAiPlaceholderReviewerName('Dr. Thabo Mokoena')).toBe(false);

    const missingResult = hasGenuineHumanGovernanceSignOff({
      signedOff: true,
      reviewerName: 'Nomsa Dlamini',
    });
    expect(missingResult.valid).toBe(false);

    // Rejects same userId signing off multiple governance roles (three-person rule)
    const duplicateUserSignOff = buildGenuineHumanSignOff();
    duplicateUserSignOff!.roles!.instructionalDesigner!.reviewerUserId = 'user-sme-a';
    const sameUserCheck = hasGenuineHumanGovernanceSignOff(duplicateUserSignOff, {
      companyId: COMPANY_A_ID,
      courseId: 'course-1',
    });
    expect(sameUserCheck.valid).toBe(false);
    expect(sameUserCheck.reason).toMatch(/three-person/i);

    // Rejects cross-company scoped approval
    const wrongCompanyCheck = hasGenuineHumanGovernanceSignOff(buildGenuineHumanSignOff(), {
      companyId: COMPANY_B_ID,
      courseId: 'course-1',
    });
    expect(wrongCompanyCheck.valid).toBe(false);

    const genuineResult = hasGenuineHumanGovernanceSignOff(buildGenuineHumanSignOff(), {
      companyId: COMPANY_A_ID,
      courseId: 'course-1',
    });
    expect(genuineResult.valid).toBe(true);

    // RBAC permission alignment checks
    const reviewerPerms = getRolePermissions('reviewer', []);
    expect(reviewerPerms.canUploadSource).toBe(false);
    expect(reviewerPerms.canCreateOrDeleteCourse).toBe(false);
    expect(reviewerPerms.canManageTemplates).toBe(false);
    expect(reviewerPerms.canEditCourse).toBe(true);
    expect(reviewerPerms.canApproveGovernance).toBe(false);
    expect(reviewerPerms.canPublishCourse).toBe(true);

    const unassignedAdminPerms = getRolePermissions('company_admin', []);
    expect(unassignedAdminPerms.canApproveGovernance).toBe(false);
    expect(unassignedAdminPerms.canPublishCourse).toBe(false);

    const authorisedAdminPerms = getRolePermissions('company_admin', ['sme']);
    expect(authorisedAdminPerms.canApproveGovernance).toBe(true);
    expect(authorisedAdminPerms.canPublishCourse).toBe(true);

    // Unassigned company_admin cannot complete course even if server holds 3 approvals -> 403
    const authoritativeSignOff = buildGenuineHumanSignOff();
    const existingWithApprovals = buildSampleCourseProject({
      lifecycleStatus: 'awaiting_review',
      latestQA: buildSampleQAReport({ humanSignOff: authoritativeSignOff }),
    });
    const unassignedAdminCompletion = validateCourseGovernanceMutation({
      actorRole: 'company_admin',
      actorGovernanceRoles: [],
      incomingProject: buildSampleCourseProject({
        lifecycleStatus: 'completed',
        latestQA: buildSampleQAReport({ humanSignOff: authoritativeSignOff }),
      }),
      existingProject: existingWithApprovals,
    });
    expect(unassignedAdminCompletion.ok).toBe(false);
    if (unassignedAdminCompletion.ok === false) {
      expect(unassignedAdminCompletion.status).toBe(403);
    }

    // Separately authorised company_admin CAN complete course when server holds all 3 distinct approvals
    const adminCompletion = validateCourseGovernanceMutation({
      actorRole: 'company_admin',
      actorGovernanceRoles: ['compliance_authorizer'],
      incomingProject: buildSampleCourseProject({
        lifecycleStatus: 'completed',
        latestQA: buildSampleQAReport({ humanSignOff: authoritativeSignOff }),
      }),
      existingProject: existingWithApprovals,
    });
    expect(adminCompletion).toEqual({ ok: true });
  });

  it('prevents unverified accreditation claims, defaults non-financial courses to Financial Literacy Not Applicable, and flags unconfirmed Stage 4 thresholds', () => {
    const project = buildSampleCourseProject();
    // 1. Non-financial course defaults Financial Literacy Benchmark to not_applicable
    const trackedDefault = getTrackedComplianceRequirements(project);
    const finReq = trackedDefault.find(r => r.key === 'financialLiteracyBenchmark');
    expect(finReq?.status).toBe('not_applicable');

    // 2. Unverified accreditation assertion with no verified source triggers blocking issue
    project.sources = [];
    project.brief.fieldStatuses = {
      ...project.brief.fieldStatuses,
      setaSaqaQcto: 'requires_sme_validation',
    };
    project.content.modules[0].lessons[0].explanation =
      'This course is formally accredited by SAQA under SAQA unit standard 115432 and carries 12 NQF credits.';
    // Also inject an unrequested Financial Literacy benchmark reference
    project.content.modules[0].lessons[0].practicalApplication =
      'Compare results against the Financial Literacy benchmark.';
    // Unconfirm Stage 4 thresholds
    project.assessments.thresholdsConfirmed = false;

    const complianceIssues = detectUnsupportedComplianceClaims(project);
    expect(complianceIssues.some(i => i.id === 'blk-unverified-accreditation-claim' && i.severity === 'blocking')).toBe(true);
    expect(complianceIssues.some(i => i.id === 'warn-inapplicable-financial-benchmark')).toBe(true);
    expect(complianceIssues.some(i => i.id === 'warn-unconfirmed-assessment-thresholds')).toBe(true);

    // Confirming thresholds clears warn-unconfirmed-assessment-thresholds
    project.assessments.thresholdsConfirmed = true;
    const afterConfirm = detectUnsupportedComplianceClaims(project);
    expect(afterConfirm.some(i => i.id === 'warn-unconfirmed-assessment-thresholds')).toBe(false);
  });
});
