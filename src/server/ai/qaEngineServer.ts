import type {
  AIProvider,
  AlignmentFlag,
  CourseProject,
  GeneratedModuleContent,
  QACriticalFailure,
  QADimensionId,
  QADimensionResult,
  QADimensionWeight,
  QAEvaluationReport,
  QAIssueItem,
  QAVerdict,
} from '../../types.js';
import { aiRouter, extractAndParseJSON } from './aiRouter.js';
import { computeFullAlignmentReport } from '../../utils/alignmentHelpers.js';
import { runStructuralAndConsistencyAudit } from '../../utils/courseValidation.js';
import {
  EXTERNAL_VERIFICATION_LIMITATION_NOTE,
  runAccessibilityChecks,
  runTechnicalValidationChecks,
} from '../../utils/validationChecks.js';
import {
  formatFieldStatusLabel,
  getUnresolvedComplianceRequirements,
} from '../../utils/complianceGovernance.js';
import { generateUniqueId } from '../../utils/id.js';

export function computeAssessmentAlignmentFlags(project: CourseProject): AlignmentFlag[] {
  return computeFullAlignmentReport(project).flags;
}

export function detectDeterministicCriticalFailures(project: CourseProject): QACriticalFailure[] {
  const audit = runStructuralAndConsistencyAudit(project);
  return audit.blockingErrors.map(err => ({
    id: err.id,
    rule: err.rule,
    description: err.description,
    affectedSection: err.affectedSection,
    recommendedFix: err.recommendedFix,
    prioritySeverity: err.prioritySeverity || 'critical',
    verificationOrigin: err.verificationOrigin || 'automated',
    exampleExcerpt: err.exampleExcerpt,
  }));
}

function applyDeterministicDimensionCaps(
  dimId: QADimensionId,
  rawScore: number,
  params: {
    blockingErrors: QAIssueItem[];
    warnings: QAIssueItem[];
    accessibilityScore: number;
    alignmentScore: number;
    assessmentIssuesCount: number;
    durationStatus: string;
    totalSources: number;
    verifiedSources: number;
    unsupportedClaims: number;
  }
): { score: number; capReason?: string } {
  let score = Math.max(0, Math.min(100, Math.round(rawScore)));
  let capReason: string | undefined;

  const hasIdPrefix = (list: QAIssueItem[], prefix: string) =>
    list.some(i => i.id.includes(prefix));

  const capAt = (limit: number, reason: string) => {
    if (score > limit) {
      score = limit;
      capReason = reason;
    }
  };

  switch (dimId) {
    case 'regulatory_accuracy': {
      const hasCriticalReg =
        hasIdPrefix(params.blockingErrors, 'popia') ||
        hasIdPrefix(params.blockingErrors, 'pepuda') ||
        hasIdPrefix(params.blockingErrors, 'unsupported-regulated') ||
        hasIdPrefix(params.blockingErrors, 'unverified-accreditation-claim');
      const hasMissingDisclaimer = hasIdPrefix(params.warnings, 'missing-legal-disclaimer');
      const hasUnresolvedCompliance = hasIdPrefix(params.warnings, 'unresolved-compliance-fields');
      if (hasCriticalReg) {
        capAt(42, 'Score capped due to critical statutory/POPIA/PEPUDA misattributions or unverified accreditation claims.');
      } else if (hasMissingDisclaimer) {
        capAt(68, 'Score capped because legal/regulatory topics lack an educational non-legal-advice disclaimer.');
      } else if (hasUnresolvedCompliance) {
        capAt(74, 'Score capped because regulatory/accreditation requirements remain To Be Confirmed or Require SME Validation.');
      }
      break;
    }
    case 'factual_accuracy': {
      const hasUnverifiedStats = hasIdPrefix(params.warnings, 'unverified-stat');
      if (params.unsupportedClaims > 0) {
        capAt(48, 'Score capped due to explicitly tagged UNSUPPORTED factual claims.');
      } else if (hasUnverifiedStats) {
        capAt(56, 'Score capped due to unverified financial/statistical case-study claims lacking verified citations or hypothetical labels.');
      }
      break;
    }
    case 'source_credibility': {
      const emptyReg = hasIdPrefix(params.warnings, 'empty-source-register');
      const missingCit = hasIdPrefix(params.warnings, 'missing-inline-citations');
      if (emptyReg) {
        capAt(40, 'Score capped because Source Register has zero registered sources.');
      } else if (params.verifiedSources === 0 && params.totalSources > 0) {
        capAt(66, 'Score capped because registered sources have not yet been human-verified.');
      }
      if (missingCit) {
        capAt(64, 'Score capped because lessons lack inline citations tying claims to sources.');
      }
      break;
    }
    case 'technical_accuracy': {
      const hasCritTech = hasIdPrefix(params.blockingErrors, 'tech-');
      const hasWarnTech = hasIdPrefix(params.warnings, 'tech-');
      const hasTermConflict = hasIdPrefix(params.warnings, 'term-conflict');
      if (hasCritTech) {
        capAt(45, 'Score capped due to critical AI/ML conceptual misstatements (e.g., confidence calibration or SHAP causation).');
      } else if (hasWarnTech) {
        capAt(66, 'Score capped due to imprecise ML metric or statistical interval explanations.');
      } else if (hasTermConflict) {
        capAt(68, 'Score capped due to conflicting key terminology definitions across modules.');
      }
      break;
    }
    case 'assessment_quality': {
      const hasBrokenMcqKey = hasIdPrefix(params.blockingErrors, 'mcq-key');
      const hasWeakDistractors = hasIdPrefix(params.warnings, 'mcq-quality');
      const hasMissingAssGuide = hasIdPrefix(
        params.warnings,
        'missing-facilitator-separation-ass'
      );
      const hasUnconfirmedThresholds = hasIdPrefix(
        params.warnings,
        'unconfirmed-assessment-thresholds'
      );
      if (params.assessmentIssuesCount > 0 || hasBrokenMcqKey) {
        capAt(48, 'Score capped due to critical assessment weighting/pass-mark mismatch or broken MCQ answer keys.');
      } else if (hasWeakDistractors || hasMissingAssGuide) {
        capAt(68, 'Score capped due to weak MCQ distractors (<4 options or giveaways) or missing marking guides/model answers.');
      } else if (hasUnconfirmedThresholds) {
        capAt(78, 'Score capped until AI-proposed assessment weighting and final pass mark are explicitly confirmed.');
      }
      break;
    }
    case 'learning_experience': {
      const hasPedagogicalDepthDefect =
        hasIdPrefix(params.warnings, 'ped-repetition') ||
        hasIdPrefix(params.warnings, 'ped-thin-lesson') ||
        hasIdPrefix(params.warnings, 'ped-outcome-echo');
      const hasMissingFacilitatorNotes = hasIdPrefix(
        params.warnings,
        'missing-facilitator-separation'
      );
      if (hasPedagogicalDepthDefect) {
        capAt(62, 'Score capped due to cross-module repetition, thin lesson explanations/missing worked examples, or outcome echoing.');
      } else if (hasMissingFacilitatorNotes) {
        capAt(72, 'Score capped because case studies, scenarios, or assessments lack separate facilitator/marking guidance.');
      }
      break;
    }
    case 'presentation_quality': {
      const missingIntro = hasIdPrefix(params.warnings, 'missing-course-intro');
      const genericFiller = hasIdPrefix(params.warnings, 'generic-filler');
      if (missingIntro || genericFiller) {
        capAt(72, 'Score capped due to incomplete structured Course Introduction or generic AI filler phrasing.');
      }
      break;
    }
    case 'instructional_alignment':
    case 'outcomes_alignment': {
      capAt(Math.max(45, params.alignmentScore + 8), 'Aligned with deterministic 3-way alignment score.');
      break;
    }
    case 'audience_suitability': {
      if (hasIdPrefix(params.warnings, 'exec-coding')) {
        capAt(58, 'Score capped because executive/leadership learners are assigned mandatory hands-on coding tasks.');
      }
      break;
    }
    case 'curriculum_coverage': {
      if (hasIdPrefix(params.blockingErrors, 'omitted-topics') || hasIdPrefix(params.blockingErrors, 'incomplete-content')) {
        capAt(52, 'Score capped due to omitted curriculum topics or missing module content.');
      } else if (params.durationStatus === 'fail') {
        capAt(68, 'Score capped due to significant declared vs scheduled course duration mismatch.');
      }
      break;
    }
    case 'accessibility':
    case 'compliance_accessibility': {
      capAt(
        Math.max(45, params.accessibilityScore + 10),
        'Aligned with automated readability, structure, and alt-caption audit.'
      );
      break;
    }
    default:
      break;
  }

  return { score, capReason };
}

