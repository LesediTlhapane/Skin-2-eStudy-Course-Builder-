import type {
  AIProvider,
  AssessmentItem,
  BriefAnalysisResult,
  CourseBrief,
  CourseProject,
  CourseTemplate,
  CurriculumArchitecture,
  CurriculumModulePlan,
  GeneratedLessonContent,
  GeneratedModuleContent,
  ImproveCourseDiagnosis,
  LearningOutcomesPlan,
  SelectedTextContext,
  SourceConflict,
  SourceDocument,
} from '../../types.js';
import { aiRouter, extractAndParseJSON } from './aiRouter.js';

function summarizeSourcesForPrompt(sources: SourceDocument[]): string {
  if (!sources || sources.length === 0) return 'No external source documents uploaded.';
  const perSourceBudget = Math.max(500, Math.floor(3200 / Math.max(1, sources.length)));
  return sources
    .slice(0, 6)
    .map(
      (s, i) =>
        `[Source ${i + 1}: ${s.title} | Org/Author: ${s.authorOrOrganisation || 'Unknown'} | Status: ${s.verificationStatus} | Ref: ${s.referenceOrUrl || s.fileName || 'N/A'}]\nExcerpt:\n${(s.extractedText || s.summary || '').slice(0, perSourceBudget)}`
    )
    .join('\n\n---\n\n');
}

/* ============================================================================
 * 1. ANALYSE SOURCE DOCUMENT & DETECT CONFLICTS
 * ============================================================================ */
export async function analyseSourceDocumentWithAI(params: {
  fileName: string;
  extractedText: string;
  existingSources?: SourceDocument[];
  provider?: AIProvider;
  model?: string;
}): Promise<{
  metadata: {
    title: string;
    authorOrOrganisation: string;
    publicationDate: string;
    version: string;
    referenceOrUrl: string;
    summary: string;
    keyTopics: string[];
    relevantSections: string[];
    verificationStatus: 'VERIFIED' | 'NEEDS REVIEW' | 'UNSUPPORTED';
  };
  briefSuggestions: Partial<CourseBrief>;
  detectedConflicts: Array<{
    topic: string;
    existingSourceId: string;
    existingSourceTitle: string;
    existingClaim: string;
    newClaim: string;
  }>;
}> {
  const existingSummary = (params.existingSources || [])
    .slice(0, 6)
    .map(s => ({
      id: s.id,
      title: s.title,
      summary: s.summary || s.extractedText.slice(0, 800),
    }));

  const res = await aiRouter.execute({
    provider: params.provider,
    model: params.model,
    responseFormat: 'json',
    systemInstruction: `You are an instructional design source analyst for eStudy South Africa.
Analyse the uploaded source text strictly from its contents.
NEVER fabricate publication dates, authors, accreditation codes, or legislation not present in the text.
If metadata is missing in the document, return "To Be Confirmed".
Return ONLY valid JSON.`,
    prompt: `Analyse uploaded document "${params.fileName}".
DOCUMENT TEXT (truncated to 14000 chars):
${params.extractedText.slice(0, 14000)}

EXISTING PROJECT SOURCES (check for factual or policy contradictions):
${JSON.stringify(existingSummary)}

Return JSON with this exact shape:
{
  "metadata": {
    "title": "Document title from text or file name",
    "authorOrOrganisation": "Author/organisation or To Be Confirmed",
    "publicationDate": "Year/date or To Be Confirmed",
    "version": "Version or To Be Confirmed",
    "referenceOrUrl": "Document ID/URL or file name",
    "summary": "Concise 2-4 sentence factual summary",
    "keyTopics": ["Topic 1", "Topic 2"],
    "relevantSections": ["Course Brief", "Module Topics"],
    "verificationStatus": "NEEDS REVIEW"
  },
  "briefSuggestions": {
    "title": "Course title ONLY if explicitly a course specification, else empty string",
    "industryDomain": "Subject domain if evident",
    "purpose": "Suggested course purpose grounded in document",
    "targetAudience": "Target learners if evident",
    "subjectTopicsInput": "Newline-separated list of key topics extracted from the document"
  },
  "detectedConflicts": [
    {
      "topic": "Contradictory requirement or figure",
      "existingSourceId": "id from EXISTING PROJECT SOURCES",
      "existingSourceTitle": "title",
      "existingClaim": "claim in existing source",
      "newClaim": "conflicting claim in this document"
    }
  ]
}`,
  });

  return extractAndParseJSON(res.text);
}

/* ============================================================================
 * 2. MODE 3: DIAGNOSE EXISTING COURSE BEFORE MODIFYING
 * ============================================================================ */
export async function diagnoseExistingCourseWithAI(params: {
  fileName: string;
  extractedText: string;
  provider?: AIProvider;
  model?: string;
}): Promise<{
  diagnosis: ImproveCourseDiagnosis;
  extractedBrief: Partial<CourseBrief>;
  extractedModules: CurriculumModulePlan[];
}> {
  const res = await aiRouter.execute({
    provider: params.provider,
    model: params.model,
    responseFormat: 'json',
    systemInstruction: `You are a senior instructional designer auditing an existing course for eStudy South Africa.
CRITICAL PRESERVATION RULE:
1. Identify the existing course's approved structure, topics, and strengths to PRESERVE.
2. Identify genuine instructional-design weaknesses (e.g., vague outcomes, missing practical assessments, alignment gaps, outdated references, repetition) and propose clear improvements.
3. Do NOT invent accreditation or regulatory details. Mark missing details as "To Be Confirmed".
Return ONLY valid JSON.`,
    prompt: `Audit this existing course document ("${params.fileName}") before any edits are made:
${params.extractedText.slice(0, 15000)}

Return JSON:
{
  "diagnosis": {
    "analysedAt": "${new Date().toISOString()}",
    "originalSummary": "Concise summary of the existing course scope and structure",
    "preservedElements": ["Approved topic/module/strength 1 to keep intact", "Strength 2"],
    "recommendations": [
      {
        "id": "rec-1",
        "area": "Learning Outcomes | Curriculum Coverage | Assessments | Content Depth | Compliance",
        "severity": "high",
        "weakness": "Specific gap identified in the uploaded course",
        "recommendation": "Actionable improvement proposal",
        "preserveExistingNote": "What existing content will remain untouched",
        "decision": "pending"
      }
    ]
  },
  "extractedBrief": {
    "title": "Exact existing course title or file-derived title",
    "code": "Existing course code or To Be Confirmed",
    "industryDomain": "Domain",
    "purpose": "Existing purpose",
    "workplaceProblem": "Workplace problem addressed",
    "targetAudience": "Target audience",
    "targetJobRoles": "Target job roles",
    "estimatedDuration": "Duration or To Be Confirmed",
    "subjectTopicsInput": "Newline-separated list of existing topics"
  },
  "extractedModules": [
    {
      "id": "mod-1",
      "order": 1,
      "title": "Existing module title",
      "qctoModuleType": "Standard Module",
      "purpose": "Module purpose",
      "objectives": ["Existing or inferred objective"],
      "competencies": ["Competency 1"],
      "topics": [{ "id": "top-1", "title": "Topic", "subtopics": ["Subtopic"] }],
      "lessons": [{ "id": "les-1", "title": "Lesson", "durationMinutes": 30, "purpose": "Lesson purpose", "keyTerms": ["Term"] }]
    }
  ]
}`,
  });

  return extractAndParseJSON(res.text);
}

/* ============================================================================
 * 3. STAGE 1: ANALYSE COURSE BRIEF (METADATA PROTECTION)
 * ============================================================================ */
export async function analyseCourseBriefWithAI(params: {
  brief: CourseBrief;
  sources: SourceDocument[];
  provider?: AIProvider;
  model?: string;
}): Promise<BriefAnalysisResult> {
  const res = await aiRouter.execute({
    provider: params.provider,
    model: params.model,
    responseFormat: 'json',
    systemInstruction: `You are an instructional design reviewer auditing a Stage 1 Course Brief.
STRICT RULES:
- Treat supplied metadata (title, code, duration, target audience, accreditation) as protected. NEVER alter or invent values.
- Flag missing essential items with recommendedStatus "to_be_confirmed" or "requires_sme_validation".
- Identify any contradictions between the brief fields (e.g., duration vs depth, prerequisites vs experience level, AI disabled vs AI requirements, or source conflicts).
- Extract a clean list of explicit subject topics from the brief and sources for Stage 2 curriculum coverage checking.
Return ONLY valid JSON.`,
    prompt: `Audit this Stage 1 Course Brief:
${JSON.stringify(params.brief, null, 2)}

Uploaded Sources:
${summarizeSourcesForPrompt(params.sources)}

Return JSON:
{
  "analysedAt": "${new Date().toISOString()}",
  "summary": "Clear summary for developer review and approval",
  "missingInformation": [
    {
      "field": "fieldName or human label",
      "recommendedStatus": "to_be_confirmed",
      "reason": "Why this needs confirmation before or during development"
    }
  ],
  "contradictions": ["Any contradiction detected, or empty array if none"],
  "recommendedClarifications": ["Actionable clarification question for SME/stakeholder"],
  "extractedTopics": ["Explicit subject topic 1", "Explicit subject topic 2"]
}`,
  });

  return extractAndParseJSON(res.text);
}

/* ============================================================================
 * 4. STAGE 2: PROPOSE CURRICULUM ARCHITECTURE & COVERAGE CHECKER
 * ============================================================================ */
