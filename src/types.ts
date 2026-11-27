export type AIProvider = 'groq';

export interface AIModelMeta {
  id: string;
  provider: AIProvider;
  displayName: string;
  description: string;
  contextWindow: number;
  enabledForCourseGeneration: boolean;
  enabledForCopilot: boolean;
  isDefault?: boolean;
  recommendedBadge?: string;
}

export type CourseLifecycleStatus =
  | 'draft'
  | 'in_development'
  | 'awaiting_review'
  | 'revision_required'
  | 'completed';

export type CourseCreationMode = 'copilot' | 'brief' | 'source' | 'improve' | 'filled_template';

export type WorkflowStage = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type FieldStatus =
  | 'confirmed'
  | 'to_be_confirmed'
  | 'requires_sme_validation'
  | 'not_applicable';

export type SourceVerificationStatus =
  | 'VERIFIED'
  | 'NEEDS REVIEW'
  | 'UNSUPPORTED';

export interface ApprovalRecord {
  approved: boolean;
  approvedAt?: string;
  approvedBy?: string;
  notes?: string;
}

/* ---------------- TEMPLATE SYSTEM ---------------- */

export interface TemplateField {
  id: string;
  key: string;
  label: string;
  placeholder: string;
  fieldType: 'text' | 'textarea' | 'select' | 'list' | 'boolean';
  required: boolean;
  defaultValue?: string;
  helpText?: string;
  options?: string[];
}

export interface TemplateSection {
  id: string;
  title: string;
  description: string;
  required: boolean;
  order: number;
  fields: TemplateField[];
}

export interface CourseTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  version: string;
  isSystemReference?: boolean;
  defaultAiMode: 'none' | 'optional' | 'core';
  qualityRules: string[];
  sections: TemplateSection[];
  companyId?: string | null;
  visibility?: 'system' | 'company';
  localSourceId?: string;
  createdAt: string;
  updatedAt: string;
}

/* ---------------- SOURCE MANAGEMENT ---------------- */

export interface SourceDocument {
  id: string;
  title: string;
  authorOrOrganisation: string;
  publicationDate: string;
  version: string;
  referenceOrUrl: string;
  fileName?: string;
  mimeType?: string;
  extractedText: string;
  relevantSections: string[];
  verificationStatus: SourceVerificationStatus;
  verifiedBy?: string;
  verifiedAt?: string;
  verificationNotes?: string;
  summary?: string;
  keyTopics?: string[];
  storagePath?: string;
  fileSizeBytes?: number;
  cloudDocumentId?: string;
  addedAt: string;
}

export interface SourceConflict {
  id: string;
  topic: string;
  sourceAId: string;
  sourceATitle: string;
  claimA: string;
  sourceBId: string;
  sourceBTitle: string;
  claimB: string;
  resolutionStatus: 'unresolved' | 'resolved';
  resolutionDecision?: string;
}

/* ---------------- STAGE 1: COURSE BRIEF ---------------- */

export interface SAComplianceProfile {
  enabled: boolean;
  nqfLevel: string;
  saqaRelevant: boolean;
  saqaNotes: string;
  qctoRelevant: boolean;
  qctoModulePattern: boolean;
  setaName: string;
  professionalBodyCpd: string;
  popiaRelevant: boolean;
  industryLegislation: string;
  technicalStandards: string;
  accreditationDisclaimerAccepted: boolean;
}

export interface BriefAnalysisResult {
  analysedAt: string;
  summary: string;
  missingInformation: Array<{
    field: string;
    recommendedStatus: FieldStatus;
    reason: string;
  }>;
  contradictions: string[];
  recommendedClarifications: string[];
  extractedTopics: string[];
}

export interface CourseBrief {
  title: string;
  code: string;
  industryDomain: string;
  purpose: string;
  workplaceProblem: string;
  targetAudience: string;
  targetJobRoles: string;
  experienceLevel: 'Entry / Foundational' | 'Intermediate' | 'Advanced' | 'Executive / Specialist' | string;
  prerequisites: string;
  estimatedDuration: string;
  language: string;
  learningRequirements: string;
  subjectTopicsInput: string;
  aiIntegrationMode: 'none' | 'optional' | 'core';
  aiIntegrationRequirements: string;
  saCompliance: SAComplianceProfile;
  templateFieldValues: Record<string, string>;
  fieldStatuses: Record<string, FieldStatus>;
  fieldStatusNotes?: Record<string, string>;
  metadataLocked: boolean;
  analysis?: BriefAnalysisResult;
  approval: ApprovalRecord;
}

