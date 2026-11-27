import crypto from 'node:crypto';
import type {
  CompanyMembership,
  CompanyWorkspace,
  CourseGovernanceApprovalRecord,
  CourseProject,
  CourseTemplate,
  CourseVersionSnapshot,
  GovernanceRole,
  QAEvaluationReport,
} from '../../src/types.js';
import type {
  TenantAuthVerifier,
  VerifiedUserSession,
} from '../../src/server/authMiddleware.js';
import type { TenantServiceAdapter } from '../../src/server/tenantRoutes.js';
import {
  canApproveGovernanceRole,
  getRolePermissions,
  GOVERNANCE_ROLE_LABELS,
  hasGenuineHumanGovernanceSignOff,
  normalizeGovernanceRoles,
} from '../../src/utils/rbac.js';

export const COMPANY_A_ID = '11111111-1111-4111-8111-111111111111';
export const COMPANY_B_ID = '22222222-2222-4222-8222-222222222222';

export function buildSampleQAReport(overrides?: Partial<QAEvaluationReport>): QAEvaluationReport {
  return {
    id: 'qa-1',
    evaluatedAt: '2026-11-26T00:00:00.000Z',
    weights: [],
    dimensions: [],
    weightedScore: 88,
    criticalFailures: [],
    blockingErrors: [],
    warnings: [],
    informationalFeedback: [],
    verdict: 'PASS',
    verdictExplanation: 'Meets all structural and regulatory quality standards.',
    humanSignOff: {
      signedOff: false,
      reviewerName: '',
      roles: {
        sme: { signedOff: false, reviewerName: '' },
        instructionalDesigner: { signedOff: false, reviewerName: '' },
        complianceAuthorizer: { signedOff: false, reviewerName: '' },
      },
    },
    ...overrides,
  };
}

export function buildGenuineHumanSignOff(
  overrides?: { companyId?: string; courseId?: string }
): QAEvaluationReport['humanSignOff'] {
  const companyId = overrides?.companyId || COMPANY_A_ID;
  const courseId = overrides?.courseId || 'course-1';
  const signedAt = '2026-11-26T01:00:00.000Z';
  return {
    signedOff: true,
    reviewerName: 'Dr. Thabo Mokoena, Nomsa Dlamini, Johan van der Merwe',
    signedOffAt: signedAt,
    roles: {
      sme: {
        signedOff: true,
        reviewerName: 'Dr. Thabo Mokoena',
        reviewerUserId: 'user-sme-a',
        governanceRole: 'sme',
        companyId,
        courseId,
        status: 'approved',
        signedOffAt: signedAt,
      },
      instructionalDesigner: {
        signedOff: true,
        reviewerName: 'Nomsa Dlamini',
        reviewerUserId: 'user-id-a',
        governanceRole: 'instructional_designer',
        companyId,
        courseId,
        status: 'approved',
        signedOffAt: signedAt,
      },
      complianceAuthorizer: {
        signedOff: true,
        reviewerName: 'Johan van der Merwe',
        reviewerUserId: 'user-comp-a',
        governanceRole: 'compliance_authorizer',
        companyId,
        courseId,
        status: 'approved',
        signedOffAt: signedAt,
      },
    },
  };
}

