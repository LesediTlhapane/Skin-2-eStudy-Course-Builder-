import type {
  CourseProject,
  QAIssueItem,
  WorkflowStage,
} from '../types';
import { computeFullAlignmentReport, detectVagueOutcomeWarning } from './alignmentHelpers';
import {
  runAccessibilityChecks,
  runTechnicalValidationChecks,
} from './validationChecks';

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
      passRequirementPercent: project.assessments?.passRequirementPercent,
      knowledgeWeightPercent: project.assessments?.knowledgeWeightPercent,
      practicalWeightPercent: project.assessments?.practicalWeightPercent,
      items: (project.assessments?.items || []).map(it => ({
        id: it.id,
        moduleId: it.moduleId,
        type: it.type,
        assessmentDomain: it.assessmentDomain,
        weightingPercent: it.weightingPercent,
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
        sourceClaims: (l.sourceClaims || []).map(sc => ({
          id: sc.id,
          status: sc.status,
          claim: sc.claim,
        })),
      })),
      scenarios: (cm.scenarios || []).map(s => ({ id: s.id, title: s.title, situation: s.situation })),
      workplaceCaseStudies: (cm.workplaceCaseStudies || []).map(c => ({
        id: c.id,
        title: c.title,
        background: c.background,
      })),
      knowledgeChecks: (cm.knowledgeChecks || []).map(k => ({
        id: k.id,
        question: k.question,
        correctIndex: k.correctIndex,
      })),
    })),
  };

  return fnv1aHash(JSON.stringify(canonical));
}

export function parseEstimatedHours(raw: string | undefined): number | null {
  if (!raw) return null;
  const text = raw.toLowerCase().trim();
  if (!text || text.includes('to be confirmed') || text === 'tbc') return null;

  const hoursMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hr|hrs|hour|hours)\b/i);
  if (hoursMatch) return Number(hoursMatch[1]);

  const daysMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:day|days)\b/i);
  if (daysMatch) return Number(daysMatch[1]) * 7;

  const minsMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:min|mins|minute|minutes)\b/i);
  if (minsMatch) return Math.round((Number(minsMatch[1]) / 60) * 10) / 10;

  return null;
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

  // 5. Stage 4 Assessments & Weights Integrity
  const assessments = project.assessments;
  const items = assessments.items || [];
  if (items.length === 0) {
    blockingErrors.push({
      id: 'blk-no-assessments',
      severity: 'blocking',
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
        rule: 'Valid Pass Threshold',
        description: `Pass requirement (${assessments.passRequirementPercent}%) must be between 1% and 100%.`,
        stage: 4,
        affectedSection: 'Stage 4 · Assessment Strategy',
        recommendedFix: 'Set pass mark between 50% and 100% in Stage 4.',
      });
    }
    const domainWeightSum =
      (Number(assessments.knowledgeWeightPercent) || 0) +
      (Number(assessments.practicalWeightPercent) || 0);
    if (domainWeightSum !== 100) {
      warnings.push({
        id: 'warn-domain-weight-sum',
        severity: 'warning',
        rule: 'Knowledge vs Practical Weight Balance',
        description: `Knowledge (${assessments.knowledgeWeightPercent}%) + Practical (${assessments.practicalWeightPercent}%) weights sum to ${domainWeightSum}% instead of 100%.`,
        stage: 4,
        affectedSection: 'Stage 4 · Assessment Strategy',
        recommendedFix: 'Adjust knowledge/practical weights to total 100% in Stage 4.',
      });
    }

    const itemWeightSum = items.reduce((s, it) => s + (Number(it.weightingPercent) || 0), 0);
    if (items.length > 0 && itemWeightSum !== 100) {
      warnings.push({
        id: 'warn-item-weights',
        severity: 'warning',
        rule: 'Assessment Item Weighting Total',
        description: `Assessment item weightings total ${itemWeightSum}% (recommended 100% across graded items).`,
        stage: 4,
        affectedSection: 'Stage 4 · Assessment Items',
        recommendedFix: 'Review item weightings in Stage 4.',
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

  // 8. Duration Consistency Check (Contradiction detection)
  const totalPlannedMinutes = currModules.reduce(
    (sum, m) => sum + (m.lessons || []).reduce((ls, l) => ls + (Number(l.durationMinutes) || 0), 0),
    0
  );
  const totalGeneratedMinutes = genModules.reduce(
    (sum, m) => sum + (m.lessons || []).reduce((ls, l) => ls + (Number(l.durationMinutes) || 0), 0),
    0
  );
  const declaredDurationHours = parseEstimatedHours(project.brief.estimatedDuration);
  const activeMinutes = totalGeneratedMinutes > 0 ? totalGeneratedMinutes : totalPlannedMinutes;
  if (declaredDurationHours && activeMinutes > 0) {
    const actualHours = activeMinutes / 60;
    const ratio = actualHours / declaredDurationHours;
    if (ratio < 0.45 || ratio > 1.75) {
      warnings.push({
        id: 'warn-duration-contradiction',
        severity: 'warning',
        rule: 'Course Duration Consistency',
        description: `Declared duration is "${project.brief.estimatedDuration}" (~${declaredDurationHours}h), while scheduled lesson times total ${Math.round(actualHours * 10) / 10}h (${activeMinutes} min). Note: practical/case-study time may explain differences.`,
        stage: 1,
        affectedSection: 'Stage 1 Duration vs Stage 2/5 Lesson Minutes',
        recommendedFix: 'Confirm estimatedDuration or adjust lesson durations to avoid learner time expectations mismatch.',
      });
    }
  }

  // 9. Source & Technical Grounding Checks
  const techSummary = runTechnicalValidationChecks(project);
  if (techSummary.unsupportedClaimsCount > 0 && project.brief.saCompliance?.enabled) {
    blockingErrors.push({
      id: 'blk-unsupported-regulated',
      severity: 'blocking',
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
      rule: 'Source Register Human Sign-Off',
      description: `${unverifiedSources.length} registered source(s) still marked "${unverifiedSources[0].verificationStatus}" (human verifier & date recommended).`,
      stage: 1,
      affectedSection: 'Source Register',
      recommendedFix: 'Open Source Register to verify authority and record verifier name.',
    });
  }

  // 10. Practical Accessibility Checks (non-blocking unless module intros/summaries completely missing)
  const accSummary = runAccessibilityChecks(project);
  for (const chk of accSummary.checks) {
    if (chk.status === 'fail' && chk.id === 'acc-navigation') {
      warnings.push({
        id: `warn-${chk.id}`,
        severity: 'warning',
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
    rule: 'Course Readiness Telemetry',
    description: `${currModules.length} curriculum module(s), ${genModules.reduce((s, m) => s + m.lessons.length, 0)} generated lesson(s) (${activeMinutes} min total), ${allOutcomes.length} measurable outcome(s), ${items.length} assessment item(s), and ${alignmentReport.scorePercent}% 3-way alignment score.`,
    stage: 6,
    affectedSection: 'Course Summary',
    recommendedFix: 'No action needed.',
  });

  if (accSummary.limitationsNote) {
    informationalFeedback.push({
      id: 'info-accessibility-scope',
      severity: 'info',
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
  };
}
