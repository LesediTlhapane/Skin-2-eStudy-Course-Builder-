import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  ImageRun,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { CourseProject, CourseTemplate } from '../types';
import {
  computeLogoFitDimensions,
  ensureContrastHex,
  parseDataUriLogoAsset,
  type ExportBrandOptions,
} from './exportBranding';

export const V9_THEME = {
  NAVY: '1B365D',
  GOLD: 'B68D2C',
  TEAL: '2C6B74',
  INSERT_BG: 'EBF3FC',
  INSERT_BORDER: '2B6CB0',
  INSERT_TEXT: '1D4ED8',
  GREEN_BG: 'ECF5F0',
  GREEN_BORDER: '1E6F5C',
  EXAMPLE_BG: 'FDF6E3',
  EXAMPLE_BORDER: 'D4A017',
  ALT_ROW_BG: 'F3F4F6',
  BORDER_GRAY: 'D1D5DB',
} as const;

const NAVY = V9_THEME.NAVY;
const GOLD = V9_THEME.GOLD;
const TEAL = V9_THEME.TEAL;
const INSERT_BG = V9_THEME.INSERT_BG;
const INSERT_BORDER = V9_THEME.INSERT_BORDER;
const INSERT_TEXT = V9_THEME.INSERT_TEXT;
const GREEN_BG = V9_THEME.GREEN_BG;
const GREEN_BORDER = V9_THEME.GREEN_BORDER;
const EXAMPLE_BG = V9_THEME.EXAMPLE_BG;
const EXAMPLE_BORDER = V9_THEME.EXAMPLE_BORDER;
const ALT_ROW_BG = V9_THEME.ALT_ROW_BG;
const BORDER_GRAY = V9_THEME.BORDER_GRAY;

const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

const GRID_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GRAY },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GRAY },
  left: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GRAY },
  right: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GRAY },
};

export function goldRule(): Paragraph {
  return new Paragraph({
    spacing: { before: 40, after: 140 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 4 },
    },
    children: [],
  });
}

export function navyBanner(title: string): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 100, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: NAVY },
            borders: NO_BORDERS,
            margins: { top: 100, bottom: 100, left: 160, right: 160 },
            children: [
              new Paragraph({
                keepNext: true,
                children: [
                  new TextRun({
                    text: title,
                    bold: true,
                    size: 26,
                    color: 'FFFFFF',
                    font: 'Calibri',
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

export function subHeading(text: string, color = NAVY): Paragraph[] {
  return [
    new Paragraph({
      spacing: { before: 240, after: 40 },
      keepNext: true,
      children: [
        new TextRun({
          text,
          bold: true,
          size: 24,
          color,
          font: 'Calibri',
        }),
      ],
    }),
    goldRule(),
  ];
}

function subHeadingNoRule(text: string, color = TEAL): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 80 },
    keepNext: true,
    children: [
      new TextRun({
        text,
        bold: true,
        size: 22,
        color,
        font: 'Calibri',
      }),
    ],
  });
}

function moduleTitleHeading(text: string): Paragraph[] {
  return [
    new Paragraph({
      spacing: { before: 260, after: 40 },
      keepNext: true,
      children: [
        new TextRun({
          text,
          bold: true,
          size: 24,
          color: NAVY,
          font: 'Calibri',
        }),
      ],
    }),
    goldRule(),
  ];
}

function bodyPara(text: string, opts?: { italic?: boolean; bold?: boolean; after?: number }): Paragraph {
  return new Paragraph({
    spacing: { after: opts?.after ?? 100 },
    children: [
      new TextRun({
        text,
        size: 21,
        color: '1E293B',
        bold: Boolean(opts?.bold),
        italics: Boolean(opts?.italic),
        font: 'Calibri',
      }),
    ],
  });
}

function bulletItem(text: string, opts?: { boldPrefix?: string }): Paragraph {
  const children: TextRun[] = [];
  if (opts?.boldPrefix) {
    children.push(
      new TextRun({
        text: `${opts.boldPrefix}   `,
        bold: true,
        size: 20,
        color: '1E293B',
        font: 'Calibri',
      })
    );
  }
  children.push(
    new TextRun({
      text,
      size: 20,
      color: '1E293B',
      font: 'Calibri',
    })
  );
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60 },
    children,
  });
}

function numberedItem(num: number, text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 60 },
    indent: { left: 360, hanging: 240 },
    children: [
      new TextRun({
        text: `${num}.  `,
        bold: true,
        size: 20,
        color: '1E293B',
        font: 'Calibri',
      }),
      new TextRun({
        text,
        size: 20,
        color: '1E293B',
        font: 'Calibri',
      }),
    ],
  });
}

function insertBox(
  placeholderOrValue: string,
  hintSuffix?: string,
  isFilledValue = false
): Table {
  const runs: TextRun[] = [
    new TextRun({
      text: placeholderOrValue,
      bold: !isFilledValue,
      italics: !isFilledValue,
      size: 20,
      color: isFilledValue ? '0F172A' : INSERT_TEXT,
      font: 'Calibri',
    }),
  ];
  if (hintSuffix && !isFilledValue) {
    runs.push(
      new TextRun({
        text: `  ${hintSuffix}`,
        italics: true,
        size: 19,
        color: '64748B',
        font: 'Calibri',
      })
    );
  }
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 100, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: INSERT_BG },
            borders: {
              ...NO_BORDERS,
              left: { style: BorderStyle.SINGLE, size: 24, color: INSERT_BORDER },
            },
            margins: { top: 80, bottom: 80, left: 140, right: 140 },
            children: [
              new Paragraph({
                spacing: { after: 20 },
                children: runs,
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

export function calloutBox(params: {
  title: string;
  lines: Array<{ text: string; italic?: boolean }>;
  fill: string;
  borderColor: string;
  titleColor: string;
}): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 100, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: params.fill },
            borders: {
              ...NO_BORDERS,
              left: { style: BorderStyle.SINGLE, size: 24, color: params.borderColor },
            },
            margins: { top: 100, bottom: 100, left: 160, right: 160 },
            children: [
              new Paragraph({
                spacing: { after: 60 },
                children: [
                  new TextRun({
                    text: params.title,
                    bold: true,
                    size: 20,
                    color: params.titleColor,
                    font: 'Calibri',
                  }),
                ],
              }),
              ...params.lines.map(
                l =>
                  new Paragraph({
                    spacing: { after: 40 },
                    children: [
                      new TextRun({
                        text: l.text,
                        italics: Boolean(l.italic),
                        size: 19,
                        color: '1E293B',
                        font: 'Calibri',
                      }),
                    ],
                  })
              ),
            ],
          }),
        ],
      }),
    ],
  });
}

function spacer(pts = 100): Paragraph {
  return new Paragraph({ spacing: { after: pts }, children: [] });
}

function promptWithInsert(
  promptLabel: string,
  valueOrPlaceholder: string,
  isFilled: boolean,
  hintSuffix?: string
): Array<Paragraph | Table> {
  return [
    bulletItem(promptLabel),
    insertBox(valueOrPlaceholder, hintSuffix, isFilled),
    spacer(40),
  ];
}

function resolveField(
  prefillProject: CourseProject | undefined,
  key: string,
  placeholder: string
): { text: string; isFilled: boolean } {
  const val = prefillProject?.brief?.templateFieldValues?.[key]?.trim();
  if (val) return { text: val, isFilled: true };
  return { text: placeholder, isFilled: false };
}

function resolveBriefField(
  val: string | undefined,
  placeholder: string
): { text: string; isFilled: boolean } {
  const trimmed = (val || '').trim();
  if (trimmed) return { text: trimmed, isFilled: true };
  return { text: placeholder, isFilled: false };
}

