import type {
  AssessmentItem,
  AssessmentItemType,
  AssessmentRubricCriterion,
  BloomLevel,
  ContentClaimReference,
  CourseBrief,
  CourseIntroduction,
  CourseProject,
  CoverageStatus,
  CurriculumArchitecture,
  CurriculumModulePlan,
  GeneratedCaseStudyContent,
  GeneratedLessonContent,
  GeneratedModuleContent,
  GeneratedScenarioContent,
  LearningOutcome,
  LearningOutcomesPlan,
  ModuleKnowledgeCheckItem,
  SourceVerificationStatus,
} from '../types.js';
import { detectVagueOutcomeWarning } from './alignmentHelpers.js';
import { generateUniqueId } from './id.js';

const VALID_BLOOM_LEVELS: BloomLevel[] = [
  'Remember',
  'Understand',
  'Apply',
  'Analyze',
  'Evaluate',
  'Create',
];

const VALID_COVERAGE_STATUSES = new Set<CoverageStatus>([
  'mapped',
  'omitted',
  'generalised',
  'clarification_needed',
  'recommended',
]);

const VALID_ASSESSMENT_TYPES = new Set<AssessmentItemType>([
  'mcq',
  'multi_response',
  'matching',
  'sequencing',
  'short_answer',
  'case_study',
  'branching_scenario',
  'problem_solving',
  'practical_task',
  'competency_demo',
  'reflection',
]);

const PRACTICAL_DOMAIN_TYPES = new Set<AssessmentItemType>([
  'practical_task',
  'competency_demo',
  'case_study',
  'branching_scenario',
  'problem_solving',
]);

function cleanStr(val: unknown, fallback = ''): string {
  if (typeof val !== 'string') return fallback;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function cleanStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.map(v => String(v ?? '').trim()).filter(Boolean);
}

function normalizeBloomLevel(val: unknown): BloomLevel {
  const raw = String(val || '').trim().toLowerCase();
  const matched = VALID_BLOOM_LEVELS.find(b => b.toLowerCase() === raw);
  return matched || 'Apply';
}

function normalizeClaimStatus(val: unknown): SourceVerificationStatus {
  const up = String(val || '').trim().toUpperCase();
  if (up === 'VERIFIED' || up === 'UNSUPPORTED' || up === 'NEEDS REVIEW') {
    return up;
  }
  return 'NEEDS REVIEW';
}

/**
 * Ensures Stage 2 AI curriculum proposals have clean sequential module numbering,
 * positive lesson durations, valid topics/lessons arrays, and safe coverageChecks/conflicts.
 */
