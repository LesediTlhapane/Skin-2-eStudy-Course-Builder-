import type {
  AlignmentFlag,
  AlignmentMatrixRow,
  AlignmentReport,
  AssessmentItem,
  CourseProject,
  LearningOutcome,
} from '../types.js';

const VAGUE_VERBS_REGEX =
  /\b(understand|know about|learn about|be aware of|appreciate|familiarise with|familiarize with)\b/i;

const HIGHER_ORDER_BLOOM = new Set(['Apply', 'Analyze', 'Evaluate', 'Create']);
const PRACTICAL_ASSESSMENT_TYPES = new Set([
  'practical_task',
  'competency_demo',
  'case_study',
  'branching_scenario',
  'problem_solving',
]);

export function detectVagueOutcomeWarning(statement: string): string | undefined {
  const match = statement.match(VAGUE_VERBS_REGEX);
  if (!match) return undefined;
  return `Uses non-measurable verb "${match[0]}". Replace with an observable action verb (e.g., Calculate, Demonstrate, Diagnose, Evaluate, Formulate).`;
}

export function computeClientAlignmentFlags(
  courseOutcomes: LearningOutcome[],
  moduleOutcomes: LearningOutcome[],
  items: AssessmentItem[]
): AlignmentFlag[] {
  const flags: AlignmentFlag[] = [];
  const allOutcomes = [...courseOutcomes, ...moduleOutcomes];
  const outcomeIdSet = new Set(allOutcomes.map(o => o.id));

  for (const out of allOutcomes) {
    const mapped = items.filter(it => Array.isArray(it.outcomeIds) && it.outcomeIds.includes(out.id));
    if (mapped.length === 0) {
      flags.push({
        id: `flag-unassessed-${out.id}`,
        severity: 'critical',
        category: 'unassessed_outcome',
        message: `${out.code} ("${out.statement.slice(0, 65)}...") has no mapped assessment evidence.`,
        targetId: out.id,
      });
    } else {
      const expectsPractical = HIGHER_ORDER_BLOOM.has(out.bloomLevel);
      const hasPractical = mapped.some(
        it =>
          it.assessmentDomain === 'practical' ||
          PRACTICAL_ASSESSMENT_TYPES.has(it.type)
      );
      if (expectsPractical && !hasPractical && mapped.every(it => it.type === 'mcq')) {
        flags.push({
          id: `flag-recall-${out.id}`,
          severity: 'warning',
          category: 'recall_when_practical_expected',
          message: `${out.code} (${out.bloomLevel}) is only tested by recall MCQs; include a practical task, scenario, or competency demonstration.`,
          targetId: out.id,
        });
      }

      if (expectsPractical && hasPractical) {
        const lacksRubricOrGuide = mapped.every(
          it => (!it.rubric || it.rubric.length === 0) && !it.markingGuide?.trim()
        );
        if (lacksRubricOrGuide) {
          flags.push({
            id: `flag-competence-evidence-${out.id}`,
            severity: 'warning',
            category: 'insufficient_competence_evidence',
            message: `${out.code} expects applied competence, but its mapped assessments lack evaluation rubrics or marking criteria.`,
            targetId: out.id,
          });
        }
      }
    }
  }

  for (const item of items) {
    if (!item.outcomeIds || item.outcomeIds.length === 0) {
      flags.push({
        id: `flag-unmapped-${item.id}`,
        severity: 'warning',
        category: 'uncovered_assessment',
        message: `Assessment "${item.title}" is not mapped to any learning outcome.`,
        targetId: item.id,
      });
    } else {
      const invalidRefs = (Array.isArray(item.outcomeIds) ? item.outcomeIds : []).filter(
        id => !outcomeIdSet.has(id)
      );
      if (invalidRefs.length > 0) {
        flags.push({
          id: `flag-invalid-ref-${item.id}`,
          severity: 'critical',
          category: 'uncovered_assessment',
          message: `Assessment "${item.title}" links to removed outcome IDs.`,
          targetId: item.id,
        });
      }
    }

    if (item.type === 'mcq' || item.type === 'multi_response') {
      const opts = Array.isArray(item.options) ? item.options : [];
      const keys = Array.isArray(item.correctIndices) ? item.correctIndices : [];
      const hasOutOfRangeKey = keys.some(
        idx => !Number.isInteger(idx) || idx < 0 || idx >= opts.length
      );
      if (opts.length < 2 || keys.length === 0 || hasOutOfRangeKey) {
        flags.push({
          id: `flag-key-${item.id}`,
          severity: 'critical',
          category: 'ambiguous_item',
          message: `Assessment "${item.title}" has missing options (<2), no answer key, or an out-of-range correct index.`,
          targetId: item.id,
        });
      } else {
        const normalizedOpts = opts.map(o => String(o || '').trim().toLowerCase()).filter(Boolean);
        const hasDuplicateOpts =
          normalizedOpts.length !== opts.length ||
          new Set(normalizedOpts).size < normalizedOpts.length;
        const hasGiveawayOpt = opts.some(o =>
          /\b(all of the above|none of the above|all the above|none the above)\b/i.test(String(o || ''))
        );
        if (hasDuplicateOpts) {
          flags.push({
            id: `flag-dup-opts-${item.id}`,
            severity: 'warning',
            category: 'weak_distractors',
            message: `Assessment "${item.title}" contains blank or duplicate answer options.`,
            targetId: item.id,
          });
        } else if (opts.length < 4 || hasGiveawayOpt) {
          flags.push({
            id: `flag-weak-distractors-${item.id}`,
            severity: 'warning',
            category: 'weak_distractors',
            message: `Assessment "${item.title}" should use at least 4 plausible options without "all/none of the above" giveaways.`,
            targetId: item.id,
          });
        }
      }
    }

    if (!item.modelAnswer?.trim() && !item.markingGuide?.trim()) {
      flags.push({
        id: `flag-evidence-${item.id}`,
        severity: 'warning',
        category: 'missing_evidence',
        message: `Assessment "${item.title}" is missing a model answer or marking guide.`,
        targetId: item.id,
      });
    }
  }

  return flags;
}

