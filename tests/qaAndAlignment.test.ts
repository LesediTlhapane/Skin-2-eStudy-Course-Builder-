import { describe, expect, it } from 'vitest';
import { computeFullAlignmentReport } from '../src/utils/alignmentHelpers.js';
import { runStructuralAndConsistencyAudit } from '../src/utils/courseValidation.js';
import {
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
  buildGenuineHumanSignOff,
  buildSampleCourseProject,
  buildSampleQAReport,
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

  it('identifies AI placeholder reviewer names and requires 3 distinct human governance sign-offs', () => {
    expect(isAiPlaceholderReviewerName('AI QA Auto-Sign-Off (Provisional)')).toBe(true);
    expect(isAiPlaceholderReviewerName('Pending Human Review')).toBe(true);
    expect(isAiPlaceholderReviewerName('Dr. Thabo Mokoena')).toBe(false);

    const missingResult = hasGenuineHumanGovernanceSignOff({
      signedOff: true,
      reviewerName: 'Nomsa Dlamini',
    });
    expect(missingResult.valid).toBe(false);

    const genuineResult = hasGenuineHumanGovernanceSignOff(buildGenuineHumanSignOff());
    expect(genuineResult.valid).toBe(true);

    const adminCompletion = validateCourseGovernanceMutation({
      actorRole: 'company_admin',
      incomingProject: buildSampleCourseProject({
        lifecycleStatus: 'completed',
        latestQA: buildSampleQAReport({ humanSignOff: buildGenuineHumanSignOff() }),
      }),
      existingProject: buildSampleCourseProject({ lifecycleStatus: 'awaiting_review' }),
    });
    expect(adminCompletion).toEqual({ ok: true });
  });
});