export function normalizeCurriculumProposal(
  raw: any,
  brief: CourseBrief
): CurriculumArchitecture {
  const rawModules = Array.isArray(raw?.modules) ? raw.modules : [];
  const allowedQcto = new Set([
    'Knowledge Module',
    'Practical Skill Module',
    'Work Experience Module',
    'Standard Module',
  ]);

  const modules: CurriculumModulePlan[] = rawModules
    .filter((m: any) => m && typeof m === 'object')
    .map((m: any, idx: number) => {
      const modId = cleanStr(m.id) || generateUniqueId(`mod-${idx + 1}`);
      const qctoRaw = cleanStr(m.qctoModuleType, 'Standard Module');
      const qctoModuleType = (
        brief.saCompliance?.qctoModulePattern && allowedQcto.has(qctoRaw)
          ? qctoRaw
          : 'Standard Module'
      ) as CurriculumModulePlan['qctoModuleType'];

      const rawTopics = Array.isArray(m.topics) ? m.topics : [];
      const topics = rawTopics
        .filter((t: any) => t && (cleanStr(t.title) || Array.isArray(t.subtopics)))
        .map((t: any, tIdx: number) => ({
          id: cleanStr(t.id) || `top-${idx + 1}-${tIdx + 1}`,
          title: cleanStr(t.title, `Topic ${idx + 1}.${tIdx + 1}`),
          subtopics: cleanStringArray(t.subtopics),
        }));

      const rawLessons = Array.isArray(m.lessons) ? m.lessons : [];
      const lessons = rawLessons
        .filter((l: any) => l && typeof l === 'object')
        .map((l: any, lIdx: number) => {
          const parsedMin = Number(l.durationMinutes);
          const durationMinutes =
            Number.isFinite(parsedMin) && parsedMin > 0
              ? Math.min(240, Math.max(10, Math.round(parsedMin)))
              : 35;
          return {
            id: cleanStr(l.id) || `les-${idx + 1}-${lIdx + 1}`,
            title: cleanStr(l.title, `Lesson ${idx + 1}.${lIdx + 1}`),
            durationMinutes,
            purpose: cleanStr(l.purpose, `Develop capability on ${cleanStr(m.title, 'module concepts')}.`),
            keyTerms: cleanStringArray(l.keyTerms),
            ...(Array.isArray(l.outcomeIds) ? { outcomeIds: cleanStringArray(l.outcomeIds) } : {}),
          };
        });

      return {
        id: modId,
        order: idx + 1,
        title: cleanStr(m.title, `Module ${idx + 1}`),
        qctoModuleType,
        purpose: cleanStr(m.purpose, `Build structured competence in Module ${idx + 1}.`),
        objectives: cleanStringArray(m.objectives),
        competencies: cleanStringArray(m.competencies),
        topics:
          topics.length > 0
            ? topics
            : [{ id: `top-${idx + 1}-1`, title: cleanStr(m.title, `Module ${idx + 1} Core Topic`), subtopics: [] }],
        lessons:
          lessons.length > 0
            ? lessons
            : [
                {
                  id: `les-${idx + 1}-1`,
                  title: `${cleanStr(m.title, `Module ${idx + 1}`)} Foundations`,
                  durationMinutes: 35,
                  purpose: cleanStr(m.purpose, 'Core concept introduction and workplace application.'),
                  keyTerms: [],
                },
              ],
      };
    });

  const validModIds = new Set(modules.map(m => m.id));
  const rawCoverage = Array.isArray(raw?.coverageChecks) ? raw.coverageChecks : [];
  const coverageChecks = rawCoverage
    .filter((c: any) => c && cleanStr(c.originalTopic))
    .map((c: any, idx: number) => {
      const statusRaw = cleanStr(c.status, 'mapped') as CoverageStatus;
      const status = VALID_COVERAGE_STATUSES.has(statusRaw) ? statusRaw : 'mapped';
      const mappedModuleId = cleanStr(c.mappedModuleId);
      return {
        id: cleanStr(c.id) || `cov-${idx + 1}`,
        originalTopic: cleanStr(c.originalTopic),
        status,
        mappedModuleId: validModIds.has(mappedModuleId) ? mappedModuleId : undefined,
        mappedLocation: cleanStr(c.mappedLocation, status === 'omitted' ? 'Not mapped' : 'Module 1'),
        notes: cleanStr(c.notes),
      };
    });

  const rawConflicts = Array.isArray(raw?.conflicts) ? raw.conflicts : [];
  const conflicts = rawConflicts
    .filter((c: any) => c && cleanStr(c.description))
    .map((c: any, idx: number) => ({
      id: cleanStr(c.id) || `conf-${idx + 1}`,
      description: cleanStr(c.description),
      resolved: Boolean(c.resolved),
      ...(cleanStr(c.decision) ? { decision: cleanStr(c.decision) } : {}),
    }));

  return {
    rationale: cleanStr(raw?.rationale),
    modules,
    coverageChecks,
    conflicts,
    approval: { approved: false },
  };
}

/**
 * Ensures Stage 3 learning outcomes have unique codes, valid moduleId links,
 * observable Bloom levels, and vague-verb warnings populated cleanly.
 */
