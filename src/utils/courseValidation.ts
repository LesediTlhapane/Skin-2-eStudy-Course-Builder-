import type {
  AssessmentValidationSummary,
  CourseProject,
  DurationValidationSummary,
  QAIssueItem,
  SourceVerificationSummary,
  WorkflowStage,
} from '../types.js';
import { computeFullAlignmentReport, detectVagueOutcomeWarning } from './alignmentHelpers.js';
import {
  computeAssessmentValidation,
  computeDurationValidation,
  parseEstimatedHours,
  runAccessibilityChecks,
  runDomainQualityChecks,
  runPedagogicalAndQualityChecks,
  runTechnicalValidationChecks,
} from './validationChecks.js';
import { getUnresolvedComplianceRequirements } from './complianceGovernance.js';

export { parseEstimatedHours };

export interface PlaceholderOccurrence {
  stage: WorkflowStage;
  location: string;
  field?: string;
  moduleNumber?: number;
  token: string;
}

export interface StructuralAuditResult {
  dataSignature: string;
  blockingErrors: QAIssueItem[];
  warnings: QAIssueItem[];
  informationalFeedback: QAIssueItem[];
  unresolvedPlaceholders: PlaceholderOccurrence[];
  totalPlannedMinutes: number;
  totalGeneratedMinutes: number;
  declaredDurationHours: number | null;
  durationValidation: DurationValidationSummary;
  assessmentValidation: AssessmentValidationSummary;
  sourceVerificationSummary: SourceVerificationSummary;
}

const PLACEHOLDER_REGEX =
  /(\{\{[^}]{1,120}\}\}|\[INSERT[^\]]{1,80}\]|\[PLACEHOLDER[^\]]{0,60}\]|<INSERT[^>]{1,80}>)/gi;