interface LessonActivityNode {
  id: string;
  title: string;
  moduleId: string;
  source: 'planned' | 'generated';
  explicitOutcomeIds?: string[];
}

function collectLessonActivityNodes(project: CourseProject): LessonActivityNode[] {
  const nodes: LessonActivityNode[] = [];
  const generatedByPlanId = new Map<string, { id: string; title: string; outcomeIds?: string[] }>();

  for (const gm of project.content.modules || []) {
    for (const gl of gm.lessons || []) {
      if (gl.lessonPlanId) {
        generatedByPlanId.set(gl.lessonPlanId, {
          id: gl.id,
          title: gl.title,
          outcomeIds: gl.outcomeIds,
        });
      } else {
        nodes.push({
          id: gl.id,
          title: `${gm.title}: ${gl.title}`,
          moduleId: gm.moduleId,
          source: 'generated',
          explicitOutcomeIds: gl.outcomeIds,
        });
      }
    }
  }

  for (const pm of project.curriculum.modules || []) {
    for (const pl of pm.lessons || []) {
      const gen = generatedByPlanId.get(pl.id);
      if (gen) {
        nodes.push({
          id: gen.id,
          title: `M${pm.order}: ${gen.title}`,
          moduleId: pm.id,
          source: 'generated',
          explicitOutcomeIds: gen.outcomeIds !== undefined ? gen.outcomeIds : pl.outcomeIds,
        });
      } else {
        nodes.push({
          id: pl.id,
          title: `M${pm.order}: ${pl.title}`,
          moduleId: pm.id,
          source: 'planned',
          explicitOutcomeIds: pl.outcomeIds,
        });
      }
    }
  }

  return nodes;
}

