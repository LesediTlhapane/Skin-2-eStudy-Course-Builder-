import type {
  AIProvider,
  AlignmentFlag,
  CourseProject,
  QACriticalFailure,
  QADimensionResult,
  QADimensionWeight,
  QAEvaluationReport,
  QAVerdict,
} from '../../types.js';
import { aiRouter, extractAndParseJSON } from './aiRouter.js';
import { computeFullAlignmentReport } from '../../utils/alignmentHelpers.js';
import {
  runAccessibilityChecks,
  runTechnicalValidationChecks,
} from '../../utils/validationChecks.js';

const VAGUE_VERBS = /\b(understand|know about|learn about|be aware of|appreciate|familiarise with|familiarize with)\b/i;

export function computeAssessmentAlignmentFlags(project: CourseProject): AlignmentFlag[] {
  return computeFullAlignmentReport(project).flags;
}

export function detectDeterministicCriticalFailures(project: CourseProject): QACriticalFailure[] {
  const failures: QACriticalFailure[] = [];

  // 1. Metadata integrity
  if (!project.brief.title?.trim() || !project.brief.purpose?.trim() || !project.brief.targetAudience?.trim()) {
    failures.push({
      id: 'crit-metadata',
      rule: 'Protected Course Metadata Completeness',
      description: 'Essential brief metadata (title, purpose, or target audience) is missing.',
      affectedSection: 'Stage 1 · Course Brief',
      recommendedFix: 'Complete and confirm core course brief metadata in Stage 1.',
    });
  }

  // 2. Omitted mandatory curriculum topics
  const omitted = (project.curriculum.coverageChecks || []).filter(c => c.status === 'omitted');
  if (omitted.length > 0) {
    failures.push({
      id: 'crit-omitted-topics',
      rule: 'Mandatory Curriculum Preservation',
      description: `${omitted.length} supplied curriculum topic(s) were omitted: ${omitted.map(o => o.originalTopic).join('; ')}.`,
      affectedSection: 'Stage 2 · Curriculum Architecture',
      recommendedFix: 'Map every omitted topic into a module/lesson in Stage 2 before release.',
    });
  }

  // 3. Unresolved curriculum or source conflicts
  const unresolvedCurr = (project.curriculum.conflicts || []).filter(c => !c.resolved);
  const unresolvedSrc = (project.sourceConflicts || []).filter(c => c.resolutionStatus !== 'resolved');
  if (unresolvedCurr.length > 0 || unresolvedSrc.length > 0) {
    failures.push({
      id: 'crit-unresolved-conflicts',
      rule: 'Unresolved Source / Scope Conflicts',
      description: `${unresolvedCurr.length + unresolvedSrc.length} conflicting requirement(s) remain unresolved.`,
      affectedSection: 'Sources & Stage 2',
      recommendedFix: 'Review and document explicit resolution decisions for every flagged conflict.',
    });
  }

  // 4. Critical 3-way alignment failures (untaught outcomes, unassessed outcomes, invalid keys)
  const alignmentReport = computeFullAlignmentReport(project);
  const alignFlags = alignmentReport.flags.filter(f => f.severity === 'critical');
  if (alignFlags.length > 0) {
    failures.push({
      id: 'crit-assessment-alignment',
      rule: '3-Way Constructive Alignment & Assessment Integrity',
      description: `${alignFlags.length} critical alignment issue(s) (Score ${alignmentReport.scorePercent}%): ${alignFlags[0].message}`,
      affectedSection: 'Stage 4 · Alignment & Assessments',
      recommendedFix: 'Ensure every outcome has both mapped learning activities/lessons and valid assessment evidence.',
    });
  }

  // 5. Missing generated module content
  if (project.curriculum.modules.length === 0 || project.content.modules.length < project.curriculum.modules.length) {
    failures.push({
      id: 'crit-incomplete-content',
      rule: 'Complete Module Content Coverage',
      description: `Only ${project.content.modules.length} of ${project.curriculum.modules.length} planned modules have generated learning content.`,
      affectedSection: 'Stage 5 · Learning Content',
      recommendedFix: 'Generate learning content for all approved modules in Stage 5.',
    });
  }

  // 6. Unsupported claims presented without flagging
  const unsupportedClaims = project.content.modules.flatMap(m =>
    m.lessons.flatMap(l => (l.sourceClaims || []).filter(c => c.status === 'UNSUPPORTED'))
  );
  if (unsupportedClaims.length > 0 && project.brief.saCompliance?.enabled) {
    failures.push({
      id: 'crit-unsupported-claims',
      rule: 'Source Grounding in Regulated Subject',
      description: `${unsupportedClaims.length} claim(s) in learning content are tagged UNSUPPORTED while SA compliance/regulatory alignment is enabled.`,
      affectedSection: 'Stage 5 · Learning Content & Source Register',
      recommendedFix: 'Verify claims against uploaded authoritative sources or mark/revise the affected lessons.',
    });
  }

  // 7. Vague outcomes check
  const vagueOutcomes = [
    ...project.outcomes.courseOutcomes,
    ...project.outcomes.moduleOutcomes,
  ].filter(o => VAGUE_VERBS.test(o.statement));
  if (vagueOutcomes.length > 0) {
    failures.push({
      id: 'crit-vague-outcomes',
      rule: 'Measurable Outcomes Standard',
      description: `${vagueOutcomes.length} learning outcome(s) use non-measurable verbs (e.g., "understand", "know about"): ${vagueOutcomes[0].code}.`,
      affectedSection: 'Stage 3 · Learning Outcomes',
      recommendedFix: 'Replace vague verbs in Stage 3 with measurable Bloom action verbs.',
    });
  }

  return failures;
}