export async function proposeCurriculumWithAI(params: {
  brief: CourseBrief;
  sources: SourceDocument[];
  desiredModuleCount?: number;
  existingModules?: CurriculumModulePlan[];
  provider?: AIProvider;
  model?: string;
}): Promise<CurriculumArchitecture> {
  const rawTopics = [
    ...(params.brief.subjectTopicsInput || '')
      .split(/\n|;/)
      .map(s => s.trim())
      .filter(Boolean),
    ...(params.brief.analysis?.extractedTopics || []),
  ];
  const uniqueTopics = Array.from(new Set(rawTopics));

  const res = await aiRouter.execute({
    provider: params.provider,
    model: params.model,
    responseFormat: 'json',
    systemInstruction: `You are a Principal Curriculum Architect for eStudy South Africa.
CRITICAL CURRICULUM PRESERVATION & DURATION RULES:
1. Every subject topic supplied in the brief and sources is AUTHORITATIVE. NEVER silently omit, replace, or over-generalise required subject matter.
2. Do NOT force every course into 3 modules or a generic AI/SOP structure. Adapt module count, titles, and sequencing to the actual subject, declared duration (${params.brief.estimatedDuration || 'unspecified'}), and learner level (${params.brief.experienceLevel}).
3. Reconcile total lesson durationMinutes across all modules PLUS estimated assessment time so the sum aligns cleanly with the declared course duration (${params.brief.estimatedDuration || 'unspecified'}). Explicitly explain this time budget in rationale.
4. If AI integration mode is "none", do NOT inject AI modules or AI topics.
5. If QCTO module pattern is enabled (${params.brief.saCompliance?.qctoModulePattern ? 'YES' : 'NO'}), tag modules appropriately as "Knowledge Module", "Practical Skill Module", or "Work Experience Module"; otherwise use "Standard Module".
6. Build an exhaustive coverageChecks array comparing EVERY supplied topic against your proposed curriculum (status: "mapped", "omitted", "generalised", "clarification_needed", or "recommended").
Return ONLY valid JSON.`,
    prompt: `Design the Stage 2 Curriculum Architecture for:
Title: ${params.brief.title || 'Untitled Course'}
Code: ${params.brief.code || 'To Be Confirmed'}
Domain: ${params.brief.industryDomain}
Purpose: ${params.brief.purpose}
Workplace Problem: ${params.brief.workplaceProblem}
Target Audience / Roles: ${params.brief.targetAudience} (${params.brief.targetJobRoles})
Experience Level: ${params.brief.experienceLevel}
Duration: ${params.brief.estimatedDuration || 'To Be Confirmed'}
AI Integration Mode: ${params.brief.aiIntegrationMode} (${params.brief.aiIntegrationRequirements || 'None'})
Learning Requirements: ${params.brief.learningRequirements}
SA Compliance: ${JSON.stringify(params.brief.saCompliance)}
Requested Module Count: ${params.desiredModuleCount || 'Choose optimal count for scope & duration (typically 3-6)'}

EXPLICIT SUPPLIED TOPICS TO PRESERVE:
${JSON.stringify(uniqueTopics)}

EXISTING MODULES TO RESPECT/PRESERVE IF ANY:
${JSON.stringify(params.existingModules || [])}

SOURCES:
${summarizeSourcesForPrompt(params.sources)}

Return JSON matching:
{
  "rationale": "Why this module sequence fits the subject, learner level, and duration",
  "modules": [
    {
      "id": "mod-1",
      "order": 1,
      "title": "Subject-specific module title",
      "qctoModuleType": "Standard Module",
      "purpose": "Specific module purpose",
      "objectives": ["Module objective 1", "Module objective 2"],
      "competencies": ["Workplace competency 1"],
      "topics": [
        { "id": "top-1-1", "title": "Topic title", "subtopics": ["Subtopic A", "Subtopic B"] }
      ],
      "lessons": [
        { "id": "les-1-1", "title": "Lesson title", "durationMinutes": 35, "purpose": "What this lesson teaches", "keyTerms": ["Term 1", "Term 2"] }
      ]
    }
  ],
  "coverageChecks": [
    {
      "id": "cov-1",
      "originalTopic": "Exact supplied topic",
      "status": "mapped",
      "mappedModuleId": "mod-1",
      "mappedLocation": "Module 1 -> Topic 1.1 / Lesson 1.1",
      "notes": "How this topic is addressed in full depth"
    }
  ],
  "conflicts": [
    { "id": "conf-1", "description": "Any conflict between source requirements or scope vs duration", "resolved": false }
  ]
}`,
  });

  const parsed = extractAndParseJSON<any>(res.text);
  return {
    rationale: parsed.rationale || '',
    modules: Array.isArray(parsed.modules) ? parsed.modules : [],
    coverageChecks: Array.isArray(parsed.coverageChecks) ? parsed.coverageChecks : [],
    conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
    approval: { approved: false },
  };
}

/* ============================================================================
 * 5. STAGE 2 DETERMINISTIC + AI COVERAGE CHECKER
 * ============================================================================ */
export async function auditCurriculumCoverageWithAI(params: {
  brief: CourseBrief;
  sources: SourceDocument[];
  curriculum: CurriculumArchitecture;
  provider?: AIProvider;
  model?: string;
}): Promise<Pick<CurriculumArchitecture, 'coverageChecks' | 'conflicts'>> {
  const suppliedTopics = (params.brief.subjectTopicsInput || '')
    .split(/\n|;/)
    .map(s => s.trim())
    .filter(Boolean);

  const res = await aiRouter.execute({
    provider: params.provider,
    model: params.model,
    responseFormat: 'json',
    systemInstruction: `You are a strict Curriculum Coverage Auditor.
Compare EVERY topic in the original brief and uploaded sources against the proposed curriculum modules/topics/lessons.
Classify each topic accurately as:
- "mapped": Explicitly covered with sufficient depth.
- "omitted": Missing from the proposed curriculum.
- "generalised": Diluted into a vague high-level heading without specific coverage.
- "clarification_needed": Ambiguous or conflicting requirement needing developer decision.
- "recommended": New topic added by the curriculum designer not in the original brief.
Return ONLY valid JSON.`,
    prompt: `Original Brief Topics: ${JSON.stringify(suppliedTopics)}
Brief Purpose & Requirements: ${params.brief.purpose} | ${params.brief.learningRequirements}
Sources: ${summarizeSourcesForPrompt(params.sources)}

Proposed Curriculum:
${JSON.stringify(params.curriculum.modules, null, 2)}

Return JSON:
{
  "coverageChecks": [
    {
      "id": "cov-1",
      "originalTopic": "Topic string",
      "status": "mapped",
      "mappedModuleId": "mod-id or empty",
      "mappedLocation": "Module X -> Lesson Y or Not mapped",
      "notes": "Evidence or gap explanation"
    }
  ],
  "conflicts": [
    { "id": "conf-1", "description": "Conflict description if any", "resolved": false }
  ]
}`,
  });

  const parsed = extractAndParseJSON<any>(res.text);
  return {
    coverageChecks: Array.isArray(parsed.coverageChecks) ? parsed.coverageChecks : [],
    conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
  };
}

/* ============================================================================
 * 6. STAGE 3: LEARNING OUTCOMES GENERATION
 * ============================================================================ */
export async function generateOutcomesWithAI(params: {
  brief: CourseBrief;
  curriculum: CurriculumArchitecture;
  provider?: AIProvider;
  model?: string;
}): Promise<LearningOutcomesPlan> {
  const res = await aiRouter.execute({
    provider: params.provider,
    model: params.model,
    responseFormat: 'json',
    systemInstruction: `You are an instructional design specialist writing measurable learning outcomes.
RULES:
- Use measurable Bloom's taxonomy action verbs (e.g., Calculate, Diagnose, Demonstrate, Formulate, Evaluate, Implement, Inspect, Resolve).
- NEVER write vague outcomes starting with "Understand", "Know", "Learn about", or "Appreciate" without demonstrable performance criteria.
- Connect every outcome to concrete workplace performance for "${params.brief.targetJobRoles || params.brief.targetAudience}".
- Keep outcomes realistic for "${params.brief.estimatedDuration || 'the programme duration'}".
- If SA NQF alignment is enabled (${params.brief.saCompliance?.enabled ? `NQF ${params.brief.saCompliance.nqfLevel || 'Unspecified'}` : 'Not enabled'}), reflect cognitive complexity WITHOUT inventing qualification codes or unit standards.
Return ONLY valid JSON.`,
    prompt: `Generate measurable Course-Level and Module-Level Learning Outcomes for:
Course: ${params.brief.title} (${params.brief.industryDomain})
Level: ${params.brief.experienceLevel} | Duration: ${params.brief.estimatedDuration}
SA Compliance: ${JSON.stringify(params.brief.saCompliance)}

Approved Curriculum Modules:
${JSON.stringify(params.curriculum.modules, null, 2)}

Return JSON:
{
  "courseOutcomes": [
    {
      "id": "co-1",
      "scope": "course",
      "code": "CLO-1",
      "actionVerb": "Calculate",
      "bloomLevel": "Apply",
      "statement": "Full measurable outcome statement",
      "workplacePerformance": "Observable workplace behaviour demonstrated",
      "nqfAlignmentNote": "Optional NQF descriptor note if applicable"
    }
  ],
  "moduleOutcomes": [
    {
      "id": "mo-1-1",
      "scope": "module",
      "moduleId": "Exact module id from curriculum",
      "code": "MLO-1.1",
      "actionVerb": "Diagnose",
      "bloomLevel": "Analyze",
      "statement": "Full measurable module outcome statement",
      "workplacePerformance": "Observable workplace task",
      "nqfAlignmentNote": ""
    }
  ],
  "durationRealismNote": "Assessment of whether outcomes fit the estimated duration",
  "nqfSummaryNote": "Honest alignment note without claiming unverified accreditation"
}`,
  });

  const parsed = extractAndParseJSON<any>(res.text);
  return {
    courseOutcomes: Array.isArray(parsed.courseOutcomes) ? parsed.courseOutcomes : [],
    moduleOutcomes: Array.isArray(parsed.moduleOutcomes) ? parsed.moduleOutcomes : [],
    durationRealismNote: parsed.durationRealismNote || '',
    nqfSummaryNote: parsed.nqfSummaryNote || '',
    approval: { approved: false },
  };
}