export function computeFullAlignmentReport(project: CourseProject): AlignmentReport {
  const courseOutcomes = project.outcomes.courseOutcomes || [];
  const moduleOutcomes = project.outcomes.moduleOutcomes || [];
  const allOutcomes = [...courseOutcomes, ...moduleOutcomes];
  const outcomeIdSet = new Set(allOutcomes.map(o => o.id));
  const items = project.assessments.items || [];

  const assessmentFlags = computeClientAlignmentFlags(courseOutcomes, moduleOutcomes, items);
  const flags: AlignmentFlag[] = [...assessmentFlags];
  const lessonNodes = collectLessonActivityNodes(project);

  // Resolve lesson -> outcome links:
  // If explicitOutcomeIds is defined (even []), respect developer's explicit mapping.
  // Otherwise infer module-level mapping to moduleOutcomes in the same module (or courseOutcomes when course-wide).
  const lessonMappedOutcomes = new Map<string, string[]>();
  for (const node of lessonNodes) {
    if (node.explicitOutcomeIds !== undefined) {
      lessonMappedOutcomes.set(
        node.id,
        node.explicitOutcomeIds.filter(id => outcomeIdSet.has(id))
      );
    } else {
      const sameModuleOutcomes = moduleOutcomes
        .filter(mo => mo.moduleId === node.moduleId)
        .map(mo => mo.id);
      lessonMappedOutcomes.set(
        node.id,
        sameModuleOutcomes.length > 0
          ? sameModuleOutcomes
          : courseOutcomes.map(co => co.id)
      );
    }
  }

  const unmappedLessonIds: string[] = [];
  for (const node of lessonNodes) {
    const linked = lessonMappedOutcomes.get(node.id) || [];
    if (linked.length === 0) {
      unmappedLessonIds.push(node.id);
      flags.push({
        id: `flag-orphan-lesson-${node.id}`,
        severity: 'warning',
        category: 'orphan_lesson',
        message: `Lesson/activity "${node.title}" is not mapped to support any learning outcome.`,
        targetId: node.id,
      });
    }
  }

  const rows: AlignmentMatrixRow[] = [];
  let outcomeScoreTotal = 0;

  for (const out of allOutcomes) {
    let teachingLessons = lessonNodes.filter(node =>
      (lessonMappedOutcomes.get(node.id) || []).includes(out.id)
    );

    // Course-level outcomes synthesize across the course's taught modules & lessons.
    // Even if AI generation or manual editing pinned only CLO-1/CLO-2 to individual lessons,
    // remaining course-level outcomes are still taught when active module lessons exist across the programme.
    if (out.scope === 'course' && teachingLessons.length === 0) {
      teachingLessons = lessonNodes.filter(
        n =>
          (lessonMappedOutcomes.get(n.id)?.length || 0) > 0 ||
          n.explicitOutcomeIds === undefined
      );
    }

    const mappedAssessments = items.filter(
      it => Array.isArray(it.outcomeIds) && it.outcomeIds.includes(out.id)
    );

    if (teachingLessons.length === 0) {
      flags.push({
        id: `flag-untaught-${out.id}`,
        severity: 'critical',
        category: 'untaught_outcome',
        message: `${out.code} ("${out.statement.slice(0, 60)}...") has no mapped lesson or learning activity teaching it.`,
        targetId: out.id,
      });
    }

    const rowFlags = flags.filter(f => f.targetId === out.id);
    const hasCritical = rowFlags.some(f => f.severity === 'critical');
    const hasWarning = rowFlags.some(f => f.severity === 'warning');

    let points = 0;
    if (teachingLessons.length > 0) points += 40;
    if (mappedAssessments.length > 0) points += 40;
    if (!hasWarning && !hasCritical) points += 20;
    else if (!hasCritical) points += 10;
    outcomeScoreTotal += points;

    rows.push({
      outcomeId: out.id,
      outcomeCode: out.code,
      outcomeStatement: out.statement,
      bloomLevel: out.bloomLevel,
      learningActivities: teachingLessons.map(l => ({
        id: l.id,
        title: l.title,
        source: l.source,
      })),
      assessmentEvidence: mappedAssessments.map(a => ({
        id: a.id,
        title: a.title,
        type: a.type,
        domain: a.assessmentDomain,
      })),
      status: hasCritical ? 'critical' : hasWarning ? 'warning' : 'aligned',
      gapReason:
        rowFlags.length > 0 ? rowFlags.map(f => f.message).join(' ') : undefined,
    });
  }

  // Compute global alignment score with penalties for unmapped assessments & orphan lessons
  const baseOutcomeScore =
    allOutcomes.length > 0 ? outcomeScoreTotal / allOutcomes.length : 0;
  const orphanPenalty = Math.min(15, unmappedLessonIds.length * 4);
  const unmappedAssessmentCount = assessmentFlags.filter(
    f => f.category === 'uncovered_assessment'
  ).length;
  const assessmentPenalty = Math.min(15, unmappedAssessmentCount * 5);

  const scorePercent =
    allOutcomes.length === 0
      ? 0
      : Math.max(0, Math.min(100, Math.round(baseOutcomeScore - orphanPenalty - assessmentPenalty)));

  const criticalCount = flags.filter(f => f.severity === 'critical').length;
  const warningCount = flags.filter(f => f.severity === 'warning').length;
  const untaughtCount = flags.filter(f => f.category === 'untaught_outcome').length;
  const unassessedCount = flags.filter(f => f.category === 'unassessed_outcome').length;

  const explanation =
    allOutcomes.length === 0
      ? 'No learning outcomes have been defined yet in Stage 3.'
      : criticalCount === 0 && warningCount === 0
      ? `All ${allOutcomes.length} learning outcomes have traceable learning activities and valid assessment evidence.`
      : `Alignment score ${scorePercent}% across ${allOutcomes.length} outcomes: ${untaughtCount} untaught outcome(s), ${unassessedCount} unassessed outcome(s), ${unmappedLessonIds.length} unmapped lesson(s), and ${warningCount} pedagogical warning(s).`;

  return {
    scorePercent,
    explanation,
    disclaimer:
      'Constructive alignment indicator for instructional quality review only — does not declare regulatory accreditation or certification.',
    rows,
    flags,
    unmappedLessonIds,
  };
}