/* ---------------- STAGE 2: CURRICULUM ARCHITECTURE ---------------- */

export interface CurriculumTopic {
  id: string;
  title: string;
  subtopics: string[];
}

export interface CurriculumLessonPlan {
  id: string;
  title: string;
  durationMinutes: number;
  purpose: string;
  keyTerms: string[];
  outcomeIds?: string[];
}

export interface CurriculumModulePlan {
  id: string;
  order: number;
  title: string;
  qctoModuleType?: 'Knowledge Module' | 'Practical Skill Module' | 'Work Experience Module' | 'Standard Module';
  purpose: string;
  objectives: string[];
  competencies: string[];
  topics: CurriculumTopic[];
  lessons: CurriculumLessonPlan[];
}

export type CoverageStatus =
  | 'mapped'
  | 'omitted'
  | 'generalised'
  | 'clarification_needed'
  | 'recommended';

export interface CoverageCheckItem {
  id: string;
  originalTopic: string;
  status: CoverageStatus;
  mappedModuleId?: string;
  mappedLocation: string;
  notes: string;
}

export interface CurriculumConflict {
  id: string;
  description: string;
  resolved: boolean;
  decision?: string;
}

export interface CurriculumArchitecture {
  rationale: string;
  modules: CurriculumModulePlan[];
  coverageChecks: CoverageCheckItem[];
  conflicts: CurriculumConflict[];
  approval: ApprovalRecord;
}

/* ---------------- STAGE 3: LEARNING OUTCOMES ---------------- */

export type BloomLevel =
  | 'Remember'
  | 'Understand'
  | 'Apply'
  | 'Analyze'
  | 'Evaluate'
  | 'Create';

export interface LearningOutcome {
  id: string;
  scope: 'course' | 'module';
  moduleId?: string;
  code: string;
  actionVerb: string;
  bloomLevel: BloomLevel;
  statement: string;
  workplacePerformance: string;
  nqfAlignmentNote?: string;
  vagueWarning?: string;
}

export interface LearningOutcomesPlan {
  courseOutcomes: LearningOutcome[];
  moduleOutcomes: LearningOutcome[];
  durationRealismNote: string;
  nqfSummaryNote: string;
  approval: ApprovalRecord;
}

/* ---------------- STAGE 4: ASSESSMENT DESIGN ---------------- */

export type AssessmentItemType =
  | 'mcq'
  | 'multi_response'
  | 'matching'
  | 'sequencing'
  | 'short_answer'
  | 'case_study'
  | 'branching_scenario'
  | 'problem_solving'
  | 'practical_task'
  | 'competency_demo'
  | 'reflection';

export interface AssessmentRubricCriterion {
  criterion: string;
  weightPercent: number;
  competentStandard: string;
  notYetCompetentIndicator: string;
}

export interface AssessmentItem {
  id: string;
  moduleId?: string;
  title: string;
  type: AssessmentItemType;
  assessmentDomain: 'knowledge' | 'practical';
  classification: 'formative' | 'summative';
  outcomeIds: string[];
  weightingPercent: number;
  durationMinutes?: number;
  objective: string;
  instructions: string;
  promptOrQuestion: string;
  options?: string[];
  correctIndices?: number[];
  matchingPairs?: Array<{ prompt: string; match: string }>;
  sequenceSteps?: string[];
  modelAnswer: string;
  explanation: string;
  feedbackCorrect: string;
  feedbackIncorrect: string;
  markingGuide: string;
  rubric: AssessmentRubricCriterion[];
}

export interface AlignmentFlag {
  id: string;
  severity: 'critical' | 'warning';
  category:
    | 'untaught_outcome'
    | 'orphan_lesson'
    | 'unassessed_outcome'
    | 'uncovered_assessment'
    | 'recall_when_practical_expected'
    | 'missing_evidence'
    | 'ambiguous_item'
    | 'weak_distractors'
    | 'insufficient_competence_evidence';
  message: string;
  targetId: string;
}

export interface AlignmentMatrixRow {
  outcomeId: string;
  outcomeCode: string;
  outcomeStatement: string;
  bloomLevel: BloomLevel;
  learningActivities: Array<{ id: string; title: string; source: 'planned' | 'generated' }>;
  assessmentEvidence: Array<{
    id: string;
    title: string;
    type: AssessmentItemType;
    domain: 'knowledge' | 'practical';
  }>;
  status: 'aligned' | 'warning' | 'critical';
  gapReason?: string;
}

