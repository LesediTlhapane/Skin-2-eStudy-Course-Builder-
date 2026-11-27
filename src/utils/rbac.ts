import type {
  CompanyRole,
  CourseProject,
  GovernanceRole,
  GovernanceUiRoleKey,
  QAEvaluationReport,
  RoleSignOffRecord,
} from '../types.js';

export interface RolePermissions {
  role: CompanyRole;
  governanceRoles: GovernanceRole[];
  isReadOnly: boolean;
  canManageCompany: boolean;
  canCreateOrDeleteCourse: boolean;
  canEditCourse: boolean;
  canCreateVersionSnapshot: boolean;
  canManageTemplates: boolean;
  canUploadSource: boolean;
  canDeleteSource: boolean;
  canUseAiGeneration: boolean;
  canRunQA: boolean;
  canRemediateQA: boolean;
  canApproveGovernance: boolean;
  canPublishCourse: boolean;
}

const VALID_COMPANY_ROLES: ReadonlySet<CompanyRole> = new Set([
  'company_admin',
  'author',
  'reviewer',
  'viewer',
]);

export const VALID_GOVERNANCE_ROLES: readonly GovernanceRole[] = [
  'sme',
  'instructional_designer',
  'compliance_authorizer',
] as const;

const VALID_GOVERNANCE_ROLE_SET: ReadonlySet<GovernanceRole> = new Set(VALID_GOVERNANCE_ROLES);

export const GOVERNANCE_ROLE_LABELS: Record<GovernanceRole, string> = {
  sme: 'Subject-Matter Expert (SME)',
  instructional_designer: 'Instructional Designer',
  compliance_authorizer: 'Compliance Authoriser',
};

export function normalizeGovernanceRole(raw?: string | null): GovernanceRole | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim();
  if (cleaned === 'sme') return 'sme';
  if (cleaned === 'instructional_designer' || cleaned === 'instructionalDesigner') {
    return 'instructional_designer';
  }
  if (cleaned === 'compliance_authorizer' || cleaned === 'complianceAuthorizer') {
    return 'compliance_authorizer';
  }
  return null;
}

export function normalizeGovernanceRoles(raw?: unknown): GovernanceRole[] {
  if (!Array.isArray(raw)) return [];
  const unique = new Set<GovernanceRole>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const normalized = normalizeGovernanceRole(item);
    if (normalized && VALID_GOVERNANCE_ROLE_SET.has(normalized)) {
      unique.add(normalized);
    }
  }
  return Array.from(unique);
}

export function governanceRoleToUiKey(role: GovernanceRole): GovernanceUiRoleKey {
  if (role === 'instructional_designer') return 'instructionalDesigner';
  if (role === 'compliance_authorizer') return 'complianceAuthorizer';
  return 'sme';
}

export function uiKeyToGovernanceRole(key: GovernanceUiRoleKey): GovernanceRole {
  if (key === 'instructionalDesigner') return 'instructional_designer';
  if (key === 'complianceAuthorizer') return 'compliance_authorizer';
  return 'sme';
}

export function normalizeCompanyRole(role?: CompanyRole | null): CompanyRole {
  if (role && VALID_COMPANY_ROLES.has(role)) {
    return role;
  }
  return 'viewer';
}