export function normalizeLearningOutcomesPlan(
  raw: any,
  curriculum: CurriculumArchitecture
): LearningOutcomesPlan {
  const validModuleIds = new Set((curriculum.modules || []).map(m => m.id));
  const fallbackModuleId = curriculum.modules?.[0]?.id;
  const seenCodes = new Set<string>();

  const dedupeCode = (rawCode: string, prefix: string, idx: number): string => {
    let candidate = cleanStr(rawCode) || `${prefix}-${idx + 1}`;
    let counter = 2;
    while (seenCodes.has(candidate.toUpperCase())) {
      candidate = `${prefix}-${idx + 1}-${counter++}`;
    }
    seenCodes.add(candidate.toUpperCase());
    return candidate;
  };

  const normalizeOutcomeList = (list: any[], scope: 'course' | 'module'): LearningOutcome[] =>
    (Array.isArray(list) ? list : [])
      .filter(o => o && cleanStr(o.statement))
      .map((o, idx) => {
        const statement = cleanStr(o.statement);
        const code = dedupeCode(o.code, scope === 'course' ? 'CLO' : 'MLO', idx);
        const rawVerb = cleanStr(o.actionVerb) || statement.split(/\s+/)[0] || 'Demonstrate';
        const modId =
          scope === 'module'
            ? validModuleIds.has(cleanStr(o.moduleId))
              ? cleanStr(o.moduleId)
              : fallbackModuleId
            : undefined;
        return {
          id: cleanStr(o.id) || `${scope === 'course' ? 'co' : 'mo'}-${idx + 1}`,
          scope,
          ...(modId ? { moduleId: modId } : {}),
          code,
          actionVerb: rawVerb.replace(/[^a-zA-Z-]/g, '') || 'Demonstrate',
          bloomLevel: normalizeBloomLevel(o.bloomLevel),
          statement,
          workplacePerformance: cleanStr(
            o.workplacePerformance,
            'Demonstrates accurate performance against workplace criteria.'
          ),
          ...(cleanStr(o.nqfAlignmentNote) ? { nqfAlignmentNote: cleanStr(o.nqfAlignmentNote) } : {}),
          vagueWarning: detectVagueOutcomeWarning(statement),
        };
      });

  return {
    courseOutcomes: normalizeOutcomeList(raw?.courseOutcomes, 'course'),
    moduleOutcomes: normalizeOutcomeList(raw?.moduleOutcomes, 'module'),
    durationRealismNote: cleanStr(raw?.durationRealismNote),
    nqfSummaryNote: cleanStr(raw?.nqfSummaryNote),
    approval: { approved: false },
  };
}

function rebalanceWeightsToTarget(weights: number[], targetTotal: number): number[] {
  if (weights.length === 0) return [];
  const safeWeights = weights.map(w => (Number.isFinite(w) && w > 0 ? w : 1));
  const sum = safeWeights.reduce((s, w) => s + w, 0);
  if (sum <= 0) {
    const base = Math.floor(targetTotal / weights.length);
    let rem = targetTotal - base * weights.length;
    return weights.map(() => base + (rem-- > 0 ? 1 : 0));
  }
  const scaled = safeWeights.map(w => Math.max(1, Math.round((w / sum) * targetTotal)));
  let diff = targetTotal - scaled.reduce((s, w) => s + w, 0);
  let cursor = 0;
  while (diff !== 0 && cursor < 500) {
    const idx = cursor % scaled.length;
    if (diff > 0) {
      scaled[idx] += 1;
      diff -= 1;
    } else if (scaled[idx] > 1) {
      scaled[idx] -= 1;
      diff += 1;
    }
    cursor++;
  }
  return scaled;
}

function normalizeRubricCriteria(rawRubric: any): AssessmentRubricCriterion[] {
  const list = (Array.isArray(rawRubric) ? rawRubric : [])
    .filter(r => r && cleanStr(r.criterion))
    .map(r => ({
      criterion: cleanStr(r.criterion),
      weightPercent: Number(r.weightPercent) || 0,
      competentStandard: cleanStr(
        r.competentStandard,
        'Meets operational accuracy and workplace quality standards.'
      ),
      notYetCompetentIndicator: cleanStr(
        r.notYetCompetentIndicator,
        'Incomplete execution, inaccurate reasoning, or missed safety/compliance steps.'
      ),
    }));
  if (list.length === 0) return [];
  const balanced = rebalanceWeightsToTarget(
    list.map(r => r.weightPercent),
    100
  );
  return list.map((r, idx) => ({ ...r, weightPercent: balanced[idx] }));
}

