import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type {
  AIProvider,
  CourseBrief,
  CourseProject,
  CourseTemplate,
  CurriculumModulePlan,
} from '../types';
import { createEmptyCourseProject } from '../data/benchmarks';
import { apiFetch, parseApiJson } from './apiClient';
import {
  V9_THEME,
  buildMasterV9TemplateDocxDocument,
  calloutBox,
  goldRule,
  isMasterV9Template,
  navyBanner,
  subHeading,
} from './masterV9TemplateDocx';

function slugify(input: string): string {
  return (input || 'estudy-template')
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

const CELL_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 4, color: V9_THEME.BORDER_GRAY },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: V9_THEME.BORDER_GRAY },
  left: { style: BorderStyle.SINGLE, size: 4, color: V9_THEME.BORDER_GRAY },
  right: { style: BorderStyle.SINGLE, size: 4, color: V9_THEME.BORDER_GRAY },
};

const ENTRY_PLACEHOLDER_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 4, color: V9_THEME.BORDER_GRAY },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: V9_THEME.BORDER_GRAY },
  left: { style: BorderStyle.SINGLE, size: 18, color: V9_THEME.INSERT_BORDER },
  right: { style: BorderStyle.SINGLE, size: 4, color: V9_THEME.BORDER_GRAY },
};

const CELL_MARGINS = {
  top: 90,
  bottom: 90,
  left: 140,
  right: 140,
};

function makeParagraphsFromText(
  text: string,
  opts?: { isPlaceholder?: boolean; bold?: boolean }
): Paragraph[] {
  const lines = String(text || '').split(/\r?\n/);
  return lines.map(
    line =>
      new Paragraph({
        spacing: { after: 40 },
        children: [
          new TextRun({
            text: line || ' ',
            size: 20,
            bold: Boolean(opts?.bold || opts?.isPlaceholder),
            italics: Boolean(opts?.isPlaceholder),
            color: opts?.isPlaceholder ? V9_THEME.INSERT_TEXT : '0F172A',
            font: 'Calibri',
          }),
        ],
      })
  );
}

function makeFieldRow(
  params: {
    label: string;
    tag: string;
    guidance?: string;
    valueOrPlaceholder: string;
    isPlaceholder?: boolean;
  },
  rowIndex = 0
): TableRow {
  const leftChildren: Paragraph[] = [
    new Paragraph({
      spacing: { after: 30 },
      children: [
        new TextRun({
          text: params.label,
          bold: true,
          size: 20,
          color: V9_THEME.NAVY,
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: params.guidance ? 30 : 0 },
      children: [
        new TextRun({
          text: params.tag,
          font: 'Courier New',
          size: 16,
          color: V9_THEME.TEAL,
        }),
      ],
    }),
  ];

  if (params.guidance) {
    leftChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: params.guidance,
            italics: true,
            size: 17,
            color: '64748B',
            font: 'Calibri',
          }),
        ],
      })
    );
  }

  const labelFill = rowIndex % 2 === 1 ? 'EEF2F6' : 'F8FAFC';

  return new TableRow({
    children: [
      new TableCell({
        width: { size: 38, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: labelFill },
        borders: CELL_BORDERS,
        margins: CELL_MARGINS,
        children: leftChildren,
      }),
      new TableCell({
        width: { size: 62, type: WidthType.PERCENTAGE },
        shading: {
          type: ShadingType.CLEAR,
          color: 'auto',
          fill: params.isPlaceholder ? V9_THEME.INSERT_BG : 'FFFFFF',
        },
        borders: params.isPlaceholder ? ENTRY_PLACEHOLDER_BORDERS : CELL_BORDERS,
        margins: CELL_MARGINS,
        children: makeParagraphsFromText(params.valueOrPlaceholder, {
          isPlaceholder: params.isPlaceholder,
        }),
      }),
    ],
  });
}

