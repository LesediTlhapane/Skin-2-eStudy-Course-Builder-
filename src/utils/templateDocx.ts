import {
  BorderStyle,
  Document,
  HeadingLevel,
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
  buildMasterV9TemplateDocxDocument,
  isMasterV9Template,
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
  top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
  left: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
  right: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
};

const CELL_MARGINS = {
  top: 100,
  bottom: 100,
  left: 140,
  right: 140,
};

function makeParagraphsFromText(text: string, opts?: { muted?: boolean; italic?: boolean }): Paragraph[] {
  const lines = String(text || '').split(/\r?\n/);
  return lines.map(
    line =>
      new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({
            text: line || ' ',
            size: 20,
            color: opts?.muted ? '64748B' : '0F172A',
            italics: Boolean(opts?.italic),
          }),
        ],
      })
  );
}

function makeFieldRow(params: {
  label: string;
  tag: string;
  guidance?: string;
  valueOrPlaceholder: string;
  isPlaceholder?: boolean;
}): TableRow {
  const leftChildren: Paragraph[] = [
    new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: params.label,
          bold: true,
          size: 20,
          color: '052B66',
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: params.guidance ? 40 : 0 },
      children: [
        new TextRun({
          text: params.tag,
          font: 'Courier New',
          size: 16,
          color: '475569',
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
          }),
        ],
      })
    );
  }

  return new TableRow({
    children: [
      new TableCell({
        width: { size: 38, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F5F9' },
        borders: CELL_BORDERS,
        margins: CELL_MARGINS,
        children: leftChildren,
      }),
      new TableCell({
        width: { size: 62, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FFFFFF' },
        borders: CELL_BORDERS,
        margins: CELL_MARGINS,
        children: makeParagraphsFromText(params.valueOrPlaceholder, {
          muted: params.isPlaceholder,
          italic: params.isPlaceholder,
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
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: '052B66' },
        borders: CELL_BORDERS,
        margins: CELL_MARGINS,
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: leftTitle, bold: true, size: 20, color: 'FFFFFF' }),
            ],
          }),
        ],
      }),
      new TableCell({
        width: { size: 62, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: '052B66' },
        borders: CELL_BORDERS,
        margins: CELL_MARGINS,
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: rightTitle, bold: true, size: 20, color: 'FFFFFF' }),
            ],
          }),
        ],
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

  // Title Banner
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: template.name,
          bold: true,
          size: 36,
          color: '052B66',
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 140 },
      children: [
        new TextRun({
          text: `${template.category} · ${template.version} — Fillable Course Authoring Form`,
          bold: true,
          size: 22,
          color: '1E293B',
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: template.description,
          size: 20,
          color: '475569',
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: 'HOW TO USE THIS WORD TEMPLATE: ',
          bold: true,
          size: 19,
          color: '052B66',
        }),
        new TextRun({
          text:
            'Fill in your course details inside the white right-hand cells below. Keep the bracketed field tags (such as [brief:title] or [field:rootCauses]) intact in the shaded left column so that when you upload this Word document back into eStudy Master Course Builder, every field imports automatically into your course.',
          size: 19,
          color: '334155',
        }),
      ],
    })
  );

  // Template Identification Metadata Table
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 160, after: 100 },
      children: [
        new TextRun({ text: 'Template Identification', bold: true, size: 26, color: '052B66' }),
      ],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        makeTwoColHeaderRow('System Property', 'Value (Do Not Remove)'),
        makeFieldRow({
          label: 'Template ID',
          tag: '[meta:templateId]',
          valueOrPlaceholder: template.id,
        }),
        makeFieldRow({
          label: 'Template Name',
          tag: '[meta:templateName]',
          valueOrPlaceholder: template.name,
        }),
        makeFieldRow({
          label: 'Template Version',
          tag: '[meta:templateVersion]',
          valueOrPlaceholder: template.version,
        }),
      ],
    })
  );

  // Section A: Core Course Brief & Metadata
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 280, after: 100 },
      children: [
        new TextRun({
          text: 'Section A: Stage 1 Core Course Brief & Metadata',
          bold: true,
          size: 26,
          color: '052B66',
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: 'Fields marked with * are required to approve Stage 1 and begin curriculum architecture.',
          size: 19,
          italics: true,
          color: '64748B',
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
      placeholder: '[Enter Course Title here]',
      currentValue: b?.title,
    },
    {
      key: 'code',
      label: 'Course Code / ID',
      guidance: 'Internal or qualification course identifier (e.g. EST-AI-101).',
      placeholder: '[Enter Course Code here]',
      currentValue: b?.code,
    },
    {
      key: 'industryDomain',
      label: 'Industry / Subject Domain *',
      guidance: 'Primary sector or discipline (e.g. Healthcare, Mining, Corporate Leadership).',
      placeholder: '[Enter Industry or Subject Domain here]',
      currentValue: b?.industryDomain,
    },
    {
      key: 'targetAudience',
      label: 'Target Audience *',
      guidance: 'Who the learners are and their workplace environment.',
      placeholder: '[Enter Target Audience here]',
      currentValue: b?.targetAudience,
    },
    {
      key: 'targetJobRoles',
      label: 'Target Job Roles',
      guidance: 'Specific job titles or roles (comma-separated).',
      placeholder: '[Enter Target Job Roles here]',
      currentValue: b?.targetJobRoles,
    },
    {
      key: 'experienceLevel',
      label: 'Experience Level',
      guidance: 'Use: Entry / Foundational, Intermediate, Advanced, or Executive / Specialist.',
      placeholder: '[Enter Experience Level: Entry / Foundational | Intermediate | Advanced | Executive / Specialist]',
      currentValue: b?.experienceLevel,
    },
    {
      key: 'prerequisites',
      label: 'Prerequisites',
      guidance: 'Prior learning, certifications, or workplace access needed.',
      placeholder: '[Enter Prerequisites or None required]',
      currentValue: b?.prerequisites,
    },
    {
      key: 'estimatedDuration',
      label: 'Estimated Duration *',
      guidance: 'Total notional learning time (e.g. 8 Hours, 2 Days, 16 Notional Hours).',
      placeholder: '[Enter Estimated Duration here]',
      currentValue: b?.estimatedDuration,
    },
    {
      key: 'language',
      label: 'Delivery Language',
      guidance: 'Language and regional context (e.g. English (South African Context)).',
      placeholder: '[Enter Delivery Language here]',
      currentValue: b?.language || 'English (South African Context)',
    },
    {
      key: 'purpose',
      label: 'Course Purpose & Capability Goal *',
      guidance: 'What learners will be able to do reliably in the workplace after completing.',
      placeholder: '[Enter 2-3 sentence Course Purpose here]',
      currentValue: b?.purpose,
    },
    {
      key: 'workplaceProblem',
      label: 'Workplace Problem / Operational Need',
      guidance: 'Concrete performance gap, risk, or operational challenge being solved.',
      placeholder: '[Enter Workplace Problem or Operational Need here]',
      currentValue: b?.workplaceProblem,
    },
    {
      key: 'learningRequirements',
      label: 'Learning Requirements & Constraints',
      guidance: 'Pedagogical depth, hands-on requirements, and verification boundaries.',
      placeholder: '[Enter Learning Requirements here]',
      currentValue: b?.learningRequirements,
    },
    {
      key: 'subjectTopicsInput',
      label: 'Mandatory Subject Topics *',
      guidance: 'List all required topics (one per line). Stage 2 verifies zero silent omissions.',
      placeholder: '[Enter Mandatory Subject Topics here, one per line]',
      currentValue: b?.subjectTopicsInput,
    },
    {
      key: 'aiIntegrationMode',
      label: 'AI Integration Mode',
      guidance: 'Choose one: none, optional, or core.',
      placeholder: template.defaultAiMode,
      currentValue: b?.aiIntegrationMode || template.defaultAiMode,
    },
    {
      key: 'aiIntegrationRequirements',
      label: 'AI Integration Scope & Governance',
      guidance: 'Specify AI tools, safeguards, or write Not applicable.',
      placeholder: '[Enter AI Integration Scope or Not applicable]',
      currentValue: b?.aiIntegrationRequirements,
    },
    {
      key: 'saCompliance.nqfLevel',
      label: 'NQF Level (Optional SA Context)',
      guidance: 'If NQF-aligned, specify level (e.g. NQF Level 5). Otherwise leave blank.',
      placeholder: '[Enter NQF Level if applicable]',
      currentValue: b?.saCompliance?.nqfLevel,
    },
    {
      key: 'saCompliance.setaName',
      label: 'SETA / ETQA Name (Optional)',
      guidance: 'Relevant SETA or professional body if applicable.',
      placeholder: '[Enter SETA Name if applicable]',
      currentValue: b?.saCompliance?.setaName,
    },
    {
      key: 'saCompliance.industryLegislation',
      label: 'Applicable Legislation / Technical Standards',
      guidance: 'Verified Acts, regulations, SANS/ISO codes, or workplace SOPs.',
      placeholder: '[Enter Applicable Legislation or Technical Standards here]',
      currentValue: b?.saCompliance?.industryLegislation,
    },
  ];

  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        makeTwoColHeaderRow('Brief Field & Tag', 'Your Entry (Replace Placeholder Text)'),
        ...briefSpecs.map(spec => {
          const resolved = valOrPlaceholder(spec.currentValue, spec.placeholder);
          return makeFieldRow({
            label: spec.label,
            tag: `[brief:${spec.key}]`,
            guidance: spec.guidance,
            valueOrPlaceholder: resolved.text,
            isPlaceholder: resolved.isPlaceholder,
          });
        }),
      ],
    })
  );

  // Section B: Template-Specific Sections & Fields
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 320, after: 100 },
      children: [
        new TextRun({
          text: `Section B: ${template.name} — Specific Sections`,
          bold: true,
          size: 26,
          color: '052B66',
        }),
      ],
    })
  );

  const sortedSections = [...template.sections].sort((a, bSec) => a.order - bSec.order);
  for (const sec of sortedSections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 220, after: 60 },
        children: [
          new TextRun({
            text: `${sec.title} (${sec.required ? 'Required' : 'Optional'})`,
            bold: true,
            size: 22,
            color: '042150',
          }),
        ],
      })
    );
    if (sec.description) {
      children.push(
        new Paragraph({
          spacing: { after: 100 },
          children: [
            new TextRun({ text: sec.description, size: 19, color: '475569' }),
          ],
        })
      );
    }

    if (sec.fields.length > 0) {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            makeTwoColHeaderRow('Template Field & Tag', 'Your Entry (Replace Placeholder Text)'),
            ...sec.fields.map(fld => {
              const resolved = valOrPlaceholder(
                b?.templateFieldValues?.[fld.key],
                fld.placeholder || `[Enter ${fld.label} here]`
              );
              const guidanceParts = [
                fld.helpText || '',
                fld.options && fld.options.length > 0
                  ? `Options: ${fld.options.join(' | ')}`
                  : '',
              ].filter(Boolean);
              return makeFieldRow({
                label: `${fld.label}${fld.required ? ' *' : ' (Optional)'}`,
                tag: `[field:${fld.key}]`,
                guidance: guidanceParts.join(' · ') || undefined,
                valueOrPlaceholder: resolved.text,
                isPlaceholder: resolved.isPlaceholder,
              });
            }),
          ],
        })
      );
    }
  }

  // Section C: Optional Starter Module Outline
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 320, after: 100 },
      children: [
        new TextRun({
          text: 'Section C: Optional Starter Module Outline',
          bold: true,
          size: 26,
          color: '052B66',
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: 'Optional: If you already know the modules you want, replace the placeholders below. Leave untouched to let Stage 2 AI propose modules from your Mandatory Subject Topics.',
          size: 19,
          color: '475569',
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
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: '052B66' },
            borders: CELL_BORDERS,
            margins: CELL_MARGINS,
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: col.label, bold: true, size: 19, color: 'FFFFFF' }),
                ],
              }),
            ],
          })
      ),
    }),
  ];

  for (let i = 0; i < moduleRowCount; i++) {
    const mod = existingModules[i];
    const modTitle = mod?.title || `[Enter Module ${i + 1} Title]`;
    const modTopics =
      mod && mod.topics.length > 0
        ? mod.topics.map(t => t.title).join(', ')
        : `[Enter Module ${i + 1} topics, comma-separated]`;
    const modMins =
      mod && mod.lessons.length > 0
        ? `${mod.lessons.reduce((acc, l) => acc + (Number(l.durationMinutes) || 0), 0)} mins`
        : '[e.g. 90 mins]';

    moduleRows.push(
      new TableRow({
        children: [
          { text: `Module ${i + 1}`, width: 14, shaded: true, muted: false },
          { text: modTitle, width: 30, shaded: false, muted: !mod?.title },
          { text: modTopics, width: 40, shaded: false, muted: !(mod && mod.topics.length > 0) },
          { text: modMins, width: 16, shaded: false, muted: !(mod && mod.lessons.length > 0) },
        ].map(
          cell =>
            new TableCell({
              width: { size: cell.width, type: WidthType.PERCENTAGE },
              shading: {
                type: ShadingType.CLEAR,
                color: 'auto',
                fill: cell.shaded ? 'F1F5F9' : 'FFFFFF',
              },
              borders: CELL_BORDERS,
              margins: CELL_MARGINS,
              children: makeParagraphsFromText(cell.text, {
                muted: cell.muted,
                italic: cell.muted,
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

  // Section D: Quality Rules Reference
  if (template.qualityRules.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 320, after: 100 },
        children: [
          new TextRun({
            text: 'Section D: Template Quality Rules (Reference)',
            bold: true,
            size: 26,
            color: '052B66',
          }),
        ],
      }),
      ...template.qualityRules.map(
        rule =>
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 60 },
            children: [new TextRun({ text: rule, size: 19, color: '334155' })],
          })
      )
    );
  }

  return new Document({
    sections: [
      {
        properties: {},
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