/* ============================================================================
 * 7. STAGE 4: ASSESSMENT DESIGN & ALIGNMENT MATRIX
 * ============================================================================ */
export async function designAssessmentsWithAI(params: {
  brief: CourseBrief;
  curriculum: CurriculumArchitecture;
  outcomes: LearningOutcomesPlan;
  provider?: AIProvider;
  model?: string;
}): Promise<{
  strategySummary: string;
  passRequirementPercent: number;
  knowledgeWeightPercent: number;
  practicalWeightPercent: number;
  items: AssessmentItem[];
}> {
  const allOutcomes = [...params.outcomes.courseOutcomes, ...params.outcomes.moduleOutcomes];

  const res = await aiRouter.execute({
    provider: params.provider,
    model: params.model,
    responseFormat: 'json',
    systemInstruction: `You are an Assessment Architect for eStudy South Africa.
Design a rigorous, balanced assessment strategy BEFORE course content is written.
CRITICAL RULES:
1. Distinguish between Knowledge Assessment ("knowledge") and Practical Competence ("practical").
2. STRICT WEIGHTING MATH: knowledgeWeightPercent + practicalWeightPercent MUST equal 100. The sum of weightingPercent across ALL items MUST equal 100. The sum of weightingPercent for "knowledge" items MUST equal knowledgeWeightPercent, and the sum of weightingPercent for "practical" items MUST equal practicalWeightPercent. Never allow weighting totals to mismatch.
3. Include an explicit realistic durationMinutes for every assessment item and ensure strategySummary states the exact same passRequirementPercent and Knowledge/Practical weight split.
4. AUDIENCE SUITABILITY: Match task format strictly to target audience/roles ("${params.brief.targetJobRoles || params.brief.targetAudience}", level: "${params.brief.experienceLevel}"). For Executive, Board, Director, or non-technical decision-maker cohorts, NEVER mandate writing Python/Pandas/Fairlearn/SQL code; instead assess governance interpretation, vendor evaluation, risk-threshold sign-off, ethical impact review, and executive decision memos.
5. Use diverse formats from: "mcq", "multi_response", "matching", "sequencing", "short_answer", "case_study", "branching_scenario", "problem_solving", "practical_task", "competency_demo", "reflection".
6. EVERY outcome ID across courseOutcomes and moduleOutcomes MUST be mapped via outcomeIds to at least one assessment item!
7. Every item MUST include: objective, instructions, promptOrQuestion, modelAnswer, explanation, feedbackCorrect, feedbackIncorrect, markingGuide, and a 100%-weighted evaluation rubric for practical/open items.
Return ONLY valid JSON.`,
    prompt: `Design Stage 4 Assessment Plan for:
Course: ${params.brief.title} (${params.brief.industryDomain})
Duration: ${params.brief.estimatedDuration || 'Unspecified'}
Target Roles: ${params.brief.targetJobRoles || params.brief.targetAudience}
Experience Level: ${params.brief.experienceLevel}
Learning Requirements: ${params.brief.learningRequirements}

Modules:
${JSON.stringify(params.curriculum.modules.map(m => ({ id: m.id, title: m.title, order: m.order })))}

All Approved Outcomes (EVERY outcome ID must be assessed):
${JSON.stringify(allOutcomes)}

Return JSON:
{
  "strategySummary": "Clear strategy balancing knowledge vs practical competence (stating exact weights and passRequirementPercent) and formative vs summative",
  "passRequirementPercent": 70,
  "knowledgeWeightPercent": 40,
  "practicalWeightPercent": 60,
  "items": [
    {
      "id": "assess-1",
      "moduleId": "mod-1",
      "title": "Assessment title",
      "type": "mcq",
      "assessmentDomain": "knowledge",
      "classification": "formative",
      "outcomeIds": ["mo-1-1"],
      "weightingPercent": 10,
      "durationMinutes": 20,
      "objective": "What this assessment verifies",
      "instructions": "Clear instructions for learner",
      "promptOrQuestion": "Detailed question, scenario, or task prompt",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndices": [1],
      "matchingPairs": [],
      "sequenceSteps": [],
      "modelAnswer": "Complete model answer or correct option explanation",
      "explanation": "Why this assesses the concept",
      "feedbackCorrect": "Constructive confirmation feedback",
      "feedbackIncorrect": "Diagnostic remediation feedback",
      "markingGuide": "Assessor scoring criteria",
      "rubric": [
        {
          "criterion": "Technical accuracy / Execution standard",
          "weightPercent": 100,
          "competentStandard": "Observable competent performance",
          "notYetCompetentIndicator": "Indicator requiring remediation"
        }
      ]
    }
  ]
}`,
  });

  return extractAndParseJSON(res.text);
}

/* ============================================================================
 * 8. STAGE 5: MODULE-BY-MODULE CONTENT GENERATION
 * ============================================================================ */
export async function generateModuleContentWithAI(params: {
  brief: CourseBrief;
  modulePlan: CurriculumModulePlan;
  allModules: CurriculumModulePlan[];
  outcomes: LearningOutcomesPlan;
  assessments: AssessmentItem[];
  sources: SourceDocument[];
  provider?: AIProvider;
  model?: string;
}): Promise<GeneratedModuleContent> {
  const modOutcomes = params.outcomes.moduleOutcomes.filter(
    o => o.moduleId === params.modulePlan.id
  );
  const modAssessments = params.assessments.filter(a => a.moduleId === params.modulePlan.id);
  const otherModuleTitles = params.allModules
    .filter(m => m.id !== params.modulePlan.id)
    .map(m => `Module ${m.order}: ${m.title}`)
    .join('; ');

  const aiRule =
    params.brief.aiIntegrationMode === 'none'
      ? 'AI integration is DISABLED for this course. Do NOT add generic AI tips or AI scenarios.'
      : `AI Integration Mode is ${params.brief.aiIntegrationMode}: ${params.brief.aiIntegrationRequirements || 'Integrate relevant AI workflows authentically where appropriate.'}`;

  const res = await aiRouter.execute({
    provider: params.provider,
    model: params.model,
    responseFormat: 'json',
    timeoutMs: 45000,
    maxTokens: 6000,
    systemInstruction: `You are a senior subject-matter educator authoring Module ${params.modulePlan.order} of "${params.brief.title}" for "${params.brief.targetAudience}" (${params.brief.experienceLevel}).
NON-NEGOTIABLE QUALITY, LEGAL & TECHNICAL ACCURACY STANDARDS:
1. Teach EVERY topic, subtopic, and lesson in the approved module plan with authentic subject depth.
2. ${aiRule}
3. AUDIENCE SUITABILITY: Match activities strictly to "${params.brief.targetJobRoles || params.brief.targetAudience}" (${params.brief.experienceLevel}). For Executive, Board, Director, or non-technical decision-maker audiences, keep mandatory exercises focused on executive interpretation, risk governance, and vendor interrogation — NEVER assign mandatory Python/Fairlearn/SQL coding unless explicitly tagged "[Optional Technical Appendix]".
4. SOUTH AFRICAN LEGAL PRECISION: When citing POPIA (Act 4 of 2013), use verified sections accurately (Accountability s8; Processing Limitation s9–12, noting s11(1)(a)–(f) has SIX lawful grounds — consent is NOT the only lawful justification; Purpose Specification s13–14; Further Processing s15; Information Quality s16; Openness s17–18; Security Safeguards s19–22; Data Subject Participation s23–25; Automated Decision-Making s71). Always write PEPUDA's exact title: "Promotion of Equality and Prevention of Unfair Discrimination Act 4 of 2000". Distinguish statute vs regulatory guidance vs governance codes (e.g. King IV), and include an educational non-legal-advice disclaimer when discussing legal duties.
5. NO FABRICATED EVIDENCE: NEVER invent statistics, percentages, ZAR savings, or real company success stories. Any illustrative numerical or workplace scenario NOT backed by a supplied verified source MUST be explicitly labelled "Illustrative hypothetical scenario (not empirical data)".
6. AI/ML TECHNICAL PRECISION: Never equate raw model confidence scores to calibrated probability without explaining empirical calibration; never present AUC > 0.8 as a universal readiness rule without prevalence, operating threshold, and asymmetric error cost context; distinguish statistical confidence intervals from prediction intervals and model uncertainty; never claim SHAP values prove real-world causation (SHAP measures correlational feature attribution).
7. NEVER use generic filler or repeat explanations covered in other modules (${otherModuleTitles || 'none'}).
8. Accessibility & Citation Honesty: Cite supplied sources inline (e.g. [Source 1]) where supported. Include descriptive alt captions ("This diagram illustrates...") when referencing any visual/diagram. Tag sourceClaims accurately ("VERIFIED", "NEEDS REVIEW", or "UNSUPPORTED").
Return ONLY valid JSON.`,
    prompt: `Author full learning content for Module ${params.modulePlan.order}: "${params.modulePlan.title}".

COURSE BRIEF:
- Title: ${params.brief.title} (${params.brief.code})
- Domain: ${params.brief.industryDomain}
- Purpose: ${params.brief.purpose}
- Language: ${params.brief.language}
- Learning Requirements: ${params.brief.learningRequirements}

APPROVED MODULE PLAN:
${JSON.stringify(params.modulePlan)}

APPROVED MODULE OUTCOMES:
${JSON.stringify(modOutcomes)}

APPROVED MODULE ASSESSMENTS TO ALIGN WITH:
${JSON.stringify(modAssessments.map(a => ({ id: a.id, title: a.title, type: a.type, objective: a.objective })))}

SUPPLIED SOURCES:
${summarizeSourcesForPrompt(params.sources)}

Return JSON matching:
{
  "id": "content-${params.modulePlan.id}",
  "moduleId": "${params.modulePlan.id}",
  "moduleNumber": ${params.modulePlan.order},
  "title": "${params.modulePlan.title}",
  "introduction": "Engaging module introduction linking to workplace need and module outcomes",
  "learningObjectives": ${JSON.stringify(modOutcomes.map(o => `${o.code}: ${o.statement}`))},
    "lessons": [
    {
      "id": "les-content-1",
      "lessonPlanId": "matching lesson id from plan",
      "outcomeIds": ${JSON.stringify([...modOutcomes.map(o => o.id), ...params.outcomes.courseOutcomes.map(o => o.id)])},
      "title": "Exact lesson title",
      "durationMinutes": 35,
      "explanation": "Rich, clear, subject-specific teaching prose (280-450 words) with structured subheadings, mechanics, equations/rules if technical, and common misconceptions",
      "keyTerminology": [{ "term": "Term", "definition": "Accurate domain definition" }],
      "workedExamples": ["Detailed worked example or step-by-step demonstration"],
      "practicalApplication": "Concrete workplace application for target roles",
      "guidedActivity": "Structured hands-on learner activity",
      "sourceClaims": [
        { "id": "clm-1", "claim": "Key technical or regulatory statement made in this lesson", "sourceTitle": "Source name or General Practice", "status": "NEEDS REVIEW" }
      ],
      "editStatus": "ai_draft"
    }
  ],
  "workplaceCaseStudies": [
    {
      "id": "cs-1",
      "title": "Domain case study title",
      "background": "Realistic workplace situation and data/context",
      "analysisQuestions": ["Question 1", "Question 2"],
      "facilitatorNotes": "Model analysis points"
    }
  ],
  "scenarios": [
    {
      "id": "sc-1",
      "title": "Scenario title",
      "contextType": "Workplace",
      "situation": "Realistic role scenario",
      "challenge": "Specific dilemma or operational constraint",
      "decisionPrompt": "What should the learner decide or do next?",
      "modelDebrief": "Expert reasoning and consequence analysis",
      "keyTakeaway": "Core principle"
    }
  ],
  "knowledgeChecks": [
    {
      "id": "kc-1",
      "question": "Concept/application question testing content taught in this module",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 1,
      "explanation": "Why correct option works and distractors fail",
      "outcomeCode": "MLO-1.1"
    }
  ],
  "summary": "Concise synthesis of module takeaways",
  "furtherLearningResources": ["Verified resource or recommended reading"],
  "editStatus": "ai_draft"
}`,
  });

  const parsed = extractAndParseJSON<GeneratedModuleContent>(res.text);
  const fallbackOutcomeIds = modOutcomes.map(o => o.id);
  const normalizedLessons = Array.isArray(parsed.lessons)
    ? parsed.lessons.map(l => ({
        ...l,
        outcomeIds:
          Array.isArray(l.outcomeIds) && l.outcomeIds.length > 0
            ? l.outcomeIds
            : fallbackOutcomeIds,
      }))
    : [];
  return {
    ...parsed,
    lessons: normalizedLessons,
    moduleId: params.modulePlan.id,
    moduleNumber: params.modulePlan.order,
    title: params.modulePlan.title,
    editStatus: 'ai_draft',
    lastGeneratedAt: new Date().toISOString(),
  };
}

