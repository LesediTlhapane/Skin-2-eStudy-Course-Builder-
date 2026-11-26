import type {
  AssessmentValidationSummary,
  AccessibilityAuditSummary,
  CourseProject,
  DeterministicCheckItem,
  DurationValidationSummary,
  QAIssueItem,
  SourceVerificationSummary,
  TechnicalValidationSummary,
} from '../types.js';

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function excerptAround(text: string, index: number, radius = 95): string {
  const start = Math.max(0, index - Math.floor(radius / 2));
  const end = Math.min(text.length, index + radius);
  const raw = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '...' : ''}${raw}${end < text.length ? '...' : ''}`;
}

export const ACCESSIBILITY_LIMITATIONS_NOTE =
  'Automated checks verify structural readability (sentence length, heading chunking, terminology support, diagram/image alt-captions, table header formatting, module orientation, and assessment instruction clarity). They do NOT audit visual colour contrast, keyboard focus order, PDF/LMS screen-reader ARIA tagging, or full WCAG 2.1 AA compliance — human assistive-technology testing is required.';

export const EXTERNAL_VERIFICATION_LIMITATION_NOTE =
  'Automated QA checks structural consistency, South African legislative citation patterns, ML technical pitfalls, and Source Register metadata. It does NOT automatically verify external URLs, court/regulatory updates, or unpublished corporate case figures against live external databases unless explicitly marked VERIFIED by a human reviewer.';

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

export function computeDurationValidation(project: CourseProject): DurationValidationSummary {
  const currModules = project.curriculum?.modules || [];
  const genModules = project.content?.modules || [];
  const assessmentItems = project.assessments?.items || [];

  const declaredDurationText = project.brief?.estimatedDuration || '';
  const declaredHours = parseEstimatedHours(declaredDurationText);
  const declaredMinutes = declaredHours !== null ? Math.round(declaredHours * 60) : null;

  const plannedLessonMinutes = currModules.reduce(
    (sum, m) => sum + (m.lessons || []).reduce((ls, l) => ls + (Number(l.durationMinutes) || 0), 0),
    0
  );
  const generatedLessonMinutes = genModules.reduce(
    (sum, m) => sum + (m.lessons || []).reduce((ls, l) => ls + (Number(l.durationMinutes) || 0), 0),
    0
  );
  const assessmentMinutes = assessmentItems.reduce(
    (sum, a) => sum + (Number(a.durationMinutes) || 0),
    0
  );

  const baseLessonMinutes =
    generatedLessonMinutes > 0 ? generatedLessonMinutes : plannedLessonMinutes;
  const totalReconciledMinutes = baseLessonMinutes + assessmentMinutes;

  if (declaredMinutes === null) {
    return {
      declaredDurationText: declaredDurationText || 'Unspecified',
      declaredMinutes: null,
      plannedLessonMinutes,
      generatedLessonMinutes,
      assessmentMinutes,
      totalReconciledMinutes,
      varianceMinutes: null,
      status: 'unspecified',
      summary: `Declared course duration ("${declaredDurationText || 'Unspecified'}") could not be parsed numerically. Lesson times total ${baseLessonMinutes} min${assessmentMinutes > 0 ? ` + ${assessmentMinutes} min assessments = ${totalReconciledMinutes} min` : ''}.`,
    };
  }

  const varianceMinutes = totalReconciledMinutes - declaredMinutes;
  const absVariance = Math.abs(varianceMinutes);
  const pctVariance = declaredMinutes > 0 ? absVariance / declaredMinutes : 0;

  let status: DurationValidationSummary['status'] = 'aligned';
  if (pctVariance > 0.25 || absVariance > 90) {
    status = 'fail';
  } else if (pctVariance > 0.1 || absVariance > 30) {
    status = 'warning';
  }

  const actualHrs = Math.round((totalReconciledMinutes / 60) * 10) / 10;
  const declaredHrs = Math.round((declaredMinutes / 60) * 10) / 10;

  return {
    declaredDurationText,
    declaredMinutes,
    plannedLessonMinutes,
    generatedLessonMinutes,
    assessmentMinutes,
    totalReconciledMinutes,
    varianceMinutes,
    status,
    summary:
      status === 'aligned'
        ? `Declared ${declaredHrs}h (${declaredMinutes} min) matches scheduled delivery (${baseLessonMinutes} min lessons${assessmentMinutes > 0 ? ` + ${assessmentMinutes} min assessments` : ''} = ${totalReconciledMinutes} min / ${actualHrs}h).`
        : `Declared duration is ${declaredHrs}h (${declaredMinutes} min), while scheduled lessons (${baseLessonMinutes} min)${assessmentMinutes > 0 ? ` plus assessments (${assessmentMinutes} min)` : ''} total ${totalReconciledMinutes} min (${actualHrs}h) — variance of ${varianceMinutes > 0 ? '+' : ''}${varianceMinutes} min.`,
  };
}

export function computeAssessmentValidation(project: CourseProject): AssessmentValidationSummary {
  const assessments = project.assessments;
  const items = assessments?.items || [];
  const declaredKnowledgeWeight = Number(assessments?.knowledgeWeightPercent) || 0;
  const declaredPracticalWeight = Number(assessments?.practicalWeightPercent) || 0;
  const passRequirementPercent = Number(assessments?.passRequirementPercent) || 0;

  const actualKnowledgeWeight = items
    .filter(it => it.assessmentDomain === 'knowledge')
    .reduce((s, it) => s + (Number(it.weightingPercent) || 0), 0);
  const actualPracticalWeight = items
    .filter(it => it.assessmentDomain === 'practical')
    .reduce((s, it) => s + (Number(it.weightingPercent) || 0), 0);
  const totalItemWeight = items.reduce((s, it) => s + (Number(it.weightingPercent) || 0), 0);

  const issues: string[] = [];
  if (items.length === 0) {
    issues.push('No assessment items have been designed.');
  } else {
    if (declaredKnowledgeWeight + declaredPracticalWeight !== 100) {
      issues.push(
        `Declared Knowledge (${declaredKnowledgeWeight}%) + Practical (${declaredPracticalWeight}%) weights equal ${declaredKnowledgeWeight + declaredPracticalWeight}% instead of 100%.`
      );
    }
    if (Math.round(totalItemWeight * 10) / 10 !== 100) {
      issues.push(`Individual assessment item weights sum to ${totalItemWeight}% instead of 100%.`);
    }
    if (
      declaredKnowledgeWeight + declaredPracticalWeight === 100 &&
      Math.round(actualKnowledgeWeight * 10) / 10 !== declaredKnowledgeWeight
    ) {
      issues.push(
        `Knowledge assessment items sum to ${actualKnowledgeWeight}% instead of the declared ${declaredKnowledgeWeight}% knowledge weight.`
      );
    }
    if (
      declaredKnowledgeWeight + declaredPracticalWeight === 100 &&
      Math.round(actualPracticalWeight * 10) / 10 !== declaredPracticalWeight
    ) {
      issues.push(
        `Practical assessment items sum to ${actualPracticalWeight}% instead of the declared ${declaredPracticalWeight}% practical weight.`
      );
    }
    if (passRequirementPercent < 1 || passRequirementPercent > 100) {
      issues.push(`Pass mark (${passRequirementPercent}%) must be between 1% and 100%.`);
    }
    // Check if strategySummary states a contradictory pass mark or split
    const strat = assessments?.strategySummary || '';
    const passMatch = strat.match(/pass\s*(?:mark|requirement|threshold)?\s*(?:of|is|:)?\s*(\d{2,3})%/i);
    if (passMatch && Number(passMatch[1]) !== passRequirementPercent) {
      issues.push(
        `Assessment strategy text cites ${passMatch[1]}% pass mark while Stage 4 setting is ${passRequirementPercent}%.`
      );
    }
  }

  return {
    totalItems: items.length,
    declaredKnowledgeWeight,
    declaredPracticalWeight,
    actualKnowledgeWeight,
    actualPracticalWeight,
    totalItemWeight,
    passRequirementPercent,
    status: issues.length === 0 ? 'aligned' : 'fail',
    issues,
  };
}

export function runAccessibilityChecks(project: CourseProject): AccessibilityAuditSummary {
  const modules = project.content?.modules || [];
  const lessons = modules.flatMap(m =>
    (m.lessons || []).map(l => ({ moduleNumber: m.moduleNumber, moduleTitle: m.title, lesson: l }))
  );

  if (lessons.length === 0) {
    return {
      scorePercent: 0,
      averageSentenceWords: 0,
      readabilityBand: 'No content generated yet',
      limitationsNote: ACCESSIBILITY_LIMITATIONS_NOTE,
      checks: [
        {
          id: 'acc-no-content',
          label: 'Content Structure & Readability',
          status: 'fail',
          details: 'No Stage 5 learning content exists to audit.',
          affectedSections: ['Stage 5 · Learning Content'],
        },
      ],
    };
  }

  let totalWords = 0;
  let totalSentences = 0;
  const denseLessons: string[] = [];
  const missingTerminologyLessons: string[] = [];
  const missingVisualAltCues: string[] = [];
  const missingStructureLessons: string[] = [];
  const malformedTableLessons: string[] = [];

  for (const item of lessons) {
    const text = item.lesson.explanation || '';
    const words = countWords(text);
    const sentences = splitSentences(text);
    totalWords += words;
    totalSentences += sentences.length;

    const label = `M${item.moduleNumber}: ${item.lesson.title}`;

    const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length > 0);
    const hasHeadingMarkers = /^#{1,4}\s+|^\*\*[^*]+\*\*/m.test(text) || paragraphs.length >= 2;
    if (!hasHeadingMarkers && words > 180) {
      missingStructureLessons.push(label);
    }

    const hasOverlongParagraph = paragraphs.some(p => countWords(p) > 220);
    if (hasOverlongParagraph) {
      denseLessons.push(label);
    }

    if (!item.lesson.keyTerminology || item.lesson.keyTerminology.length === 0) {
      missingTerminologyLessons.push(label);
    }

    const hasEmptyMarkdownImageAlt = /!\[\s*\]\([^)]+\)/.test(text);
    const hasUnexplainedDiagramRef =
      /\b(diagram|figure|chart|graph|screenshot|image)\b/i.test(text) &&
      !/\b(alt|caption|shows|depicts|illustrates|table|step|describes)\b/i.test(text);

    if (hasEmptyMarkdownImageAlt || hasUnexplainedDiagramRef) {
      missingVisualAltCues.push(label);
    }

    if (/\|[^\n]+\|/.test(text)) {
      const tableLines = text.split('\n').filter(ln => ln.trim().startsWith('|'));
      const hasSeparator = tableLines.some(ln => /\|\s*:?-{2,}:?\s*\|/.test(ln));
      if (tableLines.length >= 2 && !hasSeparator) {
        malformedTableLessons.push(label);
      }
    }
  }

  const avgSentenceWords =
    totalSentences > 0 ? Math.round((totalWords / totalSentences) * 10) / 10 : 0;

  let readabilityBand = 'Clear & Accessible';
  let readabilityStatus: 'pass' | 'warning' | 'fail' = 'pass';
  if (avgSentenceWords > 35) {
    readabilityBand = 'Very Dense (high cognitive load)';
    readabilityStatus = 'fail';
  } else if (avgSentenceWords > 28) {
    readabilityBand = 'Dense / Complex (simplify long sentences)';
    readabilityStatus = 'warning';
  }

  const missingModuleSummaries = modules
    .filter(m => !m.summary?.trim() || !m.introduction?.trim())
    .map(m => `Module ${m.moduleNumber}: ${m.title}`);

  const unclearAssessments = (project.assessments?.items || [])
    .filter(it => !it.instructions?.trim() || !it.promptOrQuestion?.trim())
    .map(it => it.title || it.id);

  const checks: DeterministicCheckItem[] = [
    {
      id: 'acc-readability',
      label: 'Plain-Language & Sentence Length',
      status: readabilityStatus,
      details: `Average sentence length is ${avgSentenceWords} words across ${lessons.length} lesson(s) (${readabilityBand}). Target <= 28 words for accessible comprehension.`,
      affectedSections: avgSentenceWords > 28 ? ['Stage 5 · Lesson Prose'] : [],
    },
    {
      id: 'acc-headings',
      label: 'Heading Hierarchy & Scannable Chunking',
      status:
        missingStructureLessons.length === 0 && denseLessons.length === 0
          ? 'pass'
          : 'warning',
      details:
        missingStructureLessons.length === 0 && denseLessons.length === 0
          ? 'All lessons are broken into clear sections and scannable paragraphs.'
          : `${missingStructureLessons.length} lesson(s) need section headings/breaks and ${denseLessons.length} contain paragraphs exceeding 220 words.`,
      affectedSections: Array.from(new Set([...missingStructureLessons, ...denseLessons])),
    },
    {
      id: 'acc-terminology',
      label: 'Glossary / Key Terminology Support',
      status: missingTerminologyLessons.length === 0 ? 'pass' : 'warning',
      details:
        missingTerminologyLessons.length === 0
          ? 'Every lesson defines domain key terms for non-native or cross-disciplinary learners.'
          : `${missingTerminologyLessons.length} lesson(s) have no key terminology definitions.`,
      affectedSections: missingTerminologyLessons,
    },
    {
      id: 'acc-alt-text',
      label: 'Visual & Diagram Descriptive Equivalents',
      status: missingVisualAltCues.length === 0 ? 'pass' : 'warning',
      details:
        missingVisualAltCues.length === 0
          ? 'All referenced diagrams, images, or visual aids include descriptive alt-text or explanations.'
          : `${missingVisualAltCues.length} lesson(s) include missing image alt text or diagram references without descriptive explanations.`,
      affectedSections: missingVisualAltCues,
    },
    {
      id: 'acc-tables',
      label: 'Table Header Structure & Readability',
      status: malformedTableLessons.length === 0 ? 'pass' : 'warning',
      details:
        malformedTableLessons.length === 0
          ? 'No malformed or headerless content tables detected.'
          : `${malformedTableLessons.length} lesson(s) include pipe tables without a Markdown header separator row.`,
      affectedSections: malformedTableLessons,
    },
    {
      id: 'acc-instructions',
      label: 'Learner Instruction Clarity',
      status: unclearAssessments.length === 0 ? 'pass' : 'warning',
      details:
        unclearAssessments.length === 0
          ? 'All Stage 4 assessments include explicit learner instructions and task prompts.'
          : `${unclearAssessments.length} assessment item(s) are missing clear learner instructions.`,
      affectedSections: unclearAssessments,
    },
    {
      id: 'acc-navigation',
      label: 'Module Orientation & Summaries',
      status: missingModuleSummaries.length === 0 ? 'pass' : 'fail',
      details:
        missingModuleSummaries.length === 0
          ? 'Every generated module has both an introduction and synthesis summary.'
          : `${missingModuleSummaries.length} module(s) lack an introduction or summary.`,
      affectedSections: missingModuleSummaries,
    },
  ];

  const passCount = checks.filter(c => c.status === 'pass').length;
  const warnCount = checks.filter(c => c.status === 'warning').length;
  const scorePercent = Math.round(((passCount * 1 + warnCount * 0.6) / checks.length) * 100);

  return {
    scorePercent,
    averageSentenceWords: avgSentenceWords,
    readabilityBand,
    limitationsNote: ACCESSIBILITY_LIMITATIONS_NOTE,
    checks,
  };
}

export function runDomainQualityChecks(project: CourseProject): {
  issues: QAIssueItem[];
  sourceVerificationSummary: SourceVerificationSummary;
} {
  const issues: QAIssueItem[] = [];
  const modules = project.content?.modules || [];
  const assessments = project.assessments?.items || [];
  const sources = project.sources || [];
  const verifiedSources = sources.filter(s => s.verificationStatus === 'VERIFIED');
  const pendingSources = sources.filter(s => s.verificationStatus !== 'VERIFIED');

  interface TextSegment {
    stage: 1 | 4 | 5;
    moduleNumber?: number;
    sectionLabel: string;
    isMandatoryExerciseOrAssessment: boolean;
    text: string;
  }

  const segments: TextSegment[] = [];
  if (project.brief?.purpose || project.brief?.workplaceProblem) {
    segments.push({
      stage: 1,
      sectionLabel: 'Stage 1 · Course Brief',
      isMandatoryExerciseOrAssessment: false,
      text: `${project.brief.purpose || ''}\n${project.brief.workplaceProblem || ''}\n${project.brief.learningRequirements || ''}`,
    });
  }

  for (const mod of modules) {
    if (mod.introduction?.trim() || mod.summary?.trim()) {
      segments.push({
        stage: 5,
        moduleNumber: mod.moduleNumber,
        sectionLabel: `Module ${mod.moduleNumber} Overview & Summary`,
        isMandatoryExerciseOrAssessment: false,
        text: `${mod.introduction || ''}\n${mod.summary || ''}`,
      });
    }
    for (const lesson of mod.lessons || []) {
      const lessonBody = [
        lesson.explanation,
        ...(lesson.workedExamples || []),
        lesson.practicalApplication,
        lesson.guidedActivity,
      ]
        .filter(Boolean)
        .join('\n');
      if (lessonBody.trim()) {
        segments.push({
          stage: 5,
          moduleNumber: mod.moduleNumber,
          sectionLabel: `Module ${mod.moduleNumber} · Lesson "${lesson.title}"`,
          isMandatoryExerciseOrAssessment: false,
          text: lessonBody,
        });
      }
      if (lesson.guidedActivity?.trim() || lesson.practicalApplication?.trim()) {
        segments.push({
          stage: 5,
          moduleNumber: mod.moduleNumber,
          sectionLabel: `Module ${mod.moduleNumber} · Lesson "${lesson.title}" Activity`,
          isMandatoryExerciseOrAssessment: true,
          text: `${lesson.guidedActivity || ''}\n${lesson.practicalApplication || ''}`,
        });
      }
    }
    for (const cs of mod.workplaceCaseStudies || []) {
      segments.push({
        stage: 5,
        moduleNumber: mod.moduleNumber,
        sectionLabel: `Module ${mod.moduleNumber} · Case Study "${cs.title}"`,
        isMandatoryExerciseOrAssessment: false,
        text: `${cs.title}\n${cs.background}\n${(cs.analysisQuestions || []).join('\n')}\n${cs.facilitatorNotes}`,
      });
    }
    for (const sc of mod.scenarios || []) {
      segments.push({
        stage: 5,
        moduleNumber: mod.moduleNumber,
        sectionLabel: `Module ${mod.moduleNumber} · Scenario "${sc.title}"`,
        isMandatoryExerciseOrAssessment: false,
        text: `${sc.title}\n${sc.situation}\n${sc.challenge}\n${sc.decisionPrompt}\n${sc.modelDebrief}`,
      });
    }
    for (const kc of mod.knowledgeChecks || []) {
      segments.push({
        stage: 5,
        moduleNumber: mod.moduleNumber,
        sectionLabel: `Module ${mod.moduleNumber} · Knowledge Check`,
        isMandatoryExerciseOrAssessment: true,
        text: `${kc.question}\n${kc.explanation}`,
      });
    }
  }

  for (const item of assessments) {
    const aText = [item.instructions, item.promptOrQuestion, item.modelAnswer, item.explanation, item.markingGuide]
      .filter(Boolean)
      .join('\n');
    if (aText.trim()) {
      segments.push({
        stage: 4,
        sectionLabel: `Stage 4 · Assessment "${item.title}"`,
        isMandatoryExerciseOrAssessment: true,
        text: aText,
      });
    }
  }

  const allText = segments.map(s => s.text).join('\n');
  const seenKeys = new Set<string>();

  const pushUnique = (key: string, issue: QAIssueItem) => {
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    issues.push(issue);
  };

  // 1. SOUTH AFRICAN LEGAL & REGULATORY CHECKS (POPIA, PEPUDA, LEGAL DISCLAIMER)
  const popiaConditionChecks: Array<{
    id: string;
    label: string;
    wrongRegex: RegExp;
    correctRef: string;
  }> = [
    {
      id: 'popia-security',
      label: 'POPIA Security Safeguards Section Attribution',
      wrongRegex:
        /\b(?:security safeguards?|integrity and confidentiality of personal information)\b[^.;,\n]{0,55}?\b(?:sections?|sec\.?|ss?\.?)\s+(?!(?:19|20|21|22)\b)\d+|\b(?:sections?|sec\.?|ss?\.?)\s+(?!(?:19|20|21|22)\b)\d+[^.;,\n]{0,55}?\b(?:security safeguards?|integrity and confidentiality)\b/i,
      correctRef: 'POPIA Sections 19–22 (Condition 7: Security Safeguards; s22 covers security compromises/breach notifications).',
    },
    {
      id: 'popia-quality',
      label: 'POPIA Information Quality Section Attribution',
      wrongRegex:
        /\binformation quality\b[^.;,\n]{0,55}?\b(?:sections?|sec\.?|ss?\.?)\s+(?!16\b)\d+|\b(?:sections?|sec\.?|ss?\.?)\s+(?!16\b)\d+[^.;,\n]{0,55}?\binformation quality\b/i,
      correctRef: 'POPIA Section 16 (Condition 5: Information Quality).',
    },
    {
      id: 'popia-participation',
      label: 'POPIA Data Subject Participation Section Attribution',
      wrongRegex:
        /\bdata subject participation\b[^.;,\n]{0,55}?\b(?:sections?|sec\.?|ss?\.?)\s+(?!(?:23|24|25)\b)\d+|\b(?:sections?|sec\.?|ss?\.?)\s+(?!(?:23|24|25)\b)\d+[^.;,\n]{0,55}?\bdata subject participation\b/i,
      correctRef: 'POPIA Sections 23–25 (Condition 8: Data Subject Participation).',
    },
    {
      id: 'popia-automated',
      label: 'POPIA Automated Decision-Making Section Attribution',
      wrongRegex:
        /\bautomated decision[- ]making\b[^.;,\n]{0,55}?\b(?:sections?|sec\.?|ss?\.?)\s+(?!71\b)\d+|\b(?:sections?|sec\.?|ss?\.?)\s+(?!71\b)\d+[^.;,\n]{0,55}?\bautomated decision[- ]making\b/i,
      correctRef: 'POPIA Section 71 (Automated decision-making).',
    },
    {
      id: 'popia-accountability',
      label: 'POPIA Accountability Section Attribution',
      wrongRegex:
        /\baccountability\b[^.;,\n]{0,45}?\b(?:popia|condition\s*1)\b[^.;,\n]{0,45}?\b(?:sections?|sec\.?|ss?\.?)\s+(?!8\b)\d+/i,
      correctRef: 'POPIA Section 8 (Condition 1: Accountability).',
    },
  ];

  for (const seg of segments) {
    // Check invalid POPIA section number (> 115)
    const popiaSecMatch = seg.text.match(
      /\bPOPIA\b[^.;\n]{0,60}\b(?:sections?|sec\.?|ss?\.?)\s+(\d{3,})\b/i
    );
    if (popiaSecMatch && Number(popiaSecMatch[1]) > 115) {
      pushUnique(`popia-range-${seg.sectionLabel}`, {
        id: `crit-popia-range-${issues.length + 1}`,
        severity: 'blocking',
        prioritySeverity: 'critical',
        verificationOrigin: 'automated',
        rule: 'Invalid POPIA Section Reference',
        description: `${seg.sectionLabel} cites POPIA Section ${popiaSecMatch[1]}, which exceeds POPIA (Act 4 of 2013)'s 115 sections.`,
        stage: seg.stage,
        moduleNumber: seg.moduleNumber,
        affectedSection: seg.sectionLabel,
        exampleExcerpt: excerptAround(seg.text, popiaSecMatch.index || 0),
        recommendedFix: 'Verify the exact section number against POPIA Act 4 of 2013 (Sections 1–115) or flag for qualified South African legal review.',
      });
    }

    for (const rule of popiaConditionChecks) {
      const m = seg.text.match(rule.wrongRegex);
      if (m) {
        pushUnique(`${rule.id}-${seg.sectionLabel}`, {
          id: `crit-${rule.id}-${issues.length + 1}`,
          severity: 'blocking',
          prioritySeverity: 'critical',
          verificationOrigin: 'automated',
          rule: rule.label,
          description: `${seg.sectionLabel} misattributes a POPIA section number. Correct statutory mapping: ${rule.correctRef}`,
          stage: seg.stage,
          moduleNumber: seg.moduleNumber,
          affectedSection: seg.sectionLabel,
          exampleExcerpt: excerptAround(seg.text, m.index || 0),
          recommendedFix: `Correct the citation to ${rule.correctRef}`,
        });
      }
    }

    // Check "consent is the only lawful basis" fallacy
    const consentFallacy = seg.text.match(
      /\b(?:consent is the only|sole lawful (?:basis|ground|justification)[^.\n]{0,40}consent|cannot process personal information without consent|always requires? (?:explicit )?consent)\b/i
    );
    if (consentFallacy) {
      pushUnique(`popia-consent-${seg.sectionLabel}`, {
        id: `crit-popia-consent-${issues.length + 1}`,
        severity: 'blocking',
        prioritySeverity: 'critical',
        verificationOrigin: 'automated',
        rule: 'POPIA Lawful Processing Misstatement (Section 11)',
        description: `${seg.sectionLabel} implies consent is the sole lawful justification for processing personal information. Under POPIA Section 11(1)(a)–(f), consent is one of six lawful grounds (alongside contract performance, legal obligation, legitimate interest of data subject, public law duty, and legitimate interest of the responsible party/third party).`,
        stage: seg.stage,
        moduleNumber: seg.moduleNumber,
        affectedSection: seg.sectionLabel,
        exampleExcerpt: excerptAround(seg.text, consentFallacy.index || 0),
        recommendedFix: 'Clarify POPIA Section 11(1)(a)–(f) lawful justifications instead of stating consent is the only ground.',
      });
    }

    // Check PEPUDA exact Act title
    const badPepuda = seg.text.match(
      /\bPromotion of (?:Equality|Equity) and (?:Unfair Discrimination|Prevention of Discrimination) Act\b|\bPromotion of Equality Act\b(?![^.\n]{0,5}\b(?:4 of 2000|PEPUDA))|(?<!Promotion of Equality and )\bPrevention of Unfair Discrimination Act\b/i
    );
    if (badPepuda) {
      pushUnique(`pepuda-name-${seg.sectionLabel}`, {
        id: `crit-pepuda-${issues.length + 1}`,
        severity: 'blocking',
        prioritySeverity: 'critical',
        verificationOrigin: 'automated',
        rule: 'Incorrect South African Statute Name (PEPUDA)',
        description: `${seg.sectionLabel} misstates the title of PEPUDA. The exact title is the "Promotion of Equality and Prevention of Unfair Discrimination Act 4 of 2000".`,
        stage: seg.stage,
        moduleNumber: seg.moduleNumber,
        affectedSection: seg.sectionLabel,
        exampleExcerpt: excerptAround(seg.text, badPepuda.index || 0),
        recommendedFix: 'Use the exact statutory title: "Promotion of Equality and Prevention of Unfair Discrimination Act 4 of 2000 (PEPUDA)".',
      });
    }

    // 2. FACTUAL / STATISTICAL / UNVERIFIED CASE STUDY CLAIMS
    const statPatterns = [
      /\bR\s?\d+[\d,.]*\s*(?:million|m|billion|bn|thousand|k)\b/gi,
      /\b\d+(?:\.\d+)?%\s*(?:reduction|decrease|fewer|savings?|gains?|improvement|increase|drop|boost)\b/gi,
    ];
    const hasHypotheticalMarker =
      /\b(?:hypothetical|illustrative|fictional|simulated|for illustration|teaching scenario|example scenario)\b/i.test(
        seg.text
      );
    const hasInlineCitation = /\[Source\s*\d+\]|\[Verified|\(\s*[A-Z][a-zA-Z]+,?\s*20\d{2}\s*\)/i.test(
      seg.text
    );

    if (!hasHypotheticalMarker && (!hasInlineCitation || verifiedSources.length === 0)) {
      for (const pat of statPatterns) {
        pat.lastIndex = 0;
        const sm = pat.exec(seg.text);
        if (sm) {
          pushUnique(`stat-${seg.sectionLabel}`, {
            id: `warn-unverified-stat-${issues.length + 1}`,
            severity: 'warning',
            prioritySeverity: 'high',
            verificationOrigin: 'unverified',
            rule: 'Unverified Statistical or Financial ROI Claim',
            description: `${seg.sectionLabel} presents specific numeric or financial impact figures ("${sm[0]}") without a verified primary source citation or an explicit hypothetical teaching-scenario label.`,
            stage: seg.stage,
            moduleNumber: seg.moduleNumber,
            affectedSection: seg.sectionLabel,
            exampleExcerpt: excerptAround(seg.text, sm.index),
            recommendedFix:
              'Either attach a verified credible external source with publication details in Source Register + inline citation, or explicitly label the example as an "Illustrative hypothetical scenario".',
          });
          break;
        }
      }
    }

    // 3. ML / AI TECHNICAL ACCURACY PITFALLS
    const confMatch = seg.text.match(
      /\b(?:model )?confidence(?:\s+score|\s+level)?\s+(?:is|means|equals|represents|tells you)\s+(?:the\s+)?(?:actual\s+)?probability\b|\b(\d{2})%\s+confidence\s+(?:means|equals)\s+(?:a\s+)?\1%\s+(?:chance|probability)\s+(?:it is|of being)\s+correct\b/i
    );
    if (confMatch && !/\bcalibrat/i.test(seg.text)) {
      pushUnique(`tech-confidence-${seg.sectionLabel}`, {
        id: `crit-tech-confidence-${issues.length + 1}`,
        severity: 'blocking',
        prioritySeverity: 'critical',
        verificationOrigin: 'automated',
        rule: 'Technical Accuracy: Model Confidence vs Calibration',
        description: `${seg.sectionLabel} equates raw model confidence scores with calibrated probability without explaining model calibration.`,
        stage: seg.stage,
        moduleNumber: seg.moduleNumber,
        affectedSection: seg.sectionLabel,
        exampleExcerpt: excerptAround(seg.text, confMatch.index || 0),
        recommendedFix:
          'Clarify that raw model confidence scores are NOT automatically calibrated true probabilities unless empirical calibration (e.g. Platt scaling, isotonic regression, calibration curves) is validated.',
      });
    }

    const aucMatch = seg.text.match(
      /\b(?:ROC[-\s]?)?AUC\s*(?:>|above|exceeding|over|of)\s*0\.?8\b[^.\n]{0,80}\b(?:good|strong|reliable|acceptable|production[- ]ready|sufficient)\b/i
    );
    if (
      aucMatch &&
      !/\b(?:class imbalance|prevalence|threshold|error cost|false positive|false negative|context[- ]dependent)\b/i.test(
        seg.text
      )
    ) {
      pushUnique(`tech-auc-${seg.sectionLabel}`, {
        id: `warn-tech-auc-${issues.length + 1}`,
        severity: 'warning',
        prioritySeverity: 'high',
        verificationOrigin: 'automated',
        rule: 'Technical Accuracy: Context-Free AUC Threshold',
        description: `${seg.sectionLabel} treats AUC > 0.8 as a universal indicator of model readiness without discussing base-rate prevalence, decision thresholds, or asymmetric false-positive/false-negative costs.`,
        stage: seg.stage,
        moduleNumber: seg.moduleNumber,
        affectedSection: seg.sectionLabel,
        exampleExcerpt: excerptAround(seg.text, aucMatch.index || 0),
        recommendedFix:
          'Clarify that AUC alone cannot prove deployment suitability; threshold selection, class prevalence, and cost-weighted precision/recall matter.',
      });
    }

    const ciMatch = seg.text.match(
      /\bconfidence intervals?\b[^.\n]{0,90}\b(?:individual prediction|future observation|model uncertainty|single outcome)\b/i
    );
    if (ciMatch && !/\bprediction interval\b/i.test(seg.text)) {
      pushUnique(`tech-ci-${seg.sectionLabel}`, {
        id: `warn-tech-ci-${issues.length + 1}`,
        severity: 'warning',
        prioritySeverity: 'high',
        verificationOrigin: 'automated',
        rule: 'Technical Accuracy: Confidence Intervals vs Prediction Intervals',
        description: `${seg.sectionLabel} conflates statistical confidence intervals (uncertainty about a population parameter) with prediction intervals or broader model uncertainty.`,
        stage: seg.stage,
        moduleNumber: seg.moduleNumber,
        affectedSection: seg.sectionLabel,
        exampleExcerpt: excerptAround(seg.text, ciMatch.index || 0),
        recommendedFix:
          'Distinguish parameter confidence intervals from prediction intervals and epistemic/aleatoric model uncertainty.',
      });
    }

    const shapMatch = seg.text.match(
      /\bSHAP\b[^.\n]{0,80}\b(?:proves?\s+(?:causation|why)|causal(?:ly)?\s+(?:drives?|causes?|explains?)|establishes?\s+cause)\b/i
    );
    if (shapMatch) {
      pushUnique(`tech-shap-${seg.sectionLabel}`, {
        id: `crit-tech-shap-${issues.length + 1}`,
        severity: 'blocking',
        prioritySeverity: 'critical',
        verificationOrigin: 'automated',
        rule: 'Technical Accuracy: SHAP Attribution vs Causation',
        description: `${seg.sectionLabel} describes SHAP values as establishing causation rather than associative feature contribution to a model's output.`,
        stage: seg.stage,
        moduleNumber: seg.moduleNumber,
        affectedSection: seg.sectionLabel,
        exampleExcerpt: excerptAround(seg.text, shapMatch.index || 0),
        recommendedFix:
          'Clarify that SHAP measures local feature contribution to model predictions (correlational attribution), not real-world causal effect.',
      });
    }
  }

  // 4. LEGAL / EDUCATIONAL DISCLAIMER CHECK WHEN LEGISLATION MENTIONED
  const citesLegislation =
    /\b(POPIA|PEPUDA|Act\s+\d+\s+of\s+\d{4}|Cybercrimes Act|FAIS|FICA|FSCA|Protection of Personal Information)\b/i.test(
      allText
    );
  const hasLegalDisclaimer =
    /\b(?:educational (?:purposes|guidance) only|does not constitute (?:formal )?legal advice|not (?:a substitute for )?(?:professional|qualified) legal advice)\b/i.test(
      allText
    );
  if (citesLegislation && !hasLegalDisclaimer && modules.length > 0) {
    pushUnique('missing-legal-disclaimer', {
      id: 'warn-missing-legal-disclaimer',
      severity: 'warning',
      prioritySeverity: 'high',
      verificationOrigin: 'expert_review_required',
      rule: 'Missing Educational / Non-Legal-Advice Disclaimer',
      description:
        'The course discusses South African statutes and regulatory duties (e.g. POPIA / PEPUDA) without an explicit educational-guidance disclaimer stating that content does not substitute for qualified legal counsel.',
      stage: 5,
      affectedSection: 'Course Modules & Complete Course Front-Matter',
      recommendedFix:
        'Include an explicit educational-guidance disclaimer and confirm all statutory citations with a qualified South African legal reviewer.',
    });
  }

  // 5. EXECUTIVE AUDIENCE SUITABILITY CHECK
  const audienceBlob = `${project.brief?.title || ''} ${project.brief?.targetAudience || ''} ${project.brief?.targetJobRoles || ''}`;
  const isExecutiveAudience =
    /\b(executive|executives|ceo|cfo|coo|cto|c-suite|board|director|managing director|senior decision[- ]maker|senior leader)\b/i.test(
      audienceBlob
    );
  if (isExecutiveAudience) {
    for (const seg of segments) {
      if (!seg.isMandatoryExerciseOrAssessment) continue;
      const codingHit = seg.text.match(
        /\b(?:write|implement|code|build|run|execute|debug)\b[^.\n]{0,60}\b(?:python|pandas|scikit-learn|fairlearn|jupyter|pytorch|tensorflow|k-anonymity(?:\s+code)?|confusion matrix in python)\b|\b(?:using|in)\s+(?:python|pandas|fairlearn|scikit-learn|jupyter)\b/i
      );
      const isOptionalDemo = /\b(?:optional|technical appendix|non-mandatory|for technical teams|demonstration only)\b/i.test(
        seg.text
      );
      if (codingHit && !isOptionalDemo) {
        const isAssessmentStage = seg.stage === 4;
        pushUnique(`exec-coding-${seg.sectionLabel}`, {
          id: `${isAssessmentStage ? 'warn' : 'warn'}-exec-coding-${issues.length + 1}`,
          severity: 'warning',
          prioritySeverity: isAssessmentStage ? 'high' : 'medium',
          verificationOrigin: 'automated',
          rule: 'Audience Suitability: Mandatory Coding Task for Executive Cohort',
          description: `${seg.sectionLabel} assigns hands-on technical coding ("${codingHit[0]}") to an Executive/Board audience without marking it as an optional technical appendix.`,
          stage: seg.stage,
          moduleNumber: seg.moduleNumber,
          affectedSection: seg.sectionLabel,
          exampleExcerpt: excerptAround(seg.text, codingHit.index || 0),
          recommendedFix:
            'Refocus mandatory executive tasks on governance interpretation, vendor interrogation, risk-threshold sign-off, and oversight briefs; place any code snippet in an optional technical appendix.',
        });
      }
    }
  }

  // 6. INLINE CITATION & SOURCE REGISTER CREDIBILITY CHECK
  if (modules.length > 0) {
    const inlineCitMatches = allText.match(/\[Source\s*\d+\]|\(\s*[A-Z][a-zA-Z]+,?\s*20\d{2}\s*\)/g) || [];
    if (sources.length > 0 && inlineCitMatches.length === 0) {
      pushUnique('missing-inline-citations', {
        id: 'warn-missing-inline-citations',
        severity: 'warning',
        prioritySeverity: 'medium',
        verificationOrigin: 'automated',
        rule: 'Source Credibility: Inline Citation Mapping',
        description: `${sources.length} source(s) exist in the Source Register, but lessons lack explicit inline citations linking factual/regulatory statements to those sources.`,
        stage: 5,
        affectedSection: 'Stage 5 · Lessons & References',
        recommendedFix:
          'Add inline citations (e.g., [Source 1]) within lessons and include a consolidated reference list.',
      });
    }
    if (sources.length === 0) {
      pushUnique('empty-source-register', {
        id: 'warn-empty-source-register',
        severity: 'warning',
        prioritySeverity: 'high',
        verificationOrigin: 'unverified',
        rule: 'Source Credibility: Empty Source Register',
        description:
          'No authoritative sources are recorded in the Source Register to substantiate factual, statistical, or regulatory content.',
        stage: 1,
        affectedSection: 'Stage 1 · Source Register',
        recommendedFix:
          'Register primary legislative, regulatory, and peer-reviewed or industry sources in Stage 1 Source Register.',
      });
    }
  }

  const unverifiedStatClaims = issues.filter(i => i.id.startsWith('warn-unverified-stat-')).length;

  return {
    issues,
    sourceVerificationSummary: {
      totalSources: sources.length,
      verifiedSources: verifiedSources.length,
      pendingSources: pendingSources.length,
      unsupportedClaims: modules
        .flatMap(m => m.lessons || [])
        .flatMap(l => l.sourceClaims || [])
        .filter(c => c.status === 'UNSUPPORTED').length,
      unverifiedStatClaims,
      externalVerificationNote: EXTERNAL_VERIFICATION_LIMITATION_NOTE,
    },
  };
}

