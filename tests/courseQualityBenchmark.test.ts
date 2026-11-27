import { describe, expect, it } from 'vitest';
import { computeFullAlignmentReport } from '../src/utils/alignmentHelpers.js';
import {
  normalizeAssessmentPlanOutput,
  normalizeCourseIntroduction,
  normalizeCurriculumProposal,
  normalizeLearningOutcomesPlan,
  normalizeLessonContentOutput,
} from '../src/utils/aiOutputValidation.js';
import {
  computeUpstreamStageSignatures,
  runPreExportCompletenessCheck,
  runStructuralAndConsistencyAudit,
} from '../src/utils/courseValidation.js';
import { runPedagogicalAndQualityChecks } from '../src/utils/validationChecks.js';
import {
  buildGenuineHumanSignOff,
  buildSampleCourseProject,
  buildSampleQAReport,
} from './helpers/testFixtures.js';

function buildBenchmarkCommercialCourse() {
  const project = buildSampleCourseProject({
    lifecycleStatus: 'awaiting_review',
    latestQA: buildSampleQAReport({
      humanSignOff: buildGenuineHumanSignOff(),
    }),
  });

  project.content.courseIntroduction = {
    whyThisMatters:
      'Every operational team handles candidate, customer, and supplier records across spreadsheets, ticketing tools, and messaging channels. Uncontrolled data sharing creates direct regulatory exposure under POPIA and erodes client trust when incidents are mishandled.',
    intendedLearners:
      'Operational team leads, HR coordinators, and line managers responsible for approving daily data transfers and team workflows.',
    prerequisitesSummary:
      'Learners should have completed standard workplace induction and possess familiarity with their department record-keeping tools.',
    outcomesOverview:
      'By completing this programme, participants evaluate processing justifications under Section 11, design practical technical and organisational safeguards under Section 19, and execute incident escalation protocols accurately.',
    structureRoadmap:
      'Module 1 builds core governance judgment around lawful processing grounds and operational security safeguards using real HR and customer workflow drills before culminating in a practical workplace audit.',
    assessmentOverview:
      'Mastery is evaluated through a weighted Knowledge Check (50%) and a Workplace Security Safeguards Audit Task (50%), with an agreed minimum pass requirement of 70%.',
    editStatus: 'human_edited',
  };

  project.content.modules[0].lessons[0].explanation =
    'Under the Protection of Personal Information Act 4 of 2013 (POPIA), Section 11 establishes six distinct lawful justifications for processing personal information: data subject consent, contractual necessity, legal obligation compliance, protection of a legitimate interest of the data subject, performance of a public law duty, and pursuit of legitimate interests of the responsible party or third party. Operational managers frequently make the mistake of requesting blanket employee or vendor consent when payroll administration, statutory tax submissions, or contract fulfilment already provide stronger, non-revocable statutory grounds. When selecting a lawful basis, document the exact business purpose, verify minimal data collection under Section 10, and apply role-based access controls and encryption under Section 19. Because statutory rules are applied alongside organisational policies, this training is provided for educational purposes only and does not constitute formal legal advice.';

  project.content.modules[0].lessons[0].workedExamples = [
    'HR Onboarding Register Audit: An HR coordinator receives an application form collecting national ID numbers, bank details, and emergency contacts. Contractual necessity and SARS tax obligations justify bank and tax identifiers, whereas optional diversity surveys require separate voluntary notice and strict access restriction.',
  ];
  project.content.modules[0].lessons[0].practicalApplication =
    'Review your team intake spreadsheet, classify each personal data column against Section 11 justifications, and eliminate redundant special personal information fields.';
  project.content.modules[0].lessons[0].guidedActivity =
    'Complete the 10-minute Data Minimisation & Lawful Basis worksheet using a sample onboarding form and present one access-control improvement to your peer group.';
  project.content.modules[0].lessons[0].keyTerminology = [
    {
      term: 'Responsible Party',
      definition:
        'The public or private body that determines the purpose of and means for processing personal information.',
    },
    {
      term: 'Information Regulator',
      definition:
        'The independent statutory authority established under POPIA to monitor compliance and receive compromise notifications.',
    },
  ];
  project.content.modules[0].knowledgeChecks = [
    {
      id: 'kc-1',
      question:
        'When administering employee monthly payroll and statutory SARS tax deductions, which POPIA Section 11 justification is most appropriate?',
      options: [
        'Contractual necessity and compliance with a legal obligation imposed on the responsible party',
        'Verbal consent collected weekly before every payroll run',
        'Complete exemption from Section 19 technical safeguards',
        'Public domain publication under open corporate reporting rules',
      ],
      correctIndex: 0,
      explanation:
        'Payroll processing is required to perform the employment contract and comply with statutory tax law, avoiding over-reliance on revocable consent.',
      outcomeCode: 'CLO-1',
    },
  ];

  // Ensure higher-order Evaluate CLO-1 is also evaluated through the practical Workplace Security Safeguards Audit Task
  project.assessments.items[1].outcomeIds = ['clo-1', 'mlo-1'];

  // Add second lesson duration alignment
  project.curriculum.modules[0].lessons[0].durationMinutes = 60;
  project.content.modules[0].lessons[0].durationMinutes = 60;

  return project;
}