/* ============================================================================
 * 8B. STAGE 5 FAST CHUNKED GENERATION: MODULE SCAFFOLD + INDIVIDUAL LESSON
 * ============================================================================ */
export async function generateModuleScaffoldWithAI(params: {
  brief: CourseBrief;
  modulePlan: CurriculumModulePlan;
  allModules: CurriculumModulePlan[];
  outcomes: LearningOutcomesPlan;
  assessments: AssessmentItem[];
  sources: SourceDocument[];
  provider?: AIProvider;
  model?: string;
}): Promise<GeneratedModuleContent> {
  const modOutcomes = params.outcomes.moduleOutcomes.filter(
    o => o.moduleId === params.modulePlan.id
  );
  const modAssessments = params.assessments.filter(a => a.moduleId === params.modulePlan.id);
  const otherModuleTitles = params.allModules
    .filter(m => m.id !== params.modulePlan.id)
    .map(m => `M${m.order}: ${m.title}`)
    .join('; ');

  const aiRule =
    params.brief.aiIntegrationMode === 'none'
      ? 'AI integration is DISABLED. Do NOT add AI tips or AI scenarios.'
      : `AI Mode: ${params.brief.aiIntegrationMode} (${params.brief.aiIntegrationRequirements || 'Integrate relevant AI workflows authentically'}).`;

  const res = await aiRouter.execute({
    provider: params.provider,
    model: params.model,
    responseFormat: 'json',
    timeoutMs: 32000,
    maxTokens: 2400,
    systemInstruction: `You are a senior educator authoring the module overview, workplace case studies, scenarios, and knowledge checks for Module ${params.modulePlan.order} of "${params.brief.title}" (${params.brief.experienceLevel}).
${aiRule}
Tailor scenarios to "${params.brief.industryDomain}" and roles "${params.brief.targetJobRoles || params.brief.targetAudience}" in a South African workplace context. Do not duplicate other modules (${otherModuleTitles || 'none'}).
NON-NEGOTIABLE EVIDENCE & ACCURACY RULES:
- Never fabricate statistics, percentages, ZAR savings, or real-company case results. Label illustrative workplace scenarios explicitly as "Illustrative hypothetical scenario".
- Ensure any POPIA (Act 4 of 2013) or PEPUDA ("Promotion of Equality and Prevention of Unfair Discrimination Act 4 of 2000") mentions are exact and educational (not legal advice).
Return ONLY valid JSON.`,
    prompt: `Author the module wrapper (excluding individual lesson essays) for Module ${params.modulePlan.order}: "${params.modulePlan.title}".
Topics: ${JSON.stringify(params.modulePlan.topics.map(t => t.title))}
Lessons planned: ${JSON.stringify(params.modulePlan.lessons.map(l => l.title))}
Module Outcomes: ${JSON.stringify(modOutcomes.map(o => ({ code: o.code, statement: o.statement })))}
Aligned Assessments: ${JSON.stringify(modAssessments.map(a => ({ title: a.title, type: a.type })))}
Sources: ${summarizeSourcesForPrompt(params.sources)}

Return JSON:
{
  "introduction": "Engaging 2-paragraph introduction linking workplace need and module outcomes",
  "learningObjectives": ${JSON.stringify(modOutcomes.map(o => `${o.code}: ${o.statement}`))},
  "workplaceCaseStudies": [
    {
      "id": "cs-${params.modulePlan.order}-1",
      "title": "Domain case study title",
      "background": "Realistic workplace situation and data/context",
      "analysisQuestions": ["Question 1", "Question 2"],
      "facilitatorNotes": "Model analysis points"
    }
  ],
  "scenarios": [
    {
      "id": "sc-${params.modulePlan.order}-1",
      "title": "Scenario title",
      "contextType": "Workplace",
      "situation": "Realistic role scenario",
      "challenge": "Specific dilemma or operational constraint",
      "decisionPrompt": "What should the learner decide or do next?",
      "modelDebrief": "Expert reasoning and consequence analysis",
      "keyTakeaway": "Core principle"
    }
  ],
  "knowledgeChecks": [
    {
      "id": "kc-${params.modulePlan.order}-1",
      "question": "Concept/application question testing this module",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 0,
      "explanation": "Why correct option works and distractors fail",
      "outcomeCode": ${JSON.stringify(modOutcomes[0]?.code || 'MLO-1')}
    },
    {
      "id": "kc-${params.modulePlan.order}-2",
      "question": "Second applied knowledge check question",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 1,
      "explanation": "Clear explanation",
      "outcomeCode": ${JSON.stringify(modOutcomes[Math.min(1, Math.max(0, modOutcomes.length - 1))]?.code || 'MLO-1')}
    }
  ],
  "summary": "Concise synthesis of module takeaways",
  "furtherLearningResources": ["Recommended reading or verifiable standard"]
}`,
  });

  const parsed = extractAndParseJSON<any>(res.text);
  return {
    id: `content-${params.modulePlan.id}`,
    moduleId: params.modulePlan.id,
    moduleNumber: params.modulePlan.order,
    title: params.modulePlan.title,
    introduction: parsed.introduction || `Module ${params.modulePlan.order}: ${params.modulePlan.title}`,
    learningObjectives: Array.isArray(parsed.learningObjectives)
      ? parsed.learningObjectives
      : modOutcomes.map(o => `${o.code}: ${o.statement}`),
    lessons: [],
    workplaceCaseStudies: Array.isArray(parsed.workplaceCaseStudies) ? parsed.workplaceCaseStudies : [],
    scenarios: Array.isArray(parsed.scenarios) ? parsed.scenarios : [],
    knowledgeChecks: Array.isArray(parsed.knowledgeChecks) ? parsed.knowledgeChecks : [],
    summary: parsed.summary || '',
    furtherLearningResources: Array.isArray(parsed.furtherLearningResources)
      ? parsed.furtherLearningResources
      : [],
    editStatus: 'ai_draft',
    lastGeneratedAt: new Date().toISOString(),
  };
}