function normalizeOptionListAndKey(
  rawOptions: unknown,
  rawIndices: unknown,
  isMulti: boolean
): { options: string[]; correctIndices: number[] } {
  const seen = new Set<string>();
  const options: string[] = [];
  const origToNextIdx = new Map<number, number>();

  (Array.isArray(rawOptions) ? rawOptions : []).forEach((opt, origIdx) => {
    const text = cleanStr(opt);
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    origToNextIdx.set(origIdx, options.length);
    options.push(text);
  });

  const mappedKeys = (Array.isArray(rawIndices) ? rawIndices : [])
    .map(i => origToNextIdx.get(Number(i)))
    .filter((i): i is number => typeof i === 'number' && i >= 0 && i < options.length);

  let correctIndices = Array.from(new Set(mappedKeys)).sort((a, b) => a - b);
  if (options.length > 0 && correctIndices.length === 0) {
    correctIndices = [0];
  } else if (!isMulti && correctIndices.length > 1) {
    correctIndices = [correctIndices[0]];
  }

  return { options, correctIndices };
}

/**
 * Normalizes Stage 4 AI assessment design: validates types, bounds MCQ keys,
 * enforces strict 100% domain weighting reconciliation, ensures rubric weights = 100%,
 * and forces thresholdsConfirmed = false so human approval is always explicit.
 */