function makeTwoColHeaderRow(leftTitle: string, rightTitle: string): TableRow {
  return new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        width: { size: 38, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: V9_THEME.NAVY },
        borders: CELL_BORDERS,
        margins: CELL_MARGINS,
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: leftTitle,
                bold: true,
                size: 20,
                color: 'FFFFFF',
                font: 'Calibri',
              }),
            ],
          }),
        ],
      }),
      new TableCell({
        width: { size: 62, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: V9_THEME.NAVY },
        borders: CELL_BORDERS,
        margins: CELL_MARGINS,
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: rightTitle,
                bold: true,
                size: 20,
                color: 'FFFFFF',
                font: 'Calibri',
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function spacer(after = 90): Paragraph {
  return new Paragraph({ spacing: { after }, children: [] });
}

function v9Bullet(text: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 55 },
    children: [
      new TextRun({
        text,
        size: 19,
        color: '1E293B',
        font: 'Calibri',
      }),
    ],
  });
}

export function buildTemplateDocxDocument(
  template: CourseTemplate,
  prefillProject?: CourseProject
): Document {
  if (isMasterV9Template(template)) {
    return buildMasterV9TemplateDocxDocument(template, prefillProject);
  }
  const b = prefillProject?.brief;

  const valOrPlaceholder = (val: string | undefined, placeholder: string) => {
    const trimmed = (val || '').trim();
    return trimmed
      ? { text: trimmed, isPlaceholder: false }
      : { text: placeholder, isPlaceholder: true };
  };

  const children: Array<Paragraph | Table> = [];

  // Executive eStudy South Africa Cover Header (matches Master v9.0 Theme)
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 100, after: 40 },
      children: [
        new TextRun({
          text: 'eStudy South Africa',
          bold: true,
          size: 44,
          color: V9_THEME.NAVY,
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: template.name.toUpperCase(),
          bold: true,
          size: 28,
          color: V9_THEME.GOLD,
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: `– ${template.category} · ${template.version} · Universal Fillable Course Template`,
          italics: true,
          size: 22,
          color: V9_THEME.TEAL,
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 140 },
      children: [
        new TextRun({
          text: template.description,
          italics: true,
          size: 19,
          color: '64748B',
          font: 'Calibri',
        }),
      ],
    }),
    goldRule(),
    spacer(40)
  );

  // HOW TO USE THIS TEMPLATE Banner + Green Callouts
  children.push(
    navyBanner('HOW TO USE THIS TEMPLATE'),
    spacer(50),
    calloutBox({
      title: 'Step-by-Step Round-Trip Instructions',
      lines: [
        {
          text:
            'Replace the blue-highlighted placeholder cells in the right-hand column with your course-specific content. Keep the bracketed field tags intact in the left column so uploading this Word file back into eStudy imports every field automatically.',
          italic: true,
        },
      ],
      fill: V9_THEME.GREEN_BG,
      borderColor: V9_THEME.GREEN_BORDER,
      titleColor: V9_THEME.GREEN_BORDER,
    }),
    spacer(80),
    calloutBox({
      title: 'GLOBAL RULE — HANDLING PLACEHOLDER FIELDS',
      lines: [
        {
          text: 'Apply these integrity standards across every field in this template:',
          italic: true,
        },
      ],
      fill: V9_THEME.GREEN_BG,
      borderColor: V9_THEME.GREEN_BORDER,
      titleColor: V9_THEME.GREEN_BORDER,
    }),
    spacer(50),
    v9Bullet('If information is known and verified, replace the blue placeholder with course-specific content.'),
    v9Bullet('If a field does not apply, enter "Not Applicable" with a brief explanation.'),
    v9Bullet('If information is unknown, enter "To Be Confirmed" and state what is needed.'),
    v9Bullet('If specialist or accreditation sign-off is required, mark it "Requires SME/Stakeholder Validation".'),
    v9Bullet('Never invent or assume statutory citations, qualification codes, or unverified thresholds.'),
    spacer(120)
  );

  // Template Identification Metadata Table
  children.push(
    navyBanner('TEMPLATE IDENTIFICATION'),
    spacer(50),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        makeTwoColHeaderRow('System Property', 'Template Metadata (Do Not Remove)'),
        makeFieldRow(
          {
            label: 'Template ID',
            tag: '[meta:templateId]',
            valueOrPlaceholder: template.id,
          },
          0
        ),
        makeFieldRow(
          {
            label: 'Template Name',
            tag: '[meta:templateName]',
            valueOrPlaceholder: template.name,
          },
          1
        ),
        makeFieldRow(
          {
            label: 'Template Version',
            tag: '[meta:templateVersion]',
            valueOrPlaceholder: template.version,
          },
          2
        ),
      ],
    }),
    spacer(120)
  );

  // Section 1: Core Course Brief & Metadata
  children.push(
    navyBanner('1. STAGE 1 CORE COURSE BRIEF & METADATA'),
    spacer(40),
    new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({
          text: 'Fields marked with * are required to approve Stage 1 and unlock curriculum architecture.',
          size: 19,
          italics: true,
          color: '64748B',
          font: 'Calibri',
        }),
      ],
    })
  );

  const briefSpecs: Array<{
    key: string;
    label: string;
    guidance: string;
    placeholder: string;
    currentValue?: string;
  }> = [
    {
      key: 'title',
      label: 'Course Title *',
      guidance: 'Protected metadata. Official name of the learning programme.',
      placeholder: '[INSERT: COURSE TITLE]',
      currentValue: b?.title,
    },
    {
      key: 'code',
      label: 'Course Code / ID',
      guidance: 'Internal or qualification course identifier (e.g. EST-ENG-101).',
      placeholder: '[INSERT: COURSE CODE]',
      currentValue: b?.code,
    },
    {
      key: 'industryDomain',
      label: 'Industry / Subject Domain *',
      guidance: 'Primary sector or discipline (e.g. Engineering, Compliance, Operations).',
      placeholder: '[INSERT: INDUSTRY DOMAIN]',
      currentValue: b?.industryDomain,
    },
    {
      key: 'targetAudience',
      label: 'Target Audience *',
      guidance: 'Who the learners are and their workplace environment.',
      placeholder: '[INSERT: TARGET AUDIENCE]',
      currentValue: b?.targetAudience,
    },
    {
      key: 'targetJobRoles',
      label: 'Target Job Roles',
      guidance: 'Specific job titles or roles (comma-separated).',
      placeholder: '[INSERT: TARGET JOB ROLES]',
      currentValue: b?.targetJobRoles,
    },
    {
      key: 'experienceLevel',
      label: 'Experience Level',
      guidance: 'Entry / Foundational, Intermediate, Advanced, or Executive / Specialist.',
      placeholder: '[INSERT: EXPERIENCE LEVEL]',
      currentValue: b?.experienceLevel,
    },
    {
      key: 'prerequisites',
      label: 'Prerequisites',
      guidance: 'Prior learning, certifications, or workplace access needed.',
      placeholder: '[INSERT: PREREQUISITES OR NONE REQUIRED]',
      currentValue: b?.prerequisites,
    },
    {
      key: 'estimatedDuration',
      label: 'Estimated Duration *',
      guidance: 'Total notional learning time (e.g. 8 Hours, 2 Days, 16 Notional Hours).',
      placeholder: '[INSERT: ESTIMATED DURATION]',
      currentValue: b?.estimatedDuration,
    },
    {
      key: 'language',
      label: 'Delivery Language',
      guidance: 'Language and regional context (e.g. English (South African Context)).',
      placeholder: '[INSERT: DELIVERY LANGUAGE — E.G. ENGLISH (SOUTH AFRICAN CONTEXT)]',
      currentValue: b?.language,
    },
    {
      key: 'purpose',
      label: 'Course Purpose & Capability Goal *',
      guidance: 'What learners will be able to do reliably in the workplace after completing.',
      placeholder: '[INSERT: 2–3 SENTENCE COURSE PURPOSE STATEMENT]',
      currentValue: b?.purpose,
    },
    {
      key: 'workplaceProblem',
      label: 'Workplace Problem / Operational Need',
      guidance: 'Concrete performance gap, risk, or operational challenge being solved.',
      placeholder: '[INSERT: WORKPLACE PROBLEM / OPERATIONAL NEED]',
      currentValue: b?.workplaceProblem,
    },
    {
      key: 'learningRequirements',
      label: 'Learning Requirements & Constraints',
      guidance: 'Pedagogical depth, hands-on requirements, and verification boundaries.',
      placeholder: '[INSERT: LEARNING REQUIREMENTS & CONSTRAINTS]',
      currentValue: b?.learningRequirements,
    },
    {
      key: 'subjectTopicsInput',
      label: 'Mandatory Subject Topics *',
      guidance: 'List all required topics (one per line). Stage 2 verifies zero silent omissions.',
      placeholder: '[INSERT: MANDATORY SUBJECT TOPICS — ONE PER LINE]',
      currentValue: b?.subjectTopicsInput,
    },
    {
      key: 'aiIntegrationMode',
      label: 'AI Integration Mode',
      guidance: 'Choose one: none, optional, or core.',
      placeholder: `[INSERT: AI INTEGRATION MODE — NONE / OPTIONAL / CORE (DEFAULT: ${template.defaultAiMode.toUpperCase()})]`,
      currentValue: b?.aiIntegrationMode,
    },
    {
      key: 'aiIntegrationRequirements',
      label: 'AI Integration Scope & Governance',
      guidance: 'Specify AI tools, safeguards, or write Not applicable.',
      placeholder: '[INSERT: AI INTEGRATION SCOPE OR NOT APPLICABLE]',
      currentValue: b?.aiIntegrationRequirements,
    },
    {
      key: 'saCompliance.nqfLevel',
      label: 'NQF Level (Optional SA Context)',
      guidance: 'If NQF-aligned, specify level (e.g. NQF Level 5). Otherwise leave untouched.',
      placeholder: '[INSERT: NQF LEVEL IF APPLICABLE]',
      currentValue: b?.saCompliance?.nqfLevel,
    },
    {
      key: 'saCompliance.setaName',
      label: 'SETA / ETQA Name (Optional)',
      guidance: 'Relevant SETA or professional body if applicable.',
      placeholder: '[INSERT: SETA / ETQA BODY IF APPLICABLE]',
      currentValue: b?.saCompliance?.setaName,
    },
    {
      key: 'saCompliance.industryLegislation',
      label: 'Applicable Legislation / Technical Standards',
      guidance: 'Verified Acts, regulations, SANS/ISO codes, or workplace SOPs.',
      placeholder: '[INSERT: APPLICABLE LEGISLATION OR TECHNICAL STANDARDS]',
      currentValue: b?.saCompliance?.industryLegislation,
    },
  ];

  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        makeTwoColHeaderRow('Brief Field & Tag', 'Your Input (Replace Highlighted Text)'),
        ...briefSpecs.map((spec, idx) => {
          const resolved = valOrPlaceholder(spec.currentValue, spec.placeholder);
          return makeFieldRow(
            {
              label: spec.label,
              tag: `[brief:${spec.key}]`,
              guidance: spec.guidance,
              valueOrPlaceholder: resolved.text,
              isPlaceholder: resolved.isPlaceholder,
            },
            idx
          );
        }),
      ],
    }),
    spacer(140)
  );

  // Section 2: Template-Specific Sections & Fields
  children.push(
    navyBanner(`2. ${template.name.toUpperCase()} — SPECIFIC SECTIONS`),
    spacer(40)
  );

  const sortedSections = [...template.sections].sort((a, bSec) => a.order - bSec.order);
  for (let sIdx = 0; sIdx < sortedSections.length; sIdx++) {
    const sec = sortedSections[sIdx];
    const cleanSecTitle = sec.title.replace(/^\d+\.\s*/, '');
    children.push(...subHeading(`2.${sIdx + 1} ${cleanSecTitle} (${sec.required ? 'Required' : 'Optional'})`));
    if (sec.description) {
      children.push(
        new Paragraph({
          spacing: { after: 90 },
          children: [
            new TextRun({
              text: sec.description,
              size: 19,
              color: '475569',
              font: 'Calibri',
            }),
          ],
        })
      );
    }

    if (sec.fields.length > 0) {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            makeTwoColHeaderRow('Template Field & Tag', 'Your Input (Replace Highlighted Text)'),
            ...sec.fields.map((fld, fIdx) => {
              const resolved = valOrPlaceholder(
                b?.templateFieldValues?.[fld.key],
                fld.placeholder || `[INSERT: ${fld.label.toUpperCase()}]`
              );
              const guidanceParts = [
                fld.helpText || '',
                fld.options && fld.options.length > 0
                  ? `Options: ${fld.options.join(' | ')}`
                  : '',
              ].filter(Boolean);
              return makeFieldRow(
                {
                  label: `${fld.label}${fld.required ? ' *' : ' (Optional)'}`,
                  tag: `[field:${fld.key}]`,
                  guidance: guidanceParts.join(' · ') || undefined,
                  valueOrPlaceholder: resolved.text,
                  isPlaceholder: resolved.isPlaceholder,
                },
                fIdx
              );
            }),
          ],
        }),
        spacer(80)
      );
    }
  }

  // Section 3: Optional Starter Module Outline
  children.push(
    spacer(100),
    navyBanner('3. OPTIONAL STARTER MODULE OUTLINE'),
    spacer(40),
    new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({
          text: 'Optional: If you already know the modules you want, replace the highlighted placeholders below. Leave untouched to let Stage 2 AI propose modules from your Mandatory Subject Topics.',
          size: 19,
          color: '475569',
          font: 'Calibri',
        }),
      ],
    })
  );

  const existingModules = prefillProject?.curriculum?.modules || [];
  const moduleRowCount = Math.max(5, existingModules.length);
  const moduleRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        { label: 'Module #', width: 14 },
        { label: 'Module Title', width: 30 },
        { label: 'Key Topics (comma-separated)', width: 40 },
        { label: 'Est. Duration', width: 16 },
      ].map(
        col =>
          new TableCell({
            width: { size: col.width, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: V9_THEME.NAVY },
            borders: CELL_BORDERS,
            margins: CELL_MARGINS,
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: col.label,
                    bold: true,
                    size: 19,
                    color: 'FFFFFF',
                    font: 'Calibri',
                  }),
                ],
              }),
            ],
          })
      ),
    }),
  ];

  for (let i = 0; i < moduleRowCount; i++) {
    const mod = existingModules[i];
    const modTitle = mod?.title || `[INSERT: MODULE ${i + 1} TITLE]`;
    const modTopics =
      mod && mod.topics.length > 0
        ? mod.topics.map(t => t.title).join(', ')
        : `[INSERT: MODULE ${i + 1} KEY TOPICS]`;
    const modMins =
      mod && mod.lessons.length > 0
        ? `${mod.lessons.reduce((acc, l) => acc + (Number(l.durationMinutes) || 0), 0)} mins`
        : '[e.g. 90 mins]';

    const rowBg = i % 2 === 1 ? V9_THEME.ALT_ROW_BG : 'FFFFFF';

    moduleRows.push(
      new TableRow({
        children: [
          { text: `Module ${i + 1}`, width: 14, isLabel: true, isPlaceholder: false },
          { text: modTitle, width: 30, isLabel: false, isPlaceholder: !mod?.title },
          {
            text: modTopics,
            width: 40,
            isLabel: false,
            isPlaceholder: !(mod && mod.topics.length > 0),
          },
          {
            text: modMins,
            width: 16,
            isLabel: false,
            isPlaceholder: !(mod && mod.lessons.length > 0),
          },
        ].map(
          cell =>
            new TableCell({
              width: { size: cell.width, type: WidthType.PERCENTAGE },
              shading: {
                type: ShadingType.CLEAR,
                color: 'auto',
                fill: cell.isLabel
                  ? 'EEF2F6'
                  : cell.isPlaceholder
                    ? V9_THEME.INSERT_BG
                    : rowBg,
              },
              borders: cell.isPlaceholder ? ENTRY_PLACEHOLDER_BORDERS : CELL_BORDERS,
              margins: CELL_MARGINS,
              children: makeParagraphsFromText(cell.text, {
                isPlaceholder: cell.isPlaceholder,
                bold: cell.isLabel,
              }),
            })
        ),
      })
    );
  }

  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: moduleRows,
    })
  );

  // Section 4: Quality Rules Reference
  if (template.qualityRules.length > 0) {
    children.push(
      spacer(140),
      navyBanner('4. TEMPLATE QUALITY RULES & BENCHMARK STANDARDS'),
      spacer(50),
      calloutBox({
        title: `Quality Assurance Standards for ${template.name}`,
        lines: template.qualityRules.map(rule => ({ text: `• ${rule}` })),
        fill: V9_THEME.EXAMPLE_BG,
        borderColor: V9_THEME.EXAMPLE_BORDER,
        titleColor: '8A6116',
      })
    );
  }

  // Executive End Banner
  children.push(
    spacer(240),
    goldRule(),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 60, after: 30 },
      children: [
        new TextRun({
          text: `END OF ${template.name.toUpperCase()} (${template.version})`,
          bold: true,
          size: 22,
          color: V9_THEME.NAVY,
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
    })
  );

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
                    text: `eStudy South Africa · ${template.name} (${template.version})`,
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

