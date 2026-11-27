import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import type { CourseProject } from '../types';
import { computeFullAlignmentReport } from './alignmentHelpers';
import {
  buildCompanyMonogram,
  computeLogoFitDimensions,
  ensureContrastHex,
  parseDataUriLogoAsset,
  resolveExportBrand,
  sanitizeBrandHex,
  type ExportBrandOptions,
  type ResolvedLogoAsset,
} from './exportBranding';
import { buildScorm12ZipBytes } from './scormExport';

export type { ExportBrandOptions, ResolvedLogoAsset };

export type DeliverableType =
  | 'complete_course'
  | 'learner_manual'
  | 'facilitator_guide'
  | 'assessment_document'
  | 'marking_guide'
  | 'curriculum_overview'
  | 'alignment_matrix'
  | 'qa_report'
  | 'source_register'
  | 'lms_package';

function slugify(input: string): string {
  return (input || 'estudy-course')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function h1(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 280, after: 120 },
    children: [new TextRun({ text, bold: true, size: 30, color: '052B66' })],
  });
}

function h2(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 220, after: 80 },
    children: [new TextRun({ text, bold: true, size: 24, color: '042150' })],
  });
}

function para(text: string, boldPrefix?: string): Paragraph {
  const children: TextRun[] = [];
  if (boldPrefix) {
    children.push(new TextRun({ text: `${boldPrefix}: `, bold: true, size: 21, color: '052B66' }));
  }
  children.push(new TextRun({ text: text || 'To Be Confirmed', size: 21 }));
  return new Paragraph({ spacing: { after: 100 }, children });
}

function accreditationDisclaimerParagraph(project: CourseProject): Paragraph {
  const sa = project.brief.saCompliance;
  const note = sa?.enabled
    ? `Compliance Alignment Note: This programme has been structured to align with ${[
        sa.nqfLevel ? `NQF ${sa.nqfLevel}` : '',
        sa.saqaRelevant ? 'SAQA' : '',
        sa.qctoRelevant ? 'QCTO' : '',
        sa.setaName ? `SETA (${sa.setaName})` : '',
      ]
        .filter(Boolean)
        .join(', ') || 'selected South African workplace frameworks'} for review readiness. Framework alignment does not constitute formal regulatory accreditation.`
    : 'Programme Note: Developed using eStudy South Africa outcomes-based instructional design standards.';
  return para(note, 'Notice');
}

function buildTable(headers: string[], rows: string[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: headers.map(
          h =>
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: h, bold: true, size: 20, color: '052B66' })],
                }),
              ],
            })
        ),
      }),
      ...rows.map(
        row =>
          new TableRow({
            children: row.map(
              cell =>
                new TableCell({
                  children: [
                    new Paragraph({
                      children: [new TextRun({ text: cell || '-', size: 19 })],
                    }),
                  ],
                })
            ),
          })
      ),
    ],
  });
}

function appendCourseIntroductionDocx(
  children: Array<Paragraph | Table>,
  project: CourseProject
): void {
  const intro = project.content?.courseIntroduction;
  if (!intro) return;
  const hasAny =
    intro.whyThisMatters?.trim() ||
    intro.intendedLearners?.trim() ||
    intro.prerequisitesSummary?.trim() ||
    intro.outcomesOverview?.trim() ||
    intro.structureRoadmap?.trim() ||
    intro.assessmentOverview?.trim();
  if (!hasAny) return;

  children.push(h1('Course Introduction & Learning Journey'));
  if (intro.whyThisMatters?.trim()) children.push(para(intro.whyThisMatters, 'Why This Matters'));
  if (intro.intendedLearners?.trim()) children.push(para(intro.intendedLearners, 'Intended Learners'));
  if (intro.prerequisitesSummary?.trim()) children.push(para(intro.prerequisitesSummary, 'Prerequisites'));
  if (intro.outcomesOverview?.trim()) children.push(para(intro.outcomesOverview, 'Outcomes Overview'));
  if (intro.structureRoadmap?.trim()) children.push(para(intro.structureRoadmap, 'Course Structure & Roadmap'));
  if (intro.assessmentOverview?.trim()) children.push(para(intro.assessmentOverview, 'Assessment Overview'));
}

function buildCourseIntroductionHtml(project: CourseProject): string {
  const intro = project.content?.courseIntroduction;
  if (!intro) return '';
  const rows = [
    intro.whyThisMatters?.trim() ? `<p><strong>Why This Matters:</strong> ${escapeHtml(intro.whyThisMatters)}</p>` : '',
    intro.intendedLearners?.trim() ? `<p><strong>Intended Learners:</strong> ${escapeHtml(intro.intendedLearners)}</p>` : '',
    intro.prerequisitesSummary?.trim() ? `<p><strong>Prerequisites:</strong> ${escapeHtml(intro.prerequisitesSummary)}</p>` : '',
    intro.outcomesOverview?.trim() ? `<p><strong>Outcomes Overview:</strong> ${escapeHtml(intro.outcomesOverview)}</p>` : '',
    intro.structureRoadmap?.trim() ? `<p><strong>Course Structure &amp; Roadmap:</strong> ${escapeHtml(intro.structureRoadmap)}</p>` : '',
    intro.assessmentOverview?.trim() ? `<p><strong>Assessment Overview:</strong> ${escapeHtml(intro.assessmentOverview)}</p>` : '',
  ].filter(Boolean);
  if (rows.length === 0) return '';
  return `<div class="box"><h2>Course Introduction &amp; Learning Journey</h2>${rows.join('')}</div>`;
}

function resolveSyncLogoAsset(brand?: ExportBrandOptions): ResolvedLogoAsset | null {
  if (brand?.logoAsset) return brand.logoAsset;
  const url = brand?.logoUrl?.trim();
  if (url && url.startsWith('data:image/')) {
    return parseDataUriLogoAsset(url);
  }
  return null;
}

function formatBrandPrefix(brand?: ExportBrandOptions): string {
  const cleanCompany = (brand?.companyName || '').trim();
  return cleanCompany ? `${cleanCompany} · eSTUDY SOUTH AFRICA` : 'eSTUDY SOUTH AFRICA';
}