function fnv1aHash(str: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch ^ (i & 0xff);
    h2 = Math.imul(h2, 0x01000193);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Deterministic signature over all authorable course data (Brief, Sources, Curriculum,
 * Outcomes, Assessments, Content). Excludes QA reports, version snapshots, currentStage,
 * and updatedAt timestamps so viewing/signing QA doesn't invalidate itself while ANY
 * course edit marks the previous QA evaluation stale.
 */
export function computeCourseDataSignature(project: CourseProject): string {
  const canonical = {
    templateId: project.templateId,
    brief: {
      title: project.brief?.title || '',
      code: project.brief?.code || '',
      industryDomain: project.brief?.industryDomain || '',
      purpose: project.brief?.purpose || '',
      workplaceProblem: project.brief?.workplaceProblem || '',
      targetAudience: project.brief?.targetAudience || '',
      targetJobRoles: project.brief?.targetJobRoles || '',
      experienceLevel: project.brief?.experienceLevel || '',
      prerequisites: project.brief?.prerequisites || '',
      estimatedDuration: project.brief?.estimatedDuration || '',
      language: project.brief?.language || '',
      learningRequirements: project.brief?.learningRequirements || '',
      subjectTopicsInput: project.brief?.subjectTopicsInput || '',
      aiIntegrationMode: project.brief?.aiIntegrationMode || 'optional',
      aiIntegrationRequirements: project.brief?.aiIntegrationRequirements || '',
      saCompliance: project.brief?.saCompliance || {},
      templateFieldValues: project.brief?.templateFieldValues || {},
      fieldStatuses: project.brief?.fieldStatuses || {},
      fieldStatusNotes: project.brief?.fieldStatusNotes || {},
    },
    sources: (project.sources || []).map(s => ({
      id: s.id,
      title: s.title,
      verificationStatus: s.verificationStatus,
      verifiedBy: s.verifiedBy || '',
      referenceOrUrl: s.referenceOrUrl,
    })),
    sourceConflicts: (project.sourceConflicts || []).map(c => ({
      id: c.id,
      resolutionStatus: c.resolutionStatus,
      resolutionDecision: c.resolutionDecision || '',
    })),
    curriculum: {
      modules: (project.curriculum?.modules || []).map(m => ({
        id: m.id,
        order: m.order,
        title: m.title,
        qctoModuleType: m.qctoModuleType,
        purpose: m.purpose,
        topics: m.topics,
        lessons: (m.lessons || []).map(l => ({
          id: l.id,
          title: l.title,
          durationMinutes: l.durationMinutes,
          outcomeIds: l.outcomeIds || [],
        })),
      })),
      coverageChecks: (project.curriculum?.coverageChecks || []).map(c => ({
        id: c.id,
        status: c.status,
        originalTopic: c.originalTopic,
      })),
      conflicts: (project.curriculum?.conflicts || []).map(c => ({
        id: c.id,
        resolved: c.resolved,
      })),
    },
    outcomes: {
      courseOutcomes: (project.outcomes?.courseOutcomes || []).map(o => ({
        id: o.id,
        code: o.code,
        bloomLevel: o.bloomLevel,
        statement: o.statement,
      })),
      moduleOutcomes: (project.outcomes?.moduleOutcomes || []).map(o => ({
        id: o.id,
        moduleId: o.moduleId,
        code: o.code,
        bloomLevel: o.bloomLevel,
        statement: o.statement,
      })),
    },
    assessments: {
      strategySummary: project.assessments?.strategySummary || '',
      passRequirementPercent: project.assessments?.passRequirementPercent,
      knowledgeWeightPercent: project.assessments?.knowledgeWeightPercent,
      practicalWeightPercent: project.assessments?.practicalWeightPercent,
      thresholdsConfirmed: Boolean(project.assessments?.thresholdsConfirmed),
      items: (project.assessments?.items || []).map(it => ({
        id: it.id,
        moduleId: it.moduleId,
        type: it.type,
        assessmentDomain: it.assessmentDomain,
        weightingPercent: it.weightingPercent,
        durationMinutes: it.durationMinutes,
        outcomeIds: it.outcomeIds,
        promptOrQuestion: it.promptOrQuestion,
        options: it.options,
        correctIndices: it.correctIndices,
        modelAnswer: it.modelAnswer,
        markingGuide: it.markingGuide,
        rubric: it.rubric,
      })),
    },
    contentModules: (project.content?.modules || []).map(cm => ({
      moduleId: cm.moduleId,
      moduleNumber: cm.moduleNumber,
      title: cm.title,
      introduction: cm.introduction,
      summary: cm.summary,
      lessons: (cm.lessons || []).map(l => ({
        id: l.id,
        lessonPlanId: l.lessonPlanId,
        title: l.title,
        durationMinutes: l.durationMinutes,
        outcomeIds: l.outcomeIds,
        explanation: l.explanation,
        practicalApplication: l.practicalApplication,
        guidedActivity: l.guidedActivity,
        workedExamples: l.workedExamples,
        keyTerminology: l.keyTerminology,
        sourceClaims: (l.sourceClaims || []).map(sc => ({
          id: sc.id,
          status: sc.status,
          claim: sc.claim,
        })),
      })),
      scenarios: (cm.scenarios || []).map(s => ({
        id: s.id,
        title: s.title,
        situation: s.situation,
        challenge: s.challenge,
        decisionPrompt: s.decisionPrompt,
        modelDebrief: s.modelDebrief,
      })),
      workplaceCaseStudies: (cm.workplaceCaseStudies || []).map(c => ({
        id: c.id,
        title: c.title,
        background: c.background,
        analysisQuestions: c.analysisQuestions,
        facilitatorNotes: c.facilitatorNotes,
      })),
      knowledgeChecks: (cm.knowledgeChecks || []).map(k => ({
        id: k.id,
        question: k.question,
        options: k.options,
        correctIndex: k.correctIndex,
        explanation: k.explanation,
      })),
    })),
    courseIntroduction: project.content?.courseIntroduction || null,
  };

  return fnv1aHash(JSON.stringify(canonical));
}

export interface UpstreamStageSignatures {
  briefSignature: string;
  curriculumSignature: string;
  outcomesSignature: string;
  stage4UpstreamSignature: string;
  stage5UpstreamSignature: string;
}

export function computeUpstreamStageSignatures(project: CourseProject): UpstreamStageSignatures {
  const briefCanonical = {
    templateId: project.templateId,
    title: project.brief?.title || '',
    industryDomain: project.brief?.industryDomain || '',
    purpose: project.brief?.purpose || '',
    workplaceProblem: project.brief?.workplaceProblem || '',
    targetAudience: project.brief?.targetAudience || '',
    targetJobRoles: project.brief?.targetJobRoles || '',
    experienceLevel: project.brief?.experienceLevel || '',
    prerequisites: project.brief?.prerequisites || '',
    estimatedDuration: project.brief?.estimatedDuration || '',
    language: project.brief?.language || '',
    subjectTopicsInput: project.brief?.subjectTopicsInput || '',
    aiIntegrationMode: project.brief?.aiIntegrationMode || 'optional',
    saCompliance: project.brief?.saCompliance || {},
  };
  const briefSignature = fnv1aHash(JSON.stringify(briefCanonical));

  const curriculumSignature = fnv1aHash(
    JSON.stringify({
      briefSignature,
      modules: (project.curriculum?.modules || []).map(m => ({
        id: m.id,
        order: m.order,
        title: m.title,
        purpose: m.purpose,
        topics: m.topics,
        lessons: (m.lessons || []).map(l => ({
          id: l.id,
          title: l.title,
          durationMinutes: l.durationMinutes,
          outcomeIds: l.outcomeIds || [],
        })),
      })),
    })
  );

  const outcomesSignature = fnv1aHash(
    JSON.stringify({
      briefSignature,
      courseOutcomes: (project.outcomes?.courseOutcomes || []).map(o => ({
        id: o.id,
        code: o.code,
        bloomLevel: o.bloomLevel,
        statement: o.statement,
      })),
      moduleOutcomes: (project.outcomes?.moduleOutcomes || []).map(o => ({
        id: o.id,
        moduleId: o.moduleId,
        code: o.code,
        bloomLevel: o.bloomLevel,
        statement: o.statement,
      })),
    })
  );

  const stage4UpstreamSignature = outcomesSignature;
  const stage5UpstreamSignature = fnv1aHash(`${curriculumSignature}:${outcomesSignature}`);

  return {
    briefSignature,
    curriculumSignature,
    outcomesSignature,
    stage4UpstreamSignature,
    stage5UpstreamSignature,
  };
}

export function detectUnresolvedPlaceholders(project: CourseProject): PlaceholderOccurrence[] {
  const hits: PlaceholderOccurrence[] = [];

  const scan = (
    value: unknown,
    stage: WorkflowStage,
    location: string,
    extra?: { field?: string; moduleNumber?: number }
  ) => {
    if (typeof value !== 'string' || !value) return;
    PLACEHOLDER_REGEX.lastIndex = 0;
    const match = PLACEHOLDER_REGEX.exec(value);
    if (match) {
      hits.push({
        stage,
        location,
        field: extra?.field,
        moduleNumber: extra?.moduleNumber,
        token: match[0],
      });
    }
  };

  const b = project.brief;
  scan(b.title, 1, 'Stage 1 · Course Title', { field: 'title' });
  scan(b.purpose, 1, 'Stage 1 · Purpose', { field: 'purpose' });
  scan(b.workplaceProblem, 1, 'Stage 1 · Workplace Problem', { field: 'workplaceProblem' });
  scan(b.targetAudience, 1, 'Stage 1 · Target Audience', { field: 'targetAudience' });
  scan(b.subjectTopicsInput, 1, 'Stage 1 · Subject Topics', { field: 'subjectTopicsInput' });
  for (const [k, v] of Object.entries(b.templateFieldValues || {})) {
    scan(v, 1, `Stage 1 · Template Field (${k})`, { field: k });
  }

  for (const m of project.curriculum?.modules || []) {
    scan(m.title, 2, `Stage 2 · Module ${m.order} Title`, { moduleNumber: m.order });
    scan(m.purpose, 2, `Stage 2 · Module ${m.order} Purpose`, { moduleNumber: m.order });
  }

  for (const o of [
    ...(project.outcomes?.courseOutcomes || []),
    ...(project.outcomes?.moduleOutcomes || []),
  ]) {
    scan(o.statement, 3, `Stage 3 · Outcome ${o.code}`);
  }

  for (const a of project.assessments?.items || []) {
    scan(a.promptOrQuestion, 4, `Stage 4 · Assessment "${a.title}"`);
    scan(a.instructions, 4, `Stage 4 · Assessment "${a.title}" Instructions`);
  }

  for (const cm of project.content?.modules || []) {
    scan(cm.introduction, 5, `Stage 5 · Module ${cm.moduleNumber} Introduction`, {
      moduleNumber: cm.moduleNumber,
    });
    scan(cm.summary, 5, `Stage 5 · Module ${cm.moduleNumber} Summary`, {
      moduleNumber: cm.moduleNumber,
    });
    for (const l of cm.lessons || []) {
      scan(l.explanation, 5, `Stage 5 · Module ${cm.moduleNumber} Lesson "${l.title}"`, {
        moduleNumber: cm.moduleNumber,
      });
    }
  }

  return hits;
}

export function runStructuralAndConsistencyAudit(project: CourseProject): StructuralAuditResult {
  const blockingErrors: QAIssueItem[] = [];
  const warnings: QAIssueItem[] = [];
  const informationalFeedback: QAIssueItem[] = [];
  const dataSignature = computeCourseDataSignature(project);

  // 1. Essential Stage 1 Metadata
  const missingBrief: string[] = [];
  if (!project.brief.title?.trim()) missingBrief.push('Course Title');
  if (!project.brief.purpose?.trim()) missingBrief.push('Course Purpose');
  if (!project.brief.targetAudience?.trim()) missingBrief.push('Target Audience');
  if (missingBrief.length > 0) {
    blockingErrors.push({
      id: 'blk-metadata',
      severity: 'blocking',
      prioritySeverity: 'critical',
      verificationOrigin: 'automated',
      rule: 'Mandatory Course Brief Information',
      description: `Required brief fields are missing: ${missingBrief.join(', ')}.`,
      stage: 1,
      affectedSection: 'Stage 1 · Course Brief',
      field: missingBrief[0],
      recommendedFix: 'Complete Title, Purpose, and Target Audience in Stage 1.',
    });
  }

  // 2. Unresolved Template Placeholders ({{...}}, [INSERT ...])
  const unresolvedPlaceholders = detectUnresolvedPlaceholders(project);
  if (unresolvedPlaceholders.length > 0) {
    const first = unresolvedPlaceholders[0];
    blockingErrors.push({
      id: 'blk-placeholders',
      severity: 'blocking',
      rule: 'Unresolved Placeholder Tokens',
      description: `${unresolvedPlaceholders.length} unresolved placeholder(s) remain (e.g., ${first.token} in ${first.location}).`,
      stage: first.stage,
      affectedSection: first.location,
      moduleNumber: first.moduleNumber,
      field: first.field,
      recommendedFix: 'Replace all {{...}} / [INSERT ...] placeholders with real course copy or mark metadata as "To Be Confirmed".',
    });
  }

  // 3. Stage 2 Curriculum Structure, Omitted Topics & Conflicts
  const currModules = project.curriculum.modules || [];
  if (currModules.length === 0) {
    blockingErrors.push({
      id: 'blk-no-modules',
      severity: 'blocking',
      rule: 'Curriculum Architecture Required',
      description: 'No modules have been defined in Stage 2 Curriculum.',
      stage: 2,
      affectedSection: 'Stage 2 · Curriculum Architecture',
      recommendedFix: 'Propose or manually create curriculum modules in Stage 2.',
    });
  } else {
    const emptyMod = currModules.find(
      m => (m.lessons?.length || 0) === 0 && (m.topics?.length || 0) === 0
    );
    if (emptyMod) {
      blockingErrors.push({
        id: 'blk-empty-module',
        severity: 'blocking',
        rule: 'Incomplete Module Plan',
        description: `Module ${emptyMod.order} ("${emptyMod.title}") has no planned topics or lessons.`,
        stage: 2,
        moduleNumber: emptyMod.order,
        affectedSection: `Stage 2 · Module ${emptyMod.order}`,
        recommendedFix: 'Add at least one topic and lesson to this module in Stage 2.',
      });
    }
  }

  const omittedTopics = (project.curriculum.coverageChecks || []).filter(c => c.status === 'omitted');
  if (omittedTopics.length > 0) {
    blockingErrors.push({
      id: 'blk-omitted-topics',
      severity: 'blocking',
      rule: 'Mandatory Curriculum Preservation',
      description: `${omittedTopics.length} supplied brief topic(s) were omitted: ${omittedTopics.map(o => o.originalTopic).slice(0, 3).join('; ')}.`,
      stage: 2,
      affectedSection: 'Stage 2 · Coverage Audit',
      recommendedFix: 'Map omitted topics into curriculum modules/lessons or update Coverage status in Stage 2.',
    });
  }

  const unresolvedCurrConflicts = (project.curriculum.conflicts || []).filter(c => !c.resolved);
  const unresolvedSrcConflicts = (project.sourceConflicts || []).filter(
    c => c.resolutionStatus !== 'resolved'
  );
  if (unresolvedCurrConflicts.length > 0 || unresolvedSrcConflicts.length > 0) {
    blockingErrors.push({
      id: 'blk-unresolved-conflicts',
      severity: 'blocking',
      rule: 'Unresolved Source / Curriculum Conflicts',
      description: `${unresolvedCurrConflicts.length + unresolvedSrcConflicts.length} flagged contradiction(s) remain unresolved.`,
      stage: unresolvedSrcConflicts.length > 0 ? 1 : 2,
      affectedSection: unresolvedSrcConflicts.length > 0 ? 'Source Register' : 'Stage 2 · Curriculum Conflicts',
      recommendedFix: 'Record a resolution decision for every flagged conflict.',
    });
  }

  // 4. Stage 3 Outcomes Completeness, Duplicates & Measurability
  const courseOutcomes = project.outcomes.courseOutcomes || [];
  const moduleOutcomes = project.outcomes.moduleOutcomes || [];
  const allOutcomes = [...courseOutcomes, ...moduleOutcomes];

  if (allOutcomes.length === 0) {
    blockingErrors.push({
      id: 'blk-no-outcomes',
      severity: 'blocking',
      rule: 'Learning Outcomes Required',
      description: 'No course or module learning outcomes have been defined in Stage 3.',
      stage: 3,
      affectedSection: 'Stage 3 · Learning Outcomes',
      recommendedFix: 'Generate or author measurable outcomes in Stage 3.',
    });
  } else {
    const emptyOutcome = allOutcomes.find(o => !o.statement?.trim());
    if (emptyOutcome) {
      blockingErrors.push({
        id: 'blk-empty-outcome',
        severity: 'blocking',
        rule: 'Incomplete Learning Outcome',
        description: `Outcome ${emptyOutcome.code} has an empty statement.`,
        stage: 3,
        affectedSection: `Stage 3 · ${emptyOutcome.code}`,
        recommendedFix: 'Complete the outcome statement in Stage 3 or remove the blank item.',
      });
    }

    const vagueOutcomes = allOutcomes.filter(o => Boolean(detectVagueOutcomeWarning(o.statement || '')));
    if (vagueOutcomes.length > 0) {
      blockingErrors.push({
        id: 'blk-vague-outcomes',
        severity: 'blocking',
        rule: 'Measurable Outcomes Standard',
        description: `${vagueOutcomes.length} outcome(s) use non-measurable verbs (e.g., ${vagueOutcomes[0].code}: "understand/know about").`,
        stage: 3,
        affectedSection: `Stage 3 · ${vagueOutcomes[0].code}`,
        recommendedFix: 'Replace vague verbs with observable Bloom action verbs in Stage 3.',
      });
    }

    const seenCodes = new Set<string>();
    const dupCodes: string[] = [];
    for (const o of allOutcomes) {
      const norm = (o.code || '').trim().toUpperCase();
      if (norm && seenCodes.has(norm)) dupCodes.push(norm);
      if (norm) seenCodes.add(norm);
    }
    if (dupCodes.length > 0) {
      warnings.push({
        id: 'warn-dup-outcome-codes',
        severity: 'warning',
        rule: 'Duplicate Outcome Codes',
        description: `Duplicate outcome code(s) found (${Array.from(new Set(dupCodes)).join(', ')}). Unique codes prevent ambiguity in LMS exports.`,
        stage: 3,
        affectedSection: 'Stage 3 · Learning Outcomes',
        recommendedFix: 'Ensure every CLO and MLO has a unique code.',
      });
    }
  }

  // 5. Stage 4 Assessments & Strict Weighting Reconciliation
  const assessments = project.assessments;
  const items = assessments.items || [];
  const assessmentValidation = computeAssessmentValidation(project);

  if (items.length === 0) {
    blockingErrors.push({
      id: 'blk-no-assessments',
      severity: 'blocking',
      prioritySeverity: 'critical',
      verificationOrigin: 'automated',
      rule: 'Assessment Plan Required',
      description: 'No assessment items have been designed in Stage 4.',
      stage: 4,
      affectedSection: 'Stage 4 · Assessments',
      recommendedFix: 'Design or add at least one aligned assessment item in Stage 4.',
    });
  } else {
    if (
      assessments.passRequirementPercent < 1 ||
      assessments.passRequirementPercent > 100
    ) {
      blockingErrors.push({
        id: 'blk-invalid-pass-mark',
        severity: 'blocking',
        prioritySeverity: 'critical',
        verificationOrigin: 'automated',
        rule: 'Valid Pass Threshold',
        description: `Pass requirement (${assessments.passRequirementPercent}%) must be between 1% and 100%.`,
        stage: 4,
        affectedSection: 'Stage 4 · Assessment Strategy',
        recommendedFix: 'Set pass mark between 50% and 100% in Stage 4.',
      });
    }

    if (assessmentValidation.issues.length > 0) {
      blockingErrors.push({
        id: 'blk-assessment-weight-reconciliation',
        severity: 'blocking',
        prioritySeverity: 'critical',
        verificationOrigin: 'automated',
        rule: 'Assessment Weighting & Pass Mark Reconciliation',
        description: assessmentValidation.issues.join(' '),
        stage: 4,
        affectedSection: 'Stage 4 · Assessment Weights & Strategy',
        recommendedFix:
          'Ensure Knowledge item weights match declared Knowledge %, Practical item weights match declared Practical %, total weights sum strictly to 100%, and strategy text matches passRequirementPercent.',
      });
    }
  }

  // 6. 3-Way Alignment Check
  const alignmentReport = computeFullAlignmentReport(project);
  const criticalAlign = alignmentReport.flags.filter(f => f.severity === 'critical');
  const warningAlign = alignmentReport.flags.filter(f => f.severity === 'warning');

  if (criticalAlign.length > 0) {
    blockingErrors.push({
      id: 'blk-alignment-critical',
      severity: 'blocking',
      rule: '3-Way Constructive Alignment & Assessment Integrity',
      description: `${criticalAlign.length} critical alignment gap(s) (Score ${alignmentReport.scorePercent}%): ${criticalAlign[0].message}`,
      stage: 4,
      affectedSection: 'Stage 4 · Alignment Matrix',
      recommendedFix: 'Link unassessed/untaught outcomes or fix incomplete MCQ answer keys in Stage 4.',
    });
  }

  for (const wf of warningAlign.slice(0, 6)) {
    warnings.push({
      id: `warn-align-${wf.id}`,
      severity: 'warning',
      rule: 'Alignment Improvement Opportunity',
      description: wf.message,
      stage: wf.category === 'orphan_lesson' ? 5 : 4,
      affectedSection: wf.category === 'orphan_lesson' ? 'Stage 5 · Lesson Mapping' : 'Stage 4 · Assessments',
      recommendedFix: 'Optionally map or strengthen practical rubric evidence.',
    });
  }

  // 7. Stage 5 Content Completeness & Consistency with Curriculum
  const genModules = project.content.modules || [];
  const plannedIds = new Set(currModules.map(m => m.id));
  const generatedByModId = new Map(genModules.map(m => [m.moduleId, m]));

  const missingContentModules = currModules.filter(pm => {
    const gm = generatedByModId.get(pm.id);
    if (!gm) return true;
    const expectedLessons = pm.lessons?.length || 0;
    if (expectedLessons > 0 && (gm.lessons?.length || 0) === 0) return true;
    return false;
  });

  if (currModules.length > 0 && missingContentModules.length > 0) {
    const firstMiss = missingContentModules[0];
    blockingErrors.push({
      id: 'blk-incomplete-content',
      severity: 'blocking',
      rule: 'Complete Module Content Coverage',
      description: `${missingContentModules.length} of ${currModules.length} planned module(s) are missing generated Stage 5 content (first missing: Module ${firstMiss.order}: ${firstMiss.title}).`,
      stage: 5,
      moduleNumber: firstMiss.order,
      affectedSection: `Stage 5 · Module ${firstMiss.order}`,
      recommendedFix: `Generate learning content for Module ${firstMiss.order} (or click Generate Remaining in Stage 5).`,
    });
  }

  const partialModules = currModules.filter(pm => {
    const gm = generatedByModId.get(pm.id);
    if (!gm) return false;
    return (pm.lessons?.length || 0) > (gm.lessons?.length || 0) && (gm.lessons?.length || 0) > 0;
  });
  if (partialModules.length > 0) {
    warnings.push({
      id: 'warn-partial-lessons',
      severity: 'warning',
      rule: 'Module Lesson Count Divergence',
      description: `${partialModules.length} module(s) have fewer generated lessons than originally planned in Stage 2 (e.g., Module ${partialModules[0].order}).`,
      stage: 5,
      moduleNumber: partialModules[0].order,
      affectedSection: `Stage 5 · Module ${partialModules[0].order}`,
      recommendedFix: 'Verify whether omitted lessons should be generated or removed from Stage 2.',
    });
  }

  const orphanContentMods = genModules.filter(gm => !plannedIds.has(gm.moduleId));
  if (orphanContentMods.length > 0) {
    warnings.push({
      id: 'warn-orphan-content-modules',
      severity: 'warning',
      rule: 'Curriculum-Content Synchronization',
      description: `${orphanContentMods.length} Stage 5 module(s) no longer match Stage 2 module IDs after curriculum edits.`,
      stage: 5,
      affectedSection: 'Stage 5 · Learning Content',
      recommendedFix: 'Review Stage 5 modules or re-align Stage 2 and Stage 5.',
    });
  }

  // 8. Duration Consistency Check (Strict Reconciliation)
  const durationValidation = computeDurationValidation(project);
  const totalPlannedMinutes = durationValidation.plannedLessonMinutes;
  const totalGeneratedMinutes = durationValidation.generatedLessonMinutes;
  const declaredDurationHours = parseEstimatedHours(project.brief.estimatedDuration);
  const activeMinutes = durationValidation.totalReconciledMinutes;

  if (durationValidation.status === 'fail') {
    warnings.push({
      id: 'warn-duration-contradiction',
      severity: 'warning',
      prioritySeverity: 'high',
      verificationOrigin: 'automated',
      rule: 'Course Duration Reconciliation Mismatch',
      description: durationValidation.summary,
      stage: 2,
      affectedSection: 'Stage 1 Duration vs Stage 2/5 Lessons & Stage 4 Assessments',
      recommendedFix:
        'Reconcile Stage 2/5 lesson durations and Stage 4 assessment timings so scheduled notional hours align with the declared course duration.',
    });
  } else if (durationValidation.status === 'warning') {
    warnings.push({
      id: 'warn-duration-variance',
      severity: 'warning',
      prioritySeverity: 'medium',
      verificationOrigin: 'automated',
      rule: 'Course Duration Minor Variance',
      description: durationValidation.summary,
      stage: 2,
      affectedSection: 'Stage 1 Duration vs Lesson & Assessment Timings',
      recommendedFix:
        'Confirm whether breaks/assessments account for the time difference and document exact notional hours.',
    });
  }

  // 9. Source, Regulatory, Factual, ML Technical & Audience Checks
  const techSummary = runTechnicalValidationChecks(project);
  const domainAudit = runDomainQualityChecks(project);
  const seenIssueIds = new Set<string>([
    ...blockingErrors.map(b => b.id),
    ...warnings.map(w => w.id),
  ]);
  for (const domIssue of domainAudit.issues) {
    if (seenIssueIds.has(domIssue.id)) continue;
    seenIssueIds.add(domIssue.id);
    if (domIssue.severity === 'blocking') {
      blockingErrors.push(domIssue);
    } else {
      warnings.push(domIssue);
    }
  }

  // 9b. Pedagogical Depth, Course Introduction, Distractor & Anti-Repetition Checks
  const pedAudit = runPedagogicalAndQualityChecks(project);
  for (const pedIssue of pedAudit.issues) {
    if (seenIssueIds.has(pedIssue.id)) continue;
    seenIssueIds.add(pedIssue.id);
    if (pedIssue.severity === 'blocking') {
      blockingErrors.push(pedIssue);
    } else {
      warnings.push(pedIssue);
    }
  }

  if (techSummary.unsupportedClaimsCount > 0 && project.brief.saCompliance?.enabled) {
    blockingErrors.push({
      id: 'blk-unsupported-regulated',
      severity: 'blocking',
      prioritySeverity: 'critical',
      verificationOrigin: 'automated',
      rule: 'Unsupported Claims in Regulated Subject',
      description: `${techSummary.unsupportedClaimsCount} claim(s) are explicitly marked UNSUPPORTED while SA regulatory alignment is enabled.`,
      stage: 5,
      affectedSection: 'Stage 5 · Source Grounding',
      recommendedFix: 'Verify claims against uploaded sources or revise/downgrade unsupported statements in Stage 5.',
    });
  } else if (techSummary.unsupportedClaimsCount > 0) {
    warnings.push({
      id: 'warn-unsupported-claims',
      severity: 'warning',
      prioritySeverity: 'high',
      verificationOrigin: 'unverified',
      rule: 'Unsupported Content Claims Flagged',
      description: `${techSummary.unsupportedClaimsCount} factual claim(s) are flagged UNSUPPORTED in Stage 5 lessons.`,
      stage: 5,
      affectedSection: 'Stage 5 · Source Grounding',
      recommendedFix: 'Attach a verified source or reword as an illustrative example in Stage 5.',
    });
  }

  if (techSummary.needsReviewClaimsCount > 0) {
    warnings.push({
      id: 'warn-sme-review-claims',
      severity: 'warning',
      prioritySeverity: 'medium',
      verificationOrigin: 'expert_review_required',
      rule: 'SME Claim Confirmation Queue',
      description: `${techSummary.needsReviewClaimsCount} technical/domain claim(s) carry status NEEDS REVIEW pending SME verification.`,
      stage: 5,
      affectedSection: 'Stage 5 · Source Claims',
      recommendedFix: 'Have the Subject-Matter Expert verify accuracy before final distribution.',
    });
  }

  const unverifiedSources = (project.sources || []).filter(s => s.verificationStatus !== 'VERIFIED');
  if (unverifiedSources.length > 0) {
    warnings.push({
      id: 'warn-unverified-sources',
      severity: 'warning',
      prioritySeverity: 'medium',
      verificationOrigin: 'unverified',
      rule: 'Source Register Human Sign-Off',
      description: `${unverifiedSources.length} registered source(s) still marked "${unverifiedSources[0].verificationStatus}" (human verifier & date recommended).`,
      stage: 1,
      affectedSection: 'Source Register',
      recommendedFix: 'Open Source Register to verify authority and record verifier name.',
    });
  }

  // 10. Practical Accessibility Checks
  const accSummary = runAccessibilityChecks(project);
  for (const chk of accSummary.checks) {
    if (chk.status === 'fail' && chk.id === 'acc-navigation') {
      warnings.push({
        id: `warn-${chk.id}`,
        severity: 'warning',
        prioritySeverity: 'medium',
        verificationOrigin: 'automated',
        rule: chk.label,
        description: chk.details,
        stage: 5,
        affectedSection: chk.affectedSections[0] || 'Stage 5 · Module Structure',
        recommendedFix: 'Add missing module introduction/summary in Stage 5 for learner orientation.',
      });
    } else if (chk.status !== 'pass') {
      warnings.push({
        id: `warn-${chk.id}`,
        severity: 'warning',
        prioritySeverity: chk.status === 'fail' ? 'high' : 'low',
        verificationOrigin: 'automated',
        rule: chk.label,
        description: chk.details,
        stage: 5,
        affectedSection: chk.affectedSections[0] || 'Stage 5 · Learning Content',
        recommendedFix: 'Improve readability, chunking, or visual alt-captions in Stage 5.',
      });
    }
  }

  // 11. Informational Feedback
  informationalFeedback.push({
    id: 'info-metrics',
    severity: 'info',
    prioritySeverity: 'low',
    verificationOrigin: 'automated',
    rule: 'Course Readiness Telemetry',
    description: `${currModules.length} curriculum module(s), ${genModules.reduce((s, m) => s + m.lessons.length, 0)} generated lesson(s) (${activeMinutes} min reconciled total), ${allOutcomes.length} measurable outcome(s), ${items.length} assessment item(s), and ${alignmentReport.scorePercent}% 3-way alignment score.`,
    stage: 6,
    affectedSection: 'Course Summary',
    recommendedFix: 'No action needed.',
  });

  if (accSummary.limitationsNote) {
    informationalFeedback.push({
      id: 'info-accessibility-scope',
      severity: 'info',
      prioritySeverity: 'low',
      verificationOrigin: 'automated',
      rule: 'Automated Accessibility Scope Limitation',
      description: accSummary.limitationsNote,
      stage: 6,
      affectedSection: 'Accessibility Audit',
      recommendedFix: 'Perform human keyboard & screen-reader inspection in your target LMS before claiming WCAG 2.1 AA compliance.',
    });
  }

  if (project.brief.saCompliance?.enabled) {
    informationalFeedback.push({
      id: 'info-sa-disclaimer',
      severity: 'info',
      prioritySeverity: 'low',
      verificationOrigin: 'expert_review_required',
      rule: 'South African Alignment Governance Reminder',
      description:
        'NQF / QCTO / SAQA / SETA alignment tags prepare the programme for formal academic or regulatory submission and do NOT establish formal accreditation on their own.',
      stage: 1,
      affectedSection: 'Stage 1 · SA Compliance Profile',
      recommendedFix: 'Verify formal submission package with your Quality Assurer.',
    });
  }

  return {
    dataSignature,
    blockingErrors,
    warnings,
    informationalFeedback,
    unresolvedPlaceholders,
    totalPlannedMinutes,
    totalGeneratedMinutes,
    declaredDurationHours,
    durationValidation,
    assessmentValidation,
    sourceVerificationSummary: domainAudit.sourceVerificationSummary,
  };
}

export interface PreExportIssue {
  id: string;
  tier: 'critical_blocker' | 'advisory_polish';
  stage: WorkflowStage;
  title: string;
  description: string;
  recommendedFix: string;
}

export interface PreExportCompletenessReport {
  readyForExport: boolean;
  criticalBlockers: PreExportIssue[];
  advisoryPolish: PreExportIssue[];
  summary: string;
}

export function runPreExportCompletenessCheck(
  project: CourseProject
): PreExportCompletenessReport {
  const audit = runStructuralAndConsistencyAudit(project);
  const criticalBlockers: PreExportIssue[] = audit.blockingErrors.map(err => ({
    id: err.id,
    tier: 'critical_blocker',
    stage: err.stage,
    title: err.rule,
    description: err.description,
    recommendedFix: err.recommendedFix,
  }));

  const advisoryPolish: PreExportIssue[] = audit.warnings.map(warn => ({
    id: warn.id,
    tier: 'advisory_polish',
    stage: warn.stage,
    title: warn.rule,
    description: warn.description,
    recommendedFix: warn.recommendedFix,
  }));

  if (!project.assessments?.thresholdsConfirmed && (project.assessments?.items?.length || 0) > 0) {
    advisoryPolish.push({
      id: 'adv-thresholds-unconfirmed',
      tier: 'advisory_polish',
      stage: 4,
      title: 'Assessment Weighting & Pass Mark Client Confirmation',
      description:
        'Assessment weighting split and pass mark are still marked as proposed/unconfirmed and should be confirmed with the client.',
      recommendedFix:
        'Confirm weighting split and pass requirement in Stage 4 once client/stakeholder approval is recorded.',
    });
  }

  const unresolvedCompliance = getUnresolvedComplianceRequirements(project);
  if (unresolvedCompliance.length > 0) {
    advisoryPolish.push({
      id: 'adv-compliance-confirmations',
      tier: 'advisory_polish',
      stage: unresolvedCompliance.some(r => r.stage === 4) ? 4 : 1,
      title: 'Client Compliance & Accreditation Confirmations Pending',
      description: `${unresolvedCompliance.length} compliance/governance field(s) remain unconfirmed (${unresolvedCompliance.slice(0, 3).map(r => r.label).join(', ')}).`,
      recommendedFix:
        'Confirm or mark Not Applicable in Stage 1/Stage 4 before final commercial sign-off.',
    });
  }

  const signOffRoles = project.latestQA?.humanSignOff?.roles;
  const approvedEntries = signOffRoles
    ? [
        signOffRoles.sme,
        signOffRoles.instructionalDesigner,
        signOffRoles.complianceAuthorizer,
      ].filter(
        r =>
          r &&
          r.signedOff &&
          r.status !== 'rejected' &&
          Boolean(r.reviewerUserId) &&
          Boolean(r.signedOffAt)
      )
    : [];
  const distinctApproverCount = new Set(approvedEntries.map(r => r.reviewerUserId)).size;
  if (approvedEntries.length < 3 || distinctApproverCount < 3) {
    advisoryPolish.push({
      id: 'adv-governance-signoffs',
      tier: 'advisory_polish',
      stage: 6,
      title: 'Three-Role Human Governance Sign-Off Pending',
      description: `${approvedEntries.length}/3 governance role approvals (${distinctApproverCount} distinct reviewer(s)) recorded (SME, Instructional Designer, Compliance Authoriser).`,
      recommendedFix:
        'Complete all three distinct authenticated approvals in Stage 6 before formal publishing.',
    });
  }

  const readyForExport = criticalBlockers.length === 0;
  const summary = readyForExport
    ? advisoryPolish.length === 0
      ? 'Course passed all critical release checks and advisory quality checks.'
      : `Ready for draft export (${advisoryPolish.length} advisory polish recommendation(s) noted).`
    : `${criticalBlockers.length} critical release blocker(s) must be resolved before final release.`;

  return {
    readyForExport,
    criticalBlockers,
    advisoryPolish,
    summary,
  };
}