export interface AlignmentReport {
  scorePercent: number;
  explanation: string;
  disclaimer: string;
  rows: AlignmentMatrixRow[];
  flags: AlignmentFlag[];
  unmappedLessonIds: string[];
}

export interface AssessmentPlan {
  strategySummary: string;
  passRequirementPercent: number;
  knowledgeWeightPercent: number;
  practicalWeightPercent: number;
  thresholdsConfirmed?: boolean;
  upstreamOutcomesSignature?: string;
  items: AssessmentItem[];
  alignmentFlags: AlignmentFlag[];
  alignmentScorePercent?: number;
  approval: ApprovalRecord;
}

/* ---------------- STAGE 5: LEARNING CONTENT ---------------- */

export interface ContentClaimReference {
  id: string;
  claim: string;
  sourceId?: string;
  sourceTitle?: string;
  status: SourceVerificationStatus;
}

export interface GeneratedLessonContent {
  id: string;
  lessonPlanId?: string;
  outcomeIds?: string[];
  title: string;
  durationMinutes: number;
  explanation: string;
  keyTerminology: Array<{ term: string; definition: string }>;
  workedExamples: string[];
  practicalApplication: string;
  guidedActivity: string;
  sourceClaims: ContentClaimReference[];
  editStatus: 'ai_draft' | 'human_edited' | 'approved';
}

export interface GeneratedScenarioContent {
  id: string;
  title: string;
  contextType: 'Workplace' | 'Branching / Decision' | 'AI Application';
  situation: string;
  challenge: string;
  decisionPrompt: string;
  modelDebrief: string;
  keyTakeaway: string;
}

export interface GeneratedCaseStudyContent {
  id: string;
  title: string;
  background: string;
  analysisQuestions: string[];
  facilitatorNotes: string;
}

export interface ModuleKnowledgeCheckItem {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  outcomeCode: string;
}

export interface GeneratedModuleContent {
  id: string;
  moduleId: string;
  moduleNumber: number;
  title: string;
  introduction: string;
  learningObjectives: string[];
  lessons: GeneratedLessonContent[];
  workplaceCaseStudies: GeneratedCaseStudyContent[];
  scenarios: GeneratedScenarioContent[];
  knowledgeChecks: ModuleKnowledgeCheckItem[];
  summary: string;
  furtherLearningResources: string[];
  editStatus: 'ai_draft' | 'human_edited' | 'approved';
  lastGeneratedAt?: string;
}

export interface CourseIntroduction {
  whyThisMatters: string;
  intendedLearners: string;
  prerequisitesSummary: string;
  outcomesOverview: string;
  structureRoadmap: string;
  assessmentOverview: string;
  editStatus?: 'ai_draft' | 'human_edited';
}

export interface LearningContentPlan {
  courseIntroduction?: CourseIntroduction;
  upstreamCurriculumSignature?: string;
  upstreamOutcomesSignature?: string;
  modules: GeneratedModuleContent[];
  generationHistory: Array<{
    id: string;
    timestamp: string;
    target: string;
    provider: AIProvider;
    model: string;
    status: 'success' | 'partial' | 'failed';
    notes: string;
  }>;
  approval: ApprovalRecord;
}

/* ---------------- STAGE 6: QUALITY ASSURANCE ---------------- */

export type QADimensionId =
  | 'curriculum_coverage'
  | 'learning_outcomes'
  | 'instructional_alignment'
  | 'assessment_quality'
  | 'factual_accuracy'
  | 'regulatory_accuracy'
  | 'source_credibility'
  | 'technical_accuracy'
  | 'audience_suitability'
  | 'learning_experience'
  | 'accessibility'
  | 'presentation_quality'
  // Legacy 7-dimension IDs retained for backward compatibility with stored reports
  | 'outcomes_alignment'
  | 'content_accuracy_sources'
  | 'compliance_accessibility'
  | 'presentation_usability';

export type QAPrioritySeverity = 'critical' | 'high' | 'medium' | 'low';

export type QAVerificationOrigin =
  | 'automated'
  | 'external_verified'
  | 'unverified'
  | 'expert_review_required';

export interface QADimensionWeight {
  id: QADimensionId;
  label: string;
  weight: number;
}