export async function generateSingleLessonWithAI(params: {
  brief: CourseBrief;
  modulePlan: CurriculumModulePlan;
  lessonPlan: {
    id: string;
    title: string;
    durationMinutes: number;
    purpose: string;
    keyTerms: string[];
  };
  lessonIndex: number;
  outcomes: LearningOutcomesPlan;
  sources: SourceDocument[];
  provider?: AIProvider;
  model?: string;
}): Promise<GeneratedLessonContent> {
  const modOutcomes = params.outcomes.moduleOutcomes.filter(
    o => o.moduleId === params.modulePlan.id
  );
  const courseOutcomeIds = params.outcomes.courseOutcomes.map(o => o.id);
  const fallbackOutcomeIds = Array.from(
    new Set([...modOutcomes.map(o => o.id), ...courseOutcomeIds])
  );

  const aiRule =
    params.brief.aiIntegrationMode === 'none'
      ? 'AI integration is DISABLED. Do NOT add generic AI tips.'
      : `AI Mode: ${params.brief.aiIntegrationMode} (${params.brief.aiIntegrationRequirements || 'Integrate relevant AI practices authentically'}).`;

  const res = await aiRouter.execute({
    provider: params.provider,
    model: params.model,
    responseFormat: 'json',
    timeoutMs: 32000,
    maxTokens: 2200,
    systemInstruction: `You are a senior subject-matter educator writing a single high-rigour lesson for "${params.brief.title}" (${params.brief.experienceLevel}, audience: "${params.brief.targetAudience}").
${aiRule}
QUALITY, LEGAL & TECHNICAL GUARDRAILS:
- Audience Alignment: Match complexity and guidedActivity to "${params.brief.targetJobRoles || params.brief.targetAudience}". For Executive/Board/Leadership audiences, avoid mandatory coding/Python exercises; focus on strategic oversight, governance checklists, and vendor interrogation.
- South African Law: Use exact POPIA Act 4 of 2013 sections (s8 Accountability, s11(1)(a)-(f) six lawful grounds beyond consent alone, s16 Information Quality, s19-22 Security Safeguards, s23-25 Participation, s71 Automated Decision-Making) and exact PEPUDA title ("Promotion of Equality and Prevention of Unfair Discrimination Act 4 of 2000"), with an educational non-legal-advice caveat.
- Anti-Fabrication: Never invent financial savings or statistics; explicitly label illustrative examples as "Illustrative hypothetical scenario" unless backed by a supplied verified source (cite inline as [Source N]).
- ML Accuracy: Distinguish confidence scores vs model calibration, explain AUC context dependence, separate confidence intervals from prediction intervals, and describe SHAP as associative feature contribution (not causation).
- Accessibility: Use structured headings, concise paragraphs, and plain-text descriptive alt captions ("This diagram illustrates...") for any visual. Tag sourceClaims honestly ("VERIFIED", "NEEDS REVIEW", or "UNSUPPORTED").
Return ONLY valid JSON.`,
    prompt: `Author Lesson ${params.lessonIndex + 1} inside Module ${params.modulePlan.order} ("${params.modulePlan.title}").
Course Domain: ${params.brief.industryDomain} | Purpose: ${params.brief.purpose}
Module Topics: ${JSON.stringify(params.modulePlan.topics.map(t => t.title))}
Lesson Plan: ${JSON.stringify(params.lessonPlan)}
Module Outcomes: ${JSON.stringify(modOutcomes.map(o => ({ id: o.id, code: o.code, statement: o.statement })))}
Sources: ${summarizeSourcesForPrompt(params.sources)}

Return JSON:
{
  "id": "les-content-${params.modulePlan.order}-${params.lessonIndex + 1}",
  "lessonPlanId": ${JSON.stringify(params.lessonPlan.id)},
  "outcomeIds": ${JSON.stringify(fallbackOutcomeIds)},
  "title": ${JSON.stringify(params.lessonPlan.title)},
  "durationMinutes": ${Number(params.lessonPlan.durationMinutes) || 35},
  "explanation": "Rich, clear teaching prose (320-480 words) with structured subheadings, core principles/equations, and common misconceptions",
  "keyTerminology": [{ "term": "Term", "definition": "Accurate domain definition" }],
  "workedExamples": ["Detailed step-by-step worked example or demonstration"],
  "practicalApplication": "Concrete workplace application for ${params.brief.targetJobRoles || params.brief.targetAudience}",
  "guidedActivity": "Structured hands-on learner activity",
  "sourceClaims": [
    { "id": "clm-${params.lessonIndex + 1}-1", "claim": "Key statement taught", "sourceTitle": "Source name or General Practice", "status": "NEEDS REVIEW" }
  ],
  "editStatus": "ai_draft"
}`,
  });

  const parsed = extractAndParseJSON<GeneratedLessonContent>(res.text);
  return {
    id: parsed.id || `les-content-${params.modulePlan.order}-${params.lessonIndex + 1}`,
    lessonPlanId: parsed.lessonPlanId || params.lessonPlan.id,
    outcomeIds:
      Array.isArray(parsed.outcomeIds) && parsed.outcomeIds.length > 0
        ? parsed.outcomeIds
        : fallbackOutcomeIds,
    title: parsed.title || params.lessonPlan.title,
    durationMinutes: Number(parsed.durationMinutes) || Number(params.lessonPlan.durationMinutes) || 35,
    explanation: parsed.explanation || '',
    keyTerminology: Array.isArray(parsed.keyTerminology) ? parsed.keyTerminology : [],
    workedExamples: Array.isArray(parsed.workedExamples) ? parsed.workedExamples : [],
    practicalApplication: parsed.practicalApplication || '',
    guidedActivity: parsed.guidedActivity || '',
    sourceClaims: Array.isArray(parsed.sourceClaims) ? parsed.sourceClaims : [],
    editStatus: 'ai_draft',
  };
}

/* ============================================================================
 * 9. STAGE 5: SELECTIVE REGENERATION
 * ============================================================================ */
export async function regenerateComponentWithAI(params: {
  project: CourseProject;
  targetType: 'lesson' | 'scenario' | 'case_study' | 'knowledge_check' | 'module';
  moduleId: string;
  targetId?: string;
  instruction?: string;
  provider?: AIProvider;
  model?: string;
}): Promise<{ updatedItem: any }> {
  const modPlan = params.project.curriculum.modules.find(m => m.id === params.moduleId);
  const modContent = params.project.content.modules.find(m => m.moduleId === params.moduleId);
  if (!modPlan || !modContent) {
    throw new Error('Target module not found.');
  }

  let currentItem: any = modContent;
  if (params.targetType === 'lesson') {
    currentItem = modContent.lessons.find(l => l.id === params.targetId);
  } else if (params.targetType === 'scenario') {
    currentItem = modContent.scenarios.find(s => s.id === params.targetId);
  } else if (params.targetType === 'case_study') {
    currentItem = modContent.workplaceCaseStudies.find(c => c.id === params.targetId);
  } else if (params.targetType === 'knowledge_check') {
    currentItem = modContent.knowledgeChecks.find(k => k.id === params.targetId);
  }

  const res = await aiRouter.execute({
    provider: params.provider,
    model: params.model,
    responseFormat: 'json',
    systemInstruction: `You are regenerating ONLY a single ${params.targetType} inside "${params.project.brief.title}" (${params.project.brief.industryDomain}).
Preserve exact IDs and approved curriculum alignment. Do NOT modify course metadata or unrelated modules.
Return ONLY valid JSON matching the exact schema of the target object.`,
    prompt: `Course Brief: ${params.project.brief.title} | Audience: ${params.project.brief.targetAudience} | Level: ${params.project.brief.experienceLevel}
Module ${modPlan.order}: ${modPlan.title}
Developer Revision Request: ${params.instruction || 'Improve clarity, technical depth, workplace realism, and alignment to module outcomes.'}

Current ${params.targetType} JSON to improve (preserve "id"):
${JSON.stringify(currentItem, null, 2)}

Return the improved JSON object ONLY.`,
  });

  const updatedItem = extractAndParseJSON(res.text);
  return { updatedItem };
}

/* ============================================================================
 * 10. COURSE COPILOT (PROPOSED DIFFS ONLY — NEVER SILENT MUTATION)
 * ============================================================================ */