function buildDocxBrandCoverHeader(
  project: CourseProject,
  type: DeliverableType,
  brand?: ExportBrandOptions
): Table {
  const title = project.brief.title || 'Untitled Course';
  const code = project.brief.code || 'TBC';
  const cleanCompany = (brand?.companyName || '').trim();
  const brandPrefix = formatBrandPrefix(brand);
  const primaryHex = ensureContrastHex(brand?.primaryColour || '052B66', '052B66');
  const secondaryHex = sanitizeBrandHex(brand?.secondaryColour, '45CC42');
  const asset = resolveSyncLogoAsset(brand);

  const noSideBorders = {
    top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    bottom: { style: BorderStyle.SINGLE, size: 18, color: secondaryHex },
  };

  let logoParagraph: Paragraph;
  if (asset?.docxBytes && asset.docxType) {
    const dims = computeLogoFitDimensions(asset, 160, 52);
    logoParagraph = new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 40, after: 40 },
      children: [
        new ImageRun({
          type: asset.docxType,
          data: asset.docxBytes,
          transformation: { width: dims.width, height: dims.height },
          altText: {
            name: 'CompanyLogo',
            title: cleanCompany || 'Company Logo',
            description: `${cleanCompany || 'Company'} official branding logo`,
          },
        }),
      ],
    });
  } else {
    const monogram = buildCompanyMonogram(cleanCompany || 'eStudy');
    logoParagraph = new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 60, after: 60 },
      children: [
        new TextRun({
          text: monogram,
          bold: true,
          size: 34,
          color: primaryHex,
        }),
      ],
    });
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 28, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.CENTER,
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F8FAFC' },
            borders: noSideBorders,
            margins: { top: 100, bottom: 120, left: 100, right: 140 },
            children: [logoParagraph],
          }),
          new TableCell({
            width: { size: 72, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.CENTER,
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FFFFFF' },
            borders: noSideBorders,
            margins: { top: 100, bottom: 120, left: 160, right: 80 },
            children: [
              new Paragraph({
                spacing: { after: 50 },
                children: [
                  new TextRun({ text: `${brandPrefix} · `, bold: true, size: 19, color: ensureContrastHex(secondaryHex, primaryHex) }),
                  new TextRun({ text: type.replace(/_/g, ' ').toUpperCase(), bold: true, size: 19, color: primaryHex }),
                ],
              }),
              new Paragraph({
                spacing: { after: 40 },
                children: [
                  new TextRun({ text: `${title} (${code})`, bold: true, size: 34, color: primaryHex }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function buildDocxChildren(
  project: CourseProject,
  type: DeliverableType,
  brand?: ExportBrandOptions
): Array<Paragraph | Table> {
  const children: Array<Paragraph | Table> = [
    buildDocxBrandCoverHeader(project, type, brand),
    new Paragraph({ spacing: { after: 140 }, children: [] }),
    para(project.brief.industryDomain, 'Industry / Domain'),
    para(project.brief.targetAudience, 'Target Audience'),
    para(project.brief.estimatedDuration, 'Estimated Duration'),
    para(project.brief.language, 'Language'),
    accreditationDisclaimerParagraph(project),
  ];

  if (type === 'complete_course') {
    children.push(h1('1. Course Brief & Workplace Specification'));
    children.push(para(project.brief.purpose, 'Purpose'));
    if (project.brief.workplaceProblem) {
      children.push(para(project.brief.workplaceProblem, 'Workplace Problem Addressed'));
    }
    if (project.brief.targetJobRoles) {
      children.push(para(project.brief.targetJobRoles, 'Target Job Roles'));
    }
    if (project.brief.experienceLevel) {
      children.push(para(project.brief.experienceLevel, 'Experience Level'));
    }
    if (project.brief.prerequisites) {
      children.push(para(project.brief.prerequisites, 'Prerequisites'));
    }
    if (project.brief.learningRequirements) {
      children.push(para(project.brief.learningRequirements, 'Learning Requirements'));
    }
    if (project.brief.subjectTopicsInput) {
      children.push(para(project.brief.subjectTopicsInput, 'Subject Topics Scope'));
    }
    children.push(
      para(
        `${project.brief.aiIntegrationMode}${project.brief.aiIntegrationRequirements ? ` — ${project.brief.aiIntegrationRequirements}` : ''}`,
        'AI Integration'
      )
    );
    if (project.brief.saCompliance?.enabled) {
      const sa = project.brief.saCompliance;
      children.push(
        para(
          [
            sa.nqfLevel ? `NQF Level ${sa.nqfLevel}` : '',
            sa.saqaRelevant ? `SAQA${sa.saqaNotes ? ` (${sa.saqaNotes})` : ''}` : '',
            sa.qctoRelevant ? 'QCTO' : '',
            sa.setaName ? `SETA: ${sa.setaName}` : '',
            sa.popiaRelevant ? 'POPIA Relevant' : '',
            sa.industryLegislation ? `Legislation: ${sa.industryLegislation}` : '',
            sa.technicalStandards ? `Standards: ${sa.technicalStandards}` : '',
          ]
            .filter(Boolean)
            .join(' | ') || 'Enabled',
          'Compliance Profile'
        )
      );
    }
    const customEntries = Object.entries(project.brief.templateFieldValues || {}).filter(
      ([, v]) => typeof v === 'string' && v.trim().length > 0
    );
    if (customEntries.length > 0) {
      children.push(h2('Template Custom Specifications'));
      for (const [k, v] of customEntries) {
        children.push(para(v, k.replace(/_/g, ' ')));
      }
    }

    children.push(h1('2. Curriculum Architecture & Coverage Audit'));
    children.push(para(project.curriculum.rationale, 'Design Rationale'));
    for (const m of project.curriculum.modules) {
      children.push(h2(`Module ${m.order}: ${m.title} (${m.qctoModuleType || 'Standard'})`));
      children.push(para(m.purpose, 'Purpose'));
      if (m.competencies.length > 0) {
        children.push(para(m.competencies.join(', '), 'Competencies'));
      }
      if (m.lessons.length > 0) {
        children.push(
          para(m.lessons.map(l => `${l.title} (${l.durationMinutes}m)`).join(' | '), 'Planned Lessons')
        );
      }
    }
    if (project.curriculum.coverageChecks.length > 0) {
      children.push(h2('Curriculum Coverage Matrix'));
      children.push(
        buildTable(
          ['Supplied Topic', 'Status', 'Mapped Location', 'Notes'],
          project.curriculum.coverageChecks.map(c => [
            c.originalTopic,
            c.status.toUpperCase(),
            c.mappedLocation,
            c.notes,
          ])
        )
      );
    }

    children.push(h1('3. Learning Outcomes & Constructive Alignment'));
    if (project.outcomes.courseOutcomes.length > 0) {
      children.push(h2('Course-Level Learning Outcomes'));
      for (const out of project.outcomes.courseOutcomes) {
        children.push(para(`${out.code} [${out.bloomLevel}]: ${out.statement}`));
      }
    }
    if (project.outcomes.moduleOutcomes.length > 0) {
      children.push(h2('Module-Level Learning Outcomes'));
      for (const out of project.outcomes.moduleOutcomes) {
        children.push(para(`${out.code} [${out.bloomLevel}]: ${out.statement}`));
      }
    }
    const report = computeFullAlignmentReport(project);
    children.push(h2('3-Way Constructive Alignment Matrix'));
    children.push(para(`${report.scorePercent}% — ${report.explanation}`, 'Alignment Score'));
    if (report.rows.length > 0) {
      children.push(
        buildTable(
          ['Code', 'Bloom', 'Outcome Statement', 'Learning Activities / Lessons', 'Assessment Evidence', 'Status'],
          report.rows.map(r => [
            r.outcomeCode,
            r.bloomLevel,
            r.outcomeStatement,
            r.learningActivities.map(a => a.title).join('; ') || 'NONE (UNTAUGHT)',
            r.assessmentEvidence.map(m => `${m.title} (${m.type})`).join('; ') || 'NONE (UNASSESSED)',
            r.status.toUpperCase(),
          ])
        )
      );
    }

    appendCourseIntroductionDocx(children, project);
    children.push(h1('4. Complete Course Modules & Learning Content'));
    for (const mod of project.content.modules) {
      children.push(h2(`Module ${mod.moduleNumber}: ${mod.title}`));
      children.push(para(mod.introduction, 'Introduction'));
      for (const obj of mod.learningObjectives) {
        children.push(para(obj, 'Objective'));
      }
      for (const lesson of mod.lessons) {
        children.push(h2(`Lesson: ${lesson.title} (${lesson.durationMinutes} min)`));
        children.push(para(lesson.explanation));
        if (lesson.keyTerminology.length > 0) {
          children.push(
            para(
              lesson.keyTerminology.map(k => `${k.term}: ${k.definition}`).join(' | '),
              'Key Terminology'
            )
          );
        }
        if (lesson.workedExamples.length > 0) {
          children.push(para(lesson.workedExamples.join('\n\n'), 'Worked Examples'));
        }
        children.push(para(lesson.practicalApplication, 'Practical Workplace Application'));
        children.push(para(lesson.guidedActivity, 'Guided Activity'));
      }
      for (const cs of mod.workplaceCaseStudies) {
        children.push(h2(`Case Study: ${cs.title}`));
        children.push(para(cs.background));
        if (cs.analysisQuestions.length > 0) {
          children.push(para(cs.analysisQuestions.join(' | '), 'Analysis Questions'));
        }
        if (cs.facilitatorNotes) {
          children.push(para(cs.facilitatorNotes, 'Facilitator Debrief Notes'));
        }
      }
      for (const sc of mod.scenarios) {
        children.push(h2(`Scenario: ${sc.title} (${sc.contextType})`));
        children.push(para(sc.situation, 'Situation'));
        children.push(para(sc.challenge, 'Challenge'));
        children.push(para(sc.decisionPrompt, 'Decision Point'));
        if (sc.modelDebrief) {
          children.push(para(sc.modelDebrief, 'Model Debrief'));
        }
        children.push(para(sc.keyTakeaway, 'Key Takeaway'));
      }
      if (mod.knowledgeChecks.length > 0) {
        children.push(h2('Module Knowledge Checks'));
        mod.knowledgeChecks.forEach((kc, idx) => {
          children.push(para(`${idx + 1}. ${kc.question}`));
          kc.options.forEach((opt, oi) => {
            children.push(para(`   ${String.fromCharCode(65 + oi)}) ${opt}`));
          });
          children.push(
            para(
              `Correct: ${String.fromCharCode(65 + kc.correctIndex)} — ${kc.explanation}`,
              'Answer Key'
            )
          );
        });
      }
      children.push(para(mod.summary, 'Module Summary'));
    }

    children.push(h1('5. Assessments, Marking Guides & Rubrics'));
    children.push(para(project.assessments.strategySummary, 'Strategy'));
    children.push(
      para(
        `${project.assessments.passRequirementPercent}% (Knowledge ${project.assessments.knowledgeWeightPercent}% / Practical ${project.assessments.practicalWeightPercent}%)`,
        'Pass & Weighting'
      )
    );
    for (const item of project.assessments.items) {
      children.push(
        h2(`${item.title} [${item.type.toUpperCase()} · ${item.classification} · ${item.weightingPercent}%]`)
      );
      children.push(para(item.objective, 'Objective'));
      children.push(para(item.instructions, 'Instructions'));
      children.push(para(item.promptOrQuestion, 'Prompt / Task'));
      if (item.options && item.options.length > 0) {
        item.options.forEach((opt, i) =>
          children.push(para(`   ${String.fromCharCode(65 + i)}) ${opt}`))
        );
      }
      children.push(para(item.modelAnswer, 'Model Answer'));
      children.push(para(item.markingGuide, 'Marking Guide'));
      children.push(para(item.feedbackCorrect, 'Feedback (Correct)'));
      children.push(para(item.feedbackIncorrect, 'Feedback (Incorrect)'));
      if (item.rubric.length > 0) {
        children.push(
          buildTable(
            ['Criterion', 'Weight %', 'Competent Standard', 'Not Yet Competent'],
            item.rubric.map(r => [
              r.criterion,
              `${r.weightPercent}%`,
              r.competentStandard,
              r.notYetCompetentIndicator,
            ])
          )
        );
      }
    }

    children.push(h1('6. Quality Assurance & Governance Summary'));
    const qa = project.latestQA;
    if (!qa) {
      children.push(para('No QA evaluation has been executed yet.'));
    } else {
      children.push(para(`${qa.verdict} (${qa.weightedScore}%)`, 'Verdict'));
      children.push(para(qa.verdictExplanation, 'Explanation'));
      children.push(
        buildTable(
          ['Dimension', 'Weight', 'Score', 'Weaknesses', 'Recommended Corrections'],
          qa.dimensions.map(d => [
            d.label,
            `${d.weight}%`,
            `${d.score}%`,
            d.weaknesses.join('; ') || 'None',
            d.recommendedCorrections.join('; ') || 'None',
          ])
        )
      );
    }

    children.push(
      para(
        'Educational Guidance Disclaimer: Any regulatory, legislative (including POPIA Act 4 of 2013 or PEPUDA Act 4 of 2000), or governance discussions in this course are provided for educational purposes only and do not constitute formal legal advice. Organisations must consult qualified South African legal or compliance advisors before making formal compliance decisions.',
        'Regulatory & Educational Disclaimer'
      )
    );

    if (project.sources.length > 0) {
      children.push(h1('7. Consolidated References & Source Register'));
      children.push(
        buildTable(
          ['Ref', 'Title', 'Author / Organisation', 'Date', 'Version', 'Reference / URL', 'Status'],
          project.sources.map((s, idx) => [
            `[Source ${idx + 1}]`,
            s.title,
            s.authorOrOrganisation,
            s.publicationDate,
            s.version,
            s.referenceOrUrl,
            s.verificationStatus,
          ])
        )
      );
    }
  } else if (type === 'learner_manual' || type === 'facilitator_guide') {
    children.push(h1('Programme Overview & Learning Outcomes'));
    children.push(para(project.brief.purpose, 'Purpose'));
    appendCourseIntroductionDocx(children, project);
    for (const out of project.outcomes.courseOutcomes) {
      children.push(para(`${out.code} [${out.bloomLevel}]: ${out.statement}`));
    }

    for (const mod of project.content.modules) {
      children.push(h1(`Module ${mod.moduleNumber}: ${mod.title}`));
      children.push(para(mod.introduction, 'Introduction'));
      if (type === 'facilitator_guide') {
        children.push(para('Guide discussion around workplace constraints, verify learner calculations/steps, and debrief case studies against the marking guide.', 'Facilitator Note'));
      }
      for (const obj of mod.learningObjectives) {
        children.push(para(obj, 'Objective'));
      }
      for (const lesson of mod.lessons) {
        children.push(h2(`${lesson.title} (${lesson.durationMinutes} min)`));
        children.push(para(lesson.explanation));
        if (lesson.keyTerminology.length > 0) {
          children.push(para(lesson.keyTerminology.map(k => `${k.term}: ${k.definition}`).join(' | '), 'Key Terminology'));
        }
        if (lesson.workedExamples.length > 0) {
          children.push(para(lesson.workedExamples.join('\n\n'), 'Worked Examples'));
        }
        children.push(para(lesson.practicalApplication, 'Practical Workplace Application'));
        children.push(para(lesson.guidedActivity, 'Guided Activity'));
      }
      for (const cs of mod.workplaceCaseStudies) {
        children.push(h2(`Case Study: ${cs.title}`));
        children.push(para(cs.background));
        children.push(para(cs.analysisQuestions.join(' | '), 'Analysis Questions'));
        if (type === 'facilitator_guide') {
          children.push(para(cs.facilitatorNotes, 'Facilitator Debrief Notes'));
        }
      }
      for (const sc of mod.scenarios) {
        children.push(h2(`Scenario: ${sc.title} (${sc.contextType})`));
        children.push(para(sc.situation, 'Situation'));
        children.push(para(sc.challenge, 'Challenge'));
        children.push(para(sc.decisionPrompt, 'Decision Point'));
        if (type === 'facilitator_guide') {
          children.push(para(sc.modelDebrief, 'Model Debrief'));
        }
        children.push(para(sc.keyTakeaway, 'Key Takeaway'));
      }
      if (mod.knowledgeChecks.length > 0) {
        children.push(h2('Module Knowledge Checks'));
        mod.knowledgeChecks.forEach((kc, idx) => {
          children.push(para(`${idx + 1}. ${kc.question}`));
          kc.options.forEach((opt, oi) => {
            children.push(para(`   ${String.fromCharCode(65 + oi)}) ${opt}`));
          });
          if (type === 'facilitator_guide') {
            children.push(para(`Correct: ${String.fromCharCode(65 + kc.correctIndex)} — ${kc.explanation}`, 'Answer Key'));
          }
        });
      }
      children.push(para(mod.summary, 'Module Summary'));
    }
    children.push(
      para(
        'Educational Guidance Disclaimer: Regulatory and legislative discussions in this manual are provided for workplace training and educational purposes only and do not constitute formal legal advice.',
        'Disclaimer'
      )
    );
    if (project.sources.length > 0) {
      children.push(h1('Consolidated References & Sources'));
      project.sources.forEach((s, idx) => {
        children.push(
          para(
            `[Source ${idx + 1}] ${s.title} — ${s.authorOrOrganisation} (${s.publicationDate || 'n.d.'}) · ${s.referenceOrUrl} [${s.verificationStatus}]`
          )
        );
      });
    }
  } else if (type === 'assessment_document' || type === 'marking_guide') {
    children.push(h1('Assessment Strategy'));
    children.push(para(project.assessments.strategySummary, 'Strategy'));
    children.push(para(`${project.assessments.passRequirementPercent}% (Knowledge ${project.assessments.knowledgeWeightPercent}% / Practical ${project.assessments.practicalWeightPercent}%)`, 'Pass & Weighting'));
    for (const item of project.assessments.items) {
      children.push(h2(`${item.title} [${item.type.toUpperCase()} · ${item.classification} · ${item.weightingPercent}%]`));
      children.push(para(item.objective, 'Objective'));
      children.push(para(item.instructions, 'Instructions'));
      children.push(para(item.promptOrQuestion, 'Prompt / Task'));
      if (item.options && item.options.length > 0) {
        item.options.forEach((opt, i) => children.push(para(`   ${String.fromCharCode(65 + i)}) ${opt}`)));
      }
      if (type === 'marking_guide') {
        children.push(para(item.modelAnswer, 'Model Answer'));
        children.push(para(item.markingGuide, 'Marking Guide'));
        children.push(para(item.feedbackCorrect, 'Feedback (Correct)'));
        children.push(para(item.feedbackIncorrect, 'Feedback (Incorrect)'));
        if (item.rubric.length > 0) {
          children.push(
            buildTable(
              ['Criterion', 'Weight %', 'Competent Standard', 'Not Yet Competent'],
              item.rubric.map(r => [r.criterion, `${r.weightPercent}%`, r.competentStandard, r.notYetCompetentIndicator])
            )
          );
        }
      }
    }
  } else if (type === 'curriculum_overview') {
    children.push(h1('Curriculum Architecture & Coverage Audit'));
    children.push(para(project.curriculum.rationale, 'Design Rationale'));
    for (const m of project.curriculum.modules) {
      children.push(h2(`Module ${m.order}: ${m.title} (${m.qctoModuleType || 'Standard'})`));
      children.push(para(m.purpose, 'Purpose'));
      children.push(para(m.competencies.join(', '), 'Competencies'));
      children.push(para(m.lessons.map(l => `${l.title} (${l.durationMinutes}m)`).join(' | '), 'Lessons'));
    }
    children.push(h1('Curriculum Coverage Matrix'));
    children.push(
      buildTable(
        ['Supplied Topic', 'Status', 'Mapped Location', 'Notes'],
        project.curriculum.coverageChecks.map(c => [c.originalTopic, c.status.toUpperCase(), c.mappedLocation, c.notes])
      )
    );
  } else if (type === 'alignment_matrix') {
    const report = computeFullAlignmentReport(project);
    children.push(h1('3-Way Constructive Alignment Matrix'));
    children.push(para(`${report.scorePercent}% — ${report.explanation}`, 'Alignment Score'));
    children.push(para(report.disclaimer, 'Quality Indicator Notice'));
    children.push(
      buildTable(
        ['Code', 'Bloom', 'Outcome Statement', 'Learning Activities / Lessons', 'Assessment Evidence', 'Status'],
        report.rows.map(r => [
          r.outcomeCode,
          r.bloomLevel,
          r.outcomeStatement,
          r.learningActivities.map(a => a.title).join('; ') || 'NONE (UNTAUGHT)',
          r.assessmentEvidence.map(m => `${m.title} (${m.type})`).join('; ') || 'NONE (UNASSESSED)',
          r.status.toUpperCase(),
        ])
      )
    );
  } else if (type === 'qa_report') {
    const qa = project.latestQA;
    children.push(h1('Quality Assurance Evaluation Report'));
    if (!qa) {
      children.push(para('No QA evaluation has been executed yet.'));
    } else {
      children.push(para(`${qa.verdict} (${qa.weightedScore}%)`, 'Verdict'));
      children.push(para(qa.verdictExplanation, 'Explanation'));
      if (qa.accessibilityAudit) {
        children.push(
          para(
            `${qa.accessibilityAudit.scorePercent}% · Avg ${qa.accessibilityAudit.averageSentenceWords} words/sentence (${qa.accessibilityAudit.readabilityBand})`,
            'Accessibility & Readability Audit'
          )
        );
      }
      if (qa.technicalValidation) {
        children.push(
          para(
            `${qa.technicalValidation.verifiedClaimsCount} Verified / ${qa.technicalValidation.needsReviewClaimsCount} Needs Review / ${qa.technicalValidation.unsupportedClaimsCount} Unsupported claims`,
            'Technical & Source Validation'
          )
        );
      }
      children.push(
        buildTable(
          ['Dimension', 'Weight', 'Score', 'Weaknesses', 'Recommended Corrections'],
          qa.dimensions.map(d => [
            d.label,
            `${d.weight}%`,
            `${d.score}%`,
            d.weaknesses.join('; ') || 'None',
            d.recommendedCorrections.join('; ') || 'None',
          ])
        )
      );
      if (qa.durationValidation) {
        children.push(para(qa.durationValidation.summary, 'Duration Reconciliation'));
      }
      if (qa.assessmentValidation) {
        children.push(
          para(
            `Declared ${qa.assessmentValidation.declaredKnowledgeWeight}%/${qa.assessmentValidation.declaredPracticalWeight}% · Items ${qa.assessmentValidation.actualKnowledgeWeight}%/${qa.assessmentValidation.actualPracticalWeight}% (Total ${qa.assessmentValidation.totalItemWeight}%, Pass ${qa.assessmentValidation.passRequirementPercent}%)`,
            'Assessment Weighting Math'
          )
        );
      }
      if (qa.verificationSummary) {
        children.push(
          para(
            `Automated: ${qa.verificationSummary.automatedCount} | Verified Sources: ${qa.verificationSummary.externalVerifiedCount} | Unverified: ${qa.verificationSummary.unverifiedCount} | Expert Review Required: ${qa.verificationSummary.expertReviewRequiredCount}. ${qa.verificationSummary.externalVerificationNote}`,
            'Verification Origin & Scope'
          )
        );
      }
      if (qa.accessibilityAudit?.limitationsNote) {
        children.push(para(qa.accessibilityAudit.limitationsNote, 'Accessibility Audit Scope'));
      }
      if (qa.blockingErrors && qa.blockingErrors.length > 0) {
        children.push(h2('Blocking & Critical Issues Preventing Release'));
        for (const err of qa.blockingErrors) {
          children.push(
            para(
              `[${(err.prioritySeverity || 'critical').toUpperCase()} · ${err.verificationOrigin || 'automated'}] ${err.rule} (${err.affectedSection}): ${err.description} [Fix: ${err.recommendedFix}]`
            )
          );
        }
      } else if (qa.criticalFailures.length > 0) {
        children.push(h2('Blocking Critical Failures'));
        for (const f of qa.criticalFailures) {
          children.push(para(`${f.rule}: ${f.description} (Fix: ${f.recommendedFix})`));
        }
      }
      if (qa.warnings && qa.warnings.length > 0) {
        children.push(h2('Advisory & High-Priority Warnings'));
        for (const w of qa.warnings) {
          children.push(
            para(
              `[${(w.prioritySeverity || 'medium').toUpperCase()} · ${w.verificationOrigin || 'automated'}] ${w.rule} (${w.affectedSection}): ${w.description}`
            )
          );
        }
      }
      if (qa.humanSignOff.roles) {
        children.push(h2('Multi-Role Governance Sign-Off'));
        children.push(
          buildTable(
            ['Role', 'Reviewer', 'Status', 'Timestamp', 'Notes'],
            [
              [
                'Subject-Matter Expert (SME)',
                qa.humanSignOff.roles.sme.reviewerName || '-',
                qa.humanSignOff.roles.sme.signedOff ? 'APPROVED' : 'PENDING',
                qa.humanSignOff.roles.sme.signedOffAt || '-',
                qa.humanSignOff.roles.sme.notes || '-',
              ],
              [
                'Instructional Designer',
                qa.humanSignOff.roles.instructionalDesigner.reviewerName || '-',
                qa.humanSignOff.roles.instructionalDesigner.signedOff ? 'APPROVED' : 'PENDING',
                qa.humanSignOff.roles.instructionalDesigner.signedOffAt || '-',
                qa.humanSignOff.roles.instructionalDesigner.notes || '-',
              ],
              [
                'Compliance Authoriser',
                qa.humanSignOff.roles.complianceAuthorizer.reviewerName || '-',
                qa.humanSignOff.roles.complianceAuthorizer.signedOff ? 'APPROVED' : 'PENDING',
                qa.humanSignOff.roles.complianceAuthorizer.signedOffAt || '-',
                qa.humanSignOff.roles.complianceAuthorizer.notes || '-',
              ],
            ]
          )
        );
      } else {
        children.push(
          para(
            qa.humanSignOff.signedOff
              ? `Approved by ${qa.humanSignOff.reviewerName} on ${qa.humanSignOff.signedOffAt}`
              : 'Pending mandatory human review sign-off.',
            'Human Review'
          )
        );
      }
    }
  } else if (type === 'source_register') {
    children.push(h1('Source Register & Verification Status'));
    children.push(
      buildTable(
        ['Title', 'Author / Organisation', 'Date', 'Version', 'Reference / URL', 'Status'],
        project.sources.map(s => [
          s.title,
          s.authorOrOrganisation,
          s.publicationDate,
          s.version,
          s.referenceOrUrl,
          s.verificationStatus,
        ])
      )
    );
  }

  return children;
}

export function buildDeliverableDocxDocument(
  project: CourseProject,
  type: Exclude<DeliverableType, 'lms_package'>,
  brand?: ExportBrandOptions
): Document {
  const cleanCompany = (brand?.companyName || '').trim() || 'eStudy South Africa';
  const title = project.brief.title || 'Untitled Course';
  const code = project.brief.code || 'TBC';

  return new Document({
    sections: [
      {
        properties: {},
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: `${cleanCompany} · ${title} (${code})`,
                    size: 16,
                    color: '64748B',
                  }),
                ],
              }),
            ],
          }),
        },
        children: buildDocxChildren(project, type, brand),
      },
    ],
  });
}