export interface QADimensionResult {
  id: QADimensionId;
  label: string;
  weight: number;
  score: number;
  findings: string[];
  supportingEvidence: string[];
  weaknesses: string[];
  affectedSections: string[];
  recommendedCorrections: string[];
}

export type QAVerdict =
  | 'PASS'
  | 'PASS WITH RECOMMENDATIONS'
  | 'REVISION REQUIRED'
  | 'FAIL';

export interface QACriticalFailure {
  id: string;
  rule: string;
  description: string;
  affectedSection: string;
  recommendedFix: string;
  prioritySeverity?: QAPrioritySeverity;
  verificationOrigin?: QAVerificationOrigin;
  exampleExcerpt?: string;
}

export interface DeterministicCheckItem {
  id: string;
  label: string;
  status: 'pass' | 'warning' | 'fail';
  details: string;
  affectedSections: string[];
}

export interface AccessibilityAuditSummary {
  scorePercent: number;
  averageSentenceWords: number;
  readabilityBand: string;
  limitationsNote?: string;
  checks: DeterministicCheckItem[];
}

export interface TechnicalValidationSummary {
  verifiedClaimsCount: number;
  needsReviewClaimsCount: number;
  unsupportedClaimsCount: number;
  unverifiedBriefFieldsCount: number;
  technicalIndicatorsDetected: string[];
  checks: DeterministicCheckItem[];
}

export interface DurationValidationSummary {
  declaredDurationText: string;
  declaredMinutes: number | null;
  plannedLessonMinutes: number;
  generatedLessonMinutes: number;
  assessmentMinutes: number;
  totalReconciledMinutes: number;
  varianceMinutes: number | null;
  status: 'aligned' | 'warning' | 'fail' | 'unspecified';
  summary: string;
}

export interface AssessmentValidationSummary {
  totalItems: number;
  declaredKnowledgeWeight: number;
  declaredPracticalWeight: number;
  actualKnowledgeWeight: number;
  actualPracticalWeight: number;
  totalItemWeight: number;
  passRequirementPercent: number;
  status: 'aligned' | 'fail';
  issues: string[];
}

export interface SourceVerificationSummary {
  totalSources: number;
  verifiedSources: number;
  pendingSources: number;
  unsupportedClaims: number;
  unverifiedStatClaims: number;
  externalVerificationNote: string;
}

export interface RoleSignOffRecord {
  signedOff: boolean;
  reviewerName: string;
  reviewerUserId?: string;
  governanceRole?: GovernanceRole;
  companyId?: string;
  courseId?: string;
  status?: 'pending' | 'approved' | 'rejected';
  signedOffAt?: string;
  notes?: string;
}

export interface CourseGovernanceApprovalRecord {
  id: string;
  companyId: string;
  courseId: string;
  governanceRole: GovernanceRole;
  reviewerUserId: string;
  reviewerName: string;
  status: 'pending' | 'approved' | 'rejected';
  approvedAt: string;
  revokedAt?: string;
  notes?: string;
  active: boolean;
}

export interface QAIssueItem {
  id: string;
  severity: 'blocking' | 'warning' | 'info';
  prioritySeverity?: QAPrioritySeverity;
  verificationOrigin?: QAVerificationOrigin;
  rule: string;
  description: string;
  stage: WorkflowStage;
  affectedSection: string;
  moduleNumber?: number;
  field?: string;
  exampleExcerpt?: string;
  recommendedFix: string;
}

export interface QAEvaluationReport {
  id: string;
  evaluatedAt: string;
  evaluatedDataSignature?: string;
  weights: QADimensionWeight[];
  dimensions: QADimensionResult[];
  weightedScore: number;
  criticalFailures: QACriticalFailure[];
  blockingErrors?: QAIssueItem[];
  warnings?: QAIssueItem[];
  informationalFeedback?: QAIssueItem[];
  verdict: QAVerdict;
  verdictExplanation: string;
  accessibilityAudit?: AccessibilityAuditSummary;
  technicalValidation?: TechnicalValidationSummary;
  durationValidation?: DurationValidationSummary;
  assessmentValidation?: AssessmentValidationSummary;
  sourceVerificationSummary?: SourceVerificationSummary;
  verificationSummary?: {
    automatedCount: number;
    externalVerifiedCount: number;
    unverifiedCount: number;
    expertReviewRequiredCount: number;
    externalVerificationNote: string;
  };
  humanReviewRequirements?: string[];
  humanSignOff: {
    signedOff: boolean;
    reviewerName: string;
    signedOffAt?: string;
    notes?: string;
    roles?: {
      sme: RoleSignOffRecord;
      instructionalDesigner: RoleSignOffRecord;
      complianceAuthorizer: RoleSignOffRecord;
    };
  };
}