export function buildSampleCourseProject(overrides?: Partial<CourseProject>): CourseProject {
  const now = '2026-11-26T00:00:00.000Z';
  const modId = 'mod-1';
  const outcomeId = 'clo-1';
  const mloId = 'mlo-1';

  return {
    id: 'course-1',
    companyId: COMPANY_A_ID,
    templateId: 'corporate-governance',
    templateName: 'Corporate Training Standard',
    creationMode: 'brief',
    lifecycleStatus: 'in_development',
    currentStage: 6,
    createdAt: now,
    updatedAt: now,
    sources: [
      {
        id: 'src-1',
        title: 'POPIA Compliance Guide',
        authorOrOrganisation: 'Information Regulator of South Africa',
        publicationDate: '2024',
        version: '1.0',
        referenceOrUrl: 'https://inforegulator.org.za',
        extractedText:
          'Under Section 11 of POPIA, personal information may only be processed if consent or another lawful justification applies, and Section 19 requires appropriate security safeguards.',
        relevantSections: ['Section 11', 'Section 19'],
        verificationStatus: 'VERIFIED',
        verifiedBy: 'Nomsa Dlamini',
        verifiedAt: now,
        addedAt: now,
      },
    ],
    sourceConflicts: [],
    brief: {
      title: 'POPIA Data Governance Essentials',
      code: 'POP-101',
      industryDomain: 'Corporate Governance & Compliance',
      purpose: 'Equip operational managers to apply POPIA lawful processing and security safeguards.',
      workplaceProblem: 'Inconsistent handling of employee and customer personal information.',
      targetAudience: 'Line managers and team leads across South African operations.',
      targetJobRoles: 'Operations Manager, HR Coordinator',
      experienceLevel: 'Intermediate',
      prerequisites: 'Basic workplace induction',
      estimatedDuration: '2 hours',
      language: 'English (South Africa)',
      learningRequirements: 'Apply Section 11 lawful processing conditions and Section 19 safeguards.',
      subjectTopicsInput: 'Lawful processing conditions\nSecurity safeguards and breach notification',
      aiIntegrationMode: 'none',
      aiIntegrationRequirements: '',
      saCompliance: {
        enabled: true,
        nqfLevel: 'NQF Level 5',
        saqaRelevant: true,
        saqaNotes: '',
        qctoRelevant: false,
        qctoModulePattern: false,
        setaName: 'Services SETA',
        professionalBodyCpd: '',
        popiaRelevant: true,
        industryLegislation: 'Protection of Personal Information Act 4 of 2013 (POPIA)',
        technicalStandards: 'ISO/IEC 27001',
        accreditationDisclaimerAccepted: true,
      },
      templateFieldValues: {},
      fieldStatuses: {
        title: 'confirmed',
        purpose: 'confirmed',
        targetAudience: 'confirmed',
      },
      metadataLocked: false,
      approval: { approved: true, approvedAt: now, approvedBy: 'Author' },
    },
    curriculum: {
      rationale: 'Builds from lawful processing foundations to practical safeguards.',
      modules: [
        {
          id: modId,
          order: 1,
          title: 'Lawful Processing & Security Safeguards',
          qctoModuleType: 'Standard Module',
          purpose: 'Establish lawful basis and operational security controls under POPIA.',
          objectives: ['Identify lawful justifications beyond consent', 'Implement safeguards'],
          competencies: ['Audit personal information workflows'],
          topics: [
            {
              id: 'top-1',
              title: 'Lawful processing conditions',
              subtopics: ['Consent and statutory justifications under Section 11'],
            },
            {
              id: 'top-2',
              title: 'Security safeguards and breach notification',
              subtopics: ['Reasonable technical and organisational measures under Section 19'],
            },
          ],
          lessons: [
            {
              id: 'lesson-1',
              title: 'Applying Lawful Processing Beyond Consent',
              durationMinutes: 60,
              purpose: 'Distinguish all six lawful justifications under POPIA Section 11.',
              keyTerms: ['Responsible Party', 'Data Subject', 'Information Regulator'],
              outcomeIds: [outcomeId, mloId],
            },
          ],
        },
      ],
      coverageChecks: [
        {
          id: 'cov-1',
          originalTopic: 'Lawful processing conditions',
          status: 'mapped',
          mappedModuleId: modId,
          mappedLocation: 'Module 1 · Lesson 1',
          notes: 'Covered thoroughly.',
        },
      ],
      conflicts: [],
      approval: { approved: true, approvedAt: now, approvedBy: 'Author' },
    },
    outcomes: {
      courseOutcomes: [
        {
          id: outcomeId,
          scope: 'course',
          code: 'CLO-1',
          actionVerb: 'Evaluate',
          bloomLevel: 'Evaluate',
          statement: 'Evaluate workplace data workflows against POPIA lawful processing justifications and security safeguards.',
          workplacePerformance: 'Produces a documented workflow risk review.',
        },
      ],
      moduleOutcomes: [
        {
          id: mloId,
          scope: 'module',
          moduleId: modId,
          code: 'MLO-1.1',
          actionVerb: 'Apply',
          bloomLevel: 'Apply',
          statement: 'Apply Section 11 justifications and Section 19 safeguards to operational scenarios.',
          workplacePerformance: 'Completes data handling checklist accurately.',
        },
      ],
      durationRealismNote: '2 hours covers 60 min instruction plus 60 min practical & knowledge assessment.',
      nqfSummaryNote: 'Aligned with NQF Level 5 workplace application.',
      approval: { approved: true, approvedAt: now, approvedBy: 'Author' },
    },
    assessments: {
      strategySummary: 'Minimum pass mark 70% combining Knowledge (50%) and Practical (50%) tasks.',
      passRequirementPercent: 70,
      knowledgeWeightPercent: 50,
      practicalWeightPercent: 50,
      thresholdsConfirmed: true,
      items: [
        {
          id: 'ass-1',
          moduleId: modId,
          title: 'POPIA Lawful Processing Knowledge Check',
          type: 'mcq',
          assessmentDomain: 'knowledge',
          classification: 'summative',
          outcomeIds: [outcomeId],
          weightingPercent: 50,
          durationMinutes: 25,
          objective: 'Verify understanding of POPIA Section 11 lawful justifications.',
          instructions: 'Select the best answer.',
          promptOrQuestion: 'Which statement accurately describes lawful processing under POPIA?',
          options: [
            'Consent is always the only valid legal basis for processing personal information.',
            'Consent is one of several lawful justifications alongside contractual necessity, legal obligation, and legitimate interest.',
            'Security safeguards only apply to financial institutions.',
            'Breaches never require notification to the Information Regulator.',
          ],
          correctIndices: [1],
          modelAnswer: 'Consent is one of several lawful justifications under Section 11.',
          explanation: 'Section 11(1) lists six justifications for processing personal information.',
          feedbackCorrect: 'Correct. POPIA Section 11 provides six distinct lawful grounds.',
          feedbackIncorrect: 'Review Section 11(1) of POPIA regarding non-consent justifications.',
          markingGuide: '1 mark for selecting option B.',
          rubric: [],
        },
        {
          id: 'ass-2',
          moduleId: modId,
          title: 'Workplace Security Safeguards Audit Task',
          type: 'practical_task',
          assessmentDomain: 'practical',
          classification: 'summative',
          outcomeIds: [mloId],
          weightingPercent: 50,
          durationMinutes: 35,
          objective: 'Demonstrate practical application of POPIA Section 19 safeguards.',
          instructions: 'Audit the sample HR onboarding register and document three corrective safeguards.',
          promptOrQuestion: 'Identify gaps in access control, encryption, and retention for HR records.',
          modelAnswer: 'Implement role-based access control, TLS/AES encryption, and retention schedules.',
          explanation: 'Directly tests practical workplace compliance skills.',
          feedbackCorrect: 'Competent safeguard plan.',
          feedbackIncorrect: 'Address technical and organisational measures under Section 19.',
          markingGuide: 'Assess against the 100% weighted practical rubric criteria.',
          rubric: [
            {
              criterion: 'Technical Safeguards Identification',
              weightPercent: 50,
              competentStandard: 'Specifies access control and encryption controls accurately.',
              notYetCompetentIndicator: 'Omits technical controls.',
            },
            {
              criterion: 'Organisational Governance & Escalation',
              weightPercent: 50,
              competentStandard: 'Documents breach escalation to the Information Officer and Information Regulator.',
              notYetCompetentIndicator: 'Fails to specify escalation path.',
            },
          ],
        },
      ],
      alignmentFlags: [],
      alignmentScorePercent: 100,
      approval: { approved: true, approvedAt: now, approvedBy: 'Author' },
    },
    content: {
      modules: [
        {
          id: 'cm-1',
          moduleId: modId,
          moduleNumber: 1,
          title: 'Lawful Processing & Security Safeguards',
          introduction: 'This module introduces responsible personal information governance under POPIA.',
          learningObjectives: ['Evaluate lawful processing conditions', 'Design security safeguards'],
          lessons: [
            {
              id: 'gl-1',
              lessonPlanId: 'lesson-1',
              outcomeIds: [outcomeId, mloId],
              title: 'Applying Lawful Processing Beyond Consent',
              durationMinutes: 60,
              explanation:
                'Under POPIA Section 11, consent is only one of several lawful justifications. Responsible parties may also process personal information where necessary for performing a contract, complying with a legal obligation, protecting a legitimate interest of the data subject, or pursuing legitimate business interests. Section 19 further requires reasonable technical and organisational safeguards overseen by the Information Regulator.',
              keyTerminology: [
                {
                  term: 'Responsible Party',
                  definition: 'Public or private body determining the purpose and means of processing.',
                },
              ],
              workedExamples: [
                'HR Payroll Processing: Processed under contractual and legal tax obligations rather than relying solely on revocable employee consent.',
              ],
              practicalApplication: 'Audit department spreadsheets for unnecessary personal fields.',
              guidedActivity: 'Review an intake form and map each field to its lawful justification.',
              sourceClaims: [
                {
                  id: 'sc-1',
                  claim: 'Section 11 provides multiple lawful processing justifications.',
                  sourceId: 'src-1',
                  sourceTitle: 'POPIA Compliance Guide',
                  status: 'VERIFIED',
                },
              ],
              editStatus: 'approved',
            },
          ],
          workplaceCaseStudies: [],
          scenarios: [
            {
              id: 'scen-1',
              title: 'Unencrypted Export Incident',
              contextType: 'Workplace',
              situation: 'An analyst emails an unencrypted spreadsheet of customer ID numbers externally.',
              challenge: 'Determine containment and notification duties.',
              decisionPrompt: 'What steps must the Information Officer take immediately?',
              modelDebrief: 'Contain exposure, assess risk, notify the Information Regulator and affected data subjects as soon as reasonably possible under Section 22.',
              keyTakeaway: 'Section 22 requires timely security compromise notifications.',
            },
          ],
          knowledgeChecks: [
            {
              id: 'kc-1',
              question: 'Is consent the only lawful basis for processing personal information under POPIA?',
              options: ['Yes', 'No, Section 11 provides multiple lawful bases'],
              correctIndex: 1,
              explanation: 'Section 11(1)(a)-(f) enumerates six lawful bases.',
              outcomeCode: 'CLO-1',
            },
          ],
          summary: 'Summary: Lawful processing requires documenting purpose, justification, and safeguards.',
          furtherLearningResources: ['Information Regulator Guidance Notes'],
          editStatus: 'approved',
        },
      ],
      generationHistory: [],
      approval: { approved: true, approvedAt: now, approvedBy: 'Author' },
    },
    qaHistory: [],
    latestQA: buildSampleQAReport(),
    versions: [],
    ...overrides,
  };
}

