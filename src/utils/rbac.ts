import type { CompanyRole, CourseProject, HumanSignOffRecord } from '../types.js';

export interface RolePermissions {
  role: CompanyRole;
  isReadOnly: boolean;
  canManageCompany: boolean;
  canCreateOrDeleteCourse: boolean;
  canEditCourse: boolean;
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

export function normalizeCompanyRole(role?: CompanyRole | null): CompanyRole {
  if (role && VALID_COMPANY_ROLES.has(role)) {
    return role;
  }
  return 'viewer';
}

export function getRolePermissions(role?: CompanyRole | null): RolePermissions {
  const effective = normalizeCompanyRole(role);
  const isAdmin = effective === 'company_admin';
  const isAuthor = effective === 'author';
  const isReviewer = effective === 'reviewer';
  const isViewer = effective === 'viewer';

  return {
    role: effective,
    isReadOnly: isViewer,
    canManageCompany: isAdmin,
    canCreateOrDeleteCourse: isAdmin || isAuthor,
    canEditCourse: isAdmin || isAuthor || isReviewer,
    canManageTemplates: isAdmin || isAuthor,
    canUploadSource: isAdmin || isAuthor || isReviewer,
    canDeleteSource: isAdmin || isAuthor,
    canUseAiGeneration: isAdmin || isAuthor || isReviewer,
    canRunQA: isAdmin || isAuthor || isReviewer,
    canRemediateQA: isAdmin || isAuthor || isReviewer,
    canApproveGovernance: isAdmin || isReviewer,
    canPublishCourse: !isViewer,
  };
}

export function canApproveGovernance(role?: CompanyRole | null): boolean {
  return getRolePermissions(role).canApproveGovernance;
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

export function hasGenuineHumanGovernanceSignOff(signOff?: HumanSignOffRecord | null): {
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

  const entries: Array<[string, { signedOff: boolean; reviewerName: string }]> = [
    ['Subject-Matter Expert (SME)', roles.sme],
    ['Instructional Designer', roles.instructionalDesigner],
    ['Compliance Authoriser', roles.complianceAuthorizer],
  ];

  for (const [label, entry] of entries) {
    if (!entry || !entry.signedOff) {
      return { valid: false, reason: `${label} sign-off is required before completion.` };
    }
    const cleanName = String(entry.reviewerName || '').trim();
    if (cleanName.length < 2) {
      return { valid: false, reason: `${label} must provide their full name to sign off.` };
    }
    if (isAiPlaceholderReviewerName(cleanName)) {
      return {
        valid: false,
        reason: `${label} sign-off cannot use an automated AI placeholder name.`,
      };
    }
  }

  return { valid: true };
}

function didEnableOrChangeSignOffRole(
  prev?: { signedOff?: boolean; reviewerName?: string; signedOffAt?: string },
  next?: { signedOff?: boolean; reviewerName?: string; signedOffAt?: string }
): boolean {
  if (!next?.signedOff) return false;
  if (!prev?.signedOff) return true;
  return (
    String(prev.reviewerName || '').trim() !== String(next.reviewerName || '').trim() ||
    String(prev.signedOffAt || '') !== String(next.signedOffAt || '')
  );
}

export function validateCourseGovernanceMutation(params: {
  actorRole: CompanyRole;
  incomingProject: CourseProject;
  existingProject?: CourseProject | null;
}): { ok: true } | { ok: false; status: 400 | 403; error: string } {
  const { actorRole, incomingProject, existingProject } = params;
  const perms = getRolePermissions(actorRole);

  if (!perms.canEditCourse) {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden: viewer accounts have read-only access and cannot modify courses.',
    };
  }

  const prevSignOff = existingProject?.latestQA?.humanSignOff;
  const nextSignOff = incomingProject.latestQA?.humanSignOff;

  if (!perms.canApproveGovernance) {
    const transitioningToCompleted =
      incomingProject.lifecycleStatus === 'completed' &&
      existingProject?.lifecycleStatus !== 'completed';
    if (transitioningToCompleted) {
      return {
        ok: false,
        status: 403,
        error:
          'Forbidden: only a Reviewer or Company Administrator can formally complete and release a course.',
      };
    }

    const tamperedOverall =
      Boolean(nextSignOff?.signedOff) &&
      (!prevSignOff?.signedOff ||
        String(prevSignOff.reviewerName || '') !== String(nextSignOff?.reviewerName || ''));
    const tamperedRoles =
      didEnableOrChangeSignOffRole(prevSignOff?.roles?.sme, nextSignOff?.roles?.sme) ||
      didEnableOrChangeSignOffRole(
        prevSignOff?.roles?.instructionalDesigner,
        nextSignOff?.roles?.instructionalDesigner
      ) ||
      didEnableOrChangeSignOffRole(
        prevSignOff?.roles?.complianceAuthorizer,
        nextSignOff?.roles?.complianceAuthorizer
      );

    if (tamperedOverall || tamperedRoles) {
      return {
        ok: false,
        status: 403,
        error:
          'Forbidden: authors cannot sign off formal governance approval gates. Submit the course for Reviewer or Company Administrator sign-off.',
      };
    }
  }

  if (incomingProject.lifecycleStatus === 'completed') {
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
    const signOffCheck = hasGenuineHumanGovernanceSignOff(nextSignOff);
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