function makeStyledDataTable(params: {
  headers: Array<{ label: string; width: number }>;
  rows: Array<Array<{ text: string; isPlaceholder?: boolean; bold?: boolean }>>;
}): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: params.headers.map(
      h =>
        new TableCell({
          width: { size: h.width, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: NAVY },
          borders: GRID_BORDERS,
          margins: { top: 90, bottom: 90, left: 120, right: 120 },
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: h.label,
                  bold: true,
                  size: 20,
                  color: 'FFFFFF',
                  font: 'Calibri',
                }),
              ],
            }),
          ],
        })
    ),
  });

  const dataRows = params.rows.map((cells, rIdx) => {
    const bg = rIdx % 2 === 1 ? ALT_ROW_BG : 'FFFFFF';
    return new TableRow({
      children: cells.map((cell, cIdx) => {
        const w = params.headers[cIdx]?.width || Math.floor(100 / cells.length);
        const lines = String(cell.text || '').split(/\r?\n/);
        return new TableCell({
          width: { size: w, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: bg },
          borders: GRID_BORDERS,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: lines.map(
            line =>
              new Paragraph({
                spacing: { after: 30 },
                children: [
                  new TextRun({
                    text: line || ' ',
                    bold: Boolean(cell.bold || cell.isPlaceholder),
                    italics: Boolean(cell.isPlaceholder),
                    size: 19,
                    color: cell.isPlaceholder ? INSERT_TEXT : '1E293B',
                    font: 'Calibri',
                  }),
                ],
              })
          ),
        });
      }),
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  });
}

export function isMasterV9Template(template: CourseTemplate): boolean {
  const nameLower = template.name.toLowerCase();
  return (
    template.id === 'tpl-estudy-master-v9' ||
    nameLower.includes('estudy master course generation template') ||
    nameLower.includes('master course generation prompt')
  );
}

export function buildMasterV9TemplateDocxDocument(
  _template: CourseTemplate,
  prefillProject?: CourseProject,
  brand?: ExportBrandOptions
): Document {
  const b = prefillProject?.brief;
  const cleanCompany = (brand?.companyName || '').trim();
  const brandTitle = cleanCompany || 'eStudy South Africa';
  const primaryHex = ensureContrastHex(brand?.primaryColour || NAVY, NAVY);
  const logoAsset =
    brand?.logoAsset ||
    (brand?.logoUrl && brand.logoUrl.trim().startsWith('data:image/')
      ? parseDataUriLogoAsset(brand.logoUrl)
      : null);

  const titleVal = resolveBriefField(b?.title, '[INSERT: COURSE TITLE]');
  const codeVal = resolveBriefField(b?.code, '[INSERT: COURSE CODE]');
  const domainVal = resolveBriefField(b?.industryDomain, '[INSERT: INDUSTRY DOMAIN]');
  const rolesVal = resolveBriefField(
    b?.targetJobRoles || b?.targetAudience,
    '[INSERT: TARGET ROLES]'
  );
  const aiLevelVal = resolveBriefField(
    b?.aiIntegrationMode ? `${b.aiIntegrationMode.toUpperCase()} (${b.aiIntegrationRequirements || 'See brief'})` : '',
    '[INSERT: AI INTEGRATION LEVEL — e.g. Awareness / Applied / Advanced]'
  );
  const accredVal = resolveField(
    prefillProject,
    'accreditationAlignmentNotes',
    b?.saCompliance?.enabled && b.saCompliance.nqfLevel
      ? `${b.saCompliance.nqfLevel}${b.saCompliance.setaName ? ` · ${b.saCompliance.setaName}` : ''}`
      : '[INSERT: ACCREDITATION / QUALIFICATION / STANDARDS ALIGNMENT — see Section 7.5 for full accreditation and standards detail. NQF level alone is not equivalent to accreditation.]'
  );
  const langVal = resolveBriefField(b?.language, '[INSERT: DELIVERY LANGUAGE(S)]');
  const durationVal = resolveBriefField(b?.estimatedDuration, '[INSERT: HOURS / CPD CREDITS]');

  const probStmtVal = resolveField(
    prefillProject,
    'problemStatement',
    b?.workplaceProblem ||
      '"This course addresses the inability of [INSERT: TARGET GROUP] to effectively perform [INSERT: TASK / SKILL], resulting in [INSERT: OPERATIONAL / FINANCIAL / COMPLIANCE / PRODUCTIVITY IMPACT]."'
  );
  const rootCausesVal = resolveField(
    prefillProject,
    'rootCauses',
    '[INSERT: ROOT CAUSE 1] [INSERT: ROOT CAUSE 2]'
  );
  const procFailVal = resolveField(
    prefillProject,
    'processFailures',
    '[INSERT: PROCESS / SYSTEM FAILURE]'
  );
  const skillGapsVal = resolveField(
    prefillProject,
    'skillKnowledgeGaps',
    '[INSERT: SKILL / KNOWLEDGE GAP]'
  );
  const constraintsVal = resolveField(
    prefillProject,
    'organisationalConstraints',
    '[INSERT: CONSTRAINT]'
  );
  const aiGapVal = resolveField(prefillProject, 'aiLiteracyGap', '[INSERT: AI LITERACY GAP]');
  const digitalReadinessVal = resolveField(
    prefillProject,
    'digitalReadinessLevel',
    '[INSERT: DIGITAL READINESS LEVEL]'
  );
  const aiEthicsRiskVal = resolveField(
    prefillProject,
    'aiEthicsComplianceRisk',
    '[INSERT: AI ETHICS / COMPLIANCE RISK]'
  );

  const refLinksVal = resolveField(
    prefillProject,
    'referenceLinks',
    '[INSERT: LINK 1 — URL or document title] [INSERT: LINK 2 — URL or document title]\n[INSERT: LINK 3 — URL or document title (add more as needed)]'
  );
  const regFrameworkVal = resolveField(
    prefillProject,
    'evidenceStandard',
    b?.saCompliance?.industryLegislation || '[INSERT: REGULATORY FRAMEWORK]'
  );
  const aiToolsVal = resolveField(
    prefillProject,
    'aiToolsPlatforms',
    '[INSERT: AI TOOL / PLATFORM NAME]'
  );
  const aiEthicsFwVal = resolveField(
    prefillProject,
    'aiEthicsFramework',
    '[INSERT: AI ETHICS FRAMEWORK]'
  );
  const caseStudiesVal = resolveField(
    prefillProject,
    'industryCaseStudies',
    '[INSERT: CASE STUDY / USE CASE]'
  );

  const purposeVal = resolveBriefField(b?.purpose, '[INSERT: PURPOSE STATEMENT]');
  const aiTechAngleVal = resolveField(
    prefillProject,
    'aiTechAngle',
    '[INSERT: AI / TECH ANGLE — Describe how AI, digital tools or technology are used, applied, evaluated or understood within this course. If AI/technology is not relevant, state "No AI/technology component" and explain why. AI must not be added merely for novelty — explain the specific role technology plays in achieving the course\'s workplace outcomes.]'
  );
  const scopeVal = resolveBriefField(b?.subjectTopicsInput, '[INSERT: SCOPE SUMMARY]');
  const prereqVal = resolveBriefField(b?.prerequisites, '[INSERT: PREREQUISITE KNOWLEDGE]');
  const departmentsVal = resolveField(prefillProject, 'targetDepartments', '[INSERT: DEPARTMENTS]');
  const expLevelVal = resolveBriefField(b?.experienceLevel, '[INSERT: EXPERIENCE LEVEL]');
  const aiFamVal = resolveField(
    prefillProject,
    'aiFamiliarityLevel',
    '[INSERT: AI FAMILIARITY LEVEL SELECTED — state NONE / BASIC / INTERMEDIATE / ADVANCED and explain the expected learner capability]'
  );
  const diagVal = resolveField(
    prefillProject,
    'preCourseDiagnosticQuestions',
    '[INSERT: DIAGNOSTIC QUESTION 1 — General domain knowledge] [INSERT: DIAGNOSTIC QUESTION 2 — Awareness of the problem] [INSERT: DIAGNOSTIC QUESTION 3 — Current workplace practices] [INSERT: DIAGNOSTIC QUESTION 4 — AI awareness / digital readiness] [INSERT: DIAGNOSTIC QUESTION 5 — Ethics / compliance awareness] [INSERT: DIAGNOSTIC QUESTIONS 6–10 — Add as needed]'
  );

  const toneLevelVal = resolveField(
    prefillProject,
    'toneAndReadingLevel',
    '[INSERT: TARGET READING LEVEL]'
  );

  const existingModules = prefillProject?.curriculum?.modules || [];
  const moduleTableRows: Array<Array<{ text: string; isPlaceholder?: boolean; bold?: boolean }>> = [];
  for (let i = 0; i < Math.max(5, existingModules.length); i++) {
    const mod = existingModules[i];
    const numLabel = i >= 3 && !mod ? `${i + 1}\n(optional)` : `${i + 1}`;
    if (mod) {
      moduleTableRows.push([
        { text: numLabel, bold: true },
        { text: mod.title || `[INSERT: MODULE ${i + 1} TITLE]`, isPlaceholder: !mod.title },
        { text: mod.purpose || `[INSERT: MODULE ${i + 1} PURPOSE]`, isPlaceholder: !mod.purpose },
        {
          text:
            mod.topics.length > 0
              ? mod.topics.map(t => t.title).join(', ')
              : `[INSERT: MODULE ${i + 1} KEY SKILLS]`,
          isPlaceholder: mod.topics.length === 0,
        },
      ]);
    } else {
      const opt = i >= 3 ? ' (optional)' : '';
      moduleTableRows.push([
        { text: numLabel },
        { text: `[INSERT: MODULE ${i + 1}${opt} TITLE]`, isPlaceholder: true },
        { text: `[INSERT: MODULE ${i + 1}${opt} PURPOSE]`, isPlaceholder: true },
        { text: `[INSERT: MODULE ${i + 1}${opt} KEY SKILLS]`, isPlaceholder: true },
      ]);
    }
  }

  const children: Array<Paragraph | Table> = [
    // ==================== PAGE 1: COVER & HOW TO USE ====================
    ...(logoAsset?.docxBytes && logoAsset.docxType
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 80, after: 80 },
            children: [
              new ImageRun({
                type: logoAsset.docxType,
                data: logoAsset.docxBytes,
                transformation: computeLogoFitDimensions(logoAsset, 200, 62),
                altText: {
                  name: 'CompanyLogo',
                  title: brandTitle,
                  description: `${brandTitle} official branding logo`,
                },
              }),
            ],
          }),
        ]
      : []),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: logoAsset?.docxBytes ? 40 : 120, after: 40 },
      children: [
        new TextRun({
          text: brandTitle,
          bold: true,
          size: 44,
          color: primaryHex,
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: 'MASTER COURSE GENERATION PROMPT',
          bold: true,
          size: 28,
          color: GOLD,
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: '– AI-Enhanced Universal Scalable Template',
          italics: true,
          size: 24,
          color: TEAL,
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 },
      children: [
        new TextRun({
          text: 'Built on the foundation of the Use of Artificial Intelligence in Financial Literacy course',
          italics: true,
          size: 20,
          color: '64748B',
          font: 'Calibri',
        }),
      ],
    }),
    goldRule(),
    spacer(40),

    navyBanner('HOW TO USE THIS TEMPLATE'),
    spacer(40),
    bodyPara(
      'This document is a structured prompt template for AI-assisted course generation at eStudy South Africa. Each [INSERT: ...] bracket is a field you replace with course-specific content before submitting the prompt to your AI engine.'
    ),
    calloutBox({
      title: 'Reference Course (Already Built)',
      lines: [
        {
          text: 'Use of Artificial Intelligence in Financial Literacy — use this course as a benchmark for tone, depth, and structure when populating this template.',
          italic: true,
        },
      ],
      fill: GREEN_BG,
      borderColor: GREEN_BORDER,
      titleColor: GREEN_BORDER,
    }),
    spacer(120),
    bodyPara('STEP-BY-STEP USAGE:', { bold: true, after: 80 }),
    numberedItem(1, 'Replace every [INSERT: ...] field with the relevant course-specific information.'),
    numberedItem(2, 'Keep all section headings and numbering exactly as shown.'),
    numberedItem(3, 'Submit the completed prompt to your AI content engine for full course generation.'),
    numberedItem(4, 'Review AI output against the Financial Literacy course as a quality benchmark.'),
    numberedItem(5, 'Deploy to LMS without further structural modification.'),
    spacer(100),

    calloutBox({
      title: 'GLOBAL RULE — HANDLING [INSERT: ...] FIELDS',
      lines: [
        {
          text: 'Apply this logic to every [INSERT: ...] field throughout this document, without exception:',
          italic: true,
        },
      ],
      fill: GREEN_BG,
      borderColor: GREEN_BORDER,
      titleColor: GREEN_BORDER,
    }),
    spacer(60),
    bulletItem('If the information is known and applicable, replace the [INSERT: ...] field with course-specific information.'),
    bulletItem('If the field is not applicable, enter "Not Applicable" and provide a brief reason where appropriate.'),
    bulletItem('If the information is unknown, enter "To Be Confirmed" and identify what information is required.'),
    bulletItem('If the information requires subject-matter, organisational, regulatory or accreditation confirmation, mark it "Requires SME/Stakeholder Validation".'),
    bulletItem('Never invent, fabricate or assume information simply to fill an [INSERT: ...] field.'),
    bulletItem('The AI may derive information from supplied source documents where that information is explicitly supported.'),
    bulletItem('Before final output, perform an INSERT FIELD VALIDATION CHECK and confirm that no unresolved [INSERT: ...] placeholders remain.'),
    spacer(40),
    bodyPara('This rule applies across the entire document.', { bold: true }),

    // ==================== PAGE 2: FINAL EXECUTION COMMAND ====================
    spacer(160),
    navyBanner('FINAL EXECUTION COMMAND'),
    spacer(40),
    bodyPara('You are an expert instructional designer, curriculum developer, and AI learning architect.'),
    bodyPara('Generate a complete, structured, industry-ready training programme for:', { bold: true }),
    insertBox(
      titleVal.text,
      '← e.g. Use of Artificial Intelligence in Financial Literacy',
      titleVal.isFilled
    ),
    spacer(80),
    bodyPara(
      "Ensure the course aligns with eStudy South Africa's instructional design standards, is AI-literacy informed, scenario-driven, and immediately deployable on an LMS."
    ),

    // ==================== SECTION 1: PROBLEM / CHALLENGE ====================
    spacer(140),
    navyBanner('1. IDENTIFY PROBLEM / CHALLENGE / DEVELOPMENT AREA'),
    spacer(40),
    bodyPara('Define the workplace performance gap clearly. Use the sentence format below, then expand.'),

    ...subHeading('1.1 Required Problem Statement'),
    bodyPara('Complete the following statement:'),
    insertBox(probStmtVal.text, undefined, probStmtVal.isFilled),
    spacer(80),
    calloutBox({
      title: 'Example (Financial Literacy course):',
      lines: [
        {
          text: '"This course addresses the inability of employees and consumers to effectively apply AI tools in personal and organisational financial management, resulting in poor financial decisions, vulnerability to digital fraud, and missed productivity gains."',
          italic: true,
        },
      ],
      fill: EXAMPLE_BG,
      borderColor: EXAMPLE_BORDER,
      titleColor: '8A6116',
    }),

    ...subHeading('1.2 Root Cause Analysis'),
    bodyPara('Expand on the following:'),
    ...promptWithInsert('Root causes of the problem:', rootCausesVal.text, rootCausesVal.isFilled),
    ...promptWithInsert('Process or system failures involved:', procFailVal.text, procFailVal.isFilled),
    ...promptWithInsert('Skills or knowledge gaps:', skillGapsVal.text, skillGapsVal.isFilled),
    ...promptWithInsert('Organisational or environmental constraints:', constraintsVal.text, constraintsVal.isFilled),

    ...subHeading('1.3 AI-Specific Considerations (NEW)'),
    bodyPara('Because this template supports AI-integrated courses, also address:'),
    ...promptWithInsert('AI literacy gap — what AI concepts are unknown to the target group?', aiGapVal.text, aiGapVal.isFilled),
    ...promptWithInsert('Data and digital readiness — what baseline digital skills are assumed?', digitalReadinessVal.text, digitalReadinessVal.isFilled),
    ...promptWithInsert('Ethical or compliance risks introduced by AI use in this domain:', aiEthicsRiskVal.text, aiEthicsRiskVal.isFilled),

    ...subHeading('1.4 Course Development Methodology (NEW)'),
    bodyPara(
      'Every course generated using this template must be developed from an identified workplace performance need and progress through the following stages, in sequence, through to LMS-ready output:'
    ),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: [
            new TableCell({
              columnSpan: 3,
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F5F9' },
              borders: GRID_BORDERS,
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: 'WORKPLACE LEARNING AND DEVELOPMENT PROCESS FLOW',
                      bold: true,
                      size: 20,
                      color: NAVY,
                      font: 'Calibri',
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
        ...[
          [
            { text: '1. WORKPLACE NEED', fill: 'E0F2FE', border: '0284C7' },
            { text: '5. LEARNING DESIGN', fill: 'EDE9FE', border: '7C3AED' },
            { text: '9. AI / ETHICS / COMPLIANCE REVIEW', fill: 'FCE7F3', border: 'DB2777' },
          ],
          [
            { text: '2. PROBLEM & ROOT-CAUSE ANALYSIS', fill: 'DBEAFE', border: '2563EB' },
            { text: '6. MODULE & SCENARIO DEVELOPMENT', fill: 'FEF3C7', border: 'D97706' },
            { text: '10. ACCREDITATION ALIGNMENT', fill: 'CCFBF1', border: '0D9488' },
          ],
          [
            { text: '3. RESEARCH & SOURCE VALIDATION', fill: 'DCFCE7', border: '16A34A' },
            { text: '7. PRACTICAL / WORKPLACE APPLICATION', fill: 'FEE2E2', border: 'DC2626' },
            { text: '11. QUALITY ASSURANCE', fill: 'D1FAE5', border: '059669' },
          ],
          [
            { text: '4. TARGET AUDIENCE & READINESS', fill: 'FFEDD5', border: 'EA580C' },
            { text: '8. ASSESSMENT & DIAGNOSTICS', fill: 'FCE7F3', border: 'BE185D' },
            { text: '12. LMS-READY OUTPUT', fill: 'E2E8F0', border: NAVY },
          ],
        ].map(
          rowCards =>
            new TableRow({
              children: rowCards.map(
                card =>
                  new TableCell({
                    width: { size: 33, type: WidthType.PERCENTAGE },
                    shading: { type: ShadingType.CLEAR, color: 'auto', fill: card.fill },
                    borders: {
                      top: { style: BorderStyle.SINGLE, size: 12, color: card.border },
                      bottom: { style: BorderStyle.SINGLE, size: 12, color: card.border },
                      left: { style: BorderStyle.SINGLE, size: 18, color: card.border },
                      right: { style: BorderStyle.SINGLE, size: 12, color: card.border },
                    },
                    margins: { top: 80, bottom: 80, left: 100, right: 100 },
                    children: [
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [
                          new TextRun({
                            text: card.text,
                            bold: true,
                            size: 17,
                            color: NAVY,
                            font: 'Calibri',
                          }),
                        ],
                      }),
                    ],
                  })
              ),
            })
        ),
      ],
    }),
    spacer(80),
    bulletItem('identify the real workplace performance problem driving the course.', { boldPrefix: 'Workplace Need' }),
    bulletItem('investigate why the problem exists, not only its symptoms.', { boldPrefix: 'Problem & Root-Cause Analysis' }),
    bulletItem('gather and validate authoritative sources, regulatory frameworks and reference material.', { boldPrefix: 'Research & Source Validation' }),
    bulletItem('confirm who the learners are and their existing knowledge, digital and AI readiness.', { boldPrefix: 'Target Audience & Readiness' }),
    bulletItem('define the instructional approach, structure and assessment strategy.', { boldPrefix: 'Learning Design' }),
    bulletItem('build module content and realistic, role-specific scenarios.', { boldPrefix: 'Module & Scenario Development' }),
    bulletItem('ensure learners can apply the content directly in their roles.', { boldPrefix: 'Practical / Workplace Application' }),
    bulletItem('confirm learning through diagnostics, knowledge checks and summative assessment.', { boldPrefix: 'Assessment' }),
    bulletItem('verify AI, ethics and compliance requirements are embedded and accurate.', { boldPrefix: 'AI / Ethics / Compliance Review' }),
    bulletItem('confirm alignment to any applicable accreditation or standards framework.', { boldPrefix: 'Accreditation Alignment' }),
    bulletItem('run the full QA checklist before deployment.', { boldPrefix: 'Quality Assurance' }),
    bulletItem('finalise the course as a complete, deployable LMS package.', { boldPrefix: 'LMS-Ready Output' }),
    spacer(60),
    bodyPara(
      'This methodology confirms that the course originates from a genuine workplace performance need and progresses through research, instructional design, application, assessment, AI/ethics/compliance review, accreditation alignment and quality assurance before reaching LMS-ready output.'
    ),

    // ==================== SECTION 2: SOURCES OF INFORMATION ====================
    spacer(140),
    navyBanner('2. SOURCES OF INFORMATION (RESEARCH LAYER)'),
    spacer(40),
    bodyPara(
      'Provide the AI engine with all relevant sources. These will be converted into practical, workplace-applicable training content — not theoretical summaries.'
    ),

    ...subHeading('2.1 Reference Links (if available)'),
    insertBox(refLinksVal.text, undefined, refLinksVal.isFilled),

    ...subHeading('2.2 Industry / Regulatory Sources'),
    bodyPara('Specify the regulatory or standards framework applicable to this course:'),
    insertBox(
      regFrameworkVal.text,
      '← e.g. POPIA, FSCA, NCA, ISO, King IV, SETA SAQA unit standards',
      regFrameworkVal.isFilled
    ),

    ...subHeading('2.3 AI & Technology Sources (NEW)'),
    bodyPara('For courses with AI components, include:'),
    ...promptWithInsert('AI tools or platforms used in this domain:', aiToolsVal.text, aiToolsVal.isFilled),
    ...promptWithInsert(
      'Relevant AI ethics framework:',
      aiEthicsFwVal.text,
      aiEthicsFwVal.isFilled,
      '← e.g. UNESCO AI Ethics, EU AI Act, SA DCDT AI Policy'
    ),
    ...promptWithInsert('Industry case studies or use cases:', caseStudiesVal.text, caseStudiesVal.isFilled),

    // ==================== SECTION 3: COURSE STRUCTURE ====================
    spacer(140),
    navyBanner('3. COURSE STRUCTURE'),
    ...subHeading('3.1 Course Details'),
    makeStyledDataTable({
      headers: [
        { label: 'Field', width: 36 },
        { label: 'Your Input', width: 64 },
      ],
      rows: [
        [
          { text: 'Course Name' },
          { text: titleVal.text, isPlaceholder: !titleVal.isFilled },
        ],
        [
          { text: 'Course Code / ID' },
          { text: codeVal.text, isPlaceholder: !codeVal.isFilled },
        ],
        [
          { text: 'Industry / Domain' },
          { text: domainVal.text, isPlaceholder: !domainVal.isFilled },
        ],
        [
          { text: 'Target Role Group' },
          { text: rolesVal.text, isPlaceholder: !rolesVal.isFilled },
        ],
        [
          { text: 'AI Integration Level' },
          { text: aiLevelVal.text, isPlaceholder: !aiLevelVal.isFilled },
        ],
        [
          { text: 'Accreditation / Qualification / Standards Alignment (if applicable)' },
          { text: accredVal.text, isPlaceholder: !accredVal.isFilled },
        ],
        [
          { text: 'Language(s)' },
          { text: langVal.text, isPlaceholder: !langVal.isFilled },
        ],
        [
          { text: 'Estimated Duration' },
          { text: durationVal.text, isPlaceholder: !durationVal.isFilled },
        ],
      ],
    }),

    ...subHeading('3.2 Course Overview'),
    bodyPara('Provide a 3–5 sentence overview covering:'),
    ...promptWithInsert('Purpose of the course:', purposeVal.text, purposeVal.isFilled),
    ...promptWithInsert(
      'Workplace relevance:',
      b?.workplaceProblem?.trim() || '[INSERT: WORKPLACE RELEVANCE]',
      Boolean(b?.workplaceProblem?.trim())
    ),
    ...promptWithInsert(
      'Expected performance improvement:',
      b?.learningRequirements?.trim() || '[INSERT: PERFORMANCE IMPROVEMENT]',
      Boolean(b?.learningRequirements?.trim())
    ),
    ...promptWithInsert('AI or technology angle of this course:', aiTechAngleVal.text, aiTechAngleVal.isFilled),

    ...subHeading('3.3 About the Course'),
    ...promptWithInsert('What the course covers:', scopeVal.text, scopeVal.isFilled),
    ...promptWithInsert("Why it is important in today's AI-enabled workplace:", '[INSERT: AI-ERA RELEVANCE]', false),
    ...promptWithInsert('How it improves job performance:', '[INSERT: PERFORMANCE LINK]', false),

    ...subHeading('3.4 Benefits of the Course'),
    makeStyledDataTable({
      headers: [
        { label: 'Organisational Benefits', width: 33 },
        { label: 'Employee Benefits', width: 33 },
        { label: 'Risk Reduction', width: 34 },
      ],
      rows: [
        [
          { text: '[INSERT: ORGANISATIONAL BENEFIT 1]', isPlaceholder: true },
          { text: '[INSERT: EMPLOYEE BENEFIT 1]', isPlaceholder: true },
          { text: '[INSERT: RISK REDUCTION OUTCOME 1]', isPlaceholder: true },
        ],
        [
          { text: '[INSERT: ORGANISATIONAL BENEFIT 2]', isPlaceholder: true },
          { text: '[INSERT: EMPLOYEE BENEFIT 2]', isPlaceholder: true },
          { text: '[INSERT: RISK REDUCTION OUTCOME 2]', isPlaceholder: true },
        ],
      ],
    }),

    ...subHeading('3.5 Course Description'),
    ...promptWithInsert('Scope of learning:', '[INSERT: SCOPE]', false),
    ...promptWithInsert('Key competencies developed:', '[INSERT: KEY COMPETENCIES]', false),
    ...promptWithInsert('Real workplace application:', '[INSERT: REAL WORLD APPLICATION]', false),
    ...promptWithInsert('AI-specific skills built in this course:', '[INSERT: AI SKILLS DEVELOPED]', false),

    ...subHeading('3.6 Target Audience'),
    ...promptWithInsert('Job roles:', rolesVal.text, rolesVal.isFilled),
    ...promptWithInsert('Departments:', departmentsVal.text, departmentsVal.isFilled),
    ...promptWithInsert('Experience level:', expLevelVal.text, expLevelVal.isFilled),
    bulletItem('AI familiarity assumed:'),
    bodyPara('Select the AI familiarity level that applies, and explain the expected learner capability at that level:'),
    bulletItem('No assumed prior AI knowledge.', { boldPrefix: 'NONE' }),
    bulletItem('General awareness or limited experience using common AI-enabled tools.', { boldPrefix: 'BASIC' }),
    bulletItem('Regular workplace use of AI tools with some ability to evaluate outputs, understand limitations and apply responsible use.', { boldPrefix: 'INTERMEDIATE' }),
    bulletItem('Substantial professional AI experience, including the ability to evaluate, configure, integrate or optimise AI-enabled workflows where relevant.', { boldPrefix: 'ADVANCED' }),
    spacer(40),
    insertBox(aiFamVal.text, undefined, aiFamVal.isFilled),
    spacer(40),
    bodyPara(
      'This level must be consistent with the target audience, prerequisites, digital literacy, AI integration level and course objectives. Do not assume advanced AI knowledge unless explicitly justified.',
      { italic: true }
    ),

    ...subHeading('3.7 Prerequisites'),
    ...promptWithInsert('Required knowledge:', prereqVal.text, prereqVal.isFilled),
    ...promptWithInsert('Required experience:', '[INSERT: PREREQUISITE EXPERIENCE]', false),
    ...promptWithInsert('Tool / system familiarity:', '[INSERT: TOOLS / SYSTEMS]', false),
    ...promptWithInsert('Digital literacy minimum:', '[INSERT: DIGITAL LITERACY LEVEL]', false),

    ...subHeading('3.8 Pre-Course Diagnostic Questions'),
    bodyPara(
      'Provide 5–10 questions to assess current knowledge and awareness. Include at least 2 questions related to AI or technology readiness.'
    ),
    insertBox(diagVal.text, undefined, diagVal.isFilled),

    ...subHeading('3.9 Module Overview Table (Minimum 3 Modules)'),
    makeStyledDataTable({
      headers: [
        { label: '#', width: 10 },
        { label: 'Module Title', width: 28 },
        { label: 'Purpose', width: 31 },
        { label: 'Key Skills', width: 31 },
      ],
      rows: moduleTableRows,
    }),

    // ==================== SECTION 4: MODULE STRUCTURE ====================
    spacer(160),
    navyBanner('4. MODULE STRUCTURE'),
    ...moduleTitleHeading('MODULE 1: FOUNDATIONAL UNDERSTANDING'),
    bodyPara('Build foundational awareness before practical application. This module sets the cognitive and contextual baseline.'),

    subHeadingNoRule('4.1.1 Core Content Requirements'),
    ...promptWithInsert('Definition of the problem area:', '[INSERT: DEFINITION]', false),
    ...promptWithInsert('Workplace context:', '[INSERT: WORKPLACE CONTEXT]', false),
    ...promptWithInsert('Core concepts and terminology:', '[INSERT: KEY TERMS / CONCEPTS]', false),
    ...promptWithInsert('Causes and contributing factors:', '[INSERT: CAUSES]', false),
    ...promptWithInsert('Early warning signs or indicators:', '[INSERT: WARNING SIGNS]', false),
    ...promptWithInsert('Organisational impact:', '[INSERT: IMPACT STATEMENT]', false),

    subHeadingNoRule('4.1.2 AI Literacy Foundation (NEW)'),
    bodyPara('For AI-integrated courses, Module 1 must also include:'),
    ...promptWithInsert('What AI is and is not (demystification):', '[INSERT: AI DEMYSTIFICATION CONTENT]', false),
    ...promptWithInsert('How AI is used in this specific domain:', '[INSERT: AI IN THIS DOMAIN]', false),
    ...promptWithInsert('Key AI tools relevant to this course:', '[INSERT: AI TOOLS OVERVIEW]', false),
    ...promptWithInsert('Responsible and ethical AI use principles:', '[INSERT: RESPONSIBLE AI PRINCIPLES]', false),
    calloutBox({
      title: 'Financial Literacy Example:',
      lines: [
        {
          text: 'Module 1 covered: What is AI? AI in personal finance (budgeting apps, robo-advisors), AI in banking (fraud detection, credit scoring), and ethical use of AI financial data.',
          italic: true,
        },
      ],
      fill: EXAMPLE_BG,
      borderColor: EXAMPLE_BORDER,
      titleColor: '8A6116',
    }),

    ...moduleTitleHeading('MODULE 2: PRACTICAL APPLICATION & INTERVENTION'),
    bodyPara('Convert knowledge into workplace action. All content must be scenario-based and immediately applicable.'),

    subHeadingNoRule('4.2.1 Tools, Techniques & Procedures'),
    ...promptWithInsert('Tools and techniques relevant to this role:', '[INSERT: TOOLS & TECHNIQUES]', false),
    ...promptWithInsert('Step-by-step workplace procedures:', '[INSERT: PROCEDURE STEPS]', false),
    ...promptWithInsert('Role responsibilities (manager vs employee):', '[INSERT: ROLE RESPONSIBILITIES]', false),
    ...promptWithInsert('Communication approaches:', '[INSERT: COMMUNICATION APPROACH]', false),
    ...promptWithInsert('Support mechanisms available:', '[INSERT: SUPPORT MECHANISMS]', false),

    subHeadingNoRule('4.2.2 Workplace Scenarios (Minimum 3–5 Required)'),
    bodyPara('Each scenario must include a situation, challenge, decision point, and debrief.'),
    insertBox(
      '[INSERT: SCENARIO 1 TITLE] [INSERT: SCENARIO 2 TITLE] [INSERT: SCENARIO 3 TITLE]\n[INSERT: SCENARIO 4 TITLE (recommended)] [INSERT: SCENARIO 5 TITLE (recommended)]',
      undefined,
      false
    ),

    subHeadingNoRule('4.2.3 AI Application Scenarios (NEW)'),
    bodyPara('Include at least 2 scenarios demonstrating AI tools in action in this domain:'),
    calloutBox({
      title: 'Financial Literacy Example:',
      lines: [
        {
          text: 'Scenario: A learner uses an AI budgeting tool to analyse their monthly expenses. They must identify an AI-generated recommendation that contains an error and explain how they verified it using human judgment.',
          italic: true,
        },
      ],
      fill: EXAMPLE_BG,
      borderColor: EXAMPLE_BORDER,
      titleColor: '8A6116',
    }),
    spacer(60),
    insertBox(
      '[INSERT: AI SCENARIO 1 — AI tool in action, decision required] [INSERT: AI SCENARIO 2 — AI output evaluation, critical thinking required]',
      undefined,
      false
    ),

    ...moduleTitleHeading('MODULE 3: IMPLEMENTATION & WORKPLACE INTEGRATION'),
    bodyPara('Ensure learners can translate training into sustained workplace behaviour and organisational change.'),

    subHeadingNoRule('4.3.1 Implementation Requirements'),
    ...promptWithInsert('Implementation strategies:', '[INSERT: IMPLEMENTATION STRATEGY]', false),
    ...promptWithInsert('Workplace rollout methods:', '[INSERT: ROLLOUT METHOD]', false),
    ...promptWithInsert('Monitoring and evaluation approach:', '[INSERT: M&E APPROACH]', false),
    ...promptWithInsert('Continuous improvement practices:', '[INSERT: IMPROVEMENT CYCLE]', false),

    subHeadingNoRule('4.3.2 Mandatory Deliverables'),
    bodyPara('Module 3 must include all of the following:'),
    insertBox(
      '[INSERT: IMPLEMENTATION CHECKLIST TITLE]  ← e.g. AI Financial Literacy 30-Day Action Plan\n[INSERT: CAMPAIGN / ROLLOUT FRAMEWORK TITLE] [INSERT: RISK & COMPLIANCE SECTION TITLE]',
      undefined,
      false
    ),

    subHeadingNoRule('4.3.3 AI Governance & Continuous Learning (NEW)'),
    bodyPara('Because AI evolves rapidly, Module 3 must address:'),
    ...promptWithInsert('How learners stay current with AI developments in this domain:', '[INSERT: CONTINUOUS AI LEARNING APPROACH]', false),
    ...promptWithInsert('Organisational AI policy or governance framework:', '[INSERT: AI GOVERNANCE FRAMEWORK]', false),
    ...promptWithInsert('Feedback loop — how AI tool performance is reviewed:', '[INSERT: AI FEEDBACK / REVIEW MECHANISM]', false),

    // ==================== SECTION 5: LEARNING DESIGN REQUIREMENTS ====================
    spacer(140),
    navyBanner('5. LEARNING DESIGN REQUIREMENTS'),
    spacer(40),
    bodyPara('All courses generated using this template must meet the following instructional design standards:'),

    ...subHeading('5.1 Core Design Standards'),
    bulletItem('Structured module flow with clear learning progression'),
    bulletItem('Scenario-based learning (minimum 3–5 per module)'),
    bulletItem('Knowledge checks at the end of each module (minimum 5 questions)'),
    bulletItem('Real workplace application focus throughout'),
    bulletItem('Critical thinking development — learners must evaluate, not just recall'),

    ...subHeading('5.2 AI-Enhanced Learning Design (NEW)'),
    bodyPara('For AI-integrated courses, also include:'),
    ...promptWithInsert('Interactive AI tool demonstrations or simulations:', '[INSERT: AI DEMO / SIMULATION DESCRIPTION]', false),
    ...promptWithInsert('Prompt engineering exercises (if applicable):', '[INSERT: PROMPT EXERCISE DESCRIPTION]', false),
    ...promptWithInsert('AI output evaluation tasks — learners critique AI-generated content:', '[INSERT: AI EVALUATION TASK]', false),
    ...promptWithInsert('Human-AI collaboration activities:', '[INSERT: COLLABORATION ACTIVITY]', false),

    ...subHeading('5.3 Assessment Design'),
    makeStyledDataTable({
      headers: [
        { label: 'Assessment Type', width: 24 },
        { label: 'Description', width: 32 },
        { label: 'When', width: 22 },
        { label: 'Weighting', width: 22 },
      ],
      rows: [
        [
          { text: 'Pre-Course Diagnostic' },
          { text: 'Baseline knowledge check' },
          { text: 'Before Module 1' },
          { text: 'Ungraded' },
        ],
        [
          { text: 'Module Knowledge Checks' },
          { text: 'Per-module MCQ / scenario quiz' },
          { text: 'End of each module' },
          { text: 'Formative' },
        ],
        [
          { text: 'Practical Application Task' },
          { text: 'Workplace-based exercise' },
          { text: 'After Module 2' },
          { text: '[INSERT: WEIGHTING]', isPlaceholder: true },
        ],
        [
          { text: 'Final Assessment' },
          { text: 'Summative — all modules' },
          { text: 'After Module 3' },
          { text: '[INSERT: PASS MARK %]', isPlaceholder: true },
        ],
        [
          { text: 'Post-Course Reflection' },
          { text: 'Self-assessment against learning goals' },
          { text: 'After completion' },
          { text: 'Ungraded' },
        ],
      ],
    }),

    // ==================== SECTION 6: ETHICS & COMPLIANCE ====================
    spacer(140),
    navyBanner('6. ETHICS, COMPLIANCE & AI RESPONSIBILITY'),
    spacer(40),
    bodyPara(
      'All eStudy courses must embed ethical principles throughout — not as a standalone module, but woven into all scenarios and learning activities.'
    ),

    ...subHeading('6.1 Core Ethics Requirements'),
    ...promptWithInsert('Confidentiality requirements relevant to this domain:', '[INSERT: CONFIDENTIALITY REQUIREMENTS]', false),
    ...promptWithInsert('Data privacy principles:', '[INSERT: DATA PRIVACY FRAMEWORK]', false, '← e.g. POPIA, GDPR'),
    ...promptWithInsert('Ethical workplace behaviour standards:', '[INSERT: ETHICS STANDARDS]', false),
    ...promptWithInsert('Psychological safety considerations:', '[INSERT: PSYCHOLOGICAL SAFETY NOTES]', false),
    ...promptWithInsert('Responsible decision-making principles:', '[INSERT: DECISION-MAKING FRAMEWORK]', false),
    ...promptWithInsert('Accountability in workplace actions:', '[INSERT: ACCOUNTABILITY MECHANISM]', false),

    ...subHeading('6.2 AI Ethics & Responsible AI (NEW — MANDATORY)'),
    bodyPara('For all AI-integrated courses, the following must be explicitly addressed:'),
    ...promptWithInsert('Bias and fairness — how AI bias may affect outcomes in this domain:', '[INSERT: AI BIAS RISK]', false),
    ...promptWithInsert('Transparency — when and how to disclose AI use:', '[INSERT: AI DISCLOSURE REQUIREMENT]', false),
    ...promptWithInsert('Human oversight — decisions that must never be fully delegated to AI:', '[INSERT: HUMAN OVERRIDE SCENARIOS]', false),
    ...promptWithInsert('Data sovereignty and consent — who owns the data AI processes:', '[INSERT: DATA SOVEREIGNTY CONTEXT]', false),
    ...promptWithInsert('AI and job displacement — honest framing for learners:', '[INSERT: AI WORKFORCE IMPACT NARRATIVE]', false),
    ...promptWithInsert(
      'Applicable AI governance framework:',
      '[INSERT: AI GOVERNANCE REFERENCE]',
      false,
      '← e.g. SA DCDT National AI Policy, UNESCO AI Ethics'
    ),
    calloutBox({
      title: 'Financial Literacy Example:',
      lines: [
        {
          text: 'Learners were taught: AI financial tools may reflect historical bias in credit scoring (e.g. racial or gender bias in training data). Always verify AI recommendations against your own financial context and seek human advice for major decisions.',
          italic: true,
        },
      ],
      fill: EXAMPLE_BG,
      borderColor: EXAMPLE_BORDER,
      titleColor: '8A6116',
    }),

    // ==================== SECTION 7: OUTPUT FORMAT RULES ====================
    spacer(140),
    navyBanner('7. OUTPUT FORMAT RULES'),
    spacer(40),
    bodyPara('The AI-generated course output must meet all of the following standards before LMS deployment:'),

    ...subHeading('7.1 Structural Requirements'),
    bulletItem('Professionally structured with numbered sections exactly as per this template'),
    bulletItem('Suitable for LMS deployment without structural modification'),
    bulletItem('Follows corporate instructional design standards'),
    bulletItem('Uses formal, inclusive, workplace-appropriate language throughout'),
    bulletItem('Fully self-contained — no external references needed to interpret the content'),

    ...subHeading('7.2 Content Quality Standards'),
    bulletItem('All scenarios are realistic, role-specific, and contextualised to the South African workplace'),
    bulletItem('AI tools referenced are current, accessible, and appropriate for the target audience'),
    bulletItem('Statistics and claims are sourced from reputable, current industry references'),
    bulletItem('Examples reflect demographic and sectoral diversity'),

    ...subHeading('7.3 AI Content Standards (NEW)'),
    bulletItem('All AI tool references must be verifiable and available to learners'),
    bulletItem('AI-generated content within the course must be clearly labelled as AI-assisted'),
    bulletItem('Scenarios involving AI must include both successful use cases and failure/limitation cases'),
    bulletItem('Prompt examples (if included) must be practical and immediately usable'),

    ...subHeading('7.4 Accessibility & Inclusivity'),
    ...promptWithInsert(
      'Reading level appropriate for target audience:',
      toneLevelVal.text,
      toneLevelVal.isFilled,
      '← e.g. NQF 4 / Grade 12 equivalent'
    ),
    bulletItem('Language accessibility — plain language principles applied'),
    bulletItem('Cultural inclusivity — examples reflect South African workplace diversity'),
    bulletItem('Accommodates varied digital literacy levels'),

    ...subHeading('7.5 Accreditation & Standards Alignment (NEW)'),
    bodyPara(
      'Where this course must align to an accreditation body, qualification, programme, unit standard or other formal standards framework, capture the following:'
    ),
    ...promptWithInsert(
      'Accreditation / Standards Body:',
      b?.saCompliance?.setaName?.trim() || '[INSERT: ACCREDITATION / STANDARDS BODY]',
      Boolean(b?.saCompliance?.setaName?.trim())
    ),
    ...promptWithInsert('Qualification / Programme / Unit Standard:', '[INSERT: QUALIFICATION / PROGRAMME / UNIT STANDARD]', false),
    ...promptWithInsert(
      'NQF Level:',
      b?.saCompliance?.nqfLevel?.trim() || '[INSERT: NQF LEVEL, IF APPLICABLE]',
      Boolean(b?.saCompliance?.nqfLevel?.trim())
    ),
    ...promptWithInsert(
      'Accreditation / Standards Requirements:',
      b?.saCompliance?.saqaNotes?.trim() || '[INSERT: SPECIFIC CURRICULUM, ASSESSMENT, CREDIT, DELIVERY OR EVIDENCE REQUIREMENTS]',
      Boolean(b?.saCompliance?.saqaNotes?.trim())
    ),
    ...promptWithInsert(
      'Required Learning Structure:',
      '[INSERT: REQUIRED STRUCTURE — e.g. Knowledge Modules, Practical Skill Modules and Work Experience Modules]',
      false
    ),
    ...promptWithInsert(
      'Assessment Requirements:',
      '[INSERT: INTERNAL / EXTERNAL / SUMMATIVE / PRACTICAL / WORKPLACE ASSESSMENT REQUIREMENTS]',
      false
    ),
    spacer(40),
    bodyPara('Mandatory:', { bold: true, after: 60 }),
    bulletItem('The AI must generate the course according to the selected accreditation or standards framework where requirements are supplied.'),
    bulletItem('The AI must not claim that a course is accredited merely because it has been aligned to an accreditation framework.'),
    bulletItem('If requirements are missing, unclear or require formal confirmation, the AI must state: "Requires SME/Provider/Accreditation-Body Validation."'),
    bulletItem('For QCTO-aligned occupational qualifications, where applicable, the output must reflect the relevant Knowledge, Practical Skill and Work Experience structure rather than treating the course as knowledge-only.'),
    bulletItem('Do not invent qualification codes, credits, unit standards, assessment rules or accreditation status.'),

    // ==================== SECTION 8: FINAL OUTPUT REQUIREMENT ====================
    spacer(140),
    navyBanner('8. FINAL OUTPUT REQUIREMENT'),
    spacer(40),
    bodyPara('Produce a complete training programme that meets ALL of the following criteria:'),
    makeStyledDataTable({
      headers: [
        { label: 'Requirement', width: 32 },
        { label: 'Standard', width: 68 },
      ],
      rows: [
        [{ text: 'Industry-ready' }, { text: 'Deployable in a corporate or regulated environment without modification' }],
        [{ text: 'Scenario-driven' }, { text: 'Minimum 3 scenarios per module; minimum 2 AI-specific scenarios' }],
        [{ text: 'Performance-focused' }, { text: 'Every module links to a measurable workplace behaviour change' }],
        [{ text: 'Scalable' }, { text: 'Structure reusable across industries with only [INSERT] fields changed' }],
        [{ text: 'AI-integrated' }, { text: 'AI tools, ethics, and responsible use embedded throughout' }],
        [{ text: 'Immediately deployable' }, { text: 'Complete, self-contained, LMS-ready on delivery' }],
        [{ text: 'South Africa compliant' }, { text: 'Aligned to applicable SA legislation and workplace standards' }],
        [{ text: 'Benchmarked' }, { text: 'Consistent with the Financial Literacy course quality standard' }],
      ],
    }),

    ...subHeading('8.1 Quality Assurance Checklist'),
    bodyPara('Before submitting for LMS deployment, confirm all of the following:'),
    bulletItem('All [INSERT: ...] fields have been replaced with course-specific content'),
    bulletItem('Minimum 3 modules with minimum 3 scenarios each'),
    bulletItem('AI ethics section is fully populated and embedded in at least 2 modules'),
    bulletItem('Pre-course diagnostic questions included (minimum 5)'),
    bulletItem('Assessment structure confirmed with pass marks and weightings'),
    bulletItem('Regulatory/compliance framework identified and referenced'),
    bulletItem('Language and accessibility standards met'),
    bulletItem('Output reviewed against the Financial Literacy course benchmark'),
    bulletItem('Accreditation / standards body identified where applicable'),
    bulletItem('Qualification / programme / unit standard identified where applicable'),
    bulletItem('Applicable NQF level identified where applicable'),
    bulletItem('Learning outcomes mapped to applicable standards'),
    bulletItem('Required knowledge components addressed'),
    bulletItem('Required practical components addressed'),
    bulletItem('Required workplace/work-experience components addressed where applicable'),
    bulletItem('Assessment requirements aligned'),
    bulletItem('No unsupported accreditation claims made'),
    bulletItem('Missing accreditation information flagged for validation'),
    bulletItem('All [INSERT: ...] fields resolved'),
    bulletItem('All "To Be Confirmed" items identified for review'),

    // ==================== SECTION 9: CUSTOMISATION GUIDE ====================
    spacer(140),
    navyBanner('9. CUSTOMISATION GUIDE FOR NEW COURSES (NEW)'),
    spacer(40),
    bodyPara(
      'Use the table below to plan your customisation before populating the template. This is an internal planning aid — it is not submitted to the AI engine.'
    ),
    makeStyledDataTable({
      headers: [
        { label: 'Template Section', width: 24 },
        { label: 'What Changes Per Course', width: 42 },
        { label: 'Your Notes', width: 34 },
      ],
      rows: [
        [
          { text: '1. Problem Statement' },
          { text: 'Industry context, target group, operational impact' },
          { text: '[INSERT: YOUR PLANNING NOTES]', isPlaceholder: true },
        ],
        [
          { text: '2. Sources' },
          { text: 'Regulation, industry links, AI tools used in domain' },
          { text: '[INSERT: YOUR PLANNING NOTES]', isPlaceholder: true },
        ],
        [
          { text: '3.1 Course Details' },
          { text: 'Title, code, domain, duration, NQF level' },
          { text: '[INSERT: YOUR PLANNING NOTES]', isPlaceholder: true },
        ],
        [
          { text: '3.6 Target Audience' },
          { text: 'Job roles, departments, AI literacy baseline' },
          { text: '[INSERT: YOUR PLANNING NOTES]', isPlaceholder: true },
        ],
        [
          { text: '4. Module Content' },
          { text: 'Scenarios, terminology, tools, procedures' },
          { text: '[INSERT: YOUR PLANNING NOTES]', isPlaceholder: true },
        ],
        [
          { text: '6. Ethics' },
          { text: 'Domain-specific risks, AI bias context, data laws' },
          { text: '[INSERT: YOUR PLANNING NOTES]', isPlaceholder: true },
        ],
        [
          { text: '7.4 Accessibility' },
          { text: 'Reading level, language, cultural context' },
          { text: '[INSERT: YOUR PLANNING NOTES]', isPlaceholder: true },
        ],
      ],
    }),

    ...subHeading('9.1 Courses Built Using This Template'),
    bodyPara('Track all courses generated from this master template:'),
    makeStyledDataTable({
      headers: [
        { label: 'Course Title', width: 38 },
        { label: 'Industry', width: 24 },
        { label: 'Date Built', width: 16 },
        { label: 'Version', width: 22 },
      ],
      rows: [
        [
          { text: 'Use of Artificial Intelligence in Financial Literacy' },
          { text: 'Financial Services' },
          { text: '2025' },
          { text: 'v1.0 — BENCHMARK' },
        ],
        [
          { text: '[INSERT: COURSE 2 TITLE]', isPlaceholder: true },
          { text: '[INSERT: INDUSTRY]', isPlaceholder: true },
          { text: '[INSERT: DATE]', isPlaceholder: true },
          { text: '[INSERT: VERSION]', isPlaceholder: true },
        ],
        [
          { text: '[INSERT: COURSE 3 TITLE]', isPlaceholder: true },
          { text: '[INSERT: INDUSTRY]', isPlaceholder: true },
          { text: '[INSERT: DATE]', isPlaceholder: true },
          { text: '[INSERT: VERSION]', isPlaceholder: true },
        ],
        [
          { text: '[INSERT: COURSE 4 TITLE]', isPlaceholder: true },
          { text: '[INSERT: INDUSTRY]', isPlaceholder: true },
          { text: '[INSERT: DATE]', isPlaceholder: true },
          { text: '[INSERT: VERSION]', isPlaceholder: true },
        ],
      ],
    }),

    // ==================== END BANNER ====================
    spacer(280),
    goldRule(),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 40 },
      children: [
        new TextRun({
          text: 'END OF MASTER PROMPT TEMPLATE v9.0',
          bold: true,
          size: 22,
          color: NAVY,
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'eStudy South Africa · Confidential & Proprietary · Not for Distribution',
          italics: true,
          size: 18,
          color: '64748B',
          font: 'Calibri',
        }),
      ],
    }),
  ];

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1080,
              bottom: 1080,
              left: 1140,
              right: 1140,
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: `${brandTitle} · Master Course Generation Prompt Template v9.0`,
                    size: 16,
                    color: '94A3B8',
                    font: 'Calibri',
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
}