export async function evaluateCourseQAWithAI(params: {
  project: CourseProject;
  weights: QADimensionWeight[];
  provider?: AIProvider;
  model?: string;
}): Promise<QAEvaluationReport> {
  const structuralAudit = runStructuralAndConsistencyAudit(params.project);
  const alignmentReport = computeFullAlignmentReport(params.project);
  const accessibilityAudit = runAccessibilityChecks(params.project);
  const technicalValidation = runTechnicalValidationChecks(params.project);

  const safeSources = Array.isArray(params.project?.sources) ? params.project.sources : [];
  const safeCourseOutcomes = Array.isArray(params.project?.outcomes?.courseOutcomes)
    ? params.project.outcomes.courseOutcomes
    : [];
  const safeModuleOutcomes = Array.isArray(params.project?.outcomes?.moduleOutcomes)
    ? params.project.outcomes.moduleOutcomes
    : [];
  const safeAssessmentItems = Array.isArray(params.project?.assessments?.items)
    ? params.project.assessments.items
    : [];
  const safeContentModules = Array.isArray(params.project?.content?.modules)
    ? params.project.content.modules
    : [];
  const safeCurrModules = Array.isArray(params.project?.curriculum?.modules)
    ? params.project.curriculum.modules
    : [];

  // Substantive course payload (up to 800 chars/lesson + activities/case studies/assessments)
  // so the AI auditor can evaluate real accuracy, audience alignment, and tone without blind truncation.
  const compactCourseForAudit = {
    brief: {
      title: params.project?.brief?.title || '',
      code: params.project?.brief?.code || '',
      domain: params.project?.brief?.industryDomain || '',
      audience: params.project?.brief?.targetAudience || '',
      jobRoles: params.project?.brief?.targetJobRoles || '',
      level: params.project?.brief?.experienceLevel || '',
      duration: params.project?.brief?.estimatedDuration || '',
      aiMode: params.project?.brief?.aiIntegrationMode || 'optional',
      saComplianceEnabled: Boolean(params.project?.brief?.saCompliance?.enabled),
      nqfLevel: params.project?.brief?.saCompliance?.nqfLevel || 'Unspecified',
      unresolvedComplianceRequirements: getUnresolvedComplianceRequirements(params.project).map(
        r => `${r.label}: ${formatFieldStatusLabel(r.status)}`
      ),
    },
    durationValidation: structuralAudit.durationValidation,
    assessmentValidation: structuralAudit.assessmentValidation,
    sourcesCount: safeSources.length,
    sources: safeSources.map(s => ({
      title: s.title,
      authorOrOrg: s.authorOrOrganisation,
      ref: s.referenceOrUrl,
      status: s.verificationStatus,
      verifiedBy: s.verifiedBy || null,
    })),
    outcomes: [...safeCourseOutcomes, ...safeModuleOutcomes].map(o => ({
      code: o.code,
      scope: o.scope,
      verb: o.actionVerb,
      bloom: o.bloomLevel,
      statement: String(o.statement || '').slice(0, 140),
    })),
    assessmentsSummary: {
      strategySummary: String(params.project?.assessments?.strategySummary || '').slice(0, 350),
      passMark: params.project?.assessments?.passRequirementPercent ?? 70,
      declaredKnowledgeWeight: params.project?.assessments?.knowledgeWeightPercent ?? 40,
      declaredPracticalWeight: params.project?.assessments?.practicalWeightPercent ?? 60,
      thresholdsConfirmed: Boolean(params.project?.assessments?.thresholdsConfirmed),
      items: safeAssessmentItems.map(a => ({
        title: a.title,
        type: a.type,
        domain: a.assessmentDomain,
        weight: a.weightingPercent,
        durationMinutes: a.durationMinutes || null,
        promptExcerpt: String(a.promptOrQuestion || '').slice(0, 260),
        optionsCount: Array.isArray(a.options) ? a.options.length : 0,
        hasGiveawayDistractor:
          Array.isArray(a.options) &&
          a.options.some(o => /\b(all of the above|none of the above)\b/i.test(String(o || ''))),
        hasAnswer: Boolean(a.modelAnswer?.trim()),
        hasMarkingGuide: Boolean(a.markingGuide?.trim()),
        rubricCount: a.rubric?.length || 0,
      })),
    },
    courseIntroduction: params.project?.content?.courseIntroduction || null,
    alignmentSummary: {
      scorePercent: alignmentReport.scorePercent,
      untaughtOutcomes: alignmentReport.flags
        .filter(f => f.category === 'untaught_outcome')
        .map(f => f.targetId),
      unassessedOutcomes: alignmentReport.flags
        .filter(f => f.category === 'unassessed_outcome')
        .map(f => f.targetId),
    },
    accessibilityAuditSummary: {
      scorePercent: accessibilityAudit.scorePercent,
      avgSentenceWords: accessibilityAudit.averageSentenceWords,
      issues: accessibilityAudit.checks
        .filter(c => c.status !== 'pass')
        .map(c => ({ label: c.label, status: c.status, details: c.details })),
    },
    contentModules: safeContentModules.map(m => ({
      mod: m.moduleNumber,
      title: m.title,
      introExcerpt: String(m.introduction || '').slice(0, 240),
      summaryExcerpt: String(m.summary || '').slice(0, 200),
      lessons: (m.lessons || []).map(l => ({
        title: l.title,
        durationMinutes: l.durationMinutes,
        explanationExcerpt: String(l.explanation || '').slice(0, 750),
        activityExcerpt: String(l.guidedActivity || '').slice(0, 220),
        practicalExcerpt: String(l.practicalApplication || '').slice(0, 220),
        workedExamplesCount: l.workedExamples?.length || 0,
        workedExampleExcerpt: String(l.workedExamples?.[0] || '').slice(0, 220),
        keyTermsCount: l.keyTerminology?.length || 0,
        sourceClaims: (l.sourceClaims || []).slice(0, 4),
      })),
      caseStudies: (m.workplaceCaseStudies || []).map(c => ({
        title: c.title,
        backgroundExcerpt: String(c.background || '').slice(0, 380),
        hasFacilitatorNotes: Boolean(c.facilitatorNotes?.trim()),
      })),
      scenarios: (m.scenarios || []).map(s => ({
        title: s.title,
        situationExcerpt: String(s.situation || '').slice(0, 240),
        hasModelDebrief: Boolean(s.modelDebrief?.trim()),
      })),
      knowledgeChecksCount: (m.knowledgeChecks || []).length,
    })),
    deterministicBlockingErrors: structuralAudit.blockingErrors.map(e => ({
      rule: e.rule,
      prioritySeverity: e.prioritySeverity || 'critical',
      affectedSection: e.affectedSection,
      description: e.description,
    })),
    deterministicWarnings: structuralAudit.warnings.map(w => ({
      rule: w.rule,
      prioritySeverity: w.prioritySeverity || 'medium',
      affectedSection: w.affectedSection,
      description: w.description,
    })),
  };

  const res = await aiRouter.execute({
    provider: params.provider,
    model: params.model,
    responseFormat: 'json',
    temperature: 0.15,
    maxTokens: 3400,
    timeoutMs: 42000,
    systemInstruction: `You are an independent Principal Quality Assurance Auditor for eStudy South Africa.
Evaluate ALL ${params.weights.length} QA dimensions rigorously, fairly, and independently against the supplied weights.
CRITICAL RULES:
1. Do NOT allow high structural/alignment scores to inflate factual, regulatory, source credibility, technical accuracy, or executive audience scores when defects exist in those areas.
2. Honour deterministicBlockingErrors, deterministicWarnings, durationValidation, and assessmentValidation as verified automated facts. Never contradict them or hallucinate missing modules/outcomes when they exist.
3. Explicitly distinguish verification origin: never claim external statutory or empirical verification unless the Source Register shows VERIFIED status.
4. Only add aiAdditionalCriticalFailures if you detect a severe defect NOT already listed in deterministicBlockingErrors. Include prioritySeverity ("critical"|"high"), verificationOrigin ("automated"|"unverified"|"expert_review_required"), and exampleExcerpt.
Return ONLY valid JSON.`,
    prompt: `Audit this course against ALL ${params.weights.length} QA dimensions and weights:
WEIGHTS: ${JSON.stringify(params.weights)}

COURSE DATA & DETERMINISTIC AUDIT FINDINGS:
${JSON.stringify(compactCourseForAudit)}

Return JSON with ALL ${params.weights.length} dimension IDs from WEIGHTS:
{
  "dimensions": [
    {
      "id": "${params.weights[0]?.id || 'curriculum_coverage'}",
      "label": "${params.weights[0]?.label || 'Curriculum structure'}",
      "weight": ${params.weights[0]?.weight || 10},
      "score": 82,
      "findings": ["Concrete finding"],
      "supportingEvidence": ["Verified strength from course"],
      "weaknesses": ["Concrete weakness if any"],
      "affectedSections": ["Module 1"],
      "recommendedCorrections": ["Specific remediation action"]
    }
  ],
  "aiAdditionalCriticalFailures": [],
  "verdictExplanation": "Balanced executive summary covering strengths, critical/high findings, duration/assessment reconciliation, and human review obligations"
}`,
  });

  const parsed = extractAndParseJSON<any>(res.text);
  const weightMap = new Map(params.weights.map(w => [w.id, w]));

  const dimensions: QADimensionResult[] = params.weights.map(w => {
    const found = (parsed.dimensions || []).find((d: any) => d.id === w.id) || {};
    const rawScore = Number(found.score ?? 75);
    const capped = applyDeterministicDimensionCaps(w.id, rawScore, {
      blockingErrors: structuralAudit.blockingErrors,
      warnings: structuralAudit.warnings,
      accessibilityScore: accessibilityAudit.scorePercent,
      alignmentScore: alignmentReport.scorePercent,
      assessmentIssuesCount: structuralAudit.assessmentValidation.issues.length,
      durationStatus: structuralAudit.durationValidation.status,
      totalSources: structuralAudit.sourceVerificationSummary.totalSources,
      verifiedSources: structuralAudit.sourceVerificationSummary.verifiedSources,
      unsupportedClaims: structuralAudit.sourceVerificationSummary.unsupportedClaims,
    });
    const weaknesses = Array.isArray(found.weaknesses) ? [...found.weaknesses] : [];
    if (capped.capReason && !weaknesses.some(x => x.includes(capped.capReason!))) {
      weaknesses.unshift(capped.capReason);
    }
    return {
      id: w.id,
      label: weightMap.get(w.id)?.label || w.label,
      weight: w.weight,
      score: capped.score,
      findings: Array.isArray(found.findings) ? found.findings : [],
      supportingEvidence: Array.isArray(found.supportingEvidence) ? found.supportingEvidence : [],
      weaknesses,
      affectedSections: Array.isArray(found.affectedSections) ? found.affectedSections : [],
      recommendedCorrections: Array.isArray(found.recommendedCorrections) ? found.recommendedCorrections : [],
    };
  });

  const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0) || 100;
  const weightedScore = Math.round(
    dimensions.reduce((sum, d) => sum + d.score * d.weight, 0) / totalWeight
  );

  // Filter out hallucinated AI critical claims when deterministic audit proves structural/advisory separation
  const deterministicUntaughtZero =
    alignmentReport.flags.filter(f => f.category === 'untaught_outcome' || f.category === 'unassessed_outcome').length === 0;
  const deterministicContentComplete =
    safeCurrModules.length > 0 &&
    !structuralAudit.blockingErrors.some(e => e.id === 'blk-incomplete-content');

  const filteredAiCriticals: QACriticalFailure[] = (
    Array.isArray(parsed.aiAdditionalCriticalFailures) ? parsed.aiAdditionalCriticalFailures : []
  )
    .filter((c: any) => c && typeof c.description === 'string' && c.description.trim().length > 0)
    .filter((c: any) => {
      const txt = `${c.rule || ''} ${c.description || ''}`.toLowerCase();
      if (
        deterministicUntaughtZero &&
        (txt.includes('untaught') ||
          txt.includes('unassessed') ||
          txt.includes('no teaching activity') ||
          txt.includes('outcomes are not taught'))
      ) {
        return false;
      }
      if (
        deterministicContentComplete &&
        (txt.includes('missing module') || txt.includes('incomplete module content'))
      ) {
        return false;
      }
      // Avoid duplicating already-reported deterministic errors
      const alreadyTracked = structuralAudit.blockingErrors.some(
        b => b.rule.toLowerCase() === String(c.rule || '').toLowerCase()
      );
      return !alreadyTracked;
    })
    .map((c: any, idx: number) => ({
      id: c.id || `ai-crit-${Date.now()}-${idx}`,
      rule: c.rule || 'AI QA Critical Defect',
      description: c.description,
      affectedSection: c.affectedSection || 'Stage 5 · Learning Content',
      recommendedFix: c.recommendedFix || 'Review and revise affected section.',
      prioritySeverity: c.prioritySeverity === 'high' ? 'high' : 'critical',
      verificationOrigin:
        c.verificationOrigin === 'unverified' || c.verificationOrigin === 'expert_review_required'
          ? c.verificationOrigin
          : 'automated',
      exampleExcerpt: typeof c.exampleExcerpt === 'string' ? c.exampleExcerpt : undefined,
    }));

  const blockingErrors: QAIssueItem[] = [
    ...structuralAudit.blockingErrors,
    ...filteredAiCriticals.map(c => {
      const modMatch = `${c.affectedSection} ${c.description}`.match(/\b(?:Module|M)\s*(\d+)\b/i);
      const lower = `${c.rule} ${c.affectedSection}`.toLowerCase();
      const stage: 1 | 2 | 3 | 4 | 5 = lower.includes('stage 1') || lower.includes('brief')
        ? 1
        : lower.includes('stage 2') || lower.includes('curriculum')
        ? 2
        : lower.includes('stage 3') || lower.includes('outcome')
        ? 3
        : lower.includes('stage 4') || lower.includes('assessment')
        ? 4
        : 5;
      return {
        id: c.id,
        severity: 'blocking' as const,
        prioritySeverity: c.prioritySeverity || 'critical',
        verificationOrigin: c.verificationOrigin || 'automated',
        rule: c.rule,
        description: c.description,
        stage,
        moduleNumber: modMatch ? Number(modMatch[1]) : undefined,
        affectedSection: c.affectedSection,
        exampleExcerpt: c.exampleExcerpt,
        recommendedFix: c.recommendedFix,
      };
    }),
  ];

  const deterministicCriticalFailures = detectDeterministicCriticalFailures(params.project);
  const combinedCritical: QACriticalFailure[] = [
    ...deterministicCriticalFailures,
    ...filteredAiCriticals,
  ];

  const allIssues: QAIssueItem[] = [
    ...blockingErrors,
    ...structuralAudit.warnings,
    ...structuralAudit.informationalFeedback,
  ];
  const highSeverityCount = structuralAudit.warnings.filter(w => w.prioritySeverity === 'high').length;

  // Strict Verdict Rule: unresolved critical/blocking issues NEVER allow PASS or PASS WITH RECOMMENDATIONS
  let verdict: QAVerdict = 'PASS';
  if (blockingErrors.length > 0 || weightedScore < 55) {
    verdict = 'FAIL';
  } else if (weightedScore < 75 || dimensions.some(d => d.score < 60) || highSeverityCount > 0) {
    verdict = 'REVISION REQUIRED';
  } else if (
    weightedScore < 90 ||
    structuralAudit.warnings.length > 0 ||
    dimensions.some(d => d.weaknesses.length > 0)
  ) {
    verdict = 'PASS WITH RECOMMENDATIONS';
  }

  const baseExplanation =
    parsed.verdictExplanation ||
    `Weighted QA score is ${weightedScore}% across ${dimensions.length} quality assurance dimensions.`;
  const overrideNote =
    blockingErrors.length > 0
      ? ` Verdict set to FAIL due to ${blockingErrors.length} unresolved critical/blocking defect(s) that must be fixed before release.`
      : highSeverityCount > 0
      ? ` Verdict set to REVISION REQUIRED due to ${highSeverityCount} high-priority quality or evidence warning(s).`
      : structuralAudit.warnings.length > 0
      ? ` Zero critical errors remain; ${structuralAudit.warnings.length} advisory warning(s) remain for quality polish.`
      : '';

  const verificationSummary = {
    automatedCount: allIssues.filter(i => (i.verificationOrigin || 'automated') === 'automated').length,
    externalVerifiedCount: structuralAudit.sourceVerificationSummary.verifiedSources,
    unverifiedCount: allIssues.filter(i => i.verificationOrigin === 'unverified').length,
    expertReviewRequiredCount: allIssues.filter(
      i => i.verificationOrigin === 'expert_review_required'
    ).length,
    externalVerificationNote: EXTERNAL_VERIFICATION_LIMITATION_NOTE,
  };

  const humanReviewRequirements: string[] = [];
  if (structuralAudit.sourceVerificationSummary.pendingSources > 0 || structuralAudit.sourceVerificationSummary.totalSources === 0) {
    humanReviewRequirements.push(
      'Source Authority Verification: A subject-matter reviewer must verify primary sources, URLs, and publication dates in the Source Register.'
    );
  }
  if (allIssues.some(i => i.id.includes('popia') || i.id.includes('pepuda') || i.id.includes('legal'))) {
    humanReviewRequirements.push(
      'Legal & Regulatory Review: Qualified South African legal/compliance counsel must confirm POPIA, PEPUDA, and sectoral regulatory interpretations.'
    );
  }
  if (technicalValidation.needsReviewClaimsCount > 0 || technicalValidation.unsupportedClaimsCount > 0) {
    humanReviewRequirements.push(
      'Subject-Matter Expert (SME) Validation: Review flagged technical/AI claims marked NEEDS REVIEW or UNSUPPORTED.'
    );
  }
  const unresolvedGov = getUnresolvedComplianceRequirements(params.project);
  if (unresolvedGov.length > 0) {
    humanReviewRequirements.push(
      `Client / Stakeholder Confirmation Required: Resolve ${unresolvedGov.length} unconfirmed governance requirement(s) — ${unresolvedGov
        .map(u => `${u.label} (${formatFieldStatusLabel(u.status)})`)
        .join('; ')}.`
    );
  }
  humanReviewRequirements.push(
    'Assistive-Technology Accessibility Audit: Human verification of colour contrast, keyboard navigation, and screen-reader tagging in exported documents/LMS.'
  );

  return {
    id: generateUniqueId('qa'),
    evaluatedAt: new Date().toISOString(),
    evaluatedDataSignature: structuralAudit.dataSignature,
    weights: params.weights,
    dimensions,
    weightedScore,
    criticalFailures: combinedCritical,
    blockingErrors,
    warnings: structuralAudit.warnings,
    informationalFeedback: structuralAudit.informationalFeedback,
    verdict,
    verdictExplanation: `${baseExplanation}${overrideNote}`,
    accessibilityAudit,
    technicalValidation,
    durationValidation: structuralAudit.durationValidation,
    assessmentValidation: structuralAudit.assessmentValidation,
    sourceVerificationSummary: structuralAudit.sourceVerificationSummary,
    verificationSummary,
    humanReviewRequirements,
    humanSignOff: {
      signedOff: false,
      reviewerName: '',
      roles: {
        sme: {
          signedOff: false,
          reviewerName: '',
          governanceRole: 'sme',
          status: 'pending',
        },
        instructionalDesigner: {
          signedOff: false,
          reviewerName: '',
          governanceRole: 'instructional_designer',
          status: 'pending',
        },
        complianceAuthorizer: {
          signedOff: false,
          reviewerName: '',
          governanceRole: 'compliance_authorizer',
          status: 'pending',
        },
      },
    },
  };
}

