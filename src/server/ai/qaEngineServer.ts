import type {
  AIProvider,
  AlignmentFlag,
  CourseProject,
  QACriticalFailure,
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
  runAccessibilityChecks,
  runTechnicalValidationChecks,
} from '../../utils/validationChecks.js';

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
  }));
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

  const deterministicCriticalFailures: QACriticalFailure[] = structuralAudit.blockingErrors.map(
    err => ({
      id: err.id,
      rule: err.rule,
      description: err.description,
      affectedSection: err.affectedSection,
      recommendedFix: err.recommendedFix,
    })
  );

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

  // Build complete non-truncated structural summary so the AI auditor never
  // hallucinates missing outcomes/modules/assessments due to array slicing.
  const compactCourseForAudit = {
    brief: {
      title: params.project?.brief?.title || '',
      code: params.project?.brief?.code || '',
      domain: params.project?.brief?.industryDomain || '',
      audience: params.project?.brief?.targetAudience || '',
      level: params.project?.brief?.experienceLevel || '',
      duration: params.project?.brief?.estimatedDuration || '',
      aiMode: params.project?.brief?.aiIntegrationMode || 'optional',
      saComplianceEnabled: Boolean(params.project?.brief?.saCompliance?.enabled),
      nqfLevel: params.project?.brief?.saCompliance?.nqfLevel || 'Unspecified',
    },
    sourcesCount: safeSources.length,
    sources: safeSources.map(s => ({
      title: s.title,
      status: s.verificationStatus,
      verifiedBy: s.verifiedBy || null,
    })),
    coverageGaps: (params.project?.curriculum?.coverageChecks || [])
      .filter(c => c.status !== 'mapped')
      .map(c => ({ topic: c.originalTopic, status: c.status })),
    outcomesCount: safeCourseOutcomes.length + safeModuleOutcomes.length,
    outcomes: [...safeCourseOutcomes, ...safeModuleOutcomes].map(o => ({
      code: o.code,
      scope: o.scope,
      verb: o.actionVerb,
      bloom: o.bloomLevel,
      statement: String(o.statement || '').slice(0, 90),
    })),
    assessmentsSummary: {
      total: safeAssessmentItems.length,
      passMark: params.project?.assessments?.passRequirementPercent ?? 70,
      knowledgeCount: safeAssessmentItems.filter(a => a.assessmentDomain === 'knowledge').length,
      practicalCount: safeAssessmentItems.filter(a => a.assessmentDomain === 'practical').length,
      items: safeAssessmentItems.map(a => ({
        title: a.title,
        type: a.type,
        domain: a.assessmentDomain,
        outcomeCount: Array.isArray(a.outcomeIds) ? a.outcomeIds.length : 0,
        hasAnswer: Boolean(a.modelAnswer?.trim()),
        rubricCount: a.rubric?.length || 0,
      })),
    },
    alignmentSummary: {
      scorePercent: alignmentReport.scorePercent,
      untaughtOutcomes: alignmentReport.flags
        .filter(f => f.category === 'untaught_outcome')
        .map(f => f.targetId),
      unassessedOutcomes: alignmentReport.flags
        .filter(f => f.category === 'unassessed_outcome')
        .map(f => f.targetId),
      warningCount: alignmentReport.flags.filter(f => f.severity !== 'critical').length,
    },
    accessibilityAuditSummary: {
      scorePercent: accessibilityAudit.scorePercent,
      avgSentenceWords: accessibilityAudit.averageSentenceWords,
      issues: accessibilityAudit.checks
        .filter(c => c.status !== 'pass')
        .map(c => ({ label: c.label, status: c.status, details: c.details.slice(0, 120) })),
    },
    technicalValidationSummary: {
      verifiedClaims: technicalValidation.verifiedClaimsCount,
      needsReviewClaims: technicalValidation.needsReviewClaimsCount,
      unsupportedClaims: technicalValidation.unsupportedClaimsCount,
    },
    contentModulesCount: safeContentModules.length,
    plannedModulesCount: safeCurrModules.length,
    contentModules: safeContentModules.map(m => ({
      mod: m.moduleNumber,
      title: m.title,
      hasIntro: Boolean(m.introduction?.trim()),
      hasSummary: Boolean(m.summary?.trim()),
      lessonsCount: (m.lessons || []).length,
      lessons: (m.lessons || []).map(l => ({
        title: l.title,
        words: l.explanation ? l.explanation.split(/\s+/).length : 0,
        excerpt: String(l.explanation || '').slice(0, 110),
        examples: l.workedExamples?.length || 0,
        keyTerms: l.keyTerminology?.length || 0,
        unsupportedClaims: (l.sourceClaims || []).filter(c => c.status === 'UNSUPPORTED').length,
      })),
      scenarios: (m.scenarios || []).map(s => s.title),
      caseStudiesCount: (m.workplaceCaseStudies || []).length,
      knowledgeChecksCount: (m.knowledgeChecks || []).length,
    })),
    deterministicBlockingErrors: structuralAudit.blockingErrors.map(e => ({
      rule: e.rule,
      description: e.description,
    })),
    deterministicWarningsCount: structuralAudit.warnings.length,
  };

  const res = await aiRouter.execute({
    provider: params.provider,
    model: params.model,
    responseFormat: 'json',
    temperature: 0.2,
    maxTokens: 2600,
    timeoutMs: 36000,
    systemInstruction: `You are an independent Quality Assurance Auditor for eStudy South Africa.
Evaluate fairly and accurately against: instructional integrity, curriculum preservation, deterministic 3-way alignment metrics, scenario authenticity, deterministic accessibility metrics, and source grounding.
CRITICAL ACCURACY RULES:
- Use deterministic alignmentSummary and deterministicBlockingErrors as authoritative facts for structural/alignment completeness.
- NEVER invent missing modules, outcomes, or lessons when the course summary shows they exist (untaughtOutcomes = [], unassessedOutcomes = [], complete contentModules).
- Distinguish clearly between genuine blocking defects vs advisory recommendations. Only populate aiAdditionalCriticalFailures if a concrete severe instructional, factual, or structural defect exists that prevents safe learner delivery. Return an empty array [] for aiAdditionalCriticalFailures if structural/alignment checks already pass cleanly.
- Evaluate ALL 7 dimensions matching the supplied weights. Keep each array concise (1-3 items per dimension).
Return ONLY valid JSON.`,
    prompt: `Audit this course against the 7 QA dimensions and weights:
WEIGHTS: ${JSON.stringify(params.weights)}

COURSE DATA:
${JSON.stringify(compactCourseForAudit)}

Return JSON:
{
  "dimensions": [
    {
      "id": "curriculum_coverage",
      "label": "Curriculum and subject coverage",
      "weight": 20,
      "score": 85,
      "findings": ["Concrete finding"],
      "supportingEvidence": ["Evidence from course"],
      "weaknesses": ["Advisory weakness if any"],
      "affectedSections": ["Module 1"],
      "recommendedCorrections": ["Optional improvement action"]
    }
  ],
  "aiAdditionalCriticalFailures": [],
  "verdictExplanation": "Clear narrative summarizing course quality, verified alignment, and any remaining advisory improvements"
}`,
  });

  const parsed = extractAndParseJSON<any>(res.text);
  const weightMap = new Map(params.weights.map(w => [w.id, w]));

  const dimensions: QADimensionResult[] = params.weights.map(w => {
    const found = (parsed.dimensions || []).find((d: any) => d.id === w.id) || {};
    const score = Math.max(0, Math.min(100, Number(found.score ?? 75)));
    return {
      id: w.id,
      label: weightMap.get(w.id)?.label || w.label,
      weight: w.weight,
      score,
      findings: Array.isArray(found.findings) ? found.findings : [],
      supportingEvidence: Array.isArray(found.supportingEvidence) ? found.supportingEvidence : [],
      weaknesses: Array.isArray(found.weaknesses) ? found.weaknesses : [],
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
  const deterministicRegulatedClear =
    !structuralAudit.blockingErrors.some(e => e.id === 'blk-unsupported-regulated');

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
      if (
        deterministicRegulatedClear &&
        (txt.includes('source register') ||
          txt.includes('needs review') ||
          txt.includes('unsupported') ||
          txt.includes('duration') ||
          txt.includes('readability') ||
          txt.includes('alt-caption') ||
          txt.includes('diagram'))
      ) {
        return false;
      }
      return true;
    })
    .map((c: any, idx: number) => ({
      id: c.id || `ai-crit-${Date.now()}-${idx}`,
      rule: c.rule || 'AI QA Critical Defect',
      description: c.description,
      affectedSection: c.affectedSection || 'Stage 5 · Learning Content',
      recommendedFix: c.recommendedFix || 'Review and revise affected section.',
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
        rule: c.rule,
        description: c.description,
        stage,
        moduleNumber: modMatch ? Number(modMatch[1]) : undefined,
        affectedSection: c.affectedSection,
        recommendedFix: c.recommendedFix,
      };
    }),
  ];

  const combinedCritical: QACriticalFailure[] = [
    ...deterministicCriticalFailures,
    ...filteredAiCriticals,
  ];

  // Clear distinction between Blocking Errors (FAIL) vs Non-blocking Warnings/Recommendations
  let verdict: QAVerdict = 'PASS';
  if (blockingErrors.length > 0 || weightedScore < 55) {
    verdict = 'FAIL';
  } else if (weightedScore < 75 || dimensions.some(d => d.score < 60)) {
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
    `Weighted QA score is ${weightedScore}% across 7 instructional design dimensions.`;
  const overrideNote =
    blockingErrors.length > 0
      ? ` Verdict overridden to FAIL due to ${blockingErrors.length} blocking error(s) that must be resolved before release.`
      : structuralAudit.warnings.length > 0
      ? ` Zero blocking errors remain; ${structuralAudit.warnings.length} non-blocking warning(s) are listed for optional improvement.`
      : '';

  // Preserve previously typed reviewer names so re-running QA after fixing issues doesn't erase them
  const prevRoles = params.project.latestQA?.humanSignOff?.roles;

  return {
    id: `qa-${Date.now()}`,
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
    humanSignOff: {
      signedOff: false,
      reviewerName: '',
      roles: {
        sme: {
          signedOff: false,
          reviewerName: prevRoles?.sme?.reviewerName || '',
          notes: prevRoles?.sme?.notes || '',
        },
        instructionalDesigner: {
          signedOff: false,
          reviewerName: prevRoles?.instructionalDesigner?.reviewerName || '',
          notes: prevRoles?.instructionalDesigner?.notes || '',
        },
        complianceAuthorizer: {
          signedOff: false,
          reviewerName: prevRoles?.complianceAuthorizer?.reviewerName || '',
          notes: prevRoles?.complianceAuthorizer?.notes || '',
        },
      },
    },
  };
}
