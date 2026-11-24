import type {
  AccessibilityAuditSummary,
  CourseProject,
  DeterministicCheckItem,
  TechnicalValidationSummary,
} from '../types';

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

export const ACCESSIBILITY_LIMITATIONS_NOTE =
  'Automated checks verify structural readability (sentence length, heading chunking, terminology support, diagram alt-captions, table header formatting, module orientation, and assessment instruction clarity). They do NOT audit visual colour contrast, keyboard focus order, PDF/LMS screen-reader ARIA tagging, or full WCAG 2.1 AA compliance — human assistive-technology testing is required.';

export function runAccessibilityChecks(project: CourseProject): AccessibilityAuditSummary {
  const modules = project.content.modules || [];
  const lessons = modules.flatMap(m =>
    m.lessons.map(l => ({ moduleNumber: m.moduleNumber, moduleTitle: m.title, lesson: l }))
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

    // Check paragraph density & heading hierarchy
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

    // Check references to figures/diagrams/charts/images without descriptive text/caption cues
    if (
      /\b(diagram|figure|chart|graph|screenshot|image)\b/i.test(text) &&
      !/\b(alt|caption|shows|depicts|illustrates|table|step|describes)\b/i.test(text)
    ) {
      missingVisualAltCues.push(label);
    }

    // Check markdown/HTML tables for structural header rows & readable cell width
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
          ? 'All referenced diagrams or visual aids include descriptive explanations.'
          : `${missingVisualAltCues.length} lesson(s) reference a diagram/figure without descriptive text or alt-caption context.`,
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

export function runTechnicalValidationChecks(project: CourseProject): TechnicalValidationSummary {
  const modules = project.content.modules || [];
  const allClaims = modules.flatMap(m =>
    m.lessons.flatMap(l =>
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

  const unverifiedBriefFields = Object.entries(project.brief.fieldStatuses || {}).filter(
    ([, st]) => st === 'to_be_confirmed' || st === 'requires_sme_validation'
  );

  const combinedCorpus = modules
    .flatMap(m =>
      m.lessons.map(l => `${l.explanation}\n${l.workedExamples.join('\n')}\n${l.practicalApplication}`)
    )
    .join('\n');

  const technicalIndicatorsDetected: string[] = [];
  if (/[=±≤≥∑√∆]|(\b\d+(\.\d+)?\s*(kW|MW|kg|mol|bar|kPa|MPa|°C|K|mg\/L|ppm|%|ZAR|R\d))/i.test(combinedCorpus)) {
    technicalIndicatorsDetected.push('Equations, numerical thresholds, or engineering/financial units');
  }
  if (/\b(Act\s+\d+|Regulation|SANS|ISO\s+\d+|OHSA|POPIA|NCA|FAIS|FICA|NQF|SAQA|QCTO)\b/i.test(combinedCorpus)) {
    technicalIndicatorsDetected.push('Statutory, regulatory, or standards citations');
  }
  if (/\b(assumption|boundary condition|operating constraint|safety margin|hazard|tolerance)\b/i.test(combinedCorpus)) {
    technicalIndicatorsDetected.push('Operating constraints, assumptions, or safety implications');
  }

  const verifiedSourcesCount = (project.sources || []).filter(
    s => s.verificationStatus === 'VERIFIED'
  ).length;

  const checks: DeterministicCheckItem[] = [
    {
      id: 'tech-unsupported-claims',
      label: 'Unsupported Factual / Technical Claims',
      status: unsupportedClaims.length === 0 ? 'pass' : 'fail',
      details:
        unsupportedClaims.length === 0
          ? 'Zero claims tagged UNSUPPORTED in lesson content.'
          : `${unsupportedClaims.length} claim(s) lack adequate source evidence and must not be presented as verified fact.`,
      affectedSections: unsupportedClaims.map(c => `M${c.moduleNumber}: ${c.lessonTitle}`),
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
          ? `Technical or regulatory indicators detected (${technicalIndicatorsDetected.join('; ')}), with ${project.sources.length} source(s) registered and ${verifiedSourcesCount} human-verified. Upload or confirm authoritative references in Source Register.`
          : `${project.sources.length} source(s) registered (${verifiedSourcesCount} human-verified) and ${verifiedClaims.length} claim(s) verified.`,
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
