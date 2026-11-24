import type {
  CopilotProposedChange,
  CourseProject,
  SelectedTextContext,
  WorkflowStage,
} from '../types';
import { computeFullAlignmentReport } from './alignmentHelpers';

export interface ProposalTargetLocation {
  stage: WorkflowStage;
  stageLabel: string;
  moduleNumber?: number;
  moduleId?: string;
}

export interface ApplyProposalResult {
  nextProject: CourseProject;
  applied: boolean;
  detail: string;
  stage: WorkflowStage;
  stageLabel: string;
  moduleNumber?: number;
  moduleId?: string;
  matchedTargetId?: string;
}

function normalizeStr(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase();
}

function extractModuleNumberFromHints(
  project: CourseProject,
  proposal: CopilotProposedChange
): number | undefined {
  if (typeof proposal.moduleNumber === 'number' && proposal.moduleNumber > 0) {
    return proposal.moduleNumber;
  }
  if (proposal.moduleId) {
    const cm = project.curriculum.modules.find(
      m => m.id === proposal.moduleId || String(m.order) === String(proposal.moduleId)
    );
    if (cm) return cm.order;
    const gm = project.content.modules.find(
      m => m.moduleId === proposal.moduleId || m.id === proposal.moduleId
    );
    if (gm) return gm.moduleNumber;
    const mIdNum = String(proposal.moduleId).match(/(?:mod|module|m)[-_ ]?(\d+)\b/i);
    if (mIdNum) return Number(mIdNum[1]);
  }
  const text = `${proposal.title} ${proposal.rationale} ${proposal.targetId || ''}`;
  const mMatch = text.match(/\b(?:Module|M)\s*(\d+)\b/i) || text.match(/\bMLO-(\d+)\.\d+\b/i);
  if (mMatch) return Number(mMatch[1]);
  return undefined;
}

function unwrapPatchPayload(proposal: CopilotProposedChange): Record<string, any> {
  const raw = proposal.patchPayload && typeof proposal.patchPayload === 'object' ? proposal.patchPayload : {};
  const wrapperKeys = [
    'outcome',
    'lesson',
    'scenario',
    'caseStudy',
    'case_study',
    'knowledgeCheck',
    'knowledge_check',
    'assessmentItem',
    'assessment_item',
    'item',
    'module',
    'brief',
    'patch',
    'updates',
  ];
  for (const key of wrapperKeys) {
    if (
      raw[key] &&
      typeof raw[key] === 'object' &&
      !Array.isArray(raw[key]) &&
      Object.keys(raw).length <= 2
    ) {
      return raw[key];
    }
  }
  return raw;
}

function withRecomputedAlignment(project: CourseProject): CourseProject {
  const report = computeFullAlignmentReport(project);
  return {
    ...project,
    assessments: {
      ...project.assessments,
      alignmentFlags: report.flags,
      alignmentScorePercent: report.scorePercent,
    },
  };
}

export function resolveProposalTargetLocation(
  project: CourseProject,
  proposal: CopilotProposedChange
): ProposalTargetLocation {
  const moduleNumber = extractModuleNumberFromHints(project, proposal);
  const matchedMod =
    (proposal.moduleId &&
      project.curriculum.modules.find(
        m => m.id === proposal.moduleId || String(m.order) === String(proposal.moduleId)
      )) ||
    (moduleNumber !== undefined
      ? project.curriculum.modules.find(m => m.order === moduleNumber)
      : undefined);

  const stageFromType: Record<CopilotProposedChange['targetType'], WorkflowStage> = {
    brief_note: 1,
    curriculum_module: 2,
    outcome: 3,
    assessment_item: 4,
    lesson: 5,
    module_content: 5,
    scenario: 5,
    case_study: 5,
    knowledge_check: 5,
  };

  const stage: WorkflowStage =
    proposal.stageHint && proposal.stageHint >= 1 && proposal.stageHint <= 7
      ? proposal.stageHint
      : stageFromType[proposal.targetType] || project.currentStage;

  const stageNames: Record<WorkflowStage, string> = {
    1: 'Stage 1 · Course Brief',
    2: 'Stage 2 · Curriculum',
    3: 'Stage 3 · Learning Outcomes',
    4: 'Stage 4 · Assessments & Alignment',
    5: 'Stage 5 · Learning Content',
    6: 'Stage 6 · Quality Assurance',
    7: 'Stage 7 · Publish & Export',
  };

  const resolvedModNum = matchedMod?.order ?? moduleNumber;
  return {
    stage,
    moduleNumber: resolvedModNum,
    moduleId: matchedMod?.id || proposal.moduleId,
    stageLabel:
      stage === 5 && resolvedModNum
        ? `Stage 5 · Module ${resolvedModNum}`
        : stageNames[stage],
  };
}