export async function exportTemplateAsDocx(
  template: CourseTemplate,
  prefillProject?: CourseProject
): Promise<void> {
  const doc = buildTemplateDocxDocument(template, prefillProject);
  const blob = await Packer.toBlob(doc);
  const baseName = prefillProject?.brief?.title
    ? `${slugify(prefillProject.brief.title)}-course-form`
    : `${slugify(template.name)}-fillable-template`;
  downloadBlob(blob, `${baseName}.docx`);
}

export interface UploadedFilledTemplateOutcome {
  project: CourseProject;
  matchedTemplate: CourseTemplate;
  populatedFieldCount: number;
  mode: 'structured' | 'ai_assisted';
  parsedBrief: Partial<CourseBrief>;
  parsedFieldValues: Record<string, string>;
  suggestedModules: CurriculumModulePlan[];
}

async function readFileAsPayload(file: File): Promise<{ rawText?: string; base64Data?: string }> {
  const isText = file.type.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(file.name);
  if (isText) {
    return { rawText: await file.text(), base64Data: undefined };
  }
  const base64Data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || '');
      const idx = s.indexOf(',');
      resolve(idx >= 0 ? s.slice(idx + 1) : s);
    };
    reader.onerror = () => reject(new Error('Could not read uploaded file.'));
    reader.readAsDataURL(file);
  });
  return { rawText: undefined, base64Data };
}