export function normalizeAssessmentPlanOutput(
  raw: any,
  outcomes: LearningOutcomesPlan
): {
  strategySummary: string;
  passRequirementPercent: number;
  knowledgeWeightPercent: number;
  practicalWeightPercent: number;
  thresholdsConfirmed: boolean;
  items: AssessmentItem[];
} {
  const allOutcomes = [...(outcomes.courseOutcomes || []), ...(outcomes.moduleOutcomes || [])];
  const validOutcomeIds = new Set(allOutcomes.map(o => o.id));
  const fallbackOutcomeId = allOutcomes[0]?.id;

  const rawPass = Number(raw?.passRequirementPercent);
  const passRequirementPercent =
    Number.isFinite(rawPass) && rawPass >= 50 && rawPass <= 100 ? Math.round(rawPass) : 70;

  let knowledgeWeightPercent = Number(raw?.knowledgeWeightPercent);
  let practicalWeightPercent = Number(raw?.practicalWeightPercent);
  if (
    !Number.isFinite(knowledgeWeightPercent) ||
    knowledgeWeightPercent < 0 ||
    knowledgeWeightPercent > 100
  ) {
    knowledgeWeightPercent = 40;
  }
  knowledgeWeightPercent = Math.round(knowledgeWeightPercent);
  if (
    !Number.isFinite(practicalWeightPercent) ||
    knowledgeWeightPercent + practicalWeightPercent !== 100
  ) {
    practicalWeightPercent = 100 - knowledgeWeightPercent;
  }

  const rawItems = Array.isArray(raw?.items) ? raw.items : [];
  let items: AssessmentItem[] = rawItems
    .filter((it: any) => it && typeof it === 'object' && (cleanStr(it.title) || cleanStr(it.promptOrQuestion)))
    .map((it: any, idx: number) => {
      const rawType = cleanStr(it.type, 'practical_task') as AssessmentItemType;
      const type = VALID_ASSESSMENT_TYPES.has(rawType) ? rawType : 'practical_task';
      const domainRaw = cleanStr(it.assessmentDomain).toLowerCase();
      const assessmentDomain: 'knowledge' | 'practical' =
        domainRaw === 'knowledge' || domainRaw === 'practical'
          ? (domainRaw as 'knowledge' | 'practical')
          : PRACTICAL_DOMAIN_TYPES.has(type)
          ? 'practical'
          : 'knowledge';
      const classification: 'formative' | 'summative' =
        cleanStr(it.classification).toLowerCase() === 'formative' ? 'formative' : 'summative';

      const mappedOutcomeIds = cleanStringArray(it.outcomeIds).filter(id => validOutcomeIds.has(id));
      const outcomeIds =
        mappedOutcomeIds.length > 0
          ? mappedOutcomeIds
          : fallbackOutcomeId
          ? [fallbackOutcomeId]
          : [];

      const isChoiceType = type === 'mcq' || type === 'multi_response';
      const { options, correctIndices } = isChoiceType
        ? normalizeOptionListAndKey(it.options, it.correctIndices, type === 'multi_response')
        : { options: undefined, correctIndices: undefined };

      const durationRaw = Number(it.durationMinutes);
      const durationMinutes =
        Number.isFinite(durationRaw) && durationRaw > 0
          ? Math.round(durationRaw)
          : assessmentDomain === 'practical'
          ? 35
          : 20;

      const rubric = normalizeRubricCriteria(it.rubric);
      const safeMarkingGuide =
        cleanStr(it.markingGuide) ||
        (rubric.length > 0
          ? `Assess learner evidence against the ${rubric.length}-criterion weighted rubric (${passRequirementPercent}% minimum pass threshold).`
          : cleanStr(it.explanation, 'Verify conceptual accuracy and completeness against the model answer.'));

      return {
        id: cleanStr(it.id) || `assess-${idx + 1}`,
        ...(cleanStr(it.moduleId) ? { moduleId: cleanStr(it.moduleId) } : {}),
        title: cleanStr(it.title, `Assessment ${idx + 1}`),
        type,
        assessmentDomain,
        classification,
        outcomeIds,
        weightingPercent: Number(it.weightingPercent) || 10,
        durationMinutes,
        objective: cleanStr(it.objective, 'Verify applied workplace mastery of target learning outcomes.'),
        instructions: cleanStr(
          it.instructions,
          isChoiceType
            ? 'Select the most accurate response based on the workplace scenario.'
            : 'Complete the structured task below and submit your documented response.'
        ),
        promptOrQuestion: cleanStr(it.promptOrQuestion, cleanStr(it.title, `Assessment ${idx + 1}`)),
        ...(options ? { options, correctIndices } : {}),
        ...(Array.isArray(it.matchingPairs) && it.matchingPairs.length > 0
          ? { matchingPairs: it.matchingPairs }
          : {}),
        ...(Array.isArray(it.sequenceSteps) && it.sequenceSteps.length > 0
          ? { sequenceSteps: cleanStringArray(it.sequenceSteps) }
          : {}),
        modelAnswer: cleanStr(
          it.modelAnswer,
          isChoiceType && options && correctIndices && correctIndices.length > 0
            ? `Correct option(s): ${correctIndices.map(ci => `${String.fromCharCode(65 + ci)}) ${options[ci]}`).join('; ')}`
            : 'A complete response addresses every criterion listed in the marking guide with workplace evidence.'
        ),
        explanation: cleanStr(it.explanation, 'Assesses alignment to target learning outcomes.'),
        feedbackCorrect: cleanStr(it.feedbackCorrect, 'Correct — your response demonstrates the required standard.'),
        feedbackIncorrect: cleanStr(
          it.feedbackIncorrect,
          'Review the lesson explanation and worked example before attempting again.'
        ),
        markingGuide: safeMarkingGuide,
        rubric,
      };
    });

  // Ensure every outcome is mapped to at least one item if items exist
  if (items.length > 0 && allOutcomes.length > 0) {
    const assessed = new Set(items.flatMap(it => it.outcomeIds));
    const missingOutcomes = allOutcomes.filter(o => !assessed.has(o.id));
    for (const missing of missingOutcomes) {
      const modMatch =
        (missing.moduleId && items.find(it => it.moduleId === missing.moduleId)) ||
        items[items.length - 1];
      if (modMatch) {
        modMatch.outcomeIds = Array.from(new Set([...modMatch.outcomeIds, missing.id]));
      }
    }
  }

  // Strictly reconcile item weights to knowledgeWeightPercent / practicalWeightPercent = 100
  if (items.length > 0) {
    const kItems = items.filter(it => it.assessmentDomain === 'knowledge');
    const pItems = items.filter(it => it.assessmentDomain === 'practical');
    if (kItems.length > 0 && pItems.length > 0) {
      if (knowledgeWeightPercent === 0 || practicalWeightPercent === 0) {
        knowledgeWeightPercent = 40;
        practicalWeightPercent = 60;
      }
      const kBalanced = rebalanceWeightsToTarget(
        kItems.map(it => it.weightingPercent),
        knowledgeWeightPercent
      );
      const pBalanced = rebalanceWeightsToTarget(
        pItems.map(it => it.weightingPercent),
        practicalWeightPercent
      );
      kItems.forEach((it, i) => {
        it.weightingPercent = kBalanced[i];
      });
      pItems.forEach((it, i) => {
        it.weightingPercent = pBalanced[i];
      });
    } else if (kItems.length > 0) {
      knowledgeWeightPercent = 100;
      practicalWeightPercent = 0;
      const balanced = rebalanceWeightsToTarget(
        kItems.map(it => it.weightingPercent),
        100
      );
      kItems.forEach((it, i) => {
        it.weightingPercent = balanced[i];
      });
    } else if (pItems.length > 0) {
      knowledgeWeightPercent = 0;
      practicalWeightPercent = 100;
      const balanced = rebalanceWeightsToTarget(
        pItems.map(it => it.weightingPercent),
        100
      );
      pItems.forEach((it, i) => {
        it.weightingPercent = balanced[i];
      });
    }
  }

  const rawSummary = cleanStr(raw?.strategySummary);
  const strategySummary = rawSummary
    ? rawSummary.replace(
        /pass\s*(?:mark|requirement|threshold)?\s*(?:of|is|:)?\s*\d{2,3}%/i,
        `pass mark of ${passRequirementPercent}%`
      )
    : `Balanced assessment strategy combining ${knowledgeWeightPercent}% knowledge evaluation and ${practicalWeightPercent}% practical application (total 100%), with an AI-proposed pass threshold of ${passRequirementPercent}% subject to client confirmation.`;

  return {
    strategySummary,
    passRequirementPercent,
    knowledgeWeightPercent,
    practicalWeightPercent,
    thresholdsConfirmed: false,
    items,
  };
}

