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
  if (/^\{\{[\s\S]*\}\}$/.test(trimmed)) return true;
  if (/^(your entry|type here|insert here|n\/a\s*-\s*placeholder)$/i.test(trimmed)) return true;
  return false;
}

function normalizeAiMode(raw: string): 'none' | 'optional' | 'core' | undefined {
  const lower = raw.trim().toLowerCase();
  if (!lower) return undefined;
  if (lower === 'none' || lower.startsWith('none ') || lower.includes('no ai')) return 'none';
  if (lower === 'core' || lower.startsWith('core ') || lower.includes('central')) return 'core';
  if (lower === 'optional' || lower.startsWith('optional ')) return 'optional';
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

/**
 * Deterministically parses `.docx` files downloaded from Template Studio / CreateCourseModal / Stage 1.
 * Handles both table-cell-delimited text (`\t|\t` from `extractTextFromDocxBuffer`) and pasted plain text.
 */
export function parseFilledTemplateTextDeterministically(
  extractedText: string,
  template?: CourseTemplate
): ParsedFilledTemplateResult {
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
      if (subKey === 'enabled' || subKey === 'saqaRelevant' || subKey === 'qctoRelevant' || subKey === 'qctoModulePattern' || subKey === 'popiaRelevant') {
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
  // We split text by "\t|\t" segments and inspect pairs where segment[i] contains a marker
  const segments = extractedText.split(/\t\|(?:\t|$)/);
  if (segments.length >= 2) {
    for (let i = 0; i < segments.length - 1; i++) {
      const labelCell = segments[i];
      const valueCell = segments[i + 1].trim();

      const metaMatch = labelCell.match(/\[meta:([a-zA-Z0-9_.-]+)\]/);
      if (metaMatch) {
        const metaKey = metaMatch[1];
        if (!isPlaceholderValue(valueCell)) {
          if (metaKey === 'templateId') matchedTemplateId = valueCell;
          if (metaKey === 'templateName') matchedTemplateName = valueCell;
        }
        continue;
      }

      const briefMatch = labelCell.match(/\[brief:([a-zA-Z0-9_.-]+)\]/);
      if (briefMatch) {
        setBriefKey(briefMatch[1], valueCell);
        continue;
      }

      const fieldMatch = labelCell.match(/\[field:([a-zA-Z0-9_.-]+)\]/);
      if (fieldMatch) {
        if (!isPlaceholderValue(valueCell)) {
          templateFieldValues[fieldMatch[1]] = valueCell;
        }
        continue;
      }
    }

    // Parse Section C Module Outline table rows:
    // "Module 1\t|\tTitle\t|\tTopic1, Topic2\t|\t90 mins\t|\t"
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
        purpose: topicList.length > 0 ? `Cover ${topicList.join(', ')}` : `Module ${order}: ${modTitle}`,
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
      const clean = line.replace(/\t\|\t/g, ': ').trim();
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

  // If template provided, also verify any direct label matches for template fields
  if (template && Object.keys(templateFieldValues).length === 0 && segments.length >= 2) {
    const allFields = template.sections.flatMap(s => s.fields);
    for (let i = 0; i < segments.length - 1; i++) {
      const labelCell = segments[i].toLowerCase();
      const valueCell = segments[i + 1].trim();
      if (isPlaceholderValue(valueCell)) continue;
      for (const fld of allFields) {
        if (!templateFieldValues[fld.key] && labelCell.includes(fld.label.toLowerCase())) {
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
 * AI-assisted fallback when user uploads a freeform/heavily modified Word, PDF, or text brief
 * without our `[brief:...]` / `[field:...]` markers.
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
1. Extract ONLY what the author wrote in the document. Do NOT invent or fabricate facts, codes, or topics that are not in the document. Leave missing fields as empty string "".
2. Put template-specific answers into "templateFieldValues" keyed by the matching field key from TEMPLATE FIELDS.
3. If the document includes a module outline, extract starter modules in "suggestedModules". Otherwise return [].
4. Return ONLY valid JSON.`,
    prompt: `FILE: ${params.fileName}
TEMPLATE: ${params.template?.name || 'eStudy Master Course Generation Template'}
TEMPLATE FIELDS:
${JSON.stringify(templateFields, null, 2)}

DOCUMENT TEXT:
${params.extractedText.slice(0, 14000)}

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