describe('Course Creation Quality Engine & Pedagogical Benchmark Tests', () => {
  it('passes a commercially structured benchmark course with zero critical blockers and 100% alignment', () => {
    const benchmarkCourse = buildBenchmarkCommercialCourse();

    const pedResult = runPedagogicalAndQualityChecks(benchmarkCourse);
    expect(pedResult.issues).toEqual([]);

    const audit = runStructuralAndConsistencyAudit(benchmarkCourse);
    expect(audit.blockingErrors).toEqual([]);

    const alignment = computeFullAlignmentReport(benchmarkCourse);
    expect(alignment.scorePercent).toBe(100);
    expect(alignment.flags.filter(f => f.severity === 'critical')).toEqual([]);

    const preExport = runPreExportCompletenessCheck(benchmarkCourse);
    expect(preExport.readyForExport).toBe(true);
    expect(preExport.criticalBlockers).toEqual([]);
  });

  it('detects missing Course Introduction, thin/outcome-echoing lessons, generic AI filler, and missing facilitator separation', () => {
    const defective = buildBenchmarkCommercialCourse();
    defective.content.courseIntroduction = undefined;

    // Replace lesson 1 with thin, outcome-echoing, generic AI filler copy
    defective.content.modules[0].lessons[0].explanation =
      "In today's fast-paced world, let's dive into POPIA Data Governance Essentials. Evaluate workplace data workflows against POPIA lawful processing justifications and security safeguards.";
    defective.content.modules[0].lessons[0].workedExamples = [];
    defective.content.modules[0].lessons[0].practicalApplication = '';
    defective.content.modules[0].lessons[0].guidedActivity = '';

    // Strip facilitator separation fields
    defective.content.modules[0].scenarios[0].modelDebrief = '';
    defective.assessments.items[1].markingGuide = '';

    const pedIssues = runPedagogicalAndQualityChecks(defective).issues;
    const ids = pedIssues.map(i => i.id);

    expect(ids).toContain('warn-missing-course-intro');
    expect(ids.some(id => id.startsWith('warn-ped-thin-lesson-'))).toBe(true);
    expect(ids.some(id => id.startsWith('warn-ped-outcome-echo-'))).toBe(true);
    expect(ids.some(id => id.startsWith('warn-generic-filler-'))).toBe(true);
    expect(ids.some(id => id.startsWith('warn-missing-facilitator-separation-sc-'))).toBe(true);
    expect(ids.some(id => id.startsWith('warn-missing-facilitator-separation-ass-'))).toBe(true);
  });

  it('detects weak MCQ distractors, invalid answer keys, cross-lesson repetition, and terminology conflicts', () => {
    const defective = buildBenchmarkCommercialCourse();

    const sharedProse = Array.from({ length: 18 }, (_, i) =>
      `Operational sentence segment ${i + 1} covering personal information inventory classification encryption storage rules and escalation.`
    ).join(' ');

    defective.content.modules[0].lessons[0].explanation = `${sharedProse} Please note this is educational guidance only and not formal legal advice.`;

    defective.content.modules.push({
      ...defective.content.modules[0],
      id: 'cm-2',
      moduleId: 'mod-2',
      moduleNumber: 2,
      title: 'Advanced Governance Operations',
      lessons: [
        {
          ...defective.content.modules[0].lessons[0],
          id: 'gl-2',
          lessonPlanId: 'lesson-2',
          title: 'Advanced Record Classification',
          explanation: `${sharedProse} Additional compliance review applies.`,
          keyTerminology: [
            {
              term: 'Responsible Party',
              definition:
                'An external cloud hosting supplier providing encrypted backup disk storage infrastructure only.',
            },
          ],
        },
      ],
      scenarios: [],
      knowledgeChecks: [
        {
          id: 'kc-bad-key',
          question: 'Broken answer key question?',
          options: ['Choice A', 'Choice B'],
          correctIndex: 5,
          explanation: '',
          outcomeCode: 'CLO-1',
        },
      ],
    });

    // Weak Stage 4 MCQ distractor ("All of the above")
    defective.assessments.items[0].options = [
      'Contractual necessity',
      'Legal obligation',
      'Consent',
      'All of the above',
    ];

    const pedIssues = runPedagogicalAndQualityChecks(defective).issues;
    const ids = pedIssues.map(i => i.id);

    expect(ids.some(id => id.startsWith('warn-ped-repetition-'))).toBe(true);
    expect(ids.some(id => id.startsWith('warn-term-conflict-responsible-party'))).toBe(true);
    expect(ids.some(id => id.startsWith('blk-mcq-key-kc-'))).toBe(true);
    expect(ids.some(id => id.startsWith('warn-mcq-quality-ass-'))).toBe(true);

    const alignment = computeFullAlignmentReport(defective);
    expect(alignment.flags.some(f => f.category === 'weak_distractors')).toBe(true);
  });

  it('normalizes raw AI outputs cleanly (strict 100% weight reconciliation, bounded keys, non-echoing course intro)', () => {
    const project = buildBenchmarkCommercialCourse();

    const normalizedCurriculum = normalizeCurriculumProposal(
      {
        rationale: 'Progressive 2-module curriculum.',
        modules: [
          {
            title: 'Foundations',
            purpose: 'Build core concepts',
            lessons: [{ title: 'Intro Lesson', durationMinutes: -10, purpose: 'Learn basics' }],
          },
          {
            title: 'Applied Practice',
            purpose: 'Apply controls',
            lessons: [{ title: 'Lab Drill', durationMinutes: 900, purpose: 'Execute lab' }],
          },
        ],
      },
      project.brief
    );
    expect(normalizedCurriculum.modules[0].order).toBe(1);
    expect(normalizedCurriculum.modules[1].order).toBe(2);
    expect(normalizedCurriculum.modules[0].lessons[0].durationMinutes).toBeGreaterThanOrEqual(10);
    expect(normalizedCurriculum.modules[1].lessons[0].durationMinutes).toBeLessThanOrEqual(240);

    const outcomes = normalizeLearningOutcomesPlan(
      {
        courseOutcomes: [
          { code: 'CLO-1', bloomLevel: 'evaluate', statement: 'Evaluate POPIA workflows' },
          { code: 'CLO-1', bloomLevel: 'invalid_bloom', statement: 'Design safeguard controls' },
        ],
        moduleOutcomes: [
          { code: 'MLO-1', bloomLevel: 'Apply', statement: 'Apply lawful basis mapping' },
        ],
      },
      normalizedCurriculum
    );
    expect(new Set(outcomes.courseOutcomes.map(o => o.code)).size).toBe(2);
    expect(outcomes.courseOutcomes[1].bloomLevel).toBe('Apply');

    const normalizedAssessments = normalizeAssessmentPlanOutput(
      {
        passRequirementPercent: 75,
        knowledgeWeightPercent: 30,
        practicalWeightPercent: 99,
        items: [
          {
            title: 'MCQ Check',
            type: 'mcq',
            assessmentDomain: 'knowledge',
            weightingPercent: 12,
            options: ['Alpha', 'Alpha', 'Beta', 'Gamma', 'Delta'],
            correctIndices: [99],
          },
          {
            title: 'Practical Audit',
            type: 'practical_task',
            assessmentDomain: 'practical',
            weightingPercent: 17,
            rubric: [
              { criterion: 'Accuracy', weightPercent: 10 },
              { criterion: 'Completeness', weightPercent: 20 },
            ],
          },
        ],
      },
      outcomes
    );

    expect(normalizedAssessments.thresholdsConfirmed).toBe(false);
    expect(
      normalizedAssessments.knowledgeWeightPercent +
        normalizedAssessments.practicalWeightPercent
    ).toBe(100);
    const totalItemWeight = normalizedAssessments.items.reduce(
      (sum, it) => sum + it.weightingPercent,
      0
    );
    expect(totalItemWeight).toBe(100);
    const mcq = normalizedAssessments.items[0];
    expect(mcq.options).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
    expect(mcq.correctIndices).toEqual([0]);

    const normalizedLesson = normalizeLessonContentOutput(
      {
        explanation: 'Detailed explanation of lawful processing safeguards.',
        workedExamples: ['Worked Example 1'],
      },
      normalizedCurriculum.modules[0],
      {
        id: 'les-1',
        title: 'Lesson 1',
        durationMinutes: 45,
      },
      0,
      outcomes.moduleOutcomes.map(o => o.id)
    );
    expect(normalizedLesson.lessonPlanId).toBe('les-1');
    expect(normalizedLesson.durationMinutes).toBe(45);

    const intro = normalizeCourseIntroduction(
      {
        whyThisMatters: 'Clear workplace relevance rationale.',
      },
      {
        ...project,
        curriculum: normalizedCurriculum,
        outcomes,
        assessments: {
          ...project.assessments,
          ...normalizedAssessments,
        },
      }
    );
    expect(intro.whyThisMatters).toBe('Clear workplace relevance rationale.');
    expect(intro.intendedLearners.length).toBeGreaterThan(10);
    expect(intro.structureRoadmap.length).toBeGreaterThan(10);
    expect(intro.assessmentOverview.length).toBeGreaterThan(10);
  });

  it('computes distinct upstream stage signatures for non-destructive Stage 4/5 change warnings', () => {
    const project = buildBenchmarkCommercialCourse();
    const initialSigs = computeUpstreamStageSignatures(project);

    const modified = buildBenchmarkCommercialCourse();
    modified.curriculum.modules[0].title = 'Renamed Curriculum Module';
    const afterCurriculumEdit = computeUpstreamStageSignatures(modified);
    expect(afterCurriculumEdit.curriculumSignature).not.toBe(initialSigs.curriculumSignature);
    expect(afterCurriculumEdit.outcomesSignature).toBe(initialSigs.outcomesSignature);

    modified.outcomes.courseOutcomes[0].statement = 'Updated measurable outcome statement.';
    const afterOutcomeEdit = computeUpstreamStageSignatures(modified);
    expect(afterOutcomeEdit.outcomesSignature).not.toBe(initialSigs.outcomesSignature);
  });
});