/**
 * Ensures the Course Introduction includes all 6 structured instructional sections
 * grounded in the project without falling back to empty shells.
 */
export function normalizeCourseIntroduction(
  raw: any,
  project: CourseProject
): CourseIntroduction {
  const b = project.brief;
  const mods = project.curriculum.modules || [];
  const outcomes = project.outcomes.courseOutcomes || [];
  const assessments = project.assessments;

  const fallbackWhy =
    b.workplaceProblem ||
    `This programme addresses practical operational capability in ${b.industryDomain || 'the workplace'}.`;
  const fallbackLearners = `${b.targetAudience || 'Practising workplace learners'}${
    b.targetJobRoles ? ` (Roles: ${b.targetJobRoles})` : ''
  } at ${b.experienceLevel || 'Intermediate'} level.`;
  const fallbackPrereq =
    b.prerequisites || 'Foundational familiarity with everyday workplace procedures and numeracy.';
  const fallbackOutcomes =
    outcomes.length > 0
      ? `Learners will achieve ${outcomes.length} course-level outcomes: ${outcomes
          .slice(0, 3)
          .map(o => `${o.code} (${o.actionVerb})`)
          .join(', ')}.`
      : 'Course outcomes focus on measurable workplace competence across all modules.';
  const fallbackRoadmap =
    mods.length > 0
      ? `Structured across ${mods.length} progressive modules (${b.estimatedDuration || 'scheduled duration'}): ${mods
          .map(m => `Module ${m.order}: ${m.title}`)
          .join(' -> ')}.`
      : 'Structured sequentially from foundational concepts to workplace synthesis.';
  const fallbackAssessment = `Assessment combines ${assessments.knowledgeWeightPercent}% knowledge checks and ${assessments.practicalWeightPercent}% practical workplace application (proposed pass threshold: ${assessments.passRequirementPercent}%, subject to stakeholder confirmation).`;

  return {
    whyThisMatters: cleanStr(raw?.whyThisMatters, fallbackWhy),
    intendedLearners: cleanStr(raw?.intendedLearners, fallbackLearners),
    prerequisitesSummary: cleanStr(raw?.prerequisitesSummary, fallbackPrereq),
    outcomesOverview: cleanStr(raw?.outcomesOverview, fallbackOutcomes),
    structureRoadmap: cleanStr(raw?.structureRoadmap, fallbackRoadmap),
    assessmentOverview: cleanStr(raw?.assessmentOverview, fallbackAssessment),
    editStatus: 'ai_draft',
  };
}