export function applyCopilotProposal(
  project: CourseProject,
  proposal: CopilotProposedChange
): ApplyProposalResult {
  const loc = resolveProposalTargetLocation(project, proposal);
  const patch = unwrapPatchPayload(proposal);
  const targetIdNorm = normalizeStr(proposal.targetId);
  const titleNorm = normalizeStr(proposal.title);

  /* -------------------- 1. OUTCOME -------------------- */
  if (proposal.targetType === 'outcome') {
    const codeMatch = `${proposal.targetId || ''} ${proposal.title} ${proposal.beforePreview || ''}`.match(
      /\b((?:CLO|MLO)[-_ ]?\d+(?:\.\d+)?)\b/i
    );
    const extractedCode = codeMatch ? normalizeStr(codeMatch[1]).replace(/\s+/g, '') : '';

    const normalizedPatch: Record<string, any> = { ...patch };
    if (!normalizedPatch.statement) {
      const altStatement =
        normalizedPatch.outcomeStatement ||
        normalizedPatch.text ||
        normalizedPatch.description ||
        (Object.keys(normalizedPatch).length === 0 ? proposal.afterPreview : undefined);
      if (altStatement) normalizedPatch.statement = altStatement;
    }
    delete normalizedPatch.outcomeStatement;
    delete normalizedPatch.text;

    const matchesOutcome = (o: { id: string; code: string; statement: string }) => {
      if (targetIdNorm && (normalizeStr(o.id) === targetIdNorm || normalizeStr(o.code) === targetIdNorm)) {
        return true;
      }
      if (extractedCode && normalizeStr(o.code).replace(/\s+/g, '') === extractedCode) {
        return true;
      }
      if (proposal.beforePreview) {
        const bp = normalizeStr(proposal.beforePreview);
        if (bp.length >= 12 && normalizeStr(o.statement).includes(bp.slice(0, 32))) {
          return true;
        }
      }
      return false;
    };

    let matchedCount = 0;
    let matchedId: string | undefined;
    const nextCourseOutcomes = project.outcomes.courseOutcomes.map(o => {
      if (matchesOutcome(o)) {
        matchedCount++;
        matchedId = o.id;
        return { ...o, ...normalizedPatch };
      }
      return o;
    });
    const nextModuleOutcomes = project.outcomes.moduleOutcomes.map(o => {
      if (matchesOutcome(o)) {
        matchedCount++;
        matchedId = matchedId || o.id;
        return { ...o, ...normalizedPatch };
      }
      return o;
    });

    if (matchedCount > 0 && Object.keys(normalizedPatch).length > 0) {
      const nextProj = withRecomputedAlignment({
        ...project,
        outcomes: {
          ...project.outcomes,
          courseOutcomes: nextCourseOutcomes,
          moduleOutcomes: nextModuleOutcomes,
          approval: { approved: false },
        },
      });
      return {
        ...loc,
        nextProject: nextProj,
        applied: true,
        matchedTargetId: matchedId,
        detail: `Updated ${matchedCount} learning outcome(s) in Stage 3.`,
      };
    }

    return {
      ...loc,
      nextProject: project,
      applied: false,
      detail: 'Could not find a matching outcome ID or code (e.g., CLO-1 / MLO-1.1). Jump to Stage 3 to edit or regenerate.',
    };
  }

  /* -------------------- 2. LESSON -------------------- */
  if (proposal.targetType === 'lesson') {
    const normalizedPatch: Record<string, any> = { ...patch };
    if (!normalizedPatch.explanation) {
      const altExp =
        normalizedPatch.content ||
        normalizedPatch.body ||
        normalizedPatch.lessonText ||
        (Object.keys(normalizedPatch).length === 0 ? proposal.afterPreview : undefined);
      if (altExp && typeof altExp === 'string') {
        normalizedPatch.explanation = altExp;
      }
    }
    delete normalizedPatch.content;
    delete normalizedPatch.body;
    delete normalizedPatch.lessonText;

    const modulePriorityFilter = (mod: { moduleId?: string; id: string; moduleNumber?: number; order?: number }) => {
      const num = mod.moduleNumber ?? mod.order;
      if (loc.moduleId && (mod.moduleId === loc.moduleId || mod.id === loc.moduleId)) return true;
      if (loc.moduleNumber !== undefined && num === loc.moduleNumber) return true;
      return false;
    };

    const matchesLesson = (l: { id: string; lessonPlanId?: string; title: string }) => {
      if (targetIdNorm) {
        if (
          normalizeStr(l.id) === targetIdNorm ||
          (l.lessonPlanId && normalizeStr(l.lessonPlanId) === targetIdNorm) ||
          normalizeStr(l.title) === targetIdNorm
        ) {
          return true;
        }
      }
      const lt = normalizeStr(l.title);
      if (lt.length >= 6 && titleNorm.includes(lt)) {
        return true;
      }
      return false;
    };

    let matchedGenerated = false;
    let matchedPlan = false;
    let matchedLessonId: string | undefined;
    let matchedLessonPlanId: string | undefined;
    let resolvedModNum = loc.moduleNumber;
    let resolvedModId = loc.moduleId;

    // Search prioritized module first, then fall back to all content modules
    const candidateContentModules = project.content.modules.some(modulePriorityFilter)
      ? [
          ...project.content.modules.filter(modulePriorityFilter),
          ...project.content.modules.filter(m => !modulePriorityFilter(m)),
        ]
      : project.content.modules;

    let targetContentModId: string | undefined;
    for (const cm of candidateContentModules) {
      const hit = cm.lessons.find(matchesLesson);
      if (hit) {
        targetContentModId = cm.moduleId;
        matchedLessonId = hit.id;
        matchedLessonPlanId = hit.lessonPlanId;
        resolvedModNum = cm.moduleNumber;
        resolvedModId = cm.moduleId;
        matchedGenerated = true;
        break;
      }
    }

    const nextContentModules = matchedGenerated
      ? project.content.modules.map(cm => {
          if (cm.moduleId !== targetContentModId) return cm;
          return {
            ...cm,
            lessons: cm.lessons.map(l => {
              if (l.id !== matchedLessonId) return l;
              const nextOutcomeIds = Array.isArray(normalizedPatch.outcomeIds)
                ? normalizedPatch.outcomeIds
                : l.outcomeIds;
              return {
                ...l,
                ...normalizedPatch,
                outcomeIds: nextOutcomeIds,
                editStatus: 'human_edited' as const,
              };
            }),
          };
        })
      : project.content.modules;

    // Also keep curriculum lesson plan outcomeIds / title / purpose in sync (or update plan directly if Stage 5 not generated yet)
    const candidatePlanModules = project.curriculum.modules.some(modulePriorityFilter)
      ? [
          ...project.curriculum.modules.filter(modulePriorityFilter),
          ...project.curriculum.modules.filter(m => !modulePriorityFilter(m)),
        ]
      : project.curriculum.modules;

    let targetPlanModId: string | undefined;
    let targetPlanLessonId: string | undefined;
    for (const pm of candidatePlanModules) {
      const hit = pm.lessons.find(
        pl =>
          (matchedLessonPlanId && pl.id === matchedLessonPlanId) ||
          matchesLesson(pl)
      );
      if (hit) {
        targetPlanModId = pm.id;
        targetPlanLessonId = hit.id;
        resolvedModNum = resolvedModNum ?? pm.order;
        resolvedModId = resolvedModId ?? pm.id;
        matchedPlan = true;
        break;
      }
    }

    const nextCurriculumModules = matchedPlan
      ? project.curriculum.modules.map(pm => {
          if (pm.id !== targetPlanModId) return pm;
          return {
            ...pm,
            lessons: pm.lessons.map(pl => {
              if (pl.id !== targetPlanLessonId) return pl;
              const planPatch: Record<string, any> = {};
              if (normalizedPatch.title) planPatch.title = normalizedPatch.title;
              if (normalizedPatch.purpose) planPatch.purpose = normalizedPatch.purpose;
              if (Array.isArray(normalizedPatch.outcomeIds)) {
                planPatch.outcomeIds = normalizedPatch.outcomeIds;
              }
              return { ...pl, ...planPatch };
            }),
          };
        })
      : project.curriculum.modules;

    if (matchedGenerated || (matchedPlan && (normalizedPatch.outcomeIds || normalizedPatch.title || normalizedPatch.purpose))) {
      const nextProj = withRecomputedAlignment({
        ...project,
        curriculum: {
          ...project.curriculum,
          modules: nextCurriculumModules,
        },
        content: {
          ...project.content,
          modules: nextContentModules,
          approval: matchedGenerated ? { approved: false } : project.content.approval,
        },
      });
      return {
        ...loc,
        stage: matchedGenerated ? 5 : 2,
        moduleNumber: resolvedModNum,
        moduleId: resolvedModId,
        matchedTargetId: matchedLessonId || targetPlanLessonId,
        stageLabel: resolvedModNum
          ? `Stage ${matchedGenerated ? 5 : 2} · Module ${resolvedModNum}`
          : loc.stageLabel,
        nextProject: nextProj,
        applied: true,
        detail: matchedGenerated
          ? `Updated lesson in Stage 5 · Module ${resolvedModNum ?? ''}.`.trim()
          : `Updated planned lesson in Stage 2 · Module ${resolvedModNum ?? ''}.`.trim(),
      };
    }

    return {
      ...loc,
      nextProject: project,
      applied: false,
      detail: 'Could not locate that lesson in generated Stage 5 modules. Jump to Stage 5 to edit or regenerate.',
    };
  }

  /* -------------------- 3. SCENARIO -------------------- */
  if (proposal.targetType === 'scenario') {
    const normalizedPatch: Record<string, any> = { ...patch };
    if (
      !normalizedPatch.situation &&
      !normalizedPatch.challenge &&
      !normalizedPatch.decisionPrompt &&
      !normalizedPatch.modelDebrief &&
      !normalizedPatch.keyTakeaway
    ) {
      if (typeof normalizedPatch.debrief === 'string') normalizedPatch.modelDebrief = normalizedPatch.debrief;
      else if (typeof normalizedPatch.text === 'string') normalizedPatch.situation = normalizedPatch.text;
      else if (proposal.afterPreview) normalizedPatch.situation = proposal.afterPreview;
    }

    let matched = false;
    let matchedId: string | undefined;
    let resolvedModNum = loc.moduleNumber;
    let resolvedModId = loc.moduleId;

    const candidateMods =
      loc.moduleId || loc.moduleNumber
        ? [
            ...project.content.modules.filter(
              m => m.moduleId === loc.moduleId || m.moduleNumber === loc.moduleNumber
            ),
            ...project.content.modules.filter(
              m => m.moduleId !== loc.moduleId && m.moduleNumber !== loc.moduleNumber
            ),
          ]
        : project.content.modules;

    let targetModId: string | undefined;
    for (const cm of candidateMods) {
      const hit =
        cm.scenarios.find(
          s =>
            (targetIdNorm && normalizeStr(s.id) === targetIdNorm) ||
            (normalizeStr(s.title).length >= 5 && titleNorm.includes(normalizeStr(s.title)))
        ) ||
        (cm.moduleId === loc.moduleId && cm.scenarios.length === 1 ? cm.scenarios[0] : undefined);
      if (hit) {
        targetModId = cm.moduleId;
        matchedId = hit.id;
        resolvedModNum = cm.moduleNumber;
        resolvedModId = cm.moduleId;
        matched = true;
        break;
      }
    }

    if (matched && targetModId && matchedId) {
      const nextMods = project.content.modules.map(cm =>
        cm.moduleId === targetModId
          ? {
              ...cm,
              scenarios: cm.scenarios.map(s =>
                s.id === matchedId ? { ...s, ...normalizedPatch } : s
              ),
            }
          : cm
      );
      return {
        ...loc,
        stage: 5,
        moduleNumber: resolvedModNum,
        moduleId: resolvedModId,
        matchedTargetId: matchedId,
        stageLabel: resolvedModNum ? `Stage 5 · Module ${resolvedModNum}` : 'Stage 5 · Learning Content',
        nextProject: {
          ...project,
          content: { ...project.content, modules: nextMods, approval: { approved: false } },
        },
        applied: true,
        detail: `Updated workplace scenario in Stage 5 · Module ${resolvedModNum ?? ''}.`.trim(),
      };
    }

    return {
      ...loc,
      nextProject: project,
      applied: false,
      detail: 'Could not match target scenario in Stage 5. Jump to Stage 5 to edit or regenerate.',
    };
  }

  /* -------------------- 4. CASE STUDY -------------------- */
  if (proposal.targetType === 'case_study') {
    const normalizedPatch: Record<string, any> = { ...patch };
    if (!normalizedPatch.background && !normalizedPatch.facilitatorNotes && proposal.afterPreview && Object.keys(normalizedPatch).length === 0) {
      normalizedPatch.background = proposal.afterPreview;
    }

    let targetModId: string | undefined;
    let matchedId: string | undefined;
    let resolvedModNum = loc.moduleNumber;
    let resolvedModId = loc.moduleId;

    for (const cm of project.content.modules) {
      const hit =
        cm.workplaceCaseStudies.find(
          c =>
            (targetIdNorm && normalizeStr(c.id) === targetIdNorm) ||
            (normalizeStr(c.title).length >= 5 && titleNorm.includes(normalizeStr(c.title)))
        ) ||
        (cm.moduleId === loc.moduleId && cm.workplaceCaseStudies.length === 1
          ? cm.workplaceCaseStudies[0]
          : undefined);
      if (hit) {
        targetModId = cm.moduleId;
        matchedId = hit.id;
        resolvedModNum = cm.moduleNumber;
        resolvedModId = cm.moduleId;
        break;
      }
    }

    if (targetModId && matchedId) {
      const nextMods = project.content.modules.map(cm =>
        cm.moduleId === targetModId
          ? {
              ...cm,
              workplaceCaseStudies: cm.workplaceCaseStudies.map(c =>
                c.id === matchedId ? { ...c, ...normalizedPatch } : c
              ),
            }
          : cm
      );
      return {
        ...loc,
        stage: 5,
        moduleNumber: resolvedModNum,
        moduleId: resolvedModId,
        matchedTargetId: matchedId,
        stageLabel: resolvedModNum ? `Stage 5 · Module ${resolvedModNum}` : 'Stage 5 · Learning Content',
        nextProject: {
          ...project,
          content: { ...project.content, modules: nextMods, approval: { approved: false } },
        },
        applied: true,
        detail: `Updated case study in Stage 5 · Module ${resolvedModNum ?? ''}.`.trim(),
      };
    }

    return {
      ...loc,
      nextProject: project,
      applied: false,
      detail: 'Could not match target case study in Stage 5. Jump to Stage 5 to edit or regenerate.',
    };
  }

  /* -------------------- 5. KNOWLEDGE CHECK -------------------- */
  if (proposal.targetType === 'knowledge_check') {
    let targetModId: string | undefined;
    let matchedId: string | undefined;
    let resolvedModNum = loc.moduleNumber;
    let resolvedModId = loc.moduleId;

    for (const cm of project.content.modules) {
      const hit = cm.knowledgeChecks.find(
        k =>
          (targetIdNorm &&
            (normalizeStr(k.id) === targetIdNorm || normalizeStr(k.outcomeCode) === targetIdNorm)) ||
          (titleNorm && normalizeStr(k.question).slice(0, 24) === titleNorm.slice(0, 24))
      );
      if (hit) {
        targetModId = cm.moduleId;
        matchedId = hit.id;
        resolvedModNum = cm.moduleNumber;
        resolvedModId = cm.moduleId;
        break;
      }
    }

    if (targetModId && matchedId) {
      const nextMods = project.content.modules.map(cm =>
        cm.moduleId === targetModId
          ? {
              ...cm,
              knowledgeChecks: cm.knowledgeChecks.map(k =>
                k.id === matchedId ? { ...k, ...patch } : k
              ),
            }
          : cm
      );
      return {
        ...loc,
        stage: 5,
        moduleNumber: resolvedModNum,
        moduleId: resolvedModId,
        matchedTargetId: matchedId,
        stageLabel: resolvedModNum ? `Stage 5 · Module ${resolvedModNum}` : 'Stage 5 · Learning Content',
        nextProject: {
          ...project,
          content: { ...project.content, modules: nextMods, approval: { approved: false } },
        },
        applied: true,
        detail: `Updated knowledge check in Stage 5 · Module ${resolvedModNum ?? ''}.`.trim(),
      };
    }

    return {
      ...loc,
      nextProject: project,
      applied: false,
      detail: 'Could not match knowledge check item in Stage 5. Jump to Stage 5 to edit or regenerate.',
    };
  }

  /* -------------------- 6. ASSESSMENT ITEM -------------------- */
  if (proposal.targetType === 'assessment_item') {
    const normalizedPatch: Record<string, any> = { ...patch };
    if (!normalizedPatch.promptOrQuestion && typeof normalizedPatch.question === 'string') {
      normalizedPatch.promptOrQuestion = normalizedPatch.question;
    }
    if (!normalizedPatch.modelAnswer && typeof normalizedPatch.answer === 'string') {
      normalizedPatch.modelAnswer = normalizedPatch.answer;
    }
    delete normalizedPatch.question;
    delete normalizedPatch.answer;

    const hit =
      project.assessments.items.find(
        it =>
          (targetIdNorm && normalizeStr(it.id) === targetIdNorm) ||
          (normalizeStr(it.title).length >= 5 && titleNorm.includes(normalizeStr(it.title)))
      ) ||
      (loc.moduleId
        ? project.assessments.items.find(it => it.moduleId === loc.moduleId)
        : undefined);

    if (hit && Object.keys(normalizedPatch).length > 0) {
      const nextProj = withRecomputedAlignment({
        ...project,
        assessments: {
          ...project.assessments,
          items: project.assessments.items.map(it =>
            it.id === hit.id ? { ...it, ...normalizedPatch } : it
          ),
          approval: { approved: false },
        },
      });
      return {
        ...loc,
        stage: 4,
        stageLabel: 'Stage 4 · Assessments & Alignment',
        matchedTargetId: hit.id,
        nextProject: nextProj,
        applied: true,
        detail: `Updated assessment item "${hit.title}" in Stage 4.`,
      };
    }

    return {
      ...loc,
      stage: 4,
      stageLabel: 'Stage 4 · Assessments & Alignment',
      nextProject: project,
      applied: false,
      detail: 'Could not find matching assessment item in Stage 4. Jump to Stage 4 to edit or regenerate.',
    };
  }

  /* -------------------- 7. BRIEF NOTE -------------------- */
  if (proposal.targetType === 'brief_note') {
    const normalizedPatch: Record<string, any> = { ...patch };
    if (!normalizedPatch.title && typeof normalizedPatch.courseTitle === 'string') {
      normalizedPatch.title = normalizedPatch.courseTitle;
    }
    if (!normalizedPatch.industryDomain && typeof normalizedPatch.domain === 'string') {
      normalizedPatch.industryDomain = normalizedPatch.domain;
    }
    if (!normalizedPatch.targetAudience && typeof normalizedPatch.audience === 'string') {
      normalizedPatch.targetAudience = normalizedPatch.audience;
    }
    if (!normalizedPatch.estimatedDuration && typeof normalizedPatch.duration === 'string') {
      normalizedPatch.estimatedDuration = normalizedPatch.duration;
    }
    if (!normalizedPatch.subjectTopicsInput && typeof normalizedPatch.topics === 'string') {
      normalizedPatch.subjectTopicsInput = normalizedPatch.topics;
    }
    if (Object.keys(normalizedPatch).length === 0 && proposal.afterPreview) {
      normalizedPatch.learningRequirements = proposal.afterPreview;
    }

    const allowedKeys = [
      'title',
      'code',
      'industryDomain',
      'purpose',
      'workplaceProblem',
      'targetAudience',
      'targetJobRoles',
      'experienceLevel',
      'prerequisites',
      'estimatedDuration',
      'language',
      'learningRequirements',
      'subjectTopicsInput',
      'aiIntegrationMode',
      'aiIntegrationRequirements',
    ] as const;

    const protectedKeys = new Set([
      'title',
      'code',
      'industryDomain',
      'targetAudience',
      'estimatedDuration',
    ]);

    const nextBrief = {
      ...project.brief,
      templateFieldValues: {
        ...project.brief.templateFieldValues,
        ...(normalizedPatch.templateFieldValues &&
        typeof normalizedPatch.templateFieldValues === 'object'
          ? normalizedPatch.templateFieldValues
          : {}),
      },
      fieldStatuses: {
        ...project.brief.fieldStatuses,
        ...(normalizedPatch.fieldStatuses && typeof normalizedPatch.fieldStatuses === 'object'
          ? normalizedPatch.fieldStatuses
          : {}),
      },
      approval: { approved: false },
    };

    let changedFields = 0;
    let blockedByLock = false;
    for (const key of allowedKeys) {
      if (normalizedPatch[key] !== undefined) {
        if (project.brief.metadataLocked && protectedKeys.has(key)) {
          blockedByLock = true;
          continue;
        }
        (nextBrief as any)[key] = normalizedPatch[key];
        changedFields++;
      }
    }
    if (normalizedPatch.templateFieldValues && Object.keys(normalizedPatch.templateFieldValues).length > 0) {
      changedFields++;
    }
    if (normalizedPatch.fieldStatuses && Object.keys(normalizedPatch.fieldStatuses).length > 0) {
      changedFields++;
    }

    if (changedFields > 0) {
      return {
        ...loc,
        stage: 1,
        stageLabel: 'Stage 1 · Course Brief',
        nextProject: { ...project, brief: nextBrief },
        applied: true,
        detail: blockedByLock
          ? 'Applied Stage 1 Brief notes (locked metadata fields were preserved).'
          : 'Applied update to Stage 1 Course Brief.',
      };
    }

    return {
      ...loc,
      stage: 1,
      stageLabel: 'Stage 1 · Course Brief',
      nextProject: project,
      applied: false,
      detail: blockedByLock
        ? 'Target brief metadata is locked in Stage 1. Unlock metadata in Stage 1 or edit manually.'
        : 'No applicable Stage 1 fields found in proposal. Jump to Stage 1 to edit.',
    };
  }

  /* -------------------- 8. CURRICULUM MODULE -------------------- */
  if (proposal.targetType === 'curriculum_module') {
    const existing = project.curriculum.modules;

    if (Array.isArray(patch.modules) && patch.modules.length > 0) {
      const normalized = patch.modules.map((m: any, idx: number) => ({
        id: m.id || `mod-${Date.now()}-${idx}`,
        order: idx + 1,
        title: m.title || `Module ${idx + 1}`,
        qctoModuleType: m.qctoModuleType || 'Standard Module',
        purpose: m.purpose || '',
        objectives: Array.isArray(m.objectives) ? m.objectives : [],
        competencies: Array.isArray(m.competencies) ? m.competencies : [],
        topics: Array.isArray(m.topics) ? m.topics : [],
        lessons: Array.isArray(m.lessons) ? m.lessons : [],
      }));
      const nextProj = withRecomputedAlignment({
        ...project,
        curriculum: {
          ...project.curriculum,
          modules: normalized,
          approval: { approved: false },
        },
      });
      return {
        ...loc,
        stage: 2,
        stageLabel: 'Stage 2 · Curriculum',
        nextProject: nextProj,
        applied: true,
        detail: `Updated ${normalized.length} curriculum module(s) in Stage 2.`,
      };
    }

    const matchedMod =
      existing.find(
        m =>
          (loc.moduleId && m.id === loc.moduleId) ||
          (targetIdNorm && normalizeStr(m.id) === targetIdNorm) ||
          (loc.moduleNumber !== undefined && m.order === loc.moduleNumber)
      ) || undefined;

    if (matchedMod) {
      const nextProj = withRecomputedAlignment({
        ...project,
        curriculum: {
          ...project.curriculum,
          modules: existing.map(m => (m.id === matchedMod.id ? { ...m, ...patch } : m)),
          approval: { approved: false },
        },
      });
      return {
        ...loc,
        stage: 2,
        moduleNumber: matchedMod.order,
        moduleId: matchedMod.id,
        stageLabel: 'Stage 2 · Curriculum',
        nextProject: nextProj,
        applied: true,
        detail: `Updated Module ${matchedMod.order} in Stage 2 Curriculum.`,
      };
    }

    const newMod = {
      id: `mod-${Date.now()}`,
      order: existing.length + 1,
      title: patch.title || `Module ${existing.length + 1}`,
      qctoModuleType: patch.qctoModuleType || 'Standard Module',
      purpose: patch.purpose || proposal.afterPreview || '',
      objectives: Array.isArray(patch.objectives) ? patch.objectives : [],
      competencies: Array.isArray(patch.competencies) ? patch.competencies : [],
      topics: Array.isArray(patch.topics) ? patch.topics : [],
      lessons: Array.isArray(patch.lessons) ? patch.lessons : [],
    };
    const nextProj = withRecomputedAlignment({
      ...project,
      curriculum: {
        ...project.curriculum,
        modules: [...existing, newMod],
        approval: { approved: false },
      },
    });
    return {
      ...loc,
      stage: 2,
      moduleNumber: newMod.order,
      moduleId: newMod.id,
      stageLabel: 'Stage 2 · Curriculum',
      nextProject: nextProj,
      applied: true,
      detail: `Added Module ${newMod.order} in Stage 2 Curriculum.`,
    };
  }

  /* -------------------- 9. MODULE CONTENT (INTRO / SUMMARY / OBJECTIVES) -------------------- */
  if (proposal.targetType === 'module_content') {
    const normalizedPatch: Record<string, any> = { ...patch };
    if (
      normalizedPatch.introduction === undefined &&
      normalizedPatch.summary === undefined &&
      !Array.isArray(normalizedPatch.learningObjectives) &&
      !Array.isArray(normalizedPatch.furtherLearningResources) &&
      proposal.afterPreview
    ) {
      if (titleNorm.includes('summary')) normalizedPatch.summary = proposal.afterPreview;
      else normalizedPatch.introduction = proposal.afterPreview;
    }

    const matchedMod =
      project.content.modules.find(
        m =>
          (loc.moduleId && (m.moduleId === loc.moduleId || m.id === loc.moduleId)) ||
          (targetIdNorm &&
            (normalizeStr(m.id) === targetIdNorm || normalizeStr(m.moduleId) === targetIdNorm)) ||
          (loc.moduleNumber !== undefined && m.moduleNumber === loc.moduleNumber)
      ) || undefined;

    if (matchedMod) {
      const nextMods = project.content.modules.map(cm =>
        cm.moduleId === matchedMod.moduleId
          ? {
              ...cm,
              ...(typeof normalizedPatch.introduction === 'string'
                ? { introduction: normalizedPatch.introduction }
                : {}),
              ...(typeof normalizedPatch.summary === 'string'
                ? { summary: normalizedPatch.summary }
                : {}),
              ...(Array.isArray(normalizedPatch.learningObjectives)
                ? { learningObjectives: normalizedPatch.learningObjectives }
                : {}),
              ...(Array.isArray(normalizedPatch.furtherLearningResources)
                ? { furtherLearningResources: normalizedPatch.furtherLearningResources }
                : {}),
              editStatus: 'human_edited' as const,
            }
          : cm
      );
      return {
        ...loc,
        stage: 5,
        moduleNumber: matchedMod.moduleNumber,
        moduleId: matchedMod.moduleId,
        matchedTargetId: matchedMod.id,
        stageLabel: `Stage 5 · Module ${matchedMod.moduleNumber}`,
        nextProject: {
          ...project,
          content: { ...project.content, modules: nextMods, approval: { approved: false } },
        },
        applied: true,
        detail: `Updated Module ${matchedMod.moduleNumber} overview/summary in Stage 5.`,
      };
    }

    return {
      ...loc,
      stage: 5,
      stageLabel: 'Stage 5 · Learning Content',
      nextProject: project,
      applied: false,
      detail: 'Could not locate generated Stage 5 module content. Generate Module content first or jump to Stage 5.',
    };
  }

  return {
    ...loc,
    nextProject: project,
    applied: false,
    detail: 'Unsupported proposal target. Jump to the affected stage to edit or regenerate.',
  };
}

