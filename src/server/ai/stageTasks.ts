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
  SourceConflict,
  SourceDocument,
} from '../../types.js';
import { aiRouter, extractAndParseJSON } from './aiRouter.js';

function summarizeSourcesForPrompt(sources: SourceDocument[]): string {
  if (!sources || sources.length === 0) return 'No external source documents uploaded.';
  return sources
    .map(
      (s, i) =>
        `[Source ${i + 1}: ${s.title} | Org/Author: ${s.authorOrOrganisation || 'Unknown'} | Status: ${s.verificationStatus} | Ref: ${s.referenceOrUrl || s.fileName || 'N/A'}]\nExcerpt:\n${(s.extractedText || s.summary || '').slice(0, 3500)}`
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
    "verificationStatus": "VERIFIED"
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
CRITICAL CURRICULUM PRESERVATION RULES:
1. Every subject topic supplied in the brief and sources is AUTHORITATIVE. NEVER silently omit, replace, or over-generalise required subject matter.
2. Do NOT force every course into 3 modules or a generic AI/SOP structure. Adapt module count, titles, and sequencing to the actual subject, duration (${params.brief.estimatedDuration || 'unspecified'}), and learner level (${params.brief.experienceLevel}).
3. If AI integration mode is "none", do NOT inject AI modules or AI topics.
4. If QCTO module pattern is enabled (${params.brief.saCompliance?.qctoModulePattern ? 'YES' : 'NO'}), tag modules appropriately as "Knowledge Module", "Practical Skill Module", or "Work Experience Module"; otherwise use "Standard Module".
5. Build an exhaustive coverageChecks array comparing EVERY supplied topic against your proposed curriculum (status: "mapped", "omitted", "generalised", "clarification_needed", or "recommended").
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
2. Use diverse, appropriate formats from: "mcq", "multi_response", "matching", "sequencing", "short_answer", "case_study", "branching_scenario", "problem_solving", "practical_task", "competency_demo", "reflection".
3. EVERY module outcome in moduleOutcomes MUST be mapped via outcomeIds to at least one assessment item!
4. If an outcome expects practical demonstration/application (e.g., Apply, Perform, Inspect, Role-play, Troubleshoot), include a practical item (practical_task, competency_demo, case_study, branching_scenario, or problem_solving)—NOT recall MCQs alone.
5. Every item MUST include: objective, instructions, promptOrQuestion, modelAnswer, explanation, feedbackCorrect, feedbackIncorrect, markingGuide, and a 100%-weighted evaluation rubric for practical/open items.
6. Weightings across items should clearly distinguish formative vs summative assessments.
Return ONLY valid JSON.`,
    prompt: `Design Stage 4 Assessment Plan for:
Course: ${params.brief.title} (${params.brief.industryDomain})
Target Roles: ${params.brief.targetJobRoles || params.brief.targetAudience}
Experience Level: ${params.brief.experienceLevel}
Learning Requirements: ${params.brief.learningRequirements}

Modules:
${JSON.stringify(params.curriculum.modules.map(m => ({ id: m.id, title: m.title, order: m.order })))}

All Approved Outcomes (EVERY outcome ID must be assessed):
${JSON.stringify(allOutcomes)}

Return JSON:
{
  "strategySummary": "Clear strategy balancing knowledge vs practical competence and formative vs summative",
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
    timeoutMs: 110000,
    systemInstruction: `You are a senior subject-matter educator authoring Module ${params.modulePlan.order} of "${params.brief.title}" for "${params.brief.targetAudience}" (${params.brief.experienceLevel}).
NON-NEGOTIABLE STANDARDS:
1. Teach EVERY topic, subtopic, and lesson in the approved module plan with authentic subject depth.
2. ${aiRule}
3. Adapt technical rigour to "${params.brief.experienceLevel}". For technical/STEM topics, preserve exact equations, units, assumptions, and calculations.
4. NEVER use generic filler, padding, or repeat explanations already covered in other modules (${otherModuleTitles || 'none'}).
5. Scenarios and case studies MUST reflect "${params.brief.industryDomain}" and job roles "${params.brief.targetJobRoles || params.brief.targetAudience}" in a realistic South African workplace context.
6. Source Honesty: Tag factual/regulatory claims in sourceClaims as "VERIFIED" only when grounded in the supplied sources, "NEEDS REVIEW" when specialist confirmation is required, or "UNSUPPORTED" if no source evidence exists. Never invent statistics, Act sections, or accreditation claims.
Return ONLY valid JSON.`,
    prompt: `Author full learning content for Module ${params.modulePlan.order}: "${params.modulePlan.title}".

COURSE BRIEF:
- Title: ${params.brief.title} (${params.brief.code})
- Domain: ${params.brief.industryDomain}
- Purpose: ${params.brief.purpose}
- Language: ${params.brief.language}
- Learning Requirements: ${params.brief.learningRequirements}

APPROVED MODULE PLAN:
${JSON.stringify(params.modulePlan, null, 2)}

APPROVED MODULE OUTCOMES:
${JSON.stringify(modOutcomes, null, 2)}

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
      "outcomeIds": ${JSON.stringify(modOutcomes.slice(0, 2).map(o => o.id))},
      "title": "Exact lesson title",
      "durationMinutes": 35,
      "explanation": "Rich, clear, subject-specific teaching prose (350-600 words) with structured subheadings, mechanics, equations/rules if technical, and common misconceptions",
      "keyTerminology": [{ "term": "Term", "definition": "Accurate domain definition" }],
      "workedExamples": ["Detailed worked example or step-by-step demonstration"],
      "practicalApplication": "Concrete workplace application for target roles",
      "guidedActivity": "Structured hands-on learner activity",
      "sourceClaims": [
        { "id": "clm-1", "claim": "Key technical or regulatory statement made in this lesson", "sourceTitle": "Source name or None", "status": "VERIFIED" }
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
      | 'assessment_item'
      | 'curriculum_module'
      | 'brief_note';
    targetId?: string;
    moduleId?: string;
    title: string;
    rationale: string;
    beforePreview?: string;
    afterPreview: string;
    patchPayload: Record<string, any>;
    status: 'pending';
  }>;
}> {
  const activeStage = params.project.currentStage;
  const compactContext = {
    stage: activeStage,
    brief: {
      title: params.project.brief.title,
      code: params.project.brief.code,
      domain: params.project.brief.industryDomain,
      audience: params.project.brief.targetAudience,
      level: params.project.brief.experienceLevel,
      duration: params.project.brief.estimatedDuration,
      aiMode: params.project.brief.aiIntegrationMode,
    },
    modules: params.project.curriculum.modules.map(m => ({
      id: m.id,
      order: m.order,
      title: m.title,
      lessons: m.lessons.map(l => ({ id: l.id, title: l.title })),
    })),
    coverageGaps: params.project.curriculum.coverageChecks.filter(c => c.status !== 'mapped'),
    outcomes: [
      ...params.project.outcomes.courseOutcomes,
      ...params.project.outcomes.moduleOutcomes,
    ].slice(0, 20),
    alignmentFlags: params.project.assessments.alignmentFlags,
    latestQASummary: params.project.latestQA
      ? {
          verdict: params.project.latestQA.verdict,
          weightedScore: params.project.latestQA.weightedScore,
          criticalFailures: params.project.latestQA.criticalFailures,
          weaknesses: params.project.latestQA.dimensions.flatMap(d => d.weaknesses),
        }
      : null,
    sources: params.project.sources.map(s => ({
      id: s.id,
      title: s.title,
      status: s.verificationStatus,
    })),
  };

  const historyText = params.messages
    .slice(-8)
    .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
    .join('\n');

  const res = await aiRouter.execute({
    provider: params.provider,
    model: params.model,
    responseFormat: 'json',
    systemInstruction: `You are the eStudy Course Copilot — a senior instructional design partner.
CRITICAL RULES:
1. You understand the active course, approved curriculum, outcomes, sources, QA findings, and current stage (${activeStage}/7).
2. NEVER silently modify approved course metadata or content.
3. When the developer asks you to improve an outcome, rewrite a lesson, refine a scenario, fix a rubric/assessment, address a QA finding, OR initialize/set a course title, scope, or module outline (for example creating a 6-module "GEN AI" course), provide clear step-by-step guidance in "reply" AND include structured proposals in "proposedChanges" so the developer can click Accept Change or Reject:
   - For course title/purpose/topics/AI mode updates, use "targetType": "brief_note" with fields inside "patchPayload" (e.g. { "title": "GEN AI", "aiIntegrationMode": "core", "purpose": "...", "subjectTopicsInput": "..." }).
   - For proposing a full list of modules, use "targetType": "curriculum_module" with "patchPayload": { "modules": [ { "title": "...", "purpose": "...", "objectives": ["..."], "competencies": ["..."], "topics": [{ "id": "top-1", "title": "...", "subtopics": [] }], "lessons": [{ "id": "les-1", "title": "...", "durationMinutes": 45, "purpose": "...", "keyTerms": [] }] } ] }.
   - Remind them they can also set the module count in Stage 2 ("Modules (auto)") and click "Propose Curriculum" after approving Stage 1.
4. Use plain, clear instructional-design language.
Return ONLY valid JSON.`,
    prompt: `ACTIVE COURSE CONTEXT:
${JSON.stringify(compactContext, null, 2)}

RECENT CONVERSATION:
${historyText}

DEVELOPER MESSAGE:
${params.userMessage}

Return JSON:
{
  "reply": "Clear, actionable instructional design advice or full rewritten text ready to copy",
  "proposedChanges": [
    {
      "id": "prop-${Date.now()}",
      "targetType": "outcome | lesson | scenario | assessment_item | curriculum_module | brief_note",
      "targetId": "matching id if applicable",
      "moduleId": "matching moduleId if applicable",
      "title": "Short label describing this proposed change",
      "rationale": "Why this improves alignment or quality",
      "beforePreview": "Optional current snippet",
      "afterPreview": "Proposed updated text",
      "patchPayload": { "statement": "..." },
      "status": "pending"
    }
  ]
}`,
  });

  const parsed = extractAndParseJSON<any>(res.text);
  return {
    reply: parsed.reply || 'Here are my instructional design recommendations.',
    proposedChanges: Array.isArray(parsed.proposedChanges)
      ? parsed.proposedChanges.map((p: any, idx: number) => ({
          ...p,
          id: p.id || `prop-${Date.now()}-${idx}`,
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