export function normalizeKnowledgeCheckItem(
  raw: any,
  fallbackId: string,
  fallbackOutcomeCode = 'MLO-1'
): ModuleKnowledgeCheckItem {
  const { options, correctIndices } = normalizeOptionListAndKey(
    raw?.options,
    raw?.correctIndex !== undefined ? [raw.correctIndex] : raw?.correctIndices,
    false
  );
  const safeOptions =
    options.length >= 2
      ? options
      : ['Primary recommended workplace practice', 'Incorrect alternative'];
  return {
    id: cleanStr(raw?.id, fallbackId),
    question: cleanStr(raw?.question, 'Which action aligns with the core concept taught in this module?'),
    options: safeOptions,
    correctIndex: correctIndices[0] ?? 0,
    explanation: cleanStr(
      raw?.explanation,
      'Review the worked example and principle summary for why the correct response applies.'
    ),
    outcomeCode: cleanStr(raw?.outcomeCode, fallbackOutcomeCode),
  };
}

export function normalizeScenarioContent(
  raw: any,
  fallbackId: string
): GeneratedScenarioContent {
  const ct = cleanStr(raw?.contextType, 'Workplace');
  const contextType: GeneratedScenarioContent['contextType'] =
    ct === 'Branching / Decision' || ct === 'AI Application' ? ct : 'Workplace';
  return {
    id: cleanStr(raw?.id, fallbackId),
    title: cleanStr(raw?.title, 'Workplace Decision Scenario'),
    contextType,
    situation: cleanStr(raw?.situation),
    challenge: cleanStr(raw?.challenge),
    decisionPrompt: cleanStr(raw?.decisionPrompt),
    modelDebrief: cleanStr(
      raw?.modelDebrief,
      'Facilitator guidance: evaluate risk, evidence, and role responsibilities before deciding.'
    ),
    keyTakeaway: cleanStr(raw?.keyTakeaway),
  };
}

export function normalizeCaseStudyContent(
  raw: any,
  fallbackId: string
): GeneratedCaseStudyContent {
  return {
    id: cleanStr(raw?.id, fallbackId),
    title: cleanStr(raw?.title, 'Workplace Case Study'),
    background: cleanStr(raw?.background),
    analysisQuestions: cleanStringArray(raw?.analysisQuestions),
    facilitatorNotes: cleanStr(
      raw?.facilitatorNotes,
      'Facilitator guide: probe learner assumptions and verify alignment with workplace standards.'
    ),
  };
}