/**
 * Guided, structure-preserving QA remediation:
 * Repairs assessment weightings, reconciles duration budgets without regenerating modules
 * from scratch, and applies surgical AI improvements to flagged modules for SA regulatory
 * precision, unverified case-study disclaimers, ML technical accuracy, executive audience
 * alignment, inline citations, and educational legal disclaimers.
 */
export async function remediateCourseQualityWithAI(params: {
  project: CourseProject;
  provider?: AIProvider;
  model?: string;
}): Promise<{
  updatedProject: CourseProject;
  changesSummary: string[];
}> {
  const audit = runStructuralAndConsistencyAudit(params.project);
  const allFindings = [...audit.blockingErrors, ...audit.warnings];
  const changesSummary: string[] = [];

  // Deep clone project safely
  let nextProject: CourseProject = JSON.parse(JSON.stringify(params.project));

  // 1. Deterministically reconcile Assessment Weightings (strict 100% total + domain split)
  const items = nextProject.assessments?.items || [];
  if (items.length > 0 && audit.assessmentValidation.issues.length > 0) {
    const targetKnowledge = Number(nextProject.assessments.knowledgeWeightPercent) || 40;
    const targetPractical = 100 - targetKnowledge;
    nextProject.assessments.knowledgeWeightPercent = targetKnowledge;
    nextProject.assessments.practicalWeightPercent = targetPractical;

    const kItems = items.filter(it => it.assessmentDomain === 'knowledge');
    const pItems = items.filter(it => it.assessmentDomain === 'practical');

    const rebalanceDomain = (domainItems: typeof items, domainTarget: number) => {
      if (domainItems.length === 0 || domainTarget <= 0) return;
      const base = Math.floor(domainTarget / domainItems.length);
      let remainder = domainTarget - base * domainItems.length;
      for (const it of domainItems) {
        it.weightingPercent = base + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;
      }
    };

    if (kItems.length > 0 && pItems.length > 0) {
      rebalanceDomain(kItems, targetKnowledge);
      rebalanceDomain(pItems, targetPractical);
    } else {
      rebalanceDomain(items, 100);
      nextProject.assessments.knowledgeWeightPercent = kItems.length > 0 ? 100 : 0;
      nextProject.assessments.practicalWeightPercent = pItems.length > 0 ? 100 : 0;
    }

    // Ensure assessment durationMinutes are populated
    for (const it of items) {
      if (!it.durationMinutes || it.durationMinutes <= 0) {
        it.durationMinutes = it.assessmentDomain === 'practical' ? 35 : 20;
      }
    }

    const passMark = Number(nextProject.assessments.passRequirementPercent) || 70;
    nextProject.assessments.strategySummary = `Balanced assessment strategy combining ${nextProject.assessments.knowledgeWeightPercent}% knowledge evaluation and ${nextProject.assessments.practicalWeightPercent}% practical application (total 100%), with a minimum pass threshold of ${passMark}%.`;
    changesSummary.push(
      `Reconciled Stage 4 assessment weights (${nextProject.assessments.knowledgeWeightPercent}% knowledge / ${nextProject.assessments.practicalWeightPercent}% practical = 100%) and aligned strategy summary with ${passMark}% pass mark.`
    );
  }

  // 2. Deterministically reconcile duration budget if declaredHours exists and variance > 10%
  if (audit.durationValidation.declaredMinutes && audit.durationValidation.status !== 'aligned') {
    const targetMin = audit.durationValidation.declaredMinutes;
    const assessMin = (nextProject.assessments?.items || []).reduce(
      (s, it) => s + (Number(it.durationMinutes) || 0),
      0
    );
    const targetLessonMin = Math.max(60, targetMin - assessMin);
    const currLessons = (nextProject.curriculum?.modules || []).flatMap(m => m.lessons || []);
    const genLessons = (nextProject.content?.modules || []).flatMap(m => m.lessons || []);
    const activeCount = genLessons.length || currLessons.length;
    if (activeCount > 0) {
      const perLesson = Math.max(15, Math.floor(targetLessonMin / activeCount));
      let rem = targetLessonMin - perLesson * activeCount;
      const lessonDurationMap = new Map<string, number>();

      const sourceLessons = currLessons.length > 0 ? currLessons : genLessons;
      sourceLessons.forEach(l => {
        const mins = perLesson + (rem > 0 ? 1 : 0);
        if (rem > 0) rem--;
        lessonDurationMap.set(l.id, mins);
        l.durationMinutes = mins;
      });
      for (const gl of genLessons) {
        const mapped = (gl.lessonPlanId && lessonDurationMap.get(gl.lessonPlanId)) || lessonDurationMap.get(gl.id);
        if (mapped) {
          gl.durationMinutes = mapped;
        } else if (currLessons.length > 0) {
          gl.durationMinutes = perLesson;
        }
      }
      changesSummary.push(
        `Reconciled lesson + assessment timings to match declared ${nextProject.brief.estimatedDuration} (${targetMin} min total: ${targetLessonMin} min lessons + ${assessMin} min assessments).`
      );
    }
  }

  // 3. Targeted AI remediation on affected content modules (preserving existing modules/lessons/structure)
  const modList = nextProject.content?.modules || [];
  const isExecutive = /\b(executive|ceo|cfo|coo|cto|c-suite|board|director|senior decision[- ]maker)\b/i.test(
    `${nextProject.brief?.title || ''} ${nextProject.brief?.targetAudience || ''} ${nextProject.brief?.targetJobRoles || ''}`
  );

  const modulesNeedingPolish = modList.filter(cm =>
    allFindings.some(f => f.moduleNumber === cm.moduleNumber || f.stage === 5)
  );

  for (const mod of modulesNeedingPolish) {
    const modFindings = allFindings.filter(
      f => f.moduleNumber === mod.moduleNumber || (!f.moduleNumber && f.stage === 5)
    );
    if (modFindings.length === 0) continue;

    const res = await aiRouter.execute({
      provider: params.provider,
      model: params.model,
      responseFormat: 'json',
      temperature: 0.15,
      maxTokens: 5500,
      timeoutMs: 45000,
      systemInstruction: `You are performing a surgical Quality & Compliance Remediation on Module ${mod.moduleNumber} of "${nextProject.brief.title}".
PRESERVATION RULES:
- DO NOT remove, rename, or replace lessons, case studies, or scenarios. Retain all valid content.
- ONLY apply targeted corrections for the flagged defects:
  1. POPIA (Act 4 of 2013): Fix wrong sections (s8 Accountability; s11(1)(a)-(f) 6 lawful grounds — consent is NOT the sole ground; s16 Information Quality; s19-22 Security Safeguards; s23-25 Data Subject Participation; s71 Automated Decision-Making).
  2. PEPUDA exact title: "Promotion of Equality and Prevention of Unfair Discrimination Act 4 of 2000". Include educational non-legal-advice disclaimer if legal duties are discussed.
  3. Unverified claims/ZAR figures/percentages (e.g. bank reducing false positives by 40% / R12m / R25m platinum mine): NEVER invent real citations; explicitly label them "Illustrative hypothetical scenario (not empirical data)".
  4. ML Technical Accuracy: Clarify model confidence requires calibration; AUC > 0.8 depends on threshold/prevalence/error costs; separate confidence intervals from prediction intervals/model uncertainty; SHAP explains feature contribution, NOT causation.
  5. ${isExecutive ? 'Executive Audience: Convert any mandatory Python/Pandas/Fairlearn/coding tasks into executive governance interpretation, risk evaluation, and vendor interrogation exercises.' : 'Keep activities aligned to learner role.'}
  6. Add plain-text alt descriptions ("This diagram illustrates...") for any referenced visual/diagram and cite registered sources inline where applicable.
Return ONLY valid JSON matching the exact module lessons/caseStudies/scenarios structure supplied.`,
      prompt: `FLAGGED QA ISSUES FOR MODULE ${mod.moduleNumber}:
${JSON.stringify(modFindings.map(f => ({ rule: f.rule, section: f.affectedSection, fix: f.recommendedFix, excerpt: f.exampleExcerpt })))}

REGISTERED SOURCES:
${JSON.stringify((nextProject.sources || []).map((s, idx) => ({ ref: `Source ${idx + 1}`, title: s.title, org: s.authorOrOrganisation, status: s.verificationStatus })))}

CURRENT MODULE DATA (preserve IDs, titles, counts):
${JSON.stringify({
  introduction: mod.introduction,
  summary: mod.summary,
  lessons: (mod.lessons || []).map(l => ({
    id: l.id,
    title: l.title,
    explanation: l.explanation,
    practicalApplication: l.practicalApplication,
    guidedActivity: l.guidedActivity,
    workedExamples: l.workedExamples,
  })),
  workplaceCaseStudies: (mod.workplaceCaseStudies || []).map(c => ({
    id: c.id,
    title: c.title,
    background: c.background,
    facilitatorNotes: c.facilitatorNotes,
  })),
  scenarios: (mod.scenarios || []).map(s => ({
    id: s.id,
    title: s.title,
    situation: s.situation,
    challenge: s.challenge,
    decisionPrompt: s.decisionPrompt,
    modelDebrief: s.modelDebrief,
  })),
})}

Return JSON:
{
  "introduction": "...",
  "summary": "...",
  "lessons": [{ "id": "...", "explanation": "...", "practicalApplication": "...", "guidedActivity": "...", "workedExamples": ["..."] }],
  "workplaceCaseStudies": [{ "id": "...", "background": "...", "facilitatorNotes": "..." }],
  "scenarios": [{ "id": "...", "situation": "...", "challenge": "...", "decisionPrompt": "...", "modelDebrief": "..." }],
  "appliedFixes": ["Short summary of what changed"]
}`,
    });

    try {
      const patched = extractAndParseJSON<any>(res.text);
      if (typeof patched.introduction === 'string' && patched.introduction.trim()) {
        mod.introduction = patched.introduction;
      }
      if (typeof patched.summary === 'string' && patched.summary.trim()) {
        mod.summary = patched.summary;
      }
      if (Array.isArray(patched.lessons)) {
        for (const pl of patched.lessons) {
          const orig = mod.lessons.find(l => l.id === pl.id);
          if (orig) {
            if (typeof pl.explanation === 'string' && pl.explanation.trim()) orig.explanation = pl.explanation;
            if (typeof pl.practicalApplication === 'string' && pl.practicalApplication.trim()) orig.practicalApplication = pl.practicalApplication;
            if (typeof pl.guidedActivity === 'string' && pl.guidedActivity.trim()) orig.guidedActivity = pl.guidedActivity;
            if (Array.isArray(pl.workedExamples) && pl.workedExamples.length > 0) orig.workedExamples = pl.workedExamples;
          }
        }
      }
      if (Array.isArray(patched.workplaceCaseStudies)) {
        for (const pc of patched.workplaceCaseStudies) {
          const orig = (mod.workplaceCaseStudies || []).find(c => c.id === pc.id);
          if (orig) {
            if (typeof pc.background === 'string' && pc.background.trim()) orig.background = pc.background;
            if (typeof pc.facilitatorNotes === 'string' && pc.facilitatorNotes.trim()) orig.facilitatorNotes = pc.facilitatorNotes;
          }
        }
      }
      if (Array.isArray(patched.scenarios)) {
        for (const ps of patched.scenarios) {
          const orig = (mod.scenarios || []).find(s => s.id === ps.id);
          if (orig) {
            if (typeof ps.situation === 'string' && ps.situation.trim()) orig.situation = ps.situation;
            if (typeof ps.challenge === 'string' && ps.challenge.trim()) orig.challenge = ps.challenge;
            if (typeof ps.decisionPrompt === 'string' && ps.decisionPrompt.trim()) orig.decisionPrompt = ps.decisionPrompt;
            if (typeof ps.modelDebrief === 'string' && ps.modelDebrief.trim()) orig.modelDebrief = ps.modelDebrief;
          }
        }
      }
      if (Array.isArray(patched.appliedFixes)) {
        for (const note of patched.appliedFixes) {
          changesSummary.push(`Module ${mod.moduleNumber}: ${note}`);
        }
      } else {
        changesSummary.push(`Module ${mod.moduleNumber}: Applied targeted compliance, factual, technical, and audience remediation.`);
      }
    } catch {
      changesSummary.push(`Module ${mod.moduleNumber}: Skipped AI patch due to response parsing fallback; deterministic fixes still applied.`);
    }
  }

  // Ensure educational non-legal-advice disclaimer exists in Module 1 intro if legal statutes appear
  const firstMod = modList[0] as GeneratedModuleContent | undefined;
  const fullCorpus = modList.map(m => `${m.introduction} ${m.lessons.map(l => l.explanation).join(' ')}`).join(' ');
  if (
    firstMod &&
    /\b(POPIA|PEPUDA|Cybercrimes Act|FAIS|FICA|Act\s+\d+\s+of\s+\d{4})\b/i.test(fullCorpus) &&
    !/\bdoes not constitute (?:formal )?legal advice\b/i.test(fullCorpus)
  ) {
    firstMod.introduction = `${firstMod.introduction.trim()}\n\n*Educational Guidance Disclaimer: Regulatory and legislative discussions in this programme are provided for executive education only and do not constitute formal legal advice; organisations should consult qualified South African legal counsel for compliance sign-off.*`;
    changesSummary.push('Added explicit educational non-legal-advice disclaimer to Module 1 overview.');
  }

  nextProject.updatedAt = new Date().toISOString();
  return {
    updatedProject: nextProject,
    changesSummary:
      changesSummary.length > 0
        ? changesSummary
        : ['Course checked; deterministic weights and metadata are already reconciled.'],
  };
}