interface StoredUser {
  userId: string;
  email: string;
  fullName: string;
  passwordHash: string;
  emailVerified: boolean;
}

export function createInMemoryTenantEnv() {
  const companies = new Map<string, CompanyWorkspace>([
    [
      COMPANY_A_ID,
      {
        id: COMPANY_A_ID,
        companyName: 'Acme Training Co',
        companySlug: 'acme-training',
        logoUrl: null,
        primaryColour: '#052B66',
        secondaryColour: '#45CC42',
        subscriptionStatus: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    [
      COMPANY_B_ID,
      {
        id: COMPANY_B_ID,
        companyName: 'Beta Learning Ltd',
        companySlug: 'beta-learning',
        logoUrl: null,
        primaryColour: '#102030',
        secondaryColour: '#309050',
        subscriptionStatus: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  ]);

  const usersById = new Map<string, StoredUser>([
    [
      'user-admin-a',
      {
        userId: 'user-admin-a',
        email: 'admin@acme.test',
        fullName: 'Acme Admin',
        passwordHash: 'hash-admin',
        emailVerified: true,
      },
    ],
    [
      'user-author-a',
      {
        userId: 'user-author-a',
        email: 'author@acme.test',
        fullName: 'Acme Author',
        passwordHash: 'hash-author',
        emailVerified: true,
      },
    ],
    [
      'user-reviewer-a',
      {
        userId: 'user-reviewer-a',
        email: 'reviewer@acme.test',
        fullName: 'Acme Reviewer',
        passwordHash: 'hash-reviewer',
        emailVerified: true,
      },
    ],
    [
      'user-sme-a',
      {
        userId: 'user-sme-a',
        email: 'sme@acme.test',
        fullName: 'Dr. Thabo Mokoena',
        passwordHash: 'hash-sme',
        emailVerified: true,
      },
    ],
    [
      'user-id-a',
      {
        userId: 'user-id-a',
        email: 'id@acme.test',
        fullName: 'Nomsa Dlamini',
        passwordHash: 'hash-id',
        emailVerified: true,
      },
    ],
    [
      'user-comp-a',
      {
        userId: 'user-comp-a',
        email: 'compliance@acme.test',
        fullName: 'Johan van der Merwe',
        passwordHash: 'hash-comp',
        emailVerified: true,
      },
    ],
    [
      'user-dual-gov-a',
      {
        userId: 'user-dual-gov-a',
        email: 'dual@acme.test',
        fullName: 'Dual Authorised Reviewer',
        passwordHash: 'hash-dual',
        emailVerified: true,
      },
    ],
    [
      'user-viewer-a',
      {
        userId: 'user-viewer-a',
        email: 'viewer@acme.test',
        fullName: 'Acme Viewer',
        passwordHash: 'hash-viewer',
        emailVerified: true,
      },
    ],
    [
      'user-unverified',
      {
        userId: 'user-unverified',
        email: 'unverified@public.test',
        fullName: 'Unverified Signup',
        passwordHash: 'hash-unverified',
        emailVerified: false,
      },
    ],
    [
      'user-admin-b',
      {
        userId: 'user-admin-b',
        email: 'admin@beta.test',
        fullName: 'Beta Admin',
        passwordHash: 'hash-beta',
        emailVerified: true,
      },
    ],
  ]);

  const memberships: CompanyMembership[] = [
    {
      id: 'mem-admin-a',
      companyId: COMPANY_A_ID,
      userId: 'user-admin-a',
      role: 'company_admin',
      governanceRoles: [],
      membershipStatus: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      company: companies.get(COMPANY_A_ID),
      profile: { id: 'user-admin-a', email: 'admin@acme.test', fullName: 'Acme Admin' },
    },
    {
      id: 'mem-author-a',
      companyId: COMPANY_A_ID,
      userId: 'user-author-a',
      role: 'author',
      governanceRoles: [],
      membershipStatus: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      company: companies.get(COMPANY_A_ID),
      profile: { id: 'user-author-a', email: 'author@acme.test', fullName: 'Acme Author' },
    },
    {
      id: 'mem-reviewer-a',
      companyId: COMPANY_A_ID,
      userId: 'user-reviewer-a',
      role: 'reviewer',
      governanceRoles: [],
      membershipStatus: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      company: companies.get(COMPANY_A_ID),
      profile: { id: 'user-reviewer-a', email: 'reviewer@acme.test', fullName: 'Acme Reviewer' },
    },
    {
      id: 'mem-sme-a',
      companyId: COMPANY_A_ID,
      userId: 'user-sme-a',
      role: 'reviewer',
      governanceRoles: ['sme'],
      membershipStatus: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      company: companies.get(COMPANY_A_ID),
      profile: { id: 'user-sme-a', email: 'sme@acme.test', fullName: 'Dr. Thabo Mokoena' },
    },
    {
      id: 'mem-id-a',
      companyId: COMPANY_A_ID,
      userId: 'user-id-a',
      role: 'reviewer',
      governanceRoles: ['instructional_designer'],
      membershipStatus: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      company: companies.get(COMPANY_A_ID),
      profile: { id: 'user-id-a', email: 'id@acme.test', fullName: 'Nomsa Dlamini' },
    },
    {
      id: 'mem-comp-a',
      companyId: COMPANY_A_ID,
      userId: 'user-comp-a',
      role: 'reviewer',
      governanceRoles: ['compliance_authorizer'],
      membershipStatus: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      company: companies.get(COMPANY_A_ID),
      profile: {
        id: 'user-comp-a',
        email: 'compliance@acme.test',
        fullName: 'Johan van der Merwe',
      },
    },
    {
      id: 'mem-dual-gov-a',
      companyId: COMPANY_A_ID,
      userId: 'user-dual-gov-a',
      role: 'reviewer',
      governanceRoles: ['sme', 'instructional_designer'],
      membershipStatus: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      company: companies.get(COMPANY_A_ID),
      profile: {
        id: 'user-dual-gov-a',
        email: 'dual@acme.test',
        fullName: 'Dual Authorised Reviewer',
      },
    },
    {
      id: 'mem-viewer-a',
      companyId: COMPANY_A_ID,
      userId: 'user-viewer-a',
      role: 'viewer',
      governanceRoles: [],
      membershipStatus: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      company: companies.get(COMPANY_A_ID),
      profile: { id: 'user-viewer-a', email: 'viewer@acme.test', fullName: 'Acme Viewer' },
    },
    {
      id: 'mem-admin-b',
      companyId: COMPANY_B_ID,
      userId: 'user-admin-b',
      role: 'company_admin',
      governanceRoles: [],
      membershipStatus: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      company: companies.get(COMPANY_B_ID),
      profile: { id: 'user-admin-b', email: 'admin@beta.test', fullName: 'Beta Admin' },
    },
  ];

  const coursesByCompany = new Map<string, Map<string, CourseProject>>([
    [COMPANY_A_ID, new Map([['course-1', buildSampleCourseProject()]])],
    [COMPANY_B_ID, new Map()],
  ]);
  const approvalsByCourse = new Map<string, CourseGovernanceApprovalRecord[]>();
  const versionsByCourse = new Map<string, CourseVersionSnapshot[]>();
  const templatesByCompany = new Map<string, Map<string, CourseTemplate>>([
    [COMPANY_A_ID, new Map()],
    [COMPANY_B_ID, new Map()],
  ]);
  const sourcesById = new Map<string, { companyId: string; fileName: string }>();

  const tokens = new Map<string, string>([
    ['token-admin-a', 'user-admin-a'],
    ['token-author-a', 'user-author-a'],
    ['token-reviewer-a', 'user-reviewer-a'],
    ['token-sme-a', 'user-sme-a'],
    ['token-id-a', 'user-id-a'],
    ['token-comp-a', 'user-comp-a'],
    ['token-dual-gov-a', 'user-dual-gov-a'],
    ['token-viewer-a', 'user-viewer-a'],
    ['token-unverified', 'user-unverified'],
    ['token-admin-b', 'user-admin-b'],
  ]);

  const authVerifier: TenantAuthVerifier = {
    async verifyAccessToken(token: string): Promise<VerifiedUserSession | null> {
      const userId = tokens.get(token);
      if (!userId) return null;
      const u = usersById.get(userId);
      if (!u) return null;
      const activeMemberships = u.emailVerified
        ? memberships
            .filter(m => m.userId === u.userId && m.membershipStatus === 'active')
            .map(m => ({ ...m, company: companies.get(m.companyId) }))
        : [];
      return {
        userId: u.userId,
        email: u.email,
        emailVerified: u.emailVerified,
        profile: { id: u.userId, fullName: u.fullName, email: u.email },
        memberships: activeMemberships,
      };
    },
  };

  function findUserByEmail(email: string): StoredUser | undefined {
    const target = email.trim().toLowerCase();
    for (const u of usersById.values()) {
      if (u.email === target) return u;
    }
    return undefined;
  }

  function buildAuthoritativeHumanSignOff(
    companyId: string,
    courseId: string,
    approvals: CourseGovernanceApprovalRecord[]
  ): QAEvaluationReport['humanSignOff'] {
    const mapRole = (govRole: GovernanceRole) => {
      const rec = approvals.find(a => a.governanceRole === govRole && a.active);
      if (!rec) {
        return {
          signedOff: false,
          reviewerName: '',
          governanceRole: govRole,
          companyId,
          courseId,
          status: 'pending' as const,
        };
      }
      return {
        signedOff: rec.status === 'approved',
        reviewerName: rec.reviewerName,
        reviewerUserId: rec.reviewerUserId,
        governanceRole: govRole,
        companyId: rec.companyId,
        courseId: rec.courseId,
        status: rec.status,
        signedOffAt: rec.approvedAt,
        notes: rec.notes || undefined,
      };
    };

    const sme = mapRole('sme');
    const instructionalDesigner = mapRole('instructional_designer');
    const complianceAuthorizer = mapRole('compliance_authorizer');
    const allApproved =
      sme.signedOff &&
      instructionalDesigner.signedOff &&
      complianceAuthorizer.signedOff &&
      new Set([sme.reviewerUserId, instructionalDesigner.reviewerUserId, complianceAuthorizer.reviewerUserId])
        .size === 3;

    const latestAt = [sme.signedOffAt, instructionalDesigner.signedOffAt, complianceAuthorizer.signedOffAt]
      .filter(Boolean)
      .sort()
      .pop();

    return {
      signedOff: allApproved,
      reviewerName: allApproved
        ? [sme.reviewerName, instructionalDesigner.reviewerName, complianceAuthorizer.reviewerName]
            .filter(Boolean)
            .join(', ')
        : '',
      signedOffAt: allApproved ? latestAt : undefined,
      roles: {
        sme,
        instructionalDesigner,
        complianceAuthorizer,
      },
    };
  }

  const service: TenantServiceAdapter = {
    async registerCompany(params) {
      const userId = params.existingUserId;
      const email = params.existingEmail || String(params.email || '').trim().toLowerCase();
      let resolvedUserId = userId;
      let requiresEmailVerification = false;

      if (!resolvedUserId) {
        const existing = findUserByEmail(email);
        if (existing) {
          if (existing.emailVerified) {
            throw new Error(
              'An account with this email already exists. Please sign in first, then register your company workspace.'
            );
          }
          resolvedUserId = existing.userId;
          requiresEmailVerification = true;
        } else {
          resolvedUserId = `user-${crypto.randomUUID()}`;
          usersById.set(resolvedUserId, {
            userId: resolvedUserId,
            email,
            fullName: String(params.fullName || ''),
            passwordHash: String(params.password || ''),
            emailVerified: false,
          });
          tokens.set(`token-${email}`, resolvedUserId);
          requiresEmailVerification = true;
        }
      }

      const companyId = crypto.randomUUID();
      const company: CompanyWorkspace = {
        id: companyId,
        companyName: params.companyName,
        companySlug: params.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        logoUrl: params.logoUrl,
        primaryColour: params.primaryColour,
        secondaryColour: params.secondaryColour,
        subscriptionStatus: 'trialing',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      companies.set(companyId, company);
      coursesByCompany.set(companyId, new Map());
      templatesByCompany.set(companyId, new Map());

      memberships.push({
        id: `mem-${crypto.randomUUID()}`,
        companyId,
        userId: resolvedUserId,
        role: 'company_admin',
        governanceRoles: [],
        membershipStatus: 'active',
        createdAt: new Date().toISOString(),
        company,
      });

      return {
        company,
        userId: resolvedUserId,
        email,
        requiresEmailVerification,
      };
    },

    async registerInvitedUser(params) {
      const email = params.email.trim().toLowerCase();
      const user = findUserByEmail(email);
      let accountAlreadyConfirmed = false;
      if (!user) {
        const hasInvite = memberships.some(
          m => usersById.get(m.userId)?.email === email && m.membershipStatus === 'invited'
        );
        if (!hasInvite) {
          throw new Error('No invitation found for this email address.');
        }
      } else {
        if (user.emailVerified) {
          accountAlreadyConfirmed = true;
        } else {
          user.passwordHash = params.password;
          user.fullName = params.fullName;
          user.emailVerified = true;
        }
      }

      let activated = 0;
      if (user) {
        for (const m of memberships) {
          if (m.userId === user.userId && m.membershipStatus === 'invited') {
            m.membershipStatus = 'active';
            activated += 1;
          }
        }
      }

      return {
        userId: user!.userId,
        email,
        activatedMembershipsCount: activated,
        requiresEmailVerification: !user!.emailVerified,
        accountAlreadyConfirmed,
        invitedPending: activated === 0 && !user!.emailVerified,
      };
    },

    async acceptPendingInvitations(userId) {
      let activated = 0;
      for (const m of memberships) {
        if (m.userId === userId && m.membershipStatus === 'invited') {
          m.membershipStatus = 'active';
          activated += 1;
        }
      }
      return {
        activatedMembershipsCount: activated,
        memberships: memberships
          .filter(m => m.userId === userId && m.membershipStatus === 'active')
          .map(m => ({ ...m, company: companies.get(m.companyId) })),
      };
    },

    async updateCompany(companyId, _userId, patch) {
      const c = companies.get(companyId);
      if (!c) throw new Error('Company not found.');
      const updated = { ...c, ...patch, updatedAt: new Date().toISOString() };
      companies.set(companyId, updated);
      return updated;
    },

    async uploadCompanyLogo() {
      throw new Error('Not used in unit tests');
    },
    async removeCompanyLogo(companyId) {
      return companies.get(companyId)!;
    },

    async listMembers(companyId) {
      return memberships.filter(m => m.companyId === companyId);
    },

    async inviteMember(params) {
      const email = params.email.trim().toLowerCase();
      let user = findUserByEmail(email);
      if (!user) {
        const userId = `user-${crypto.randomUUID()}`;
        user = {
          userId,
          email,
          fullName: params.fullName,
          passwordHash: params.temporaryPassword || '',
          emailVerified: false,
        };
        usersById.set(userId, user);
        tokens.set(`token-${email}`, userId);
      }

      const normalizedGovRoles =
        params.role === 'reviewer' || params.role === 'company_admin'
          ? normalizeGovernanceRoles(params.governanceRoles)
          : [];

      const existingMem = memberships.find(
        m => m.companyId === params.companyId && m.userId === user!.userId
      );
      if (existingMem) {
        existingMem.role = params.role;
        existingMem.governanceRoles = normalizedGovRoles;
        return existingMem;
      }

      const newMem: CompanyMembership = {
        id: `mem-${crypto.randomUUID()}`,
        companyId: params.companyId,
        userId: user.userId,
        role: params.role,
        governanceRoles: normalizedGovRoles,
        membershipStatus: user.emailVerified ? 'active' : 'invited',
        createdAt: new Date().toISOString(),
        company: companies.get(params.companyId),
        profile: { id: user.userId, email: user.email, fullName: user.fullName },
      };
      memberships.push(newMem);
      return newMem;
    },

    async updateMember(params) {
      const m = memberships.find(x => x.companyId === params.companyId && x.id === params.memberId);
      if (!m) throw new Error('Member not found.');
      const nextRole = params.role || m.role;
      if (params.role) m.role = params.role;
      if (params.governanceRoles !== undefined) {
        m.governanceRoles =
          nextRole === 'reviewer' || nextRole === 'company_admin'
            ? normalizeGovernanceRoles(params.governanceRoles)
            : [];
      } else if (nextRole !== 'reviewer' && nextRole !== 'company_admin') {
        m.governanceRoles = [];
      }
      if (params.membershipStatus) m.membershipStatus = params.membershipStatus;
      return m;
    },

    async listCourses(companyId) {
      return Array.from(coursesByCompany.get(companyId)?.values() || []);
    },

    async getCourse(companyId, courseIdParam) {
      return coursesByCompany.get(companyId)?.get(courseIdParam) || null;
    },

    async saveCourse(companyId, _userId, project, courseIdParam, options) {
      const store = coursesByCompany.get(companyId) || new Map<string, CourseProject>();
      coursesByCompany.set(companyId, store);
      if (courseIdParam && !store.has(courseIdParam)) {
        return { project, notFound: true };
      }
      const existing = courseIdParam ? store.get(courseIdParam) : undefined;
      if (
        existing &&
        options?.expectedUpdatedAt &&
        existing.updatedAt &&
        options.expectedUpdatedAt !== existing.updatedAt
      ) {
        return { project: existing, conflict: true };
      }
      const id = courseIdParam || project.id || `course-${crypto.randomUUID()}`;
      const approvals = approvalsByCourse.get(`${companyId}:${id}`) || [];
      const authoritativeSignOff = buildAuthoritativeHumanSignOff(companyId, id, approvals);
      let nextUpdatedAt = new Date().toISOString();
      if (existing?.updatedAt && nextUpdatedAt <= existing.updatedAt) {
        nextUpdatedAt = new Date(Date.parse(existing.updatedAt) + 1).toISOString();
      }

      const saved: CourseProject = {
        ...project,
        id,
        companyId,
        updatedAt: nextUpdatedAt,
        ...(existing?.lifecycleStatus === 'completed'
          ? { lifecycleStatus: 'completed' }
          : {}),
        ...(project.latestQA
          ? {
              latestQA: {
                ...project.latestQA,
                humanSignOff:
                  existing?.lifecycleStatus === 'completed'
                    ? existing.latestQA?.humanSignOff || authoritativeSignOff
                    : approvals.length > 0
                      ? authoritativeSignOff
                      : project.latestQA.humanSignOff,
              },
            }
          : {}),
      };
      store.set(id, saved);
      return { project: saved };
    },

    async deleteCourse(companyId, courseIdParam) {
      approvalsByCourse.delete(`${companyId}:${courseIdParam}`);
      return Boolean(coursesByCompany.get(companyId)?.delete(courseIdParam));
    },

    async getCourseGovernance(companyId, courseIdParam) {
      const course = coursesByCompany.get(companyId)?.get(courseIdParam);
      if (!course) {
        return { notFound: true, approvals: [] };
      }
      const approvals = (approvalsByCourse.get(`${companyId}:${course.id}`) || []).filter(
        a => a.active
      );
      return {
        courseId: course.id,
        lifecycleStatus: course.lifecycleStatus,
        approvals,
        humanSignOff: buildAuthoritativeHumanSignOff(companyId, course.id, approvals),
      };
    },

    async submitCourseGovernanceDecision(params) {
      if (!canApproveGovernanceRole(params.actorRole, params.actorGovernanceRoles, params.governanceRole)) {
        return {
          ok: false as const,
          status: 403 as const,
          error: `Forbidden: you are not authorised for the ${GOVERNANCE_ROLE_LABELS[params.governanceRole]} governance role.`,
        };
      }
      const store = coursesByCompany.get(params.companyId);
      const course = store?.get(params.courseIdParam);
      if (!course) {
        return {
          ok: false as const,
          status: 404 as const,
          error: 'Course not found in your company workspace.',
        };
      }
      if (course.lifecycleStatus === 'completed') {
        return {
          ok: false as const,
          status: 409 as const,
          error: 'Conflict: governance approvals on a completed course are immutable.',
        };
      }
      if (!course.latestQA) {
        return {
          ok: false as const,
          status: 400 as const,
          error: 'Run Stage 6 Quality Assurance before recording governance approvals.',
        };
      }

      const key = `${params.companyId}:${course.id}`;
      const existingList = (approvalsByCourse.get(key) || []).filter(a => a.active);
      const existingForSlot = existingList.find(a => a.governanceRole === params.governanceRole);
      if (
        existingForSlot &&
        existingForSlot.status === 'approved' &&
        existingForSlot.reviewerUserId !== params.actorUserId
      ) {
        return {
          ok: false as const,
          status: 409 as const,
          error: `${GOVERNANCE_ROLE_LABELS[params.governanceRole]} is already approved by ${existingForSlot.reviewerName}. Only that reviewer may revoke their approval before completion.`,
        };
      }

      if (params.decision === 'approved') {
        const otherBySameUser = existingList.find(
          a =>
            a.status === 'approved' &&
            a.reviewerUserId === params.actorUserId &&
            a.governanceRole !== params.governanceRole
        );
        if (otherBySameUser) {
          return {
            ok: false as const,
            status: 409 as const,
            error: `Three-person governance rule violated: you already hold the active approval for ${GOVERNANCE_ROLE_LABELS[otherBySameUser.governanceRole]} on this course.`,
          };
        }
      }

      const filtered = existingList.filter(a => a.governanceRole !== params.governanceRole);
      const approval: CourseGovernanceApprovalRecord = {
        id: `appr-${crypto.randomUUID()}`,
        companyId: params.companyId,
        courseId: course.id,
        governanceRole: params.governanceRole,
        reviewerUserId: params.actorUserId,
        reviewerName: params.actorName.trim(),
        status: params.decision,
        notes: params.notes || '',
        approvedAt: new Date().toISOString(),
        active: true,
      };
      const nextApprovals = [...filtered, approval];
      approvalsByCourse.set(key, nextApprovals);

      const humanSignOff = buildAuthoritativeHumanSignOff(
        params.companyId,
        course.id,
        nextApprovals
      );
      const updatedCourse: CourseProject = {
        ...course,
        lifecycleStatus:
          params.decision === 'rejected' && course.lifecycleStatus === 'awaiting_review'
            ? 'revision_required'
            : course.lifecycleStatus,
        latestQA: {
          ...course.latestQA,
          humanSignOff,
        },
      };
      store!.set(course.id, updatedCourse);

      return {
        ok: true as const,
        course: updatedCourse,
        approval,
        approvals: nextApprovals,
      };
    },

    async revokeCourseGovernanceDecision(params) {
      if (params.actorRole !== 'reviewer' && params.actorRole !== 'company_admin') {
        return {
          ok: false as const,
          status: 403 as const,
          error: 'Forbidden: only Reviewers or authorised Company Administrators can revoke approvals.',
        };
      }
      const store = coursesByCompany.get(params.companyId);
      const course = store?.get(params.courseIdParam);
      if (!course) {
        return {
          ok: false as const,
          status: 404 as const,
          error: 'Course not found in your company workspace.',
        };
      }
      if (course.lifecycleStatus === 'completed') {
        return {
          ok: false as const,
          status: 409 as const,
          error: 'Conflict: governance approvals on a completed course are immutable.',
        };
      }

      const key = `${params.companyId}:${course.id}`;
      const existingList = (approvalsByCourse.get(key) || []).filter(a => a.active);
      const target = existingList.find(a => a.governanceRole === params.governanceRole);
      if (!target) {
        return {
          ok: false as const,
          status: 404 as const,
          error: `No active approval found for ${GOVERNANCE_ROLE_LABELS[params.governanceRole]}.`,
        };
      }
      if (target.reviewerUserId !== params.actorUserId) {
        return {
          ok: false as const,
          status: 403 as const,
          error: 'Forbidden: you cannot modify or revoke another reviewer’s governance approval.',
        };
      }

      const nextApprovals = existingList.filter(a => a.governanceRole !== params.governanceRole);
      approvalsByCourse.set(key, nextApprovals);

      const humanSignOff = buildAuthoritativeHumanSignOff(
        params.companyId,
        course.id,
        nextApprovals
      );
      const updatedCourse: CourseProject = {
        ...course,
        ...(course.latestQA
          ? {
              latestQA: {
                ...course.latestQA,
                humanSignOff,
              },
            }
          : {}),
      };
      store!.set(course.id, updatedCourse);

      return {
        ok: true as const,
        course: updatedCourse,
        approvals: nextApprovals,
      };
    },

    async completeCourseRelease(params) {
      const perms = getRolePermissions(params.actorRole, params.actorGovernanceRoles);
      if (!perms.canPublishCourse) {
        return {
          ok: false as const,
          status: 403 as const,
          error:
            'Forbidden: only a Reviewer or a separately authorised Company Administrator can complete and publish a course.',
        };
      }
      const store = coursesByCompany.get(params.companyId);
      const course = store?.get(params.courseIdParam);
      if (!course) {
        return {
          ok: false as const,
          status: 404 as const,
          error: 'Course not found in your company workspace.',
        };
      }
      if (!course.latestQA) {
        return {
          ok: false as const,
          status: 400 as const,
          error: 'A Stage 6 Quality Assurance evaluation is required before completing a course.',
        };
      }
      if (course.latestQA.verdict === 'FAIL') {
        return {
          ok: false as const,
          status: 400 as const,
          error: 'Courses with a FAIL QA verdict cannot be completed.',
        };
      }
      if ((course.latestQA.blockingErrors?.length || 0) > 0) {
        return {
          ok: false as const,
          status: 400 as const,
          error: 'All blocking QA issues must be resolved before completion.',
        };
      }

      const approvals = (approvalsByCourse.get(`${params.companyId}:${course.id}`) || []).filter(
        a => a.active
      );
      const humanSignOff = buildAuthoritativeHumanSignOff(params.companyId, course.id, approvals);
      const signOffCheck = hasGenuineHumanGovernanceSignOff(humanSignOff, {
        companyId: params.companyId,
        courseId: course.id,
      });
      if (!signOffCheck.valid) {
        return {
          ok: false as const,
          status: 400 as const,
          error: signOffCheck.reason || 'Three distinct human governance approvals are required.',
        };
      }

      const completedCourse: CourseProject = {
        ...course,
        currentStage: 7,
        lifecycleStatus: 'completed',
        latestQA: {
          ...course.latestQA,
          humanSignOff,
        },
      };
      store!.set(course.id, completedCourse);
      return { ok: true as const, course: completedCourse };
    },

    async listCourseVersions(companyId, courseIdParam) {
      if (!coursesByCompany.get(companyId)?.has(courseIdParam)) return [];
      return versionsByCourse.get(`${companyId}:${courseIdParam}`) || [];
    },

    async addCourseVersion(companyId, _userId, courseIdParam, snapshot) {
      if (!coursesByCompany.get(companyId)?.has(courseIdParam)) {
        return { notFound: true };
      }
      const key = `${companyId}:${courseIdParam}`;
      const list = versionsByCourse.get(key) || [];
      const saved: CourseVersionSnapshot = {
        ...snapshot,
        id: snapshot.id || `ver-${crypto.randomUUID()}`,
      };
      list.unshift(saved);
      versionsByCourse.set(key, list);
      return { version: saved };
    },

    async migrateLocalWorkspace(params) {
      return {
        migratedCourses: params.projects.length,
        skippedCourses: 0,
        migratedTemplates: params.customTemplates.length,
        skippedTemplates: 0,
      };
    },

    async listTemplates(companyId) {
      return Array.from(templatesByCompany.get(companyId)?.values() || []);
    },

    async saveTemplate(companyId, _userId, template, templateIdParam) {
      if (template.visibility === 'system' || template.isSystemReference) {
        return { forbiddenSystem: true };
      }
      const store = templatesByCompany.get(companyId) || new Map<string, CourseTemplate>();
      templatesByCompany.set(companyId, store);
      if (templateIdParam && !store.has(templateIdParam)) {
        return { notFound: true };
      }
      const id = templateIdParam || template.id || `tpl-${crypto.randomUUID()}`;
      const saved: CourseTemplate = {
        ...template,
        id,
        companyId,
        visibility: 'company',
        isSystemReference: false,
      };
      store.set(id, saved);
      return { template: saved };
    },

    async deleteTemplate(companyId, templateIdParam) {
      return {
        deleted: Boolean(templatesByCompany.get(companyId)?.delete(templateIdParam)),
      };
    },

    async uploadSourceFile(params) {
      const sourceId = `src-${crypto.randomUUID()}`;
      sourcesById.set(sourceId, { companyId: params.companyId, fileName: params.fileName });
      return {
        sourceId,
        storagePath: `${params.companyId}/${params.fileName}`,
        signedUrl: `https://storage.test/${sourceId}`,
      };
    },

    async getSourceSignedUrl(companyId, sourceId) {
      const found = sourcesById.get(sourceId);
      if (!found || found.companyId !== companyId) return { signedUrl: null, notFound: true };
      return { signedUrl: `https://storage.test/${sourceId}`, fileName: found.fileName };
    },

    async deleteSourceDocument(companyId, sourceId) {
      const found = sourcesById.get(sourceId);
      if (!found || found.companyId !== companyId) return false;
      return sourcesById.delete(sourceId);
    },

    async getAiUsageSummary() {
      return {
        totalCalls: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalEstimatedCost: 0,
        recentRecords: [],
      };
    },
  };

  function verifyUserEmail(email: string) {
    const u = findUserByEmail(email);
    if (u) u.emailVerified = true;
  }

  return { authVerifier, service, usersById, tokens, memberships, verifyUserEmail };
}