export function normalizeLessonContentOutput(
  raw: any,
  modulePlan: CurriculumModulePlan,
  lessonPlan: { id: string; title: string; durationMinutes: number },
  lessonIndex: number,
  fallbackOutcomeIds: string[]
): GeneratedLessonContent {
  const outcomeIds = cleanStringArray(raw?.outcomeIds);
  const keyTerminology = Array.isArray(raw?.keyTerminology)
    ? raw.keyTerminology
        .filter((k: any) => k && cleanStr(k.term) && cleanStr(k.definition))
        .map((k: any) => ({ term: cleanStr(k.term), definition: cleanStr(k.definition) }))
    : [];

  const sourceClaims: ContentClaimReference[] = Array.isArray(raw?.sourceClaims)
    ? raw.sourceClaims
        .filter((c: any) => c && cleanStr(c.claim))
        .map((c: any, idx: number) => ({
          id: cleanStr(c.id, `clm-${lessonIndex + 1}-${idx + 1}`),
          claim: cleanStr(c.claim),
          ...(cleanStr(c.sourceId) ? { sourceId: cleanStr(c.sourceId) } : {}),
          sourceTitle: cleanStr(c.sourceTitle, 'Subject Domain Practice'),
          status: normalizeClaimStatus(c.status),
        }))
    : [];

  const durationRaw = Number(raw?.durationMinutes);
  const durationMinutes =
    Number.isFinite(durationRaw) && durationRaw > 0
      ? Math.round(durationRaw)
      : Number(lessonPlan.durationMinutes) || 35;

  return {
    id: cleanStr(raw?.id, `les-content-${modulePlan.order}-${lessonIndex + 1}`),
    lessonPlanId: cleanStr(raw?.lessonPlanId, lessonPlan.id),
    outcomeIds: outcomeIds.length > 0 ? outcomeIds : fallbackOutcomeIds,
    title: cleanStr(raw?.title, lessonPlan.title),
    durationMinutes,
    explanation: cleanStr(raw?.explanation),
    keyTerminology,
    workedExamples: cleanStringArray(raw?.workedExamples),
    practicalApplication: cleanStr(raw?.practicalApplication),
    guidedActivity: cleanStr(raw?.guidedActivity),
    sourceClaims,
    editStatus: 'ai_draft',
  };
}

export function normalizeModuleScaffoldOutput(
  raw: any,
  modulePlan: CurriculumModulePlan,
  outcomes: LearningOutcomesPlan
): GeneratedModuleContent {
  const modOutcomes = (outcomes.moduleOutcomes || []).filter(o => o.moduleId === modulePlan.id);
  const defaultOutcomeCode = modOutcomes[0]?.code || 'MLO-1';

  const workplaceCaseStudies = (
    Array.isArray(raw?.workplaceCaseStudies) ? raw.workplaceCaseStudies : []
  )
    .filter((c: any) => c && (cleanStr(c.title) || cleanStr(c.background)))
    .map((c: any, idx: number) => normalizeCaseStudyContent(c, `cs-${modulePlan.order}-${idx + 1}`));

  const scenarios = (Array.isArray(raw?.scenarios) ? raw.scenarios : [])
    .filter((s: any) => s && (cleanStr(s.title) || cleanStr(s.situation)))
    .map((s: any, idx: number) => normalizeScenarioContent(s, `sc-${modulePlan.order}-${idx + 1}`));

  const knowledgeChecks = (Array.isArray(raw?.knowledgeChecks) ? raw.knowledgeChecks : [])
    .filter((k: any) => k && cleanStr(k.question))
    .map((k: any, idx: number) =>
      normalizeKnowledgeCheckItem(k, `kc-${modulePlan.order}-${idx + 1}`, defaultOutcomeCode)
    );

  return {
    id: `content-${modulePlan.id}`,
    moduleId: modulePlan.id,
    moduleNumber: modulePlan.order,
    title: modulePlan.title,
    introduction: cleanStr(
      raw?.introduction,
      `Module ${modulePlan.order}: ${modulePlan.title}`
    ),
    learningObjectives:
      cleanStringArray(raw?.learningObjectives).length > 0
        ? cleanStringArray(raw.learningObjectives)
        : modOutcomes.map(o => `${o.code}: ${o.statement}`),
    lessons: [],
    workplaceCaseStudies,
    scenarios,
    knowledgeChecks,
    summary: cleanStr(raw?.summary),
    furtherLearningResources: cleanStringArray(raw?.furtherLearningResources),
    editStatus: 'ai_draft',
    lastGeneratedAt: new Date().toISOString(),
  };
}