export async function evaluateCourseQAWithAI(params: {
  project: CourseProject;
  weights: QADimensionWeight[];
  provider?: AIProvider;
  model?: string;
}): Promise<QAEvaluationReport> {
  const criticalFailures = detectDeterministicCriticalFailures(params.project);
  const alignmentReport = computeFullAlignmentReport(params.project);
  const accessibilityAudit = runAccessibilityChecks(params.project);
  const technicalValidation = runTechnicalValidationChecks(params.project);

  const compactCourseForAudit = {
    brief: {
      title: params.project.brief.title,
      code: params.project.brief.code,
      domain: params.project.brief.industryDomain,
      audience: params.project.brief.targetAudience,
      level: params.project.brief.experienceLevel,
      duration: params.project.brief.estimatedDuration,
      aiMode: params.project.brief.aiIntegrationMode,
      saComplianceEnabled: Boolean(params.project.brief.saCompliance?.enabled),
      nqfLevel: params.project.brief.saCompliance?.nqfLevel || 'Unspecified',
    },
    sourcesCount: params.project.sources.length,
    sources: params.project.sources.slice(0, 6).map(s => ({
      title: s.title,
      status: s.verificationStatus,
    })),
    coverageGaps: (params.project.curriculum.coverageChecks || [])
      .filter(c => c.status !== 'mapped')
      .slice(0, 10)
      .map(c => ({ topic: c.originalTopic, status: c.status })),
    outcomesCount:
      params.project.outcomes.courseOutcomes.length +
      params.project.outcomes.moduleOutcomes.length,
    outcomes: [
      ...params.project.outcomes.courseOutcomes,
      ...params.project.outcomes.moduleOutcomes,
    ]
      .slice(0, 18)
      .map(o => ({
        code: o.code,
        verb: o.actionVerb,
        statement: String(o.statement || '').slice(0, 140),
      })),
    assessmentsSummary: {
      total: params.project.assessments.items.length,
      knowledgeCount: params.project.assessments.items.filter(
        a => a.assessmentDomain === 'knowledge'
      ).length,
      practicalCount: params.project.assessments.items.filter(
        a => a.assessmentDomain === 'practical'
      ).length,
      items: params.project.assessments.items.slice(0, 12).map(a => ({
        title: a.title,
        type: a.type,
        domain: a.assessmentDomain,
        outcomes: a.outcomeIds,
        hasAnswer: Boolean(a.modelAnswer?.trim()),
        rubricCount: a.rubric?.length || 0,
      })),
    },
    alignmentSummary: {
      scorePercent: alignmentReport.scorePercent,
      criticalFlags: alignmentReport.flags
        .filter(f => f.severity === 'critical')
        .slice(0, 5)
        .map(f => f.message),
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
      issues: technicalValidation.checks
        .filter(c => c.status !== 'pass')
        .map(c => ({ label: c.label, status: c.status })),
    },
    contentModules: params.project.content.modules.map(m => ({
      mod: m.moduleNumber,
      title: m.title,
      lessonsCount: m.lessons.length,
      lessons: m.lessons.slice(0, 5).map(l => ({
        title: l.title,
        words: l.explanation ? l.explanation.split(/\s+/).length : 0,
        excerpt: String(l.explanation || '').slice(0, 140),
        examples: l.workedExamples?.length || 0,
        unsupportedClaims: (l.sourceClaims || []).filter(c => c.status === 'UNSUPPORTED').length,
      })),
      scenarios: m.scenarios.map(s => s.title),
      caseStudiesCount: m.workplaceCaseStudies.length,
      knowledgeChecksCount: m.knowledgeChecks.length,
    })),
    deterministicCriticalFailures: criticalFailures.map(f => ({
      rule: f.rule,
      description: f.description,
    })),
  };

  const res = await aiRouter.execute({
    provider: params.provider,
    model: params.model,
    responseFormat: 'json',
    temperature: 0.2,
    maxTokens: 2600,
    timeoutMs: 36000,
    systemInstruction: `You are an independent Quality Assurance Auditor for eStudy South Africa.
Evaluate strictly on instructional integrity, subject accuracy, curriculum preservation, 3-way alignment, scenario authenticity, deterministic accessibility metrics, and source grounding.
Penalise repetition, generic filler, weak scenarios, or unsupported claims.
Evaluate ALL 7 dimensions matching the supplied weights. Keep each array concise (1-3 items per dimension).
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
      "score": 82,
      "findings": ["Concrete finding"],
      "supportingEvidence": ["Evidence from course"],
      "weaknesses": ["Specific weakness if any"],
      "affectedSections": ["Module 1"],
      "recommendedCorrections": ["Specific correction action"]
    }
  ],
  "aiAdditionalCriticalFailures": [
    {
      "id": "ai-crit-1",
      "rule": "Rule violated",
      "description": "Only include if a genuine critical defect exists",
      "affectedSection": "Affected module/lesson",
      "recommendedFix": "Exact correction needed"
    }
  ],
  "verdictExplanation": "Clear narrative explaining exact reasons for the QA verdict"
}`,
  });

  const parsed = extractAndParseJSON<any>(res.text);
  const weightMap = new Map(params.weights.map(w => [w.id, w]));

  const dimensions: QADimensionResult[] = params.weights.map(w => {
    const found = (parsed.dimensions || []).find((d: any) => d.id === w.id) || {};
    const score = Math.max(0, Math.min(100, Number(found.score ?? 0)));
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

  const combinedCritical: QACriticalFailure[] = [
    ...criticalFailures,
    ...(Array.isArray(parsed.aiAdditionalCriticalFailures)
      ? parsed.aiAdditionalCriticalFailures.filter((c: any) => c && c.description)
      : []),
  ];

  // Critical failure override: high average score NEVER overrides critical failures
  let verdict: QAVerdict = 'PASS';
  if (combinedCritical.length > 0 || weightedScore < 55) {
    verdict = 'FAIL';
  } else if (weightedScore < 75 || dimensions.some(d => d.score < 65)) {
    verdict = 'REVISION REQUIRED';
  } else if (
    weightedScore < 90 ||
    dimensions.some(d => d.weaknesses.length > 0)
  ) {
    verdict = 'PASS WITH RECOMMENDATIONS';
  }

  const baseExplanation =
    parsed.verdictExplanation ||
    `Weighted QA score is ${weightedScore}% across 7 instructional design dimensions.`;
  const overrideNote =
    combinedCritical.length > 0
      ? ` Verdict overridden to FAIL due to ${combinedCritical.length} critical failure(s) that prevent release regardless of average score.`
      : '';

  return {
    id: `qa-${Date.now()}`,
    evaluatedAt: new Date().toISOString(),
    weights: params.weights,
    dimensions,
    weightedScore,
    criticalFailures: combinedCritical,
    verdict,
    verdictExplanation: `${baseExplanation}${overrideNote}`,
    accessibilityAudit,
    technicalValidation,
    humanSignOff: {
      signedOff: false,
      reviewerName: '',
      roles: {
        sme: { signedOff: false, reviewerName: '' },
        instructionalDesigner: { signedOff: false, reviewerName: '' },
        complianceAuthorizer: { signedOff: false, reviewerName: '' },
      },
    },
  };
}