export function getRolePermissions(
  role?: CompanyRole | null,
  governanceRoles?: GovernanceRole[] | null
): RolePermissions {
  const effective = normalizeCompanyRole(role);
  const normalizedGovRoles = normalizeGovernanceRoles(governanceRoles);
  const isAdmin = effective === 'company_admin';
  const isAuthor = effective === 'author';
  const isReviewer = effective === 'reviewer';
  const isViewer = effective === 'viewer';
  const hasExplicitGovRole = normalizedGovRoles.length > 0;

  return {
    role: effective,
    governanceRoles: normalizedGovRoles,
    isReadOnly: isViewer,
    canManageCompany: isAdmin,
    canCreateOrDeleteCourse: isAdmin || isAuthor,
    canEditCourse: isAdmin || isAuthor || isReviewer,
    canCreateVersionSnapshot: isAdmin || isAuthor || isReviewer,
    canManageTemplates: isAdmin || isAuthor,
    canUploadSource: isAdmin || isAuthor,
    canDeleteSource: isAdmin || isAuthor,
    canUseAiGeneration: isAdmin || isAuthor || isReviewer,
    canRunQA: isAdmin || isAuthor || isReviewer,
    canRemediateQA: isAdmin || isAuthor || isReviewer,
    // Both Reviewer and Company Admin require explicit governance-role authorisation
    canApproveGovernance: (isAdmin || isReviewer) && hasExplicitGovRole,
    // Reviewer can release when all 3 distinct human approvals pass; Company Admin only if separately authorised
    canPublishCourse: isReviewer || (isAdmin && hasExplicitGovRole),
  };
}

export function canApproveGovernance(
  role?: CompanyRole | null,
  governanceRoles?: GovernanceRole[] | null
): boolean {
  return getRolePermissions(role, governanceRoles).canApproveGovernance;
}

export function canApproveGovernanceRole(
  role?: CompanyRole | null,
  governanceRoles?: GovernanceRole[] | null,
  targetRole?: GovernanceRole | GovernanceUiRoleKey | null
): boolean {
  const effectiveRole = normalizeCompanyRole(role);
  if (effectiveRole !== 'reviewer' && effectiveRole !== 'company_admin') {
    return false;
  }
  const normalizedTarget = normalizeGovernanceRole(targetRole || '');
  if (!normalizedTarget) return false;
  return normalizeGovernanceRoles(governanceRoles).includes(normalizedTarget);
}

export function isAiPlaceholderReviewerName(name?: string | null): boolean {
  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes('ai qa auto-sign-off') ||
    normalized.includes('ai provisional') ||
    normalized.includes('provisional — pending human review') ||
    normalized.includes('pending human review')
  );
}

export function hasGenuineHumanGovernanceSignOff(
  signOff?: QAEvaluationReport['humanSignOff'] | null,
  expectedScope?: { companyId?: string; courseId?: string }
): {
  valid: boolean;
  reason?: string;
} {
  if (!signOff || !signOff.signedOff) {
    return { valid: false, reason: 'Formal human governance sign-off has not been completed.' };
  }

  if (isAiPlaceholderReviewerName(signOff.reviewerName)) {
    return {
      valid: false,
      reason: 'AI-generated provisional sign-offs are not permitted for course completion.',
    };
  }

  const roles = signOff.roles;
  if (!roles) {
    return {
      valid: false,
      reason:
        'All three human governance roles (SME, Instructional Designer, Compliance Authoriser) must sign off.',
    };
  }

  const entries: Array<[GovernanceRole, string, RoleSignOffRecord]> = [
    ['sme', GOVERNANCE_ROLE_LABELS.sme, roles.sme],
    [
      'instructional_designer',
      GOVERNANCE_ROLE_LABELS.instructional_designer,
      roles.instructionalDesigner,
    ],
    [
      'compliance_authorizer',
      GOVERNANCE_ROLE_LABELS.compliance_authorizer,
      roles.complianceAuthorizer,
    ],
  ];

  const distinctUserIds = new Set<string>();

  for (const [, label, entry] of entries) {
    if (!entry || !entry.signedOff || entry.status === 'rejected') {
      return { valid: false, reason: `${label} sign-off is required before completion.` };
    }
    const cleanName = String(entry.reviewerName || '').trim();
    if (cleanName.length < 2) {
      return { valid: false, reason: `${label} must provide a verified display name to sign off.` };
    }
    if (isAiPlaceholderReviewerName(cleanName)) {
      return {
        valid: false,
        reason: `${label} sign-off cannot use an automated AI placeholder name.`,
      };
    }
    const reviewerUserId = String(entry.reviewerUserId || '').trim();
    if (!reviewerUserId) {
      return {
        valid: false,
        reason: `${label} approval must be bound to an authenticated user account.`,
      };
    }
    if (!entry.signedOffAt) {
      return {
        valid: false,
        reason: `${label} approval is missing a server-verified approval timestamp.`,
      };
    }
    if (expectedScope?.companyId && entry.companyId && entry.companyId !== expectedScope.companyId) {
      return {
        valid: false,
        reason: `${label} approval belongs to a different company workspace.`,
      };
    }
    if (expectedScope?.courseId && entry.courseId && entry.courseId !== expectedScope.courseId) {
      return {
        valid: false,
        reason: `${label} approval belongs to a different course.`,
      };
    }
    if (distinctUserIds.has(reviewerUserId)) {
      return {
        valid: false,
        reason:
          'Three-person governance rule violated: each required governance role (SME, Instructional Designer, Compliance Authoriser) must be approved by a different authenticated user.',
      };
    }
    distinctUserIds.add(reviewerUserId);
  }

  return { valid: true };
}