export async function uploadAndParseFilledTemplateFile(params: {
  file: File;
  templates: CourseTemplate[];
  fallbackTemplateId?: string;
  provider: AIProvider;
  model: string;
}): Promise<UploadedFilledTemplateOutcome> {
  const payload = await readFileAsPayload(params.file);
  const hintTemplate =
    params.templates.find(t => t.id === params.fallbackTemplateId) || params.templates[0];

  const res = await apiFetch('/api/v2/templates/parse-filled', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: params.file.name,
      mimeType: params.file.type,
      base64Data: payload.base64Data,
      rawText: payload.rawText,
      template: hintTemplate,
      provider: params.provider,
      model: params.model,
    }),
  });
  const data = await parseApiJson<any>(res);
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Could not parse filled Word template.');
  }

  const matchedTemplate =
    (data.matchedTemplateId && params.templates.find(t => t.id === data.matchedTemplateId)) ||
    (data.matchedTemplateName &&
      params.templates.find(
        t => t.name.toLowerCase() === String(data.matchedTemplateName).toLowerCase()
      )) ||
    hintTemplate;

  const project = createEmptyCourseProject({
    templateId: matchedTemplate.id,
    templateName: matchedTemplate.name,
    creationMode: 'filled_template',
  });

  const parsedBrief: Partial<CourseBrief> = data.brief || {};
  const parsedFieldValues: Record<string, string> = data.templateFieldValues || {};
  const suggestedModules: CurriculumModulePlan[] = Array.isArray(data.suggestedModules)
    ? data.suggestedModules
    : [];

  project.brief = {
    ...project.brief,
    ...parsedBrief,
    saCompliance: {
      ...project.brief.saCompliance,
      ...(parsedBrief.saCompliance || {}),
    },
    templateFieldValues: {
      ...project.brief.templateFieldValues,
      ...parsedFieldValues,
    },
    aiIntegrationMode:
      parsedBrief.aiIntegrationMode || matchedTemplate.defaultAiMode || project.brief.aiIntegrationMode,
    metadataLocked: false,
    approval: { approved: false },
  };

  if (suggestedModules.length > 0) {
    project.curriculum = {
      ...project.curriculum,
      rationale: `Starter ${suggestedModules.length}-module structure imported from ${params.file.name}.`,
      modules: suggestedModules,
      approval: { approved: false },
    };
  }

  return {
    project,
    matchedTemplate,
    populatedFieldCount: Number(data.populatedCount) || 0,
    mode: data.mode === 'ai_assisted' ? 'ai_assisted' : 'structured',
    parsedBrief,
    parsedFieldValues,
    suggestedModules,
  };
}