/* ---------------- IMPROVE EXISTING COURSE MODE ---------------- */

export interface ImproveDiagnosisItem {
  id: string;
  area: string;
  severity: 'high' | 'medium' | 'low';
  weakness: string;
  recommendation: string;
  preserveExistingNote: string;
  decision: 'pending' | 'accepted' | 'rejected';
}

export interface ImproveCourseDiagnosis {
  analysedAt: string;
  originalSummary: string;
  preservedElements: string[];
  recommendations: ImproveDiagnosisItem[];
}

/* ---------------- VERSION HISTORY & COPILOT ---------------- */

export interface CourseVersionSnapshot {
  id: string;
  versionNumber: number;
  createdAt: string;
  stage: WorkflowStage;
  trigger: 'auto_save' | 'stage_approval' | 'ai_generation' | 'manual_snapshot' | 'restore';
  summary: string;
  data: Omit<CourseProject, 'versions'>;
}

export interface CopilotProposedChange {
  id: string;
  targetType:
    | 'outcome'
    | 'lesson'
    | 'scenario'
    | 'case_study'
    | 'knowledge_check'
    | 'module_content'
    | 'assessment_item'
    | 'curriculum_module'
    | 'brief_note';
  executionMode?: 'direct' | 'confirm';
  targetId?: string;
  moduleId?: string;
  moduleNumber?: number;
  stageHint?: WorkflowStage;
  title: string;
  rationale: string;
  beforePreview?: string;
  afterPreview: string;
  patchPayload: Record<string, any>;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface SelectedTextContext {
  text: string;
  stage: WorkflowStage;
  sectionLabel: string;
  action?: 'rewrite' | 'simplify' | 'expand' | 'fix_clarity' | 'change_tone' | 'explain' | 'custom';
  moduleNumber?: number;
  moduleId?: string;
  targetType?: CopilotProposedChange['targetType'];
  targetId?: string;
  field?: string;
}

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  proposedChanges?: CopilotProposedChange[];
}

/* ---------------- ROOT COURSE PROJECT ---------------- */

export interface CourseProject {
  id: string;
  companyId?: string;
  createdBy?: string;
  localSourceId?: string;
  templateId: string;
  templateName: string;
  creationMode: CourseCreationMode;
  lifecycleStatus: CourseLifecycleStatus;
  currentStage: WorkflowStage;
  createdAt: string;
  updatedAt: string;
  sources: SourceDocument[];
  sourceConflicts: SourceConflict[];
  improveDiagnosis?: ImproveCourseDiagnosis;
  brief: CourseBrief;
  curriculum: CurriculumArchitecture;
  outcomes: LearningOutcomesPlan;
  assessments: AssessmentPlan;
  content: LearningContentPlan;
  qaHistory: QAEvaluationReport[];
  latestQA?: QAEvaluationReport;
  versions: CourseVersionSnapshot[];
}

/* ---------------- MULTI-TENANT SAAS WORKSPACE TYPES ---------------- */

export type CompanyRole = 'company_admin' | 'author' | 'reviewer' | 'viewer';

export type GovernanceRole = 'sme' | 'instructional_designer' | 'compliance_authorizer';

export type GovernanceUiRoleKey = 'sme' | 'instructionalDesigner' | 'complianceAuthorizer';

export type MembershipStatus = 'active' | 'invited' | 'suspended';

export interface CompanyWorkspace {
  id: string;
  companyName: string;
  companySlug: string;
  logoUrl?: string | null;
  primaryColour: string;
  secondaryColour: string;
  subscriptionStatus: 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled' | string;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CompanyMembership {
  id: string;
  companyId: string;
  userId: string;
  role: CompanyRole;
  governanceRoles?: GovernanceRole[];
  membershipStatus: MembershipStatus;
  createdAt: string;
  company?: CompanyWorkspace;
  profile?: UserProfile;
}

export interface AiUsageRecord {
  id: string;
  companyId: string;
  userId?: string | null;
  provider: string;
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  createdAt: string;
}

export interface AiUsageSummary {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCost: number;
  recentRecords: AiUsageRecord[];
}