function normalizeSignOffEntryForCompare(entry?: RoleSignOffRecord) {
  return {
    signedOff: Boolean(entry?.signedOff),
    reviewerName: String(entry?.reviewerName || '').trim(),
    reviewerUserId: String(entry?.reviewerUserId || '').trim(),
    governanceRole: entry?.governanceRole || '',
    companyId: String(entry?.companyId || '').trim(),
    courseId: String(entry?.courseId || '').trim(),
    status: entry?.status || (entry?.signedOff ? 'approved' : 'pending'),
    signedOffAt: String(entry?.signedOffAt || '').trim(),
  };
}

function isSameRoleSignOff(a?: RoleSignOffRecord, b?: RoleSignOffRecord): boolean {
  const na = normalizeSignOffEntryForCompare(a);
  const nb = normalizeSignOffEntryForCompare(b);
  return (
    na.signedOff === nb.signedOff &&
    na.reviewerName === nb.reviewerName &&
    na.reviewerUserId === nb.reviewerUserId &&
    na.governanceRole === nb.governanceRole &&
    na.companyId === nb.companyId &&
    na.courseId === nb.courseId &&
    na.status === nb.status &&
    na.signedOffAt === nb.signedOffAt
  );
}

function isSameHumanSignOff(
  prev?: QAEvaluationReport['humanSignOff'] | null,
  next?: QAEvaluationReport['humanSignOff'] | null
): boolean {
  return (
    Boolean(prev?.signedOff) === Boolean(next?.signedOff) &&
    String(prev?.reviewerName || '').trim() === String(next?.reviewerName || '').trim() &&
    String(prev?.signedOffAt || '').trim() === String(next?.signedOffAt || '').trim() &&
    isSameRoleSignOff(prev?.roles?.sme, next?.roles?.sme) &&
    isSameRoleSignOff(prev?.roles?.instructionalDesigner, next?.roles?.instructionalDesigner) &&
    isSameRoleSignOff(prev?.roles?.complianceAuthorizer, next?.roles?.complianceAuthorizer)
  );
}

function isEmptyUnsignedSignOff(signOff?: QAEvaluationReport['humanSignOff'] | null): boolean {
  if (!signOff) return true;
  if (signOff.signedOff || String(signOff.reviewerName || '').trim() || signOff.signedOffAt) {
    return false;
  }
  const r = signOff.roles;
  if (!r) return true;
  const entries = [r.sme, r.instructionalDesigner, r.complianceAuthorizer];
  return entries.every(
    e =>
      !e ||
      (!e.signedOff &&
        !String(e.reviewerName || '').trim() &&
        !String(e.reviewerUserId || '').trim() &&
        !e.signedOffAt)
  );
}