export async function exportDeliverableDocx(
  project: CourseProject,
  type: DeliverableType,
  brand?: ExportBrandOptions
): Promise<void> {
  if (type === 'lms_package') {
    await exportLmsPackageJson(project, brand);
    return;
  }
  const resolvedBrand = await resolveExportBrand(brand);
  const doc = buildDeliverableDocxDocument(project, type, resolvedBrand);
  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `${slugify(project.brief.title)}-${type}.docx`);
}

export function buildDeliverableHtmlDocument(
  project: CourseProject,
  type: Exclude<DeliverableType, 'lms_package'>,
  brand?: ExportBrandOptions
): string {
  const title = project.brief.title || 'Untitled Course';
  const code = project.brief.code || 'TBC';
  const label = type.replace(/_/g, ' ').toUpperCase();
  const brandPrefix = formatBrandPrefix(brand);
  const cleanCompany = (brand?.companyName || '').trim();
  const primaryHex = ensureContrastHex(brand?.primaryColour || '052B66', '052B66');
  const secondaryHex = sanitizeBrandHex(brand?.secondaryColour, '45CC42');
  const asset = resolveSyncLogoAsset(brand);
  const monogram = escapeHtml(buildCompanyMonogram(cleanCompany || 'eStudy'));
  const logoAlt = escapeHtml(cleanCompany ? `${cleanCompany} logo` : 'Company logo');
  const logoMarkup = asset?.dataUri
    ? `<div class="logo-box"><img src="${asset.dataUri}" alt="${logoAlt}" class="company-logo" /></div>`
    : `<div class="logo-box logo-monogram" aria-hidden="true">${monogram}</div>`;

  let bodyHtml = '';
  if (type === 'complete_course') {
    const report = computeFullAlignmentReport(project);
    bodyHtml += `<h2>1. Course Brief &amp; Workplace Specification</h2>`;
    bodyHtml += `<p><strong>Purpose:</strong> ${escapeHtml(project.brief.purpose)}</p>`;
    if (project.brief.workplaceProblem) {
      bodyHtml += `<p><strong>Workplace Problem:</strong> ${escapeHtml(project.brief.workplaceProblem)}</p>`;
    }
    if (project.brief.targetJobRoles) {
      bodyHtml += `<p><strong>Target Job Roles:</strong> ${escapeHtml(project.brief.targetJobRoles)}</p>`;
    }
    if (project.brief.prerequisites) {
      bodyHtml += `<p><strong>Prerequisites:</strong> ${escapeHtml(project.brief.prerequisites)}</p>`;
    }
    if (project.brief.learningRequirements) {
      bodyHtml += `<p><strong>Learning Requirements:</strong> ${escapeHtml(project.brief.learningRequirements)}</p>`;
    }

    bodyHtml += `<h2>2. Curriculum Architecture</h2><p><strong>Design Rationale:</strong> ${escapeHtml(project.curriculum.rationale)}</p>`;
    for (const m of project.curriculum.modules) {
      bodyHtml += `<h3>Module ${m.order}: ${escapeHtml(m.title)}</h3><p>${escapeHtml(m.purpose)}</p>`;
      if (m.lessons.length > 0) {
        bodyHtml += `<p><strong>Lessons:</strong> ${m.lessons.map(l => `${escapeHtml(l.title)} (${l.durationMinutes}m)`).join(' · ')}</p>`;
      }
    }

    bodyHtml += `<h2>3. Learning Outcomes &amp; Constructive Alignment (${report.scorePercent}%)</h2>`;
    bodyHtml += `<ul>${project.outcomes.courseOutcomes
      .map(o => `<li><strong>${escapeHtml(o.code)} (${escapeHtml(o.bloomLevel)}):</strong> ${escapeHtml(o.statement)}</li>`)
      .join('')}</ul>`;
    if (report.rows.length > 0) {
      bodyHtml += `<table><thead><tr><th>Code</th><th>Outcome</th><th>Learning Activities</th><th>Mapped Assessments</th><th>Status</th></tr></thead><tbody>${report.rows
        .map(
          r =>
            `<tr><td>${escapeHtml(r.outcomeCode)}</td><td>${escapeHtml(r.outcomeStatement)}</td><td>${r.learningActivities.map(a => escapeHtml(a.title)).join(', ') || 'UNTAUGHT'}</td><td>${r.assessmentEvidence.map(m => escapeHtml(m.title)).join(', ') || 'UNASSESSED'}</td><td>${escapeHtml(r.status.toUpperCase())}</td></tr>`
        )
        .join('')}</tbody></table>`;
    }

    bodyHtml += buildCourseIntroductionHtml(project);
    bodyHtml += `<div class="page-break"></div><h2>4. Complete Course Modules &amp; Learning Content</h2>`;
    for (const mod of project.content.modules) {
      bodyHtml += `<div class="page-break"></div><h3>Module ${mod.moduleNumber}: ${escapeHtml(mod.title)}</h3>`;
      bodyHtml += `<p><strong>Introduction:</strong> ${escapeHtml(mod.introduction)}</p>`;
      if (mod.learningObjectives.length > 0) {
        bodyHtml += `<ul>${mod.learningObjectives.map(o => `<li>${escapeHtml(o)}</li>`).join('')}</ul>`;
      }
      for (const l of mod.lessons) {
        bodyHtml += `<h4>${escapeHtml(l.title)} (${l.durationMinutes} min)</h4><p>${escapeHtml(l.explanation).replace(/\n/g, '<br/>')}</p>`;
        if (l.keyTerminology.length > 0) {
          bodyHtml += `<p><strong>Key Terminology:</strong> ${l.keyTerminology.map(k => `${escapeHtml(k.term)}: ${escapeHtml(k.definition)}`).join(' · ')}</p>`;
        }
        if (l.workedExamples.length) {
          bodyHtml += `<p><strong>Worked Examples:</strong><br/>${l.workedExamples.map(e => escapeHtml(e)).join('<br/><br/>')}</p>`;
        }
        bodyHtml += `<p><strong>Practical Application:</strong> ${escapeHtml(l.practicalApplication)}</p>`;
        bodyHtml += `<p><strong>Guided Activity:</strong> ${escapeHtml(l.guidedActivity)}</p>`;
      }
      for (const cs of mod.workplaceCaseStudies) {
        bodyHtml += `<div class="box"><h4>Case Study: ${escapeHtml(cs.title)}</h4><p>${escapeHtml(cs.background)}</p><p><strong>Analysis Questions:</strong> ${cs.analysisQuestions.map(q => escapeHtml(q)).join(' | ')}</p>${cs.facilitatorNotes ? `<p><strong>Facilitator Notes:</strong> ${escapeHtml(cs.facilitatorNotes)}</p>` : ''}</div>`;
      }
      for (const sc of mod.scenarios) {
        bodyHtml += `<div class="box"><h4>Scenario: ${escapeHtml(sc.title)}</h4><p><strong>Situation:</strong> ${escapeHtml(sc.situation)}</p><p><strong>Challenge:</strong> ${escapeHtml(sc.challenge)}</p><p><strong>Decision:</strong> ${escapeHtml(sc.decisionPrompt)}</p>${sc.modelDebrief ? `<p><strong>Model Debrief:</strong> ${escapeHtml(sc.modelDebrief)}</p>` : ''}<p><strong>Key Takeaway:</strong> ${escapeHtml(sc.keyTakeaway)}</p></div>`;
      }
      if (mod.knowledgeChecks.length > 0) {
        bodyHtml += `<div class="box"><h4>Knowledge Checks</h4>${mod.knowledgeChecks
          .map(
            (kc, idx) =>
              `<p><strong>${idx + 1}. ${escapeHtml(kc.question)}</strong><br/>${kc.options
                .map((opt, oi) => `${String.fromCharCode(65 + oi)}) ${escapeHtml(opt)}`)
                .join('<br/>')}<br/><em>Answer: ${String.fromCharCode(65 + kc.correctIndex)} — ${escapeHtml(kc.explanation)}</em></p>`
          )
          .join('')}</div>`;
      }
      bodyHtml += `<p><strong>Module Summary:</strong> ${escapeHtml(mod.summary)}</p>`;
    }

    bodyHtml += `<div class="page-break"></div><h2>5. Assessments, Marking Guides &amp; Rubrics</h2>`;
    bodyHtml += `<p>${escapeHtml(project.assessments.strategySummary)}</p>`;
    bodyHtml += `<p><strong>Pass Requirement:</strong> ${project.assessments.passRequirementPercent}% (Knowledge ${project.assessments.knowledgeWeightPercent}% / Practical ${project.assessments.practicalWeightPercent}%)</p>`;
    for (const it of project.assessments.items) {
      bodyHtml += `<div class="box"><h3>${escapeHtml(it.title)} (${escapeHtml(it.type)} · ${it.weightingPercent}%)</h3><p><strong>Objective:</strong> ${escapeHtml(it.objective)}</p><p><strong>Instructions:</strong> ${escapeHtml(it.instructions)}</p><p>${escapeHtml(it.promptOrQuestion)}</p><p><strong>Model Answer:</strong> ${escapeHtml(it.modelAnswer)}</p><p><strong>Marking Guide:</strong> ${escapeHtml(it.markingGuide)}</p>${
        it.rubric.length > 0
          ? `<table><thead><tr><th>Criterion</th><th>Weight %</th><th>Competent</th><th>Not Yet Competent</th></tr></thead><tbody>${it.rubric
              .map(
                r =>
                  `<tr><td>${escapeHtml(r.criterion)}</td><td>${r.weightPercent}%</td><td>${escapeHtml(r.competentStandard)}</td><td>${escapeHtml(r.notYetCompetentIndicator)}</td></tr>`
              )
              .join('')}</tbody></table>`
          : ''
      }</div>`;
    }

    const qa = project.latestQA;
    bodyHtml += `<h2>6. Quality Assurance Summary</h2>${
      qa
        ? `<p><strong>Verdict:</strong> ${escapeHtml(qa.verdict)} (${qa.weightedScore}%)</p><p>${escapeHtml(qa.verdictExplanation)}</p>`
        : '<p>No QA evaluation run yet.</p>'
    }`;

    bodyHtml += `<div class="box"><strong>Educational &amp; Legal Guidance Disclaimer:</strong> Regulatory, statutory (including POPIA Act 4 of 2013 or PEPUDA Act 4 of 2000), and governance discussions in this programme are for educational purposes only and do not constitute formal legal advice.</div>`;

    if (project.sources.length > 0) {
      bodyHtml += `<h2>7. Consolidated References &amp; Source Register</h2><table><thead><tr><th>Ref</th><th>Title</th><th>Author/Org</th><th>Ref / URL</th><th>Status</th></tr></thead><tbody>${project.sources
        .map(
          (s, idx) =>
            `<tr><td>[Source ${idx + 1}]</td><td>${escapeHtml(s.title)}</td><td>${escapeHtml(s.authorOrOrganisation)}</td><td>${escapeHtml(s.referenceOrUrl)}</td><td>${escapeHtml(s.verificationStatus)}</td></tr>`
        )
        .join('')}</tbody></table>`;
    }
  } else if (type === 'learner_manual' || type === 'facilitator_guide') {
    bodyHtml += `<h2>Programme Overview</h2><p><strong>Purpose:</strong> ${escapeHtml(project.brief.purpose)}</p>${buildCourseIntroductionHtml(project)}`;
    bodyHtml += `<h3>Course Learning Outcomes</h3><ul>${project.outcomes.courseOutcomes
      .map(o => `<li><strong>${escapeHtml(o.code)} (${escapeHtml(o.bloomLevel)}):</strong> ${escapeHtml(o.statement)}</li>`)
      .join('')}</ul>`;
    for (const mod of project.content.modules) {
      bodyHtml += `<div class="page-break"></div><h2>Module ${mod.moduleNumber}: ${escapeHtml(mod.title)}</h2>`;
      bodyHtml += `<p><strong>Introduction:</strong> ${escapeHtml(mod.introduction)}</p>`;
      for (const l of mod.lessons) {
        bodyHtml += `<h3>${escapeHtml(l.title)} (${l.durationMinutes} min)</h3><p>${escapeHtml(l.explanation).replace(/\n/g, '<br/>')}</p>`;
        if (l.workedExamples.length) {
          bodyHtml += `<p><strong>Worked Examples:</strong><br/>${l.workedExamples.map(e => escapeHtml(e)).join('<br/><br/>')}</p>`;
        }
        bodyHtml += `<p><strong>Practical Application:</strong> ${escapeHtml(l.practicalApplication)}</p>`;
        bodyHtml += `<p><strong>Guided Activity:</strong> ${escapeHtml(l.guidedActivity)}</p>`;
      }
      for (const sc of mod.scenarios) {
        bodyHtml += `<div class="box"><h4>Scenario: ${escapeHtml(sc.title)}</h4><p><strong>Situation:</strong> ${escapeHtml(sc.situation)}</p><p><strong>Challenge:</strong> ${escapeHtml(sc.challenge)}</p><p><strong>Decision:</strong> ${escapeHtml(sc.decisionPrompt)}</p>${type === 'facilitator_guide' ? `<p><strong>Model Debrief:</strong> ${escapeHtml(sc.modelDebrief)}</p>` : ''}</div>`;
      }
      bodyHtml += `<p><strong>Summary:</strong> ${escapeHtml(mod.summary)}</p>`;
    }
  } else if (type === 'assessment_document' || type === 'marking_guide') {
    bodyHtml += `<h2>Assessment Strategy</h2><p>${escapeHtml(project.assessments.strategySummary)}</p>`;
    for (const it of project.assessments.items) {
      bodyHtml += `<div class="box"><h3>${escapeHtml(it.title)} (${escapeHtml(it.type)} · ${it.weightingPercent}%)</h3><p><strong>Instructions:</strong> ${escapeHtml(it.instructions)}</p><p>${escapeHtml(it.promptOrQuestion)}</p>${type === 'marking_guide' ? `<p><strong>Model Answer:</strong> ${escapeHtml(it.modelAnswer)}</p><p><strong>Marking Guide:</strong> ${escapeHtml(it.markingGuide)}</p>` : ''}</div>`;
    }
  } else if (type === 'alignment_matrix') {
    const report = computeFullAlignmentReport(project);
    bodyHtml += `<h2>3-Way Constructive Alignment Matrix (Score: ${report.scorePercent}%)</h2><p>${escapeHtml(report.explanation)}</p><table><thead><tr><th>Code</th><th>Outcome</th><th>Learning Activities</th><th>Mapped Assessments</th><th>Status</th></tr></thead><tbody>${report.rows
      .map(
        r =>
          `<tr><td>${escapeHtml(r.outcomeCode)}</td><td>${escapeHtml(r.outcomeStatement)}</td><td>${r.learningActivities.map(a => escapeHtml(a.title)).join(', ') || 'UNTAUGHT'}</td><td>${r.assessmentEvidence.map(m => escapeHtml(m.title)).join(', ') || 'UNASSESSED'}</td><td>${escapeHtml(r.status.toUpperCase())}</td></tr>`
      )
      .join('')}</tbody></table>`;
  } else if (type === 'qa_report') {
    const qa = project.latestQA;
    bodyHtml += `<h2>Quality Assurance Report</h2>${
      qa
        ? `<p><strong>Verdict:</strong> ${escapeHtml(qa.verdict)} (${qa.weightedScore}%)</p><p>${escapeHtml(qa.verdictExplanation)}</p>${
            qa.durationValidation
              ? `<p><strong>Duration Reconciliation:</strong> ${escapeHtml(qa.durationValidation.summary)}</p>`
              : ''
          }${
            qa.assessmentValidation
              ? `<p><strong>Assessment Weighting:</strong> Declared ${qa.assessmentValidation.declaredKnowledgeWeight}%/${qa.assessmentValidation.declaredPracticalWeight}% · Items ${qa.assessmentValidation.actualKnowledgeWeight}%/${qa.assessmentValidation.actualPracticalWeight}% (Total ${qa.assessmentValidation.totalItemWeight}%)</p>`
              : ''
          }${
            qa.verificationSummary
              ? `<p><strong>Verification Origins:</strong> Automated ${qa.verificationSummary.automatedCount} · Verified Sources ${qa.verificationSummary.externalVerifiedCount} · Unverified ${qa.verificationSummary.unverifiedCount} · Expert Review ${qa.verificationSummary.expertReviewRequiredCount}. ${escapeHtml(qa.verificationSummary.externalVerificationNote)}</p>`
              : ''
          }${
            qa.accessibilityAudit
              ? `<p><strong>Accessibility Audit:</strong> ${qa.accessibilityAudit.scorePercent}% · ${qa.accessibilityAudit.averageSentenceWords} words/sentence (${escapeHtml(qa.accessibilityAudit.readabilityBand)})</p>`
              : ''
          }<table><thead><tr><th>Dimension</th><th>Weight</th><th>Score</th><th>Weaknesses</th></tr></thead><tbody>${qa.dimensions
            .map(
              d =>
                `<tr><td>${escapeHtml(d.label)}</td><td>${d.weight}%</td><td>${d.score}%</td><td>${escapeHtml(d.weaknesses.join('; ') || 'None')}</td></tr>`
            )
            .join('')}</tbody></table>`
        : '<p>No QA evaluation run yet.</p>'
    }`;
  } else if (type === 'source_register') {
    bodyHtml += `<h2>Source Register</h2><table><thead><tr><th>Title</th><th>Author/Org</th><th>Ref</th><th>Status</th></tr></thead><tbody>${project.sources
      .map(
        s =>
          `<tr><td>${escapeHtml(s.title)}</td><td>${escapeHtml(s.authorOrOrganisation)}</td><td>${escapeHtml(s.referenceOrUrl)}</td><td>${escapeHtml(s.verificationStatus)}</td></tr>`
      )
      .join('')}</tbody></table>`;
  } else {
    bodyHtml += `<h2>Curriculum Overview</h2>${project.curriculum.modules
      .map(m => `<h3>Module ${m.order}: ${escapeHtml(m.title)}</h3><p>${escapeHtml(m.purpose)}</p>`)
      .join('')}`;
  }

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} - ${escapeHtml(label)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 36px; line-height: 1.55; }
  header.doc-header { border-top: 4px solid #${secondaryHex}; border-bottom: 3px solid #${primaryHex}; padding: 14px 0 12px; margin-bottom: 24px; }
  .header-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .header-meta { min-width: 0; flex: 1 1 280px; }
  .logo-box { flex-shrink: 0; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 10px; display: inline-flex; align-items: center; justify-content: center; }
  .logo-monogram { width: 46px; height: 46px; background: #${primaryHex}; color: #ffffff; font-weight: 800; font-size: 16px; border-color: #${primaryHex}; }
  .company-logo { max-width: 170px; max-height: 54px; width: auto; height: auto; object-fit: contain; display: block; }
  .brand { color: #${primaryHex}; font-weight: 800; font-size: 12px; letter-spacing: 0.08em; }
  h1 { color: #${primaryHex}; margin: 4px 0 6px; font-size: 24px; line-height: 1.25; }
  h2 { color: #${primaryHex}; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-top: 24px; }
  h3 { color: #${primaryHex}; margin-top: 16px; }
  .meta { font-size: 12px; color: #475569; }
  .box { border: 1px solid #cbd5e1; padding: 12px 16px; margin: 12px 0; border-radius: 6px; background: #f8fafc; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
  th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; }
  th { background: #${primaryHex}; color: #ffffff; }
  .page-break { page-break-before: always; }
  @media print { * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <header class="doc-header">
    <div class="header-row">
      ${logoMarkup}
      <div class="header-meta">
        <div class="brand">${escapeHtml(brandPrefix)} · ${escapeHtml(label)}</div>
        <h1>${escapeHtml(title)} (${escapeHtml(code)})</h1>
        <div class="meta">${escapeHtml(project.brief.industryDomain)} · ${escapeHtml(project.brief.targetAudience)} · ${escapeHtml(project.brief.estimatedDuration)}</div>
      </div>
    </div>
  </header>
  ${bodyHtml}
</body>
</html>`;
}

async function waitForDocumentImagesReady(doc: globalThis.Document): Promise<void> {
  const imgs = Array.from(doc.querySelectorAll('img'));
  if (imgs.length === 0) return;
  await Promise.all(
    imgs.map(
      img =>
        new Promise<void>(resolve => {
          if (img.complete) {
            resolve();
            return;
          }
          const done = () => resolve();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
          setTimeout(done, 1500);
        })
    )
  );
}

export async function exportDeliverableHtmlOrPrint(
  project: CourseProject,
  type: DeliverableType,
  mode: 'print' | 'download_html',
  brand?: ExportBrandOptions
): Promise<void> {
  if (type === 'lms_package') {
    await exportLmsPackageJson(project, brand);
    return;
  }
  const title = project.brief.title || 'Untitled Course';
  const resolvedBrand = await resolveExportBrand(brand);
  const fullHtml = buildDeliverableHtmlDocument(project, type, resolvedBrand);

  if (mode === 'download_html') {
    const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
    downloadBlob(blob, `${slugify(title)}-${type}.html`);
    return;
  }

  let iframe = document.getElementById('estudy-v2-print-frame') as HTMLIFrameElement | null;
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = 'estudy-v2-print-frame';
    iframe.style.position = 'fixed';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
  }
  const doc = iframe.contentWindow?.document;
  if (doc) {
    doc.open();
    doc.write(fullHtml);
    doc.close();
    await waitForDocumentImagesReady(doc);
    setTimeout(() => {
      iframe?.contentWindow?.focus();
      iframe?.contentWindow?.print();
    }, 150);
  }
}

export async function exportScorm12PackageZip(
  project: CourseProject,
  brand?: ExportBrandOptions
): Promise<void> {
  const resolvedBrand = await resolveExportBrand(brand);
  const bytes = buildScorm12ZipBytes(project, resolvedBrand);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: 'application/zip' });
  downloadBlob(blob, `${slugify(project.brief.title)}-scorm-1.2.zip`);
}

export function buildLmsPackageData(
  project: CourseProject,
  brand?: ExportBrandOptions
) {
  const asset = resolveSyncLogoAsset(brand);
  return {
    schema: 'eStudy-LMS-Structured-Data-v2',
    note: 'Structured JSON data export for custom LMS/CMS API ingestion (not a SCORM ZIP package).',
    exportedAt: new Date().toISOString(),
    companyId: brand?.companyId || undefined,
    companyName: (brand?.companyName || '').trim() || undefined,
    branding: {
      companyId: brand?.companyId || undefined,
      companyName: (brand?.companyName || '').trim() || undefined,
      logoUrl: brand?.logoUrl || undefined,
      embeddedLogoDataUri: asset?.dataUri || undefined,
      primaryColour: brand?.primaryColour || '#052B66',
      secondaryColour: brand?.secondaryColour || '#45CC42',
    },
    metadata: {
      title: project.brief.title,
      code: project.brief.code,
      language: project.brief.language,
      duration: project.brief.estimatedDuration,
      targetAudience: project.brief.targetAudience,
      saComplianceNote: project.brief.saCompliance.enabled
        ? 'Aligned to selected South African workplace standards; formal accreditation requires external verification.'
        : 'Non-accredited workplace learning programme.',
    },
    courseIntroduction: project.content?.courseIntroduction || null,
    outcomes: [...project.outcomes.courseOutcomes, ...project.outcomes.moduleOutcomes],
    modules: project.content.modules,
    assessments: project.assessments,
    sources: project.sources.map(s => ({
      title: s.title,
      authorOrOrganisation: s.authorOrOrganisation,
      referenceOrUrl: s.referenceOrUrl,
      verificationStatus: s.verificationStatus,
      verifiedBy: s.verifiedBy,
      verifiedAt: s.verifiedAt,
    })),
  };
}

export async function exportLmsPackageJson(
  project: CourseProject,
  brand?: ExportBrandOptions
): Promise<void> {
  const resolvedBrand = await resolveExportBrand(brand);
  const structuredManifest = buildLmsPackageData(project, resolvedBrand);
  const blob = new Blob([JSON.stringify(structuredManifest, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${slugify(project.brief.title)}-lms-data.json`);
}

function escapeHtml(text: string | undefined): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
