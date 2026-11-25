import { aiRouter } from './aiRouter.js';
import type {
  AIProvider,
  CourseBrief,
  CourseTemplate,
  CurriculumModulePlan,
} from '../../types.js';

export interface ParsedFilledTemplateResult {
  mode: 'structured' | 'ai_assisted';
  matchedTemplateId?: string;
  matchedTemplateName?: string;
  brief: Partial<CourseBrief>;
  templateFieldValues: Record<string, string>;
  suggestedModules: CurriculumModulePlan[];
  populatedCount: number;
}

function isPlaceholderValue(val: string): boolean {
  const trimmed = val.trim();
  if (!trimmed) return true;
  if (/^\[Enter\b[\s\S]*\]$/i.test(trimmed)) return true;
  if (/^\[INSERT\b/i.test(trimmed)) return true;
  if (/\[INSERT:\s*[^\]]+\]/i.test(trimmed)) return true;
  if (/^\[e\.g\.[\s\S]*\]$/i.test(trimmed)) return true;
  if (/^\{\{[\s\S]*\}\}$/.test(trimmed)) return true;
  if (/^(your entry|type here|insert here|n\/a\s*-\s*placeholder)$/i.test(trimmed)) return true;
  return false;
}

function normalizeAiMode(raw: string): 'none' | 'optional' | 'core' | undefined {
  const lower = raw.trim().toLowerCase();
  if (!lower) return undefined;
  if (lower === 'none' || lower.startsWith('none ') || lower.includes('no ai')) return 'none';
  if (
    lower === 'core' ||
    lower.startsWith('core ') ||
    lower.includes('central') ||
    lower.includes('advanced') ||
    lower.includes('ai-integrated')
  ) {
    return 'core';
  }
  if (lower === 'optional' || lower.startsWith('optional ') || lower.includes('applied') || lower.includes('awareness')) {
    return 'optional';
  }
  return undefined;
}

function extractAndParseJSON<T = any>(rawText: string): T {
  const trimmed = rawText.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    }
    throw new Error('AI returned malformed JSON while parsing filled template.');
  }
}