function didSupplyOrChangeApprovalInPayload(
  prev?: QAEvaluationReport['humanSignOff'] | null,
  next?: QAEvaluationReport['humanSignOff'] | null
): boolean {
  if (!next) return false;
  if (!prev) {
    return !isEmptyUnsignedSignOff(next);
  }
  return !isSameHumanSignOff(prev, next);
}

export function validateCourseGovernanceMutation(params: {
  actorRole: CompanyRole;
  actorGovernanceRoles?: GovernanceRole[] | null;
  incomingProject: CourseProject;
  existingProject?: CourseProject | null;
}): { ok: true } | { ok: false; status: 400 | 403 | 409; error: string } {
  const { actorRole, actorGovernanceRoles, incomingProject, existingProject } = params;
  const perms = getRolePermissions(actorRole, actorGovernanceRoles);

  if (!perms.canEditCourse) {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden: viewer accounts have read-only access and cannot modify courses.',
    };
  }

  const prevSignOff = existingProject?.latestQA?.humanSignOff;
  const nextSignOff = incomingProject.latestQA?.humanSignOff;

  // 1. Completed course governance approvals are strictly immutable
  if (existingProject?.lifecycleStatus === 'completed') {
    if (didSupplyOrChangeApprovalInPayload(prevSignOff, nextSignOff)) {
      return {
        ok: false,
        status: 409,
        error:
          'Conflict: governance approvals on a completed course are immutable and cannot be modified or overwritten.',
      };
    }
  }

  // 2. Reject client-forged or arbitrary governance approval payloads on generic course create/update routes
  if (!existingProject) {
    if (!isEmptyUnsignedSignOff(nextSignOff)) {
      return {
        ok: false,
        status: 403,
        error:
          'Forbidden: governance approvals cannot be forged during course creation. Use authenticated per-role approval endpoints.',
      };
    }
  } else if (didSupplyOrChangeApprovalInPayload(prevSignOff, nextSignOff)) {
    // Allow clearing pending draft sign-offs only when QA re-runs on a non-completed course without introducing any approved/named entries
    const isFreshQaResetOnDraft =
      existingProject.lifecycleStatus !== 'completed' &&
      incomingProject.lifecycleStatus !== 'completed' &&
      isEmptyUnsignedSignOff(nextSignOff);

    if (!isFreshQaResetOnDraft) {
      return {
        ok: false,
        status: 403,
        error:
          'Forbidden: governance approvals cannot be supplied or edited in course payloads. Each reviewer must sign off via authenticated governance endpoints.',
      };
    }
  }

  // 3. Enforce role & 3-person identity gate on completion
  if (incomingProject.lifecycleStatus === 'completed') {
    if (!perms.canPublishCourse) {
      return {
        ok: false,
        status: 403,
        error:
          'Forbidden: only a Reviewer or a separately authorised Company Administrator can complete and publish a course.',
      };
    }
    if (!incomingProject.latestQA) {
      return {
        ok: false,
        status: 400,
        error: 'A Quality Assurance evaluation is required before marking a course completed.',
      };
    }
    if (incomingProject.latestQA.verdict === 'FAIL') {
      return {
        ok: false,
        status: 400,
        error: 'Courses with a FAIL QA verdict cannot be marked completed.',
      };
    }
    if ((incomingProject.latestQA.blockingErrors?.length || 0) > 0) {
      return {
        ok: false,
        status: 400,
        error: 'All blocking QA issues must be resolved before marking a course completed.',
      };
    }

    const authoritativeSignOff = existingProject?.latestQA?.humanSignOff;
    const signOffCheck = hasGenuineHumanGovernanceSignOff(authoritativeSignOff, {
      companyId: existingProject?.companyId,
      courseId: existingProject?.id,
    });
    if (!signOffCheck.valid) {
      return {
        ok: false,
        status: 400,
        error:
          signOffCheck.reason ||
          'Genuine human multi-role sign-off is required before marking a course completed.',
      };
    }
  }

  return { ok: true };
}