export async function processCopilotChatWithAI(params: {
  project: CourseProject;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  userMessage: string;
  selectedTextContext?: SelectedTextContext;
  activeModuleId?: string;
  provider?: AIProvider;
  model?: string;
}): Promise<{
  reply: string;
  proposedChanges: Array<{
    id: string;
    targetType:
      | 'outcome'
      | 'lesson'
      | 'scenario'
      | 'case_study'
      | 'knowledge_check'
      | 'assessment_item'
      | 'curriculum_module'
      | 'module_content'
      | 'brief_note';
    targetId?: string;
    moduleId?: string;
    moduleNumber?: number;
    stageHint?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
    executionMode?: 'direct' | 'confirm';
    title: string;
    rationale: string;
    beforePreview?: string;
    afterPreview: string;
    patchPayload: Record<string, any>;
    status: 'pending';
  }>;
}> {
  const activeStage = params.project.currentStage;
  const activeModId = params.activeModuleId || params.selectedTextContext?.moduleId;
  const isSelectionFocused = Boolean(params.selectedTextContext?.text?.trim());
  const targetStage = params.selectedTextContext?.stage || activeStage;

  const compactContext = isSelectionFocused
    ? {
        stage: targetStage,
        brief: {
          title: params.project.brief.title,
          code: params.project.brief.code,
          domain: params.project.brief.industryDomain,
          audience: params.project.brief.targetAudience,
          metadataLocked: params.project.brief.metadataLocked,
        },
        ...(targetStage === 2
          ? {
              curriculumModules: params.project.curriculum.modules.map(m => ({
                id: m.id,
                order: m.order,
                title: m.title,
              })),
            }
          : {}),
        ...(targetStage === 3
          ? {
              outcomes: [
                ...params.project.outcomes.courseOutcomes,
                ...params.project.outcomes.moduleOutcomes,
              ]
                .slice(0, 25)
                .map(o => ({
                  id: o.id,
                  code: o.code,
                  scope: o.scope,
                  moduleId: o.moduleId,
                  statement: (o.statement || '').slice(0, 140),
                })),
            }
          : {}),
        ...(targetStage === 4
          ? {
              assessments: params.project.assessments.items.slice(0, 20).map(a => ({
                id: a.id,
                moduleId: a.moduleId,
                title: a.title,
                type: a.type,
              })),
            }
          : {}),
        ...(targetStage === 5
          ? {
              contentModules: params.project.content.modules
                .filter(cm => !activeModId || cm.moduleId === activeModId)
                .slice(0, 2)
                .map(cm => ({
                  id: cm.id,
                  moduleId: cm.moduleId,
                  moduleNumber: cm.moduleNumber,
                  title: cm.title,
                  lessons: cm.lessons.map(l => ({ id: l.id, title: l.title })),
                  scenarios: cm.scenarios.map(s => ({ id: s.id, title: s.title })),
                  caseStudies: cm.workplaceCaseStudies.map(c => ({ id: c.id, title: c.title })),
                  knowledgeChecks: cm.knowledgeChecks.map(k => ({ id: k.id, outcomeCode: k.outcomeCode })),
                })),
            }
          : {}),
        ...(targetStage >= 6 && params.project.latestQA
          ? {
              latestQASummary: {
                verdict: params.project.latestQA.verdict,
                weightedScore: params.project.latestQA.weightedScore,
                blockingErrors: (params.project.latestQA.blockingErrors || []).slice(0, 5),
                warnings: (params.project.latestQA.warnings || []).slice(0, 5),
              },
            }
          : {}),
        sources: (params.project.sources || []).slice(0, 2).map(s => ({
          id: s.id,
          title: s.title,
          status: s.verificationStatus,
          excerpt: (s.summary || s.extractedText || '').slice(0, 280),
        })),
      }
    : {
        stage: activeStage,
        brief: {
          title: params.project.brief.title,
          code: params.project.brief.code,
          domain: params.project.brief.industryDomain,
          purpose: (params.project.brief.purpose || '').slice(0, 280),
          audience: params.project.brief.targetAudience,
          level: params.project.brief.experienceLevel,
          duration: params.project.brief.estimatedDuration,
          aiMode: params.project.brief.aiIntegrationMode,
          metadataLocked: params.project.brief.metadataLocked,
          learningRequirements: (params.project.brief.learningRequirements || '').slice(0, 260),
          subjectTopics: (params.project.brief.subjectTopicsInput || '').slice(0, 260),
        },
        curriculumModules: params.project.curriculum.modules.map(m => ({
          id: m.id,
          order: m.order,
          title: m.title,
          purpose: (m.purpose || '').slice(0, 120),
          lessons: m.lessons.map(l => ({
            id: l.id,
            title: l.title,
            outcomeIds: l.outcomeIds || [],
          })),
        })),
        coverageGaps: params.project.curriculum.coverageChecks
          .filter(c => c.status !== 'mapped')
          .slice(0, 10),
        outcomes: [
          ...params.project.outcomes.courseOutcomes,
          ...params.project.outcomes.moduleOutcomes,
        ]
          .slice(0, 30)
          .map(o => ({
            id: o.id,
            code: o.code,
            scope: o.scope,
            moduleId: o.moduleId,
            bloomLevel: o.bloomLevel,
            statement: (o.statement || '').slice(0, 140),
          })),
        assessments: params.project.assessments.items.slice(0, 20).map(a => ({
          id: a.id,
          moduleId: a.moduleId,
          title: a.title,
          type: a.type,
          outcomeIds: a.outcomeIds || [],
        })),
        contentModules: params.project.content.modules.map(cm => {
          const isFocused = !activeModId || cm.moduleId === activeModId;
          return {
            id: cm.id,
            moduleId: cm.moduleId,
            moduleNumber: cm.moduleNumber,
            title: cm.title,
            introduction: isFocused ? (cm.introduction || '').slice(0, 240) : undefined,
            lessons: cm.lessons.map(l => ({
              id: l.id,
              lessonPlanId: l.lessonPlanId,
              title: l.title,
              outcomeIds: l.outcomeIds || [],
              explanationExcerpt: isFocused ? (l.explanation || '').slice(0, 280) : undefined,
            })),
            scenarios: cm.scenarios.map(s => ({ id: s.id, title: s.title })),
            caseStudies: cm.workplaceCaseStudies.map(c => ({ id: c.id, title: c.title })),
            knowledgeChecks: cm.knowledgeChecks.map(k => ({
              id: k.id,
              outcomeCode: k.outcomeCode,
            })),
          };
        }),
        alignmentFlags: params.project.assessments.alignmentFlags.slice(0, 12),
        latestQASummary: params.project.latestQA
          ? {
              verdict: params.project.latestQA.verdict,
              weightedScore: params.project.latestQA.weightedScore,
              blockingErrors: (params.project.latestQA.blockingErrors || []).slice(0, 6),
              warnings: (params.project.latestQA.warnings || []).slice(0, 6),
              criticalFailures: params.project.latestQA.criticalFailures.slice(0, 6),
            }
          : null,
        sources: (params.project.sources || []).slice(0, 4).map(s => ({
          id: s.id,
          title: s.title,
          authorOrOrganisation: s.authorOrOrganisation,
          status: s.verificationStatus,
          verifiedBy: s.verifiedBy,
          keyTopics: (s.keyTopics || []).slice(0, 6),
          excerpt: (s.summary || s.extractedText || '').slice(0, 400),
        })),
      };

  const historyText = params.messages
    .slice(-6)
    .map(m => `[${m.role.toUpperCase()}]: ${String(m.content || '').slice(0, 500)}`)
    .join('\n');

  const selectedBlock = params.selectedTextContext?.text
    ? `\nSELECTED TEXT CONTEXT FROM WORKSPACE:\n- Stage: ${params.selectedTextContext.stage}${params.selectedTextContext.moduleNumber ? ` (Module ${params.selectedTextContext.moduleNumber})` : ''}\n- Section: ${params.selectedTextContext.sectionLabel || 'Active Stage'}\n- Action Requested: ${params.selectedTextContext.action || 'custom'}\n- Selected Excerpt:\n"""\n${params.selectedTextContext.text.slice(0, 1200)}\n"""\n`
    : '';

  const res = await aiRouter.execute({
    provider: params.provider,
    model: params.model,
    responseFormat: 'json',
    maxTokens: isSelectionFocused ? 1400 : 2200,
    timeoutMs: 32000,
    systemInstruction: `You are the eStudy Course Copilot — a senior instructional design partner.
CRITICAL RULES:
1. You have read context of the active course: brief, curriculum modules, outcomes, assessments, Stage 5 lessons/scenarios/case studies, QA findings (blocking errors & warnings), and uploaded reference source excerpts in "sources".
2. NEVER claim you cannot read uploaded reference sources if excerpts are present in "sources" — cite them directly by title! If "sources" is empty or lacks excerpts, say so honestly.
3. NEVER silently modify approved course metadata or content. Always propose structured edits in "proposedChanges" with exact IDs copied from ACTIVE COURSE CONTEXT so "Accept & Apply" executes cleanly on click:
   - "outcome" (stageHint: 3): exact outcome "id" in "targetId" (and "moduleId" if module outcome). patchPayload: { "statement", "actionVerb", "bloomLevel", "workplacePerformance" }.
   - "lesson" (stageHint: 5): exact content lesson "id" (or curriculum lesson "id") in "targetId", exact "moduleId", numeric "moduleNumber". patchPayload: { "title", "explanation", "outcomeIds", "practicalApplication", "guidedActivity", "workedExamples", "keyTerminology", "sourceClaims" }.
   - "module_content" (stageHint: 5): exact "moduleId" and numeric "moduleNumber" for updating module-level text. patchPayload: { "introduction", "summary", "learningObjectives", "furtherLearningResources" }.
   - "scenario" (stageHint: 5): exact scenario "id" in "targetId", exact "moduleId", numeric "moduleNumber". patchPayload: { "title", "situation", "challenge", "decisionPrompt", "modelDebrief", "keyTakeaway" }.
   - "case_study" (stageHint: 5): exact case study "id" in "targetId", exact "moduleId", numeric "moduleNumber". patchPayload: { "title", "background", "analysisQuestions", "facilitatorNotes" }.
   - "knowledge_check" (stageHint: 5): exact knowledge check "id" in "targetId", exact "moduleId", numeric "moduleNumber". patchPayload: { "question", "options", "correctIndex", "explanation", "outcomeCode" }.
   - "assessment_item" (stageHint: 4): exact assessment "id" in "targetId". patchPayload: { "title", "instructions", "promptOrQuestion", "modelAnswer", "markingGuide", "outcomeIds", "rubric" }.
   - "curriculum_module" (stageHint: 2): exact module "id" in "targetId"/"moduleId" or { "modules": [...] }.
   - "brief_note" (stageHint: 1): brief fields { "title", "code", "industryDomain", "purpose", "workplaceProblem", "targetAudience", "estimatedDuration", "subjectTopicsInput", "aiIntegrationMode" }. If metadataLocked is true, preserve protected metadata and tell the user clearly.
4. "patchPayload" MUST contain real updated fields — NEVER empty. Mark "executionMode": "direct" for minor scoped phrasing/explanation improvements, or "confirm" for major structural/module/assessment/outcome changes.
5. MULTI-REQUIREMENT HANDLING: If the user asks for multiple changes in one message (e.g., simplify intro + verify alignment + preserve technical accuracy), address EVERY part explicitly in "reply" and create separate "proposedChanges" entries for each distinct section.
6. READ-ONLY UI COPY: If the selected excerpt is Stage 6/7 interface instructions (e.g., QA sign-off/publish UI prompts) rather than course content, explain clearly what action is needed in the app and return "proposedChanges": [].
Return ONLY valid JSON.`,
    prompt: `ACTIVE COURSE CONTEXT:
${JSON.stringify(compactContext)}
${selectedBlock}
RECENT CONVERSATION:
${historyText}

DEVELOPER MESSAGE:
${params.userMessage}

Return JSON:
{
  "reply": "Clear, actionable instructional design response addressing every part of the user's request and referencing exact Stages/Modules/Sources",
  "proposedChanges": [
    {
      "id": "prop-${Date.now()}",
      "targetType": "outcome | lesson | module_content | scenario | case_study | knowledge_check | assessment_item | curriculum_module | brief_note",
      "targetId": "exact id copied from ACTIVE COURSE CONTEXT (or omitted for brief_note)",
      "moduleId": "exact moduleId copied from ACTIVE COURSE CONTEXT (if applicable)",
      "moduleNumber": 1,
      "stageHint": 5,
      "executionMode": "confirm",
      "title": "Short label describing this proposed change",
      "rationale": "Why this fixes the issue or satisfies the request",
      "beforePreview": "Optional current snippet",
      "afterPreview": "Proposed updated text",
      "patchPayload": { "explanation": "..." },
      "status": "pending"
    }
  ]
}`,
  });

  const parsed = extractAndParseJSON<any>(res.text);
  const stageFallbackByType: Record<string, 1 | 2 | 3 | 4 | 5 | 6 | 7> = {
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
  return {
    reply: parsed.reply || 'Here are my instructional design recommendations.',
    proposedChanges: Array.isArray(parsed.proposedChanges)
      ? parsed.proposedChanges.map((p: any, idx: number) => ({
          ...p,
          id: p.id || `prop-${Date.now()}-${idx}`,
          executionMode: p.executionMode === 'direct' ? 'direct' : 'confirm',
          stageHint:
            p.stageHint && p.stageHint >= 1 && p.stageHint <= 7
              ? p.stageHint
              : stageFallbackByType[p.targetType] || activeStage,
          status: 'pending' as const,
        }))
      : [],
  };
}

/* ============================================================================
 * 11. EXTRACT REUSABLE TEMPLATE FROM UPLOADED DOCUMENT
 * ============================================================================ */
export async function extractTemplateFromDocumentWithAI(params: {
  fileName: string;
  extractedText: string;
  provider?: AIProvider;
  model?: string;
}): Promise<Partial<CourseTemplate>> {
  const res = await aiRouter.execute({
    provider: params.provider,
    model: params.model,
    responseFormat: 'json',
    systemInstruction: `You are an instructional-design template architect.
Analyse the uploaded document and convert its structure into a reusable eStudy V2 CourseTemplate with modular sections, placeholders ({{...}}), and required/optional field flags.
Return ONLY valid JSON.`,
    prompt: `Extract a reusable course template from "${params.fileName}":
${params.extractedText.slice(0, 12000)}

Return JSON:
{
  "name": "Template Name",
  "category": "Category",
  "description": "What programmes this template supports",
  "version": "v1.0",
  "defaultAiMode": "optional",
  "qualityRules": ["Quality rule 1", "Quality rule 2"],
  "sections": [
    {
      "id": "sec-1",
      "title": "Section Title",
      "description": "Section purpose",
      "required": true,
      "order": 1,
      "fields": [
        {
          "id": "fld-1",
          "key": "fieldKey",
          "label": "Field Label",
          "placeholder": "{{Insert ...}}",
          "fieldType": "textarea",
          "required": true,
          "helpText": "Guidance for course developer"
        }
      ]
    }
  ]
}`,
  });

  return extractAndParseJSON(res.text);
}

/* ============================================================================
 * 12. NEW COURSE COPILOT: DRAFT BRIEF, TEMPLATE PLACEHOLDERS & MODULE OUTLINE
 * ============================================================================ */
export async function draftCourseFromCopilotPromptWithAI(params: {
  prompt: string;
  template?: CourseTemplate;
  currentBrief?: Partial<CourseBrief>;
  currentModules?: CurriculumModulePlan[];
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  provider?: AIProvider;
  model?: string;
}): Promise<{
  reply: string;
  brief: Partial<CourseBrief>;
  suggestedModuleCount: number;
  modules: CurriculumModulePlan[];
  suggestedFollowUps: string[];
}> {
  const templateFields = (params.template?.sections || []).flatMap(sec =>
    sec.fields.map(f => ({
      key: f.key,
      label: f.label,
      placeholder: f.placeholder,
      required: f.required,
      helpText: f.helpText || '',
    }))
  );

  const historyText = (params.messages || [])
    .slice(-8)
    .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
    .join('\n');

  const res = await aiRouter.execute({
    provider: params.provider,
    model: params.model,
    responseFormat: 'json',
    systemInstruction: `You are the eStudy Course Copilot — helping instructional designers and first-time course creators turn a plain-language course idea into a complete, well-structured Stage 1 Course Brief, template placeholder values, and starter module outline.

CRITICAL RULES:
1. Fill ALL relevant Stage 1 Brief fields clearly and specifically for the user's requested subject — NEVER leave generic "{{...}}" placeholder strings in any output field.
2. Fill EVERY template field key listed under TEMPLATE FIELDS inside "brief.templateFieldValues" with domain-specific, practical instructional content matching that field's label/purpose.
3. If the user asks for a specific number of modules (e.g. "6 modules"), generate EXACTLY that number of detailed starter modules in "modules" (with topics and lessons). Otherwise generate an optimal 4 to 6 modules suited to the subject and duration.
4. Honesty & Metadata Integrity:
   - Never fabricate official SAQA/QCTO qualification IDs, SETA accreditation claims, or unverified legislation.
   - Suggest a sensible provisional Course Code (e.g. "EST-GENAI-101") and mark "code" as "to_be_confirmed" in "fieldStatuses" so the user knows they can edit or confirm it.
   - Use "Entry / Foundational", "Intermediate", "Advanced", or "Executive / Specialist" for "experienceLevel".
   - Use "none", "optional", or "core" for "aiIntegrationMode" strictly based on whether AI belongs in the course subject.
5. If "CURRENT DRAFT BRIEF" already has user-entered values, preserve them unless the user's latest prompt explicitly asks to change or refine them.
Return ONLY valid JSON.`,
    prompt: `USER PROMPT:
${params.prompt}

SELECTED TEMPLATE: ${params.template?.name || 'eStudy Master Course Generation Template v9.0'} (defaultAiMode: ${params.template?.defaultAiMode || 'optional'})
TEMPLATE FIELDS TO POPULATE IN brief.templateFieldValues:
${JSON.stringify(templateFields, null, 2)}

CURRENT DRAFT BRIEF (refine/complete any missing or requested fields):
${JSON.stringify(params.currentBrief || {}, null, 2)}

CONVERSATION HISTORY:
${historyText || 'None'}

Return JSON matching this exact schema:
{
  "reply": "Warm, concise explanation of the drafted course brief, placeholders, and module structure, noting any items marked To Be Confirmed.",
  "brief": {
    "title": "Course Title",
    "code": "EST-SUBJ-101",
    "industryDomain": "Specific Industry / Subject Domain",
    "purpose": "Clear 2-3 sentence workplace capability goal",
    "workplaceProblem": "Concrete workplace performance gap or operational need addressed",
    "targetAudience": "Specific target learners",
    "targetJobRoles": "Specific job roles (comma-separated)",
    "experienceLevel": "Entry / Foundational | Intermediate | Advanced | Executive / Specialist",
    "prerequisites": "Realistic prior knowledge or 'None required for foundational entry'",
    "estimatedDuration": "e.g. 8 Hours or 2 Days",
    "language": "English (South African Context)",
    "learningRequirements": "Pedagogical depth, hands-on tasks, and verification boundaries",
    "subjectTopicsInput": "Topic 1\\nTopic 2\\nTopic 3\\nTopic 4\\nTopic 5",
    "aiIntegrationMode": "none | optional | core",
    "aiIntegrationRequirements": "Specific AI tools/governance scope or 'Not applicable'",
    "templateFieldValues": {
      "fieldKeyFromTemplate": "Drafted field content replacing placeholder"
    },
    "fieldStatuses": {
      "title": "confirmed",
      "code": "to_be_confirmed",
      "estimatedDuration": "to_be_confirmed"
    }
  },
  "suggestedModuleCount": 6,
  "modules": [
    {
      "id": "mod-1",
      "order": 1,
      "title": "Module 1 Title",
      "qctoModuleType": "Standard Module",
      "purpose": "Specific module purpose",
      "objectives": ["Measurable objective 1", "Measurable objective 2"],
      "competencies": ["Workplace competency 1"],
      "topics": [
        { "id": "top-1-1", "title": "Topic 1.1", "subtopics": ["Subtopic A", "Subtopic B"] }
      ],
      "lessons": [
        { "id": "les-1-1", "title": "Lesson 1.1", "durationMinutes": 35, "purpose": "What learners do", "keyTerms": ["Term 1"] }
      ]
    }
  ],
  "suggestedFollowUps": [
    "Make it beginner-friendly with hands-on exercises",
    "Adjust duration to 12 hours and add POPIA governance",
    "Tailor examples for South African retail teams"
  ]
}`,
  });

  const parsed = extractAndParseJSON<any>(res.text);
  const rawModules = Array.isArray(parsed.modules) ? parsed.modules : [];
  const modules: CurriculumModulePlan[] = rawModules.map((m: any, idx: number) => ({
    id: m.id || `mod-${Date.now()}-${idx + 1}`,
    order: idx + 1,
    title: m.title || `Module ${idx + 1}`,
    qctoModuleType: m.qctoModuleType || 'Standard Module',
    purpose: m.purpose || '',
    objectives: Array.isArray(m.objectives) ? m.objectives : [],
    competencies: Array.isArray(m.competencies) ? m.competencies : [],
    topics: Array.isArray(m.topics) ? m.topics : [],
    lessons: Array.isArray(m.lessons) ? m.lessons : [],
  }));

  return {
    reply: parsed.reply || 'I have drafted the Course Brief fields, template placeholders, and starter modules based on your prompt.',
    brief: parsed.brief || {},
    suggestedModuleCount: Number(parsed.suggestedModuleCount) || modules.length || 4,
    modules,
    suggestedFollowUps: Array.isArray(parsed.suggestedFollowUps)
      ? parsed.suggestedFollowUps.slice(0, 3)
      : [],
  };
}

/* ============================================================================
 * 13. TEMPLATE COPILOT: CREATE OR REFINE A CUSTOM COURSE TEMPLATE FROM PROMPT
 * ============================================================================ */
function toSafeCamelKey(raw: string, fallbackIndex: number): string {
  const cleaned = String(raw || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9\s_]/g, ' ')
    .trim()
    .split(/[\s_]+/)
    .filter(Boolean);
  if (cleaned.length === 0) return `customField${fallbackIndex}`;
  return cleaned
    .map((word, idx) =>
      idx === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join('')
    .replace(/^[0-9]+/, 'f');
}

export async function generateOrRefineTemplateWithCopilotAI(params: {
  prompt: string;
  currentTemplate?: Partial<CourseTemplate> | null;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  provider?: AIProvider;
  model?: string;
}): Promise<{
  reply: string;
  template: CourseTemplate;
  suggestedFollowUps: string[];
}> {
  const historyText = (params.messages || [])
    .slice(-8)
    .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
    .join('\n');

  const isRefining = Boolean(params.currentTemplate && params.currentTemplate.name);

  const res = await aiRouter.execute({
    provider: params.provider,
    model: params.model,
    responseFormat: 'json',
    systemInstruction: `You are the eStudy Template Copilot — a senior instructional-design architect who designs reusable, Word-downloadable CourseTemplates for the eStudy Master Course Builder.

CRITICAL DESIGN RULES:
1. Note that eStudy's Stage 1 Core Course Brief ALREADY collects Course Title, Course Code, Industry Domain, Target Audience, Job Roles, Experience Level, Duration, Purpose, Workplace Problem, Mandatory Topics, AI Integration Mode, and NQF/SETA fields. Do NOT waste template sections repeating those generic brief fields — focus template sections and fields on the domain-specific instructional, regulatory, assessment, operational, or lab architecture unique to the user's request!
2. Build a comprehensive, practical, domain-tailored CourseTemplate with 3 to 6 logical sections and 2 to 5 fields per section (unless the user explicitly asks for more or fewer sections/fields).
3. Every field MUST have:
   - unique camelCase "key" (no spaces or special characters)
   - clear "label"
   - actionable placeholder formatted strictly as "[INSERT: SPECIFIC GUIDANCE]" (e.g. "[INSERT: APPLICABLE SANS STANDARDS OR WORKPLACE SOPS]") so it renders in the eStudy Master v9.0 Word callout boxes and cleanly parses back on upload
   - "fieldType": one of "text", "textarea", "select", "list", or "boolean"
   - "required": boolean
   - "helpText": concise instruction for the course author
   - "options": string array ONLY when fieldType is "select"
4. Include 3 to 6 domain-specific "qualityRules" that QA & authors must enforce when building courses with this template.
5. Set "defaultAiMode" to "none", "optional", or "core" based on the template domain.
6. ${
      isRefining
        ? 'You are REFINING the provided CURRENT TEMPLATE. Preserve existing sections and fields that do not conflict with the user instruction while applying all requested additions, removals, or edits.'
        : 'You are creating a BRAND NEW template tailored closely to the user prompt.'
    }
7. Never fabricate official SAQA/QCTO qualification IDs or unverified statutory registration claims.
Return ONLY valid JSON.`,
    prompt: `USER REQUEST:
${params.prompt}

${
  isRefining
    ? `CURRENT TEMPLATE TO REFINE:
${JSON.stringify(params.currentTemplate, null, 2)}`
    : 'MODE: Create a brand-new reusable CourseTemplate.'
}

CONVERSATION HISTORY:
${historyText || 'None'}

Return JSON matching this exact schema:
{
  "reply": "Clear 2-3 sentence summary explaining the template created or updated, its key sections, and how an author fills it in.",
  "template": {
    "name": "Descriptive Template Name",
    "category": "e.g. Technical / Engineering, Compliance & Governance, Corporate Enablement, Healthcare, Vocational Skills",
    "description": "1-2 sentence explanation of the programmes this template supports and what standards it enforces.",
    "version": "v1.0",
    "defaultAiMode": "optional",
    "qualityRules": [
      "Quality assurance rule 1",
      "Quality assurance rule 2",
      "Quality assurance rule 3"
    ],
    "sections": [
      {
        "title": "Section Title (without leading number prefix)",
        "description": "What this section captures and why it matters.",
        "required": true,
        "fields": [
          {
            "key": "uniqueCamelCaseKey",
            "label": "Field Label",
            "placeholder": "[INSERT: SPECIFIC AUTHOR PROMPT]",
            "fieldType": "textarea",
            "required": true,
            "helpText": "Brief author guidance",
            "options": []
          }
        ]
      }
    ]
  },
  "suggestedFollowUps": [
    "Add a practical workplace assessment rubric section",
    "Include South African NQF / SETA alignment fields",
    "Make safety & verification fields mandatory"
  ]
}`,
  });

  const parsed = extractAndParseJSON<any>(res.text);
  const rawTpl = parsed?.template && typeof parsed.template === 'object' ? parsed.template : parsed;
  const now = new Date().toISOString();
  const baseStamp = Date.now();
  const usedKeys = new Set<string>();
  const allowedTypes = new Set(['text', 'textarea', 'select', 'list', 'boolean']);

  const rawSections = Array.isArray(rawTpl?.sections) ? rawTpl.sections : [];
  const sections = rawSections.map((sec: any, sIdx: number) => {
    const rawFields = Array.isArray(sec?.fields) ? sec.fields : [];
    const fields = rawFields.map((fld: any, fIdx: number) => {
      let candidateKey = toSafeCamelKey(fld?.key || fld?.label, sIdx * 10 + fIdx + 1);
      while (usedKeys.has(candidateKey)) {
        candidateKey = `${candidateKey}${fIdx + 2}`;
      }
      usedKeys.add(candidateKey);

      const rawType = String(fld?.fieldType || 'textarea').toLowerCase();
      const fieldType = (allowedTypes.has(rawType) ? rawType : 'textarea') as
        | 'text'
        | 'textarea'
        | 'select'
        | 'list'
        | 'boolean';

      const rawPlaceholder = String(fld?.placeholder || '').trim();
      const labelStr = String(fld?.label || `Field ${fIdx + 1}`).trim();
      const placeholder = /^\[INSERT\b/i.test(rawPlaceholder)
        ? rawPlaceholder
        : `[INSERT: ${(rawPlaceholder.replace(/^\{\{|\}\}$/g, '') || labelStr).toUpperCase()}]`;

      const options =
        fieldType === 'select' && Array.isArray(fld?.options)
          ? fld.options.map((o: any) => String(o).trim()).filter(Boolean)
          : undefined;

      return {
        id: String(fld?.id || `fld-${baseStamp}-${sIdx + 1}-${fIdx + 1}`),
        key: candidateKey,
        label: labelStr,
        placeholder,
        fieldType,
        required: Boolean(fld?.required),
        helpText: fld?.helpText ? String(fld.helpText).trim() : undefined,
        ...(options && options.length > 0 ? { options } : {}),
      };
    });

    const cleanTitle = String(sec?.title || `Section ${sIdx + 1}`)
      .trim()
      .replace(/^\d+\.\s*/, '');

    return {
      id: String(sec?.id || `sec-${baseStamp}-${sIdx + 1}`),
      title: `${sIdx + 1}. ${cleanTitle}`,
      description: String(sec?.description || '').trim(),
      required: sec?.required !== undefined ? Boolean(sec.required) : sIdx === 0,
      order: sIdx + 1,
      fields,
    };
  });

  const aiModeRaw = String(rawTpl?.defaultAiMode || 'optional').toLowerCase();
  const defaultAiMode: 'none' | 'optional' | 'core' =
    aiModeRaw === 'none' || aiModeRaw === 'core' ? aiModeRaw : 'optional';

  const qualityRules = Array.isArray(rawTpl?.qualityRules)
    ? rawTpl.qualityRules.map((r: any) => String(r).trim()).filter(Boolean)
    : ['Verify all metadata, statutory standards, and learning outcome alignment before export.'];

  const preservedId =
    isRefining && params.currentTemplate?.id && !params.currentTemplate?.isSystemReference
      ? String(params.currentTemplate.id)
      : `tpl-custom-${baseStamp}`;

  const template: CourseTemplate = {
    id: preservedId,
    name: String(rawTpl?.name || 'Custom AI-Designed Template').trim(),
    category: String(rawTpl?.category || 'Custom').trim(),
    description: String(
      rawTpl?.description || 'Reusable custom instructional-design template created with Template Copilot.'
    ).trim(),
    version: String(rawTpl?.version || 'v1.0').trim(),
    isSystemReference: false,
    defaultAiMode,
    qualityRules:
      qualityRules.length > 0
        ? qualityRules
        : ['Verify all metadata, statutory standards, and learning outcome alignment before export.'],
    sections,
    createdAt:
      isRefining && params.currentTemplate?.createdAt
        ? String(params.currentTemplate.createdAt)
        : now,
    updatedAt: now,
  };

  return {
    reply:
      String(parsed?.reply || '').trim() ||
      `Created "${template.name}" with ${template.sections.length} structured sections ready to edit, save, or download as Word (.docx).`,
    template,
    suggestedFollowUps: Array.isArray(parsed?.suggestedFollowUps)
      ? parsed.suggestedFollowUps.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 3)
      : [],
  };
}