function parseMasterV9OfficialDocx(extractedText: string): ParsedFilledTemplateResult | null {
  const isOfficialV9 =
    /MASTER COURSE GENERATION PROMPT/i.test(extractedText) ||
    /END OF MASTER PROMPT TEMPLATE v9\.0/i.test(extractedText) ||
    /3\.1 Course Details/i.test(extractedText);

  if (!isOfficialV9) return null;

  const brief: Partial<CourseBrief> = {};
  const saCompliancePatch: Record<string, any> = {};
  const templateFieldValues: Record<string, string> = {};
  const suggestedModules: CurriculumModulePlan[] = [];

  const segments = extractedText.split(/\t\|(?:\t|$)/);

  // 1. Parse 3.1 Course Details table & 3.9 Module Overview Table via table cell segments
  if (segments.length >= 2) {
    for (let i = 0; i < segments.length - 1; i++) {
      const cellLabel = segments[i].split('\n').pop()?.trim().toLowerCase() || '';
      const cellVal = segments[i + 1].trim();

      if (!isPlaceholderValue(cellVal)) {
        if (cellLabel === 'course name') brief.title = cellVal;
        else if (cellLabel === 'course code / id') brief.code = cellVal;
        else if (cellLabel === 'industry / domain') brief.industryDomain = cellVal;
        else if (cellLabel === 'target role group') {
          brief.targetJobRoles = cellVal;
          if (!brief.targetAudience) brief.targetAudience = cellVal;
        } else if (cellLabel === 'ai integration level') {
          const mode = normalizeAiMode(cellVal);
          if (mode) brief.aiIntegrationMode = mode;
          brief.aiIntegrationRequirements = cellVal;
        } else if (cellLabel.startsWith('accreditation / qualification')) {
          templateFieldValues.accreditationAlignmentNotes = cellVal;
        } else if (cellLabel === 'language(s)') brief.language = cellVal;
        else if (cellLabel === 'estimated duration') brief.estimatedDuration = cellVal;
      }
    }

    // Parse 3.9 Module Overview Table rows: "1\t|\tTitle\t|\tPurpose\t|\tKey Skills\t|\t"
    for (let i = 0; i < segments.length - 3; i++) {
      const firstCellTail = segments[i].split('\n').pop()?.trim() || '';
      const rowMatch = firstCellTail.match(/^(\d+)(?:\s*\(optional\))?$/i);
      if (!rowMatch) continue;

      const order = Number(rowMatch[1]);
      if (order < 1 || order > 12) continue;

      const modTitle = (segments[i + 1] || '').trim();
      const modPurpose = (segments[i + 2] || '').trim();
      const modSkills = (segments[i + 3] || '').trim();

      if (isPlaceholderValue(modTitle)) continue;

      const topicList = isPlaceholderValue(modSkills)
        ? []
        : modSkills
            .split(/[\n,;]+/)
            .map(s => s.trim())
            .filter(Boolean);

      suggestedModules.push({
        id: `mod-v9-${order}-${Date.now()}`,
        order,
        title: modTitle,
        qctoModuleType: 'Standard Module',
        purpose: isPlaceholderValue(modPurpose) ? `Module ${order}: ${modTitle}` : modPurpose,
        objectives: [],
        competencies: topicList,
        topics: topicList.map((t, idx) => ({
          id: `top-v9-${order}-${idx + 1}`,
          title: t,
          subtopics: [],
        })),
        lessons:
          topicList.length > 0
            ? topicList.map((t, lIdx) => ({
                id: `les-v9-${order}-${lIdx + 1}`,
                title: t,
                durationMinutes: 45,
                purpose: `Develop practical capability in ${t}.`,
                keyTerms: [],
              }))
            : [
                {
                  id: `les-v9-${order}-1`,
                  title: `${modTitle} — Core Concepts & Application`,
                  durationMinutes: 60,
                  purpose: isPlaceholderValue(modPurpose) ? `Core content for ${modTitle}.` : modPurpose,
                  keyTerms: [],
                },
              ],
      });
    }
  }

  // 2. Parse prompt-label -> following non-empty text blocks across sections 1–7
  const lines = extractedText
    .split('\n')
    .map(l => l.replace(/\t\|(?:\t|$)/g, ' ').trim());

  const captureNextBlock = (
    triggerPattern: RegExp,
    stopPatterns: RegExp[] = []
  ): string => {
    for (let i = 0; i < lines.length; i++) {
      if (!triggerPattern.test(lines[i])) continue;
      const collected: string[] = [];
      for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
        const line = lines[j];
        if (!line) {
          if (collected.length > 0) break;
          continue;
        }
        if (
          /^(?:\d+\.\d+(?:\.\d+)?|MODULE\s+\d+:|\d+\.\s+[A-Z]|HOW TO USE|FINAL EXECUTION|GLOBAL RULE|Example \(|Financial Literacy Example)/i.test(
            line
          )
        ) {
          break;
        }
        if (stopPatterns.some(p => p.test(line))) break;
        // Stop if we hit the next prompt label ending with colon
        if (/^[A-Za-z0-9 ,/'—–()-]{6,75}:$/.test(line) && collected.length > 0) break;
        collected.push(line);
      }
      const joined = collected.join('\n').trim();
      if (joined && !isPlaceholderValue(joined)) {
        return joined;
      }
    }
    return '';
  };

  if (!brief.title) {
    const cmdTitle = captureNextBlock(
      /^Generate a complete, structured, industry-ready training programme for:$/i,
      [/^Ensure the course aligns/i]
    );
    if (cmdTitle) brief.title = cmdTitle;
  }

  const probStmt = captureNextBlock(/^Complete the following statement:$/i, [
    /^Example \(Financial Literacy/i,
  ]);
  if (probStmt) {
    templateFieldValues.problemStatement = probStmt;
    if (!brief.workplaceProblem) brief.workplaceProblem = probStmt;
  }

  const fieldMatchers: Array<{
    trigger: RegExp;
    assign: (val: string) => void;
    stops?: RegExp[];
  }> = [
    {
      trigger: /^Root causes of the problem:$/i,
      assign: v => {
        templateFieldValues.rootCauses = v;
      },
    },
    {
      trigger: /^Process or system failures involved:$/i,
      assign: v => {
        templateFieldValues.processFailures = v;
      },
    },
    {
      trigger: /^Skills or knowledge gaps:$/i,
      assign: v => {
        templateFieldValues.skillKnowledgeGaps = v;
      },
    },
    {
      trigger: /^Organisational or environmental constraints:$/i,
      assign: v => {
        templateFieldValues.organisationalConstraints = v;
      },
    },
    {
      trigger: /^AI literacy gap/i,
      assign: v => {
        templateFieldValues.aiLiteracyGap = v;
      },
    },
    {
      trigger: /^Data and digital readiness/i,
      assign: v => {
        templateFieldValues.digitalReadinessLevel = v;
      },
    },
    {
      trigger: /^Ethical or compliance risks introduced by AI/i,
      assign: v => {
        templateFieldValues.aiEthicsComplianceRisk = v;
      },
    },
    {
      trigger: /^2\.1 Reference Links/i,
      assign: v => {
        templateFieldValues.referenceLinks = v;
      },
    },
    {
      trigger: /^Specify the regulatory or standards framework applicable to this course:$/i,
      assign: v => {
        templateFieldValues.evidenceStandard = v;
        saCompliancePatch.industryLegislation = v;
        saCompliancePatch.enabled = true;
      },
    },
    {
      trigger: /^AI tools or platforms used in this domain:$/i,
      assign: v => {
        templateFieldValues.aiToolsPlatforms = v;
      },
    },
    {
      trigger: /^Relevant AI ethics framework:$/i,
      assign: v => {
        templateFieldValues.aiEthicsFramework = v;
      },
    },
    {
      trigger: /^Industry case studies or use cases:$/i,
      assign: v => {
        templateFieldValues.industryCaseStudies = v;
      },
    },
    {
      trigger: /^Purpose of the course:$/i,
      assign: v => {
        brief.purpose = v;
      },
    },
    {
      trigger: /^Workplace relevance:$/i,
      assign: v => {
        brief.workplaceProblem = v;
      },
    },
    {
      trigger: /^Expected performance improvement:$/i,
      assign: v => {
        brief.learningRequirements = v;
      },
    },
    {
      trigger: /^AI or technology angle of this course:$/i,
      assign: v => {
        templateFieldValues.aiTechAngle = v;
      },
    },
    {
      trigger: /^What the course covers:$/i,
      assign: v => {
        brief.subjectTopicsInput = v;
      },
    },
    {
      trigger: /^Job roles:$/i,
      assign: v => {
        brief.targetJobRoles = v;
        if (!brief.targetAudience) brief.targetAudience = v;
      },
    },
    {
      trigger: /^Departments:$/i,
      assign: v => {
        templateFieldValues.targetDepartments = v;
      },
    },
    {
      trigger: /^Experience level:$/i,
      assign: v => {
        brief.experienceLevel = v;
      },
    },
    {
      trigger: /^Required knowledge:$/i,
      assign: v => {
        brief.prerequisites = v;
      },
    },
    {
      trigger: /^Reading level appropriate for target audience:$/i,
      assign: v => {
        templateFieldValues.toneAndReadingLevel = v;
      },
    },
    {
      trigger: /^Accreditation \/ Standards Body:$/i,
      assign: v => {
        saCompliancePatch.setaName = v;
        saCompliancePatch.enabled = true;
      },
    },
    {
      trigger: /^NQF Level:$/i,
      assign: v => {
        saCompliancePatch.nqfLevel = v;
        saCompliancePatch.enabled = true;
      },
    },
    {
      trigger: /^Accreditation \/ Standards Requirements:$/i,
      assign: v => {
        saCompliancePatch.saqaNotes = v;
        saCompliancePatch.enabled = true;
      },
    },
  ];

  for (const matcher of fieldMatchers) {
    const extracted = captureNextBlock(matcher.trigger, matcher.stops);
    if (extracted) {
      matcher.assign(extracted);
    }
  }

  if (Object.keys(saCompliancePatch).length > 0) {
    brief.saCompliance = saCompliancePatch as any;
  }

  const populatedCount =
    Object.keys(brief).filter(k => k !== 'saCompliance').length +
    Object.keys(saCompliancePatch).length +
    Object.keys(templateFieldValues).length;

  return {
    mode: 'structured',
    matchedTemplateId: 'tpl-estudy-master-v9',
    matchedTemplateName: 'eStudy Master Course Generation Template v9.0',
    brief,
    templateFieldValues,
    suggestedModules,
    populatedCount,
  };
}

/**
 * Deterministically parses `.docx` files downloaded from Template Studio / CreateCourseModal / Stage 1.
 * Supports both the official 9-section Master v9.0 Word layout and standard 2-column tagged templates.
 */
export function parseFilledTemplateTextDeterministically(
  extractedText: string,
  template?: CourseTemplate
): ParsedFilledTemplateResult {
  const masterV9Result = parseMasterV9OfficialDocx(extractedText);
  if (masterV9Result) {
    return masterV9Result;
  }

  const brief: Partial<CourseBrief> = {};
  const saCompliancePatch: Record<string, any> = {};
  const templateFieldValues: Record<string, string> = {};
  const suggestedModules: CurriculumModulePlan[] = [];
  let matchedTemplateId: string | undefined;
  let matchedTemplateName: string | undefined;

  const setBriefKey = (key: string, rawVal: string) => {
    const val = rawVal.trim();
    if (isPlaceholderValue(val)) return;

    if (key.startsWith('saCompliance.')) {
      const subKey = key.slice('saCompliance.'.length);
      if (
        subKey === 'enabled' ||
        subKey === 'saqaRelevant' ||
        subKey === 'qctoRelevant' ||
        subKey === 'qctoModulePattern' ||
        subKey === 'popiaRelevant'
      ) {
        saCompliancePatch[subKey] = /^(yes|true|1|enabled)/i.test(val);
      } else {
        saCompliancePatch[subKey] = val;
        if (val) saCompliancePatch.enabled = true;
      }
      return;
    }

    if (key === 'aiIntegrationMode') {
      const normalized = normalizeAiMode(val);
      if (normalized) brief.aiIntegrationMode = normalized;
      return;
    }

    (brief as any)[key] = val;
  };

  // 1. Parse cell-delimited Word table rows: "... [tag:key] ...\t|\t<VALUE>\t|\t"
  const segments = extractedText.split(/\t\|(?:\t|$)/);
  if (segments.length >= 2) {
    for (let i = 0; i < segments.length - 1; i++) {
      const labelCell = segments[i];
      const valueCell = segments[i + 1].trim();

      const metaMatch = labelCell.match(/(?:^|\n)\s*\[meta:([a-zA-Z0-9_.-]+)\]\s*(?:\n|$)/);
      if (metaMatch) {
        const metaKey = metaMatch[1];
        if (!isPlaceholderValue(valueCell)) {
          if (metaKey === 'templateId') matchedTemplateId = valueCell;
          if (metaKey === 'templateName') matchedTemplateName = valueCell;
        }
        continue;
      }

      const briefMatch = labelCell.match(/(?:^|\n)\s*\[brief:([a-zA-Z0-9_.-]+)\]\s*(?:\n|$)/);
      if (briefMatch) {
        setBriefKey(briefMatch[1], valueCell);
        continue;
      }

      const fieldMatch = labelCell.match(/(?:^|\n)\s*\[field:([a-zA-Z0-9_.-]+)\]\s*(?:\n|$)/);
      if (fieldMatch) {
        if (!isPlaceholderValue(valueCell)) {
          templateFieldValues[fieldMatch[1]] = valueCell;
        }
        continue;
      }
    }

    // Parse Section C Module Outline table rows
    for (let i = 0; i < segments.length - 2; i++) {
      const firstCellTail = segments[i].split('\n').pop()?.trim() || '';
      const modNumMatch = firstCellTail.match(/^Module\s+(\d+)$/i);
      if (!modNumMatch) continue;

      const order = Number(modNumMatch[1]) || suggestedModules.length + 1;
      const modTitle = (segments[i + 1] || '').trim();
      const modTopicsRaw = (segments[i + 2] || '').trim();
      const modDurationRaw = (segments[i + 3] || '').trim();

      if (isPlaceholderValue(modTitle)) continue;

      const topicList = isPlaceholderValue(modTopicsRaw)
        ? []
        : modTopicsRaw
            .split(/[\n,;]+/)
            .map(s => s.trim())
            .filter(Boolean);

      const minsMatch = modDurationRaw.match(/(\d+)\s*(min|hour|hr)/i);
      let durationMinutes = 60;
      if (minsMatch) {
        const n = Number(minsMatch[1]) || 60;
        durationMinutes = minsMatch[2].toLowerCase().startsWith('h') ? n * 60 : n;
      }

      suggestedModules.push({
        id: `mod-doc-${order}-${Date.now()}`,
        order,
        title: modTitle,
        qctoModuleType: 'Standard Module',
        purpose:
          topicList.length > 0 ? `Cover ${topicList.join(', ')}` : `Module ${order}: ${modTitle}`,
        objectives: [],
        competencies: [],
        topics: topicList.map((t, tIdx) => ({
          id: `top-doc-${order}-${tIdx + 1}`,
          title: t,
          subtopics: [],
        })),
        lessons:
          topicList.length > 0
            ? topicList.map((t, lIdx) => ({
                id: `les-doc-${order}-${lIdx + 1}`,
                title: t,
                durationMinutes: Math.max(15, Math.round(durationMinutes / topicList.length)),
                purpose: `Develop practical understanding and workplace capability in ${t}.`,
                keyTerms: [],
              }))
            : [
                {
                  id: `les-doc-${order}-1`,
                  title: `${modTitle} — Core Concepts & Application`,
                  durationMinutes,
                  purpose: `Core instruction for ${modTitle}.`,
                  keyTerms: [],
                },
              ],
      });
    }
  }

  // 2. Fallback label-based extraction if author removed [brief:...] tags or pasted text
  if (Object.keys(brief).length < 2) {
    const labelMap: Array<{ pattern: RegExp; key: string }> = [
      { pattern: /^(?:Course Title|Programme Title)\s*[*:]?\s*[:\-–]\s*(.+)$/i, key: 'title' },
      { pattern: /^(?:Course Code(?:\s*\/\s*ID)?)\s*[*:]?\s*[:\-–]\s*(.+)$/i, key: 'code' },
      { pattern: /^(?:Industry(?:\s*\/\s*Subject)? Domain)\s*[*:]?\s*[:\-–]\s*(.+)$/i, key: 'industryDomain' },
      { pattern: /^(?:Target Audience)\s*[*:]?\s*[:\-–]\s*(.+)$/i, key: 'targetAudience' },
      { pattern: /^(?:Target Job Roles)\s*[*:]?\s*[:\-–]\s*(.+)$/i, key: 'targetJobRoles' },
      { pattern: /^(?:Experience Level)\s*[*:]?\s*[:\-–]\s*(.+)$/i, key: 'experienceLevel' },
      { pattern: /^(?:Prerequisites)\s*[*:]?\s*[:\-–]\s*(.+)$/i, key: 'prerequisites' },
      { pattern: /^(?:Estimated Duration|Duration)\s*[*:]?\s*[:\-–]\s*(.+)$/i, key: 'estimatedDuration' },
      { pattern: /^(?:Delivery Language|Language)\s*[*:]?\s*[:\-–]\s*(.+)$/i, key: 'language' },
      { pattern: /^(?:Course Purpose(?: & Workplace Capability Goal)?)\s*[*:]?\s*[:\-–]\s*(.+)$/i, key: 'purpose' },
      { pattern: /^(?:Workplace Problem(?: \/ Operational Need)?)\s*[*:]?\s*[:\-–]\s*(.+)$/i, key: 'workplaceProblem' },
    ];

    for (const line of extractedText.split('\n')) {
      if (line.includes('\t|')) continue;
      const clean = line.trim();
      for (const rule of labelMap) {
        const m = clean.match(rule.pattern);
        if (m && m[1] && !(brief as any)[rule.key]) {
          setBriefKey(rule.key, m[1]);
        }
      }
    }
  }

  if (Object.keys(saCompliancePatch).length > 0) {
    brief.saCompliance = saCompliancePatch as any;
  }

  const hasFieldTags = /\[field:[a-zA-Z0-9_.-]+\]/.test(extractedText);
  if (template && !hasFieldTags && Object.keys(templateFieldValues).length === 0 && segments.length >= 2) {
    const allFields = template.sections.flatMap(s => s.fields);
    for (let i = 0; i < segments.length - 1; i++) {
      const labelLine = (segments[i].split('\n')[0] || '').replace(/\s*\*$/, '').trim().toLowerCase();
      const valueCell = segments[i + 1].trim();
      if (
        !labelLine ||
        labelLine.startsWith('[') ||
        isPlaceholderValue(valueCell) ||
        /\[(brief|field|meta):/i.test(valueCell) ||
        /^Your Input\b/i.test(valueCell) ||
        /^END OF\b/i.test(valueCell)
      ) {
        continue;
      }
      for (const fld of allFields) {
        const fldNorm = fld.label.replace(/\s*\*$/, '').trim().toLowerCase();
        if (!templateFieldValues[fld.key] && (labelLine === fldNorm || labelLine.startsWith(fldNorm))) {
          templateFieldValues[fld.key] = valueCell;
        }
      }
    }
  }

  const populatedCount =
    Object.keys(brief).filter(k => k !== 'saCompliance').length +
    Object.keys(saCompliancePatch).length +
    Object.keys(templateFieldValues).length;

  return {
    mode: 'structured',
    matchedTemplateId,
    matchedTemplateName,
    brief,
    templateFieldValues,
    suggestedModules,
    populatedCount,
  };
}

/**
 * AI-assisted fallback when user uploads a freeform/heavily modified Word, PDF, or text brief.
 */
export async function parseFilledCourseBriefWithAI(params: {
  fileName: string;
  extractedText: string;
  template?: CourseTemplate;
  provider?: AIProvider;
  model?: string;
}): Promise<ParsedFilledTemplateResult> {
  const templateFields = (params.template?.sections || []).flatMap(sec =>
    sec.fields.map(f => ({
      key: f.key,
      label: f.label,
      helpText: f.helpText || '',
    }))
  );

  const res = await aiRouter.execute({
    provider: params.provider,
    model: params.model,
    responseFormat: 'json',
    systemInstruction: `You extract filled course brief information from an uploaded Word/PDF/text template into structured eStudy V2 CourseBrief JSON.
RULES:
1. Extract ONLY what the author wrote in the document. Ignore untouched [INSERT: ...] placeholders and benchmark Financial Literacy example text. Do NOT invent facts or codes. Leave missing fields as "".
2. Put template-specific answers into "templateFieldValues" keyed by the matching field key from TEMPLATE FIELDS.
3. If the document includes a module outline (e.g. 3.9 Module Overview Table), extract starter modules in "suggestedModules". Otherwise return [].
4. Return ONLY valid JSON.`,
    prompt: `FILE: ${params.fileName}
TEMPLATE: ${params.template?.name || 'eStudy Master Course Generation Template v9.0'}
TEMPLATE FIELDS:
${JSON.stringify(templateFields, null, 2)}

DOCUMENT TEXT:
${params.extractedText.slice(0, 16000)}

Return JSON:
{
  "brief": {
    "title": "",
    "code": "",
    "industryDomain": "",
    "purpose": "",
    "workplaceProblem": "",
    "targetAudience": "",
    "targetJobRoles": "",
    "experienceLevel": "Intermediate",
    "prerequisites": "",
    "estimatedDuration": "",
    "language": "English (South African Context)",
    "learningRequirements": "",
    "subjectTopicsInput": "",
    "aiIntegrationMode": "optional",
    "aiIntegrationRequirements": ""
  },
  "templateFieldValues": {},
  "suggestedModules": [
    {
      "id": "mod-1",
      "order": 1,
      "title": "Module Title",
      "qctoModuleType": "Standard Module",
      "purpose": "Module purpose",
      "objectives": [],
      "competencies": [],
      "topics": [{ "id": "top-1", "title": "Topic 1", "subtopics": [] }],
      "lessons": [{ "id": "les-1", "title": "Lesson 1", "durationMinutes": 45, "purpose": "Lesson purpose", "keyTerms": [] }]
    }
  ]
}`,
  });

  const parsed = extractAndParseJSON<any>(res.text);
  const cleanBrief: Partial<CourseBrief> = {};
  for (const [k, v] of Object.entries(parsed?.brief || {})) {
    if (typeof v === 'string' && v.trim() && !isPlaceholderValue(v)) {
      (cleanBrief as any)[k] = v.trim();
    }
  }
  const cleanFieldValues: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed?.templateFieldValues || {})) {
    if (typeof v === 'string' && v.trim() && !isPlaceholderValue(v)) {
      cleanFieldValues[k] = v.trim();
    }
  }
  const suggestedModules: CurriculumModulePlan[] = Array.isArray(parsed?.suggestedModules)
    ? parsed.suggestedModules
    : [];

  return {
    mode: 'ai_assisted',
    matchedTemplateId: params.template?.id,
    matchedTemplateName: params.template?.name,
    brief: cleanBrief,
    templateFieldValues: cleanFieldValues,
    suggestedModules,
    populatedCount: Object.keys(cleanBrief).length + Object.keys(cleanFieldValues).length,
  };
}