export function applySelectedTextReplacement(
  project: CourseProject,
  selectedCtx: SelectedTextContext,
  replacementText: string
): { nextProject: CourseProject; applied: boolean; detail: string } {
  const snippet = selectedCtx.text.trim();
  const nextVal = replacementText.trim();
  if (!snippet || !nextVal) {
    return { nextProject: project, applied: false, detail: 'Empty selection or replacement text.' };
  }

  const replaceOnce = (source: string): string | null => {
    if (!source) return null;
    if (source.includes(snippet)) {
      return source.replace(snippet, nextVal);
    }
    const compactSnippet = snippet.replace(/\s+/g, ' ');
    const escaped = compactSnippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    const re = new RegExp(escaped);
    if (re.test(source)) {
      return source.replace(re, nextVal);
    }
    return null;
  };

  // Search Stage 5 generated content first
  for (const mod of project.content.modules) {
    if (selectedCtx.moduleNumber && mod.moduleNumber !== selectedCtx.moduleNumber) continue;
    const introHit = replaceOnce(mod.introduction);
    if (introHit !== null) {
      return {
        applied: true,
        detail: `Replaced selected text in Module ${mod.moduleNumber} introduction.`,
        nextProject: {
          ...project,
          content: {
            ...project.content,
            approval: { approved: false },
            modules: project.content.modules.map(m =>
              m.moduleId === mod.moduleId
                ? { ...m, introduction: introHit, editStatus: 'human_edited' }
                : m
            ),
          },
        },
      };
    }
    const sumHit = replaceOnce(mod.summary);
    if (sumHit !== null) {
      return {
        applied: true,
        detail: `Replaced selected text in Module ${mod.moduleNumber} summary.`,
        nextProject: {
          ...project,
          content: {
            ...project.content,
            approval: { approved: false },
            modules: project.content.modules.map(m =>
              m.moduleId === mod.moduleId ? { ...m, summary: sumHit, editStatus: 'human_edited' } : m
            ),
          },
        },
      };
    }
    for (const les of mod.lessons) {
      for (const field of ['explanation', 'practicalApplication', 'guidedActivity', 'title'] as const) {
        const hit = replaceOnce(les[field]);
        if (hit !== null) {
          return {
            applied: true,
            detail: `Replaced selected text in Lesson "${les.title}" (${field}).`,
            nextProject: {
              ...project,
              content: {
                ...project.content,
                approval: { approved: false },
                modules: project.content.modules.map(m =>
                  m.moduleId === mod.moduleId
                    ? {
                        ...m,
                        lessons: m.lessons.map(l =>
                          l.id === les.id ? { ...l, [field]: hit, editStatus: 'human_edited' } : l
                        ),
                      }
                    : m
                ),
              },
            },
          };
        }
      }
    }
    for (const sc of mod.scenarios) {
      for (const field of ['situation', 'challenge', 'decisionPrompt', 'modelDebrief', 'keyTakeaway'] as const) {
        const hit = replaceOnce(sc[field]);
        if (hit !== null) {
          return {
            applied: true,
            detail: `Replaced selected text in Scenario "${sc.title}".`,
            nextProject: {
              ...project,
              content: {
                ...project.content,
                approval: { approved: false },
                modules: project.content.modules.map(m =>
                  m.moduleId === mod.moduleId
                    ? {
                        ...m,
                        scenarios: m.scenarios.map(s =>
                          s.id === sc.id ? { ...s, [field]: hit } : s
                        ),
                      }
                    : m
                ),
              },
            },
          };
        }
      }
    }
    for (const cs of mod.workplaceCaseStudies) {
      for (const field of ['background', 'facilitatorNotes'] as const) {
        const hit = replaceOnce(cs[field]);
        if (hit !== null) {
          return {
            applied: true,
            detail: `Replaced selected text in Case Study "${cs.title}".`,
            nextProject: {
              ...project,
              content: {
                ...project.content,
                approval: { approved: false },
                modules: project.content.modules.map(m =>
                  m.moduleId === mod.moduleId
                    ? {
                        ...m,
                        workplaceCaseStudies: m.workplaceCaseStudies.map(c =>
                          c.id === cs.id ? { ...c, [field]: hit } : c
                        ),
                      }
                    : m
                ),
              },
            },
          };
        }
      }
    }
  }

  // Search Stage 4 assessment items
  for (const it of project.assessments.items) {
    for (const field of ['promptOrQuestion', 'instructions', 'modelAnswer', 'markingGuide'] as const) {
      const hit = replaceOnce(it[field] || '');
      if (hit !== null) {
        return {
          applied: true,
          detail: `Replaced selected text in Assessment "${it.title}".`,
          nextProject: {
            ...project,
            assessments: {
              ...project.assessments,
              approval: { approved: false },
              items: project.assessments.items.map(x =>
                x.id === it.id ? { ...x, [field]: hit } : x
              ),
            },
          },
        };
      }
    }
  }

  // Search Stage 3 outcomes
  for (const co of project.outcomes.courseOutcomes) {
    const hit = replaceOnce(co.statement);
    if (hit !== null) {
      return {
        applied: true,
        detail: `Replaced selected text in outcome ${co.code}.`,
        nextProject: {
          ...project,
          outcomes: {
            ...project.outcomes,
            approval: { approved: false },
            courseOutcomes: project.outcomes.courseOutcomes.map(x =>
              x.id === co.id ? { ...x, statement: hit } : x
            ),
          },
        },
      };
    }
  }
  for (const mo of project.outcomes.moduleOutcomes) {
    const hit = replaceOnce(mo.statement);
    if (hit !== null) {
      return {
        applied: true,
        detail: `Replaced selected text in outcome ${mo.code}.`,
        nextProject: {
          ...project,
          outcomes: {
            ...project.outcomes,
            approval: { approved: false },
            moduleOutcomes: project.outcomes.moduleOutcomes.map(x =>
              x.id === mo.id ? { ...x, statement: hit } : x
            ),
          },
        },
      };
    }
  }

  // Search Stage 1 non-locked descriptive fields
  for (const field of ['purpose', 'workplaceProblem', 'learningRequirements', 'subjectTopicsInput'] as const) {
    const hit = replaceOnce(project.brief[field]);
    if (hit !== null) {
      return {
        applied: true,
        detail: `Replaced selected text in Stage 1 Brief (${field}).`,
        nextProject: {
          ...project,
          brief: { ...project.brief, [field]: hit, approval: { approved: false } },
        },
      };
    }
  }

  return {
    nextProject: project,
    applied: false,
    detail: 'Could not locate the exact selected snippet cleanly (it may be protected metadata or already modified).',
  };
}