export function runTechnicalValidationChecks(project: CourseProject): TechnicalValidationSummary {
  const modules = project.content?.modules || [];
  const allClaims = modules.flatMap(m =>
    (m.lessons || []).flatMap(l =>
      (l.sourceClaims || []).map(cl => ({
        moduleNumber: m.moduleNumber,
        lessonTitle: l.title,
        claim: cl,
      }))
    )
  );

  const verifiedClaims = allClaims.filter(c => c.claim.status === 'VERIFIED');
  const needsReviewClaims = allClaims.filter(c => c.claim.status === 'NEEDS REVIEW');
  const unsupportedClaims = allClaims.filter(c => c.claim.status === 'UNSUPPORTED');

  const unverifiedBriefFields = Object.entries(project.brief?.fieldStatuses || {}).filter(
    ([, st]) => st === 'to_be_confirmed' || st === 'requires_sme_validation'
  );

  const combinedCorpus = modules
    .flatMap(m =>
      (m.lessons || []).map(
        l => `${l.explanation}\n${(l.workedExamples || []).join('\n')}\n${l.practicalApplication}`
      )
    )
    .join('\n');

  const technicalIndicatorsDetected: string[] = [];
  if (
    /[=±≤≥∑√∆]|(\b\d+(\.\d+)?\s*(kW|MW|kg|mol|bar|kPa|MPa|°C|K|mg\/L|ppm|%|ZAR|R\d))/i.test(
      combinedCorpus
    )
  ) {
    technicalIndicatorsDetected.push('Equations, numerical thresholds, or engineering/financial units');
  }
  if (/\b(Act\s+\d+|Regulation|SANS|ISO\s+\d+|OHSA|POPIA|PEPUDA|NCA|FAIS|FICA|NQF|SAQA|QCTO)\b/i.test(combinedCorpus)) {
    technicalIndicatorsDetected.push('Statutory, regulatory, or standards citations');
  }
  if (/\b(AUC|SHAP|calibrat|confidence interval|prediction interval|bias|drift)\b/i.test(combinedCorpus)) {
    technicalIndicatorsDetected.push('AI/ML metrics, interpretability, or statistical concepts');
  }

  const verifiedSourcesCount = (project.sources || []).filter(
    s => s.verificationStatus === 'VERIFIED'
  ).length;

  const domainAudit = runDomainQualityChecks(project);
  const criticalDomainCount = domainAudit.issues.filter(i => i.prioritySeverity === 'critical').length;
  const highDomainCount = domainAudit.issues.filter(i => i.prioritySeverity === 'high').length;

  const checks: DeterministicCheckItem[] = [
    {
      id: 'tech-unsupported-claims',
      label: 'Unsupported Factual / Technical Claims',
      status: unsupportedClaims.length === 0 ? 'pass' : 'fail',
      details:
        unsupportedClaims.length === 0
          ? 'Zero claims explicitly tagged UNSUPPORTED in lesson sourceClaims.'
          : `${unsupportedClaims.length} claim(s) lack adequate source evidence and must not be presented as verified fact.`,
      affectedSections: unsupportedClaims.map(c => `M${c.moduleNumber}: ${c.lessonTitle}`),
    },
    {
      id: 'tech-domain-compliance',
      label: 'Regulatory, Factual & ML Technical Accuracy Audit',
      status:
        criticalDomainCount > 0 ? 'fail' : highDomainCount > 0 ? 'warning' : 'pass',
      details:
        domainAudit.issues.length === 0
          ? 'No automated SA statutory (POPIA/PEPUDA), unverified ROI statistic, or ML conceptual pitfalls detected.'
          : `${criticalDomainCount} critical and ${highDomainCount} high-priority regulatory/factual/technical issue(s) flagged across modules or assessments.`,
      affectedSections: Array.from(new Set(domainAudit.issues.map(i => i.affectedSection))).slice(0, 5),
    },
    {
      id: 'tech-sme-review',
      label: 'Specialist Review Queue (NEEDS REVIEW Claims)',
      status: needsReviewClaims.length === 0 ? 'pass' : 'warning',
      details:
        needsReviewClaims.length === 0
          ? 'No pending NEEDS REVIEW claims remain.'
          : `${needsReviewClaims.length} technical or regulatory claim(s) require Subject-Matter Expert confirmation.`,
      affectedSections: needsReviewClaims.map(c => `M${c.moduleNumber}: ${c.lessonTitle}`),
    },
    {
      id: 'tech-source-grounding',
      label: 'Authoritative Source Grounding for Technical / Regulated Content',
      status:
        technicalIndicatorsDetected.length > 0 && verifiedSourcesCount === 0
          ? 'warning'
          : 'pass',
      details:
        technicalIndicatorsDetected.length > 0 && verifiedSourcesCount === 0
          ? `Technical or regulatory indicators detected (${technicalIndicatorsDetected.join('; ')}), with ${(project.sources || []).length} source(s) registered and ${verifiedSourcesCount} human-verified. Upload or confirm authoritative references in Source Register.`
          : `${(project.sources || []).length} source(s) registered (${verifiedSourcesCount} human-verified) and ${verifiedClaims.length} claim(s) verified.`,
      affectedSections:
        technicalIndicatorsDetected.length > 0 && verifiedSourcesCount === 0
          ? ['Source Register', 'Stage 5 · Lessons']
          : [],
    },
    {
      id: 'tech-metadata-tbc',
      label: 'Unverified Programme Metadata Flags',
      status: unverifiedBriefFields.length === 0 ? 'pass' : 'warning',
      details:
        unverifiedBriefFields.length === 0
          ? 'All tracked Stage 1 brief metadata fields are marked Confirmed.'
          : `${unverifiedBriefFields.length} metadata field(s) remain To Be Confirmed or Require SME Validation: ${unverifiedBriefFields.map(([k]) => k).join(', ')}.`,
      affectedSections: unverifiedBriefFields.length > 0 ? ['Stage 1 · Course Brief'] : [],
    },
  ];

  return {
    verifiedClaimsCount: verifiedClaims.length,
    needsReviewClaimsCount: needsReviewClaims.length,
    unsupportedClaimsCount: unsupportedClaims.length,
    unverifiedBriefFieldsCount: unverifiedBriefFields.length,
    technicalIndicatorsDetected,
    checks,
  };
}
