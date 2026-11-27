import crypto from 'node:crypto';
import express from 'express';
import type {
  AiUsageRecord,
  AiUsageSummary,
  CompanyMembership,
  CompanyRole,
  CompanyWorkspace,
  CourseGovernanceApprovalRecord,
  CourseProject,
  CourseTemplate,
  CourseVersionSnapshot,
  GovernanceRole,
  MembershipStatus,
  QAEvaluationReport,
  RoleSignOffRecord,
  SourceDocument,
} from '../types.js';
import type { AuthenticatedRequest, TenantAuthVerifier } from './authMiddleware.js';
import {
  AuthServiceUnavailableError,
  createTenantAuthMiddleware,
  createUserSessionMiddleware,
  defaultTenantAuthVerifier,
  extractBearerToken,
  isMissingSchemaColumnError,
  isTransientAuthError,
  requireCompanyRole,
} from './authMiddleware.js';
import {
  extractCompanyLogoStoragePath,
  getSupabaseAdminClient,
  getSupabaseAnonAuthClient,
  isSupabaseServerConfigured,
  isValidHexColour,
  isValidUuid,
  MAX_COMPANY_LOGO_BYTES,
  sanitizeHttpUrl,
  sanitizeStorageSegment,
  slugifyCompanyName,
  validateLogoImageBuffer,
} from './supabaseAdmin.js';
import {
  canApproveGovernanceRole,
  getRolePermissions,
  GOVERNANCE_ROLE_LABELS,
  governanceRoleToUiKey,
  hasGenuineHumanGovernanceSignOff,
  normalizeGovernanceRole,
  normalizeGovernanceRoles,
  VALID_GOVERNANCE_ROLES,
  validateCourseGovernanceMutation,
} from '../utils/rbac.js';

const VALID_ROLES: CompanyRole[] = ['company_admin', 'author', 'reviewer', 'viewer'];
const VALID_LIFECYCLE_STATUSES = new Set([
  'draft',
  'in_development',
  'awaiting_review',
  'revision_required',
  'completed',
]);
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
]);
const FORBIDDEN_PRIVILEGE_KEYS = [
  'isPlatformAdmin',
  'is_platform_admin',
  'superAdmin',
  'super_admin',
  'platformRole',
  'platform_role',
  'globalAdmin',
];

function mapCompany(row: any): CompanyWorkspace {
  return {
    id: String(row.id),
    companyName: String(row.company_name || 'Company Workspace'),
    companySlug: String(row.company_slug || ''),
    logoUrl: row.logo_url ?? null,
    primaryColour: String(row.primary_colour || '#052B66'),
    secondaryColour: String(row.secondary_colour || '#45CC42'),
    subscriptionStatus: String(row.subscription_status || 'trialing'),
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || new Date().toISOString()),
  };
}

function hasForbiddenPrivilegeInjection(body: Record<string, any>): boolean {
  if (!body || typeof body !== 'object') return false;
  for (const key of FORBIDDEN_PRIVILEGE_KEYS) {
    if (body[key] !== undefined && body[key] !== false && body[key] !== null) {
      return true;
    }
  }
  if (typeof body.role === 'string' && !VALID_ROLES.includes(body.role as CompanyRole)) {
    return true;
  }
  return false;
}

function mapCourseRowToProject(row: any): CourseProject {
  const data = (row.course_data && typeof row.course_data === 'object' ? row.course_data : {}) as any;
  return {
    ...data,
    id: String(row.local_source_id || row.id),
    companyId: String(row.company_id),
    createdBy: row.created_by ? String(row.created_by) : data.createdBy,
    localSourceId: row.local_source_id ? String(row.local_source_id) : undefined,
    lifecycleStatus: row.lifecycle_status || data.lifecycleStatus || 'draft',
    createdAt: String(row.created_at || data.createdAt || new Date().toISOString()),
    updatedAt: String(row.updated_at || data.updatedAt || new Date().toISOString()),
  };
}

function mapTemplateRowToTemplate(row: any): CourseTemplate {
  const data =
    row.template_data && typeof row.template_data === 'object' ? row.template_data : {};
  return {
    ...(data as CourseTemplate),
    id: String(row.local_source_id || row.id),
    name: String(row.template_name || (data as any).name || 'Untitled Template'),
    companyId: row.company_id ? String(row.company_id) : null,
    visibility: row.visibility === 'system' ? 'system' : 'company',
    isSystemReference: row.visibility === 'system',
    localSourceId: row.local_source_id ? String(row.local_source_id) : undefined,
    createdAt: String(row.created_at || (data as any).createdAt || new Date().toISOString()),
    updatedAt: String(row.updated_at || (data as any).updatedAt || new Date().toISOString()),
  };
}

export interface ParsedLogoUpload {
  fileName: string;
  mimeType: string;
  ext: 'png' | 'jpg' | 'webp';
  buffer: Buffer;
}

export function parseAndValidateLogoUpload(body: any):
  | { ok: true; logo: ParsedLogoUpload }
  | { ok: false; statusCode: number; error: string } {
  const { fileName, base64Data } = body || {};
  if (!base64Data || typeof base64Data !== 'string') {
    return { ok: false, statusCode: 400, error: 'Missing logo image payload.' };
  }

  const compact = base64Data.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!compact || !/^[A-Za-z0-9+/=]+$/.test(compact)) {
    return { ok: false, statusCode: 400, error: 'Invalid base64 image payload.' };
  }

  if (compact.length > 2_900_000) {
    return {
      ok: false,
      statusCode: 413,
      error: 'Company logo exceeds the 2 MB maximum upload size.',
    };
  }

  const buffer = Buffer.from(compact, 'base64');
  const validation = validateLogoImageBuffer(buffer);
  if (validation.valid === false) {
    return {
      ok: false,
      statusCode: buffer.byteLength > MAX_COMPANY_LOGO_BYTES ? 413 : 400,
      error: validation.error,
    };
  }

  return {
    ok: true,
    logo: {
      fileName:
        typeof fileName === 'string' && fileName.trim()
          ? fileName.trim()
          : `logo.${validation.ext}`,
      mimeType: validation.mimeType,
      ext: validation.ext,
      buffer,
    },
  };
}

export interface TenantServiceAdapter {
  registerCompany(params: {
    existingUserId?: string;
    existingEmail?: string;
    existingFullName?: string;
    email?: string;
    password?: string;
    fullName?: string;
    redirectTo?: string;
    companyName: string;
    primaryColour: string;
    secondaryColour: string;
    logoUrl: string | null;
    logoUpload?: ParsedLogoUpload | null;
  }): Promise<{
    company: CompanyWorkspace;
    userId: string;
    email: string;
    requiresEmailVerification?: boolean;
    message?: string;
  }>;

  registerInvitedUser(params: {
    email: string;
    password: string;
    fullName: string;
    redirectTo?: string;
  }): Promise<{
    userId: string;
    email: string;
    activatedMembershipsCount: number;
    requiresEmailVerification?: boolean;
    accountAlreadyConfirmed?: boolean;
    invitedPending?: boolean;
    message?: string;
  }>;

  acceptPendingInvitations?(
    userId: string,
    email: string
  ): Promise<{ activatedMembershipsCount: number; memberships: CompanyMembership[] }>;

  updateCompany(
    companyId: string,
    userId: string,
    patch: {
      companyName?: string;
      logoUrl?: string | null;
      primaryColour?: string;
      secondaryColour?: string;
    }
  ): Promise<CompanyWorkspace>;

  uploadCompanyLogo(params: {
    companyId: string;
    userId: string;
    fileName: string;
    mimeType: string;
    ext: 'png' | 'jpg' | 'webp';
    buffer: Buffer;
  }): Promise<{ company: CompanyWorkspace; logoUrl: string; storagePath: string }>;

  removeCompanyLogo(companyId: string, userId: string): Promise<CompanyWorkspace>;

  listMembers(companyId: string): Promise<CompanyMembership[]>;

  inviteMember(params: {
    companyId: string;
    invitedByUserId: string;
    email: string;
    fullName: string;
    role: CompanyRole;
    governanceRoles?: GovernanceRole[];
    temporaryPassword?: string;
    redirectTo?: string;
  }): Promise<CompanyMembership>;

  updateMember(params: {
    companyId: string;
    memberId: string;
    actorUserId: string;
    role?: CompanyRole;
    governanceRoles?: GovernanceRole[];
    membershipStatus?: MembershipStatus;
  }): Promise<CompanyMembership>;

  listCourses(companyId: string): Promise<CourseProject[]>;
  getCourse?(companyId: string, courseIdParam: string): Promise<CourseProject | null>;
  saveCourse(
    companyId: string,
    userId: string,
    project: CourseProject,
    courseIdParam?: string,
    options?: { expectedUpdatedAt?: string }
  ): Promise<{ project: CourseProject; notFound?: boolean; conflict?: boolean }>;
  deleteCourse(companyId: string, courseIdParam: string): Promise<boolean>;

  getCourseGovernance?(
    companyId: string,
    courseIdParam: string
  ): Promise<{
    notFound?: boolean;
    courseId?: string;
    lifecycleStatus?: string;
    approvals: CourseGovernanceApprovalRecord[];
    humanSignOff?: QAEvaluationReport['humanSignOff'];
  }>;

  submitCourseGovernanceDecision?(params: {
    companyId: string;
    courseIdParam: string;
    actorUserId: string;
    actorName: string;
    actorRole: CompanyRole;
    actorGovernanceRoles: GovernanceRole[];
    governanceRole: GovernanceRole;
    decision: 'approved' | 'rejected';
    notes?: string;
  }): Promise<
    | {
        ok: true;
        course: CourseProject;
        approval: CourseGovernanceApprovalRecord;
        approvals: CourseGovernanceApprovalRecord[];
      }
    | { ok: false; status: 400 | 403 | 404 | 409; error: string }
  >;

  revokeCourseGovernanceDecision?(params: {
    companyId: string;
    courseIdParam: string;
    actorUserId: string;
    actorRole: CompanyRole;
    governanceRole: GovernanceRole;
  }): Promise<
    | {
        ok: true;
        course: CourseProject;
        approvals: CourseGovernanceApprovalRecord[];
      }
    | { ok: false; status: 400 | 403 | 404 | 409; error: string }
  >;

  completeCourseRelease?(params: {
    companyId: string;
    courseIdParam: string;
    actorUserId: string;
    actorName: string;
    actorRole: CompanyRole;
    actorGovernanceRoles: GovernanceRole[];
  }): Promise<
    | { ok: true; course: CourseProject }
    | { ok: false; status: 400 | 403 | 404 | 409; error: string }
  >;

  listCourseVersions(companyId: string, courseIdParam: string): Promise<CourseVersionSnapshot[]>;
  addCourseVersion(
    companyId: string,
    userId: string,
    courseIdParam: string,
    snapshot: CourseVersionSnapshot
  ): Promise<{ version?: CourseVersionSnapshot; notFound?: boolean }>;

  migrateLocalWorkspace(params: {
    companyId: string;
    userId: string;
    projects: CourseProject[];
    customTemplates: CourseTemplate[];
  }): Promise<{
    migratedCourses: number;
    skippedCourses: number;
    migratedTemplates: number;
    skippedTemplates: number;
  }>;

  listTemplates(companyId: string): Promise<CourseTemplate[]>;
  saveTemplate(
    companyId: string,
    userId: string,
    template: CourseTemplate,
    templateIdParam?: string
  ): Promise<{ template?: CourseTemplate; forbiddenSystem?: boolean; notFound?: boolean }>;
  deleteTemplate(
    companyId: string,
    templateIdParam: string
  ): Promise<{ deleted: boolean; forbiddenSystem?: boolean }>;

  uploadSourceFile(params: {
    companyId: string;
    userId: string;
    courseId?: string;
    fileName: string;
    mimeType: string;
    buffer: Buffer;
    extractedText: string;
    metadata: Record<string, any>;
  }): Promise<{ sourceId: string; storagePath: string; signedUrl: string | null }>;

  getSourceSignedUrl(
    companyId: string,
    sourceId: string
  ): Promise<{ signedUrl: string | null; fileName?: string; notFound?: boolean }>;

  deleteSourceDocument(companyId: string, sourceId: string): Promise<boolean>;

  getAiUsageSummary(companyId: string): Promise<AiUsageSummary>;
}

class SupabaseTenantService implements TenantServiceAdapter {
  private async findCourseRow(companyId: string, courseIdParam: string) {
    const admin = getSupabaseAdminClient();
    if (isValidUuid(courseIdParam)) {
      const { data } = await admin
        .from('courses')
        .select('*')
        .eq('company_id', companyId)
        .eq('id', courseIdParam)
        .maybeSingle();
      if (data) return data;
    }
    const { data: byLocal } = await admin
      .from('courses')
      .select('*')
      .eq('company_id', companyId)
      .eq('local_source_id', courseIdParam)
      .maybeSingle();
    return byLocal || null;
  }

  private async ensureCourseExistsElsewhere(courseIdParam: string): Promise<boolean> {
    const admin = getSupabaseAdminClient();
    if (isValidUuid(courseIdParam)) {
      const { data } = await admin.from('courses').select('id').eq('id', courseIdParam).maybeSingle();
      return Boolean(data);
    }
    return false;
  }

  private async findAuthUserByEmail(email: string): Promise<{
    id: string;
    email: string;
    fullName: string;
    emailConfirmed: boolean;
  } | null> {
    const admin = getSupabaseAdminClient();
    const normalized = email.trim().toLowerCase();

    const { data: profileRow } = await admin
      .from('user_profiles')
      .select('id, email, full_name')
      .ilike('email', normalized)
      .maybeSingle();

    if (profileRow?.id) {
      const { data: authLookup } = await admin.auth.admin.getUserById(String(profileRow.id));
      const u = authLookup?.user;
      if (u) {
        return {
          id: u.id,
          email: String(u.email || normalized).toLowerCase(),
          fullName: String(profileRow.full_name || (u.user_metadata as any)?.full_name || ''),
          emailConfirmed: Boolean(u.email_confirmed_at),
        };
      }
    }

    for (let page = 1; page <= 5; page++) {
      const { data: listData, error: listErr } = await admin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (listErr || !listData?.users?.length) break;
      const found = listData.users.find(
        u => String(u.email || '').trim().toLowerCase() === normalized
      );
      if (found) {
        return {
          id: found.id,
          email: String(found.email || normalized).toLowerCase(),
          fullName: String((found.user_metadata as any)?.full_name || ''),
          emailConfirmed: Boolean(found.email_confirmed_at),
        };
      }
      if (listData.users.length < 200) break;
    }

    return null;
  }

  async registerCompany(params: {
    existingUserId?: string;
    existingEmail?: string;
    existingFullName?: string;
    email?: string;
    password?: string;
    fullName?: string;
    redirectTo?: string;
    companyName: string;
    primaryColour: string;
    secondaryColour: string;
    logoUrl: string | null;
    logoUpload?: ParsedLogoUpload | null;
  }) {
    const admin = getSupabaseAdminClient();
    let userId = params.existingUserId;
    let userEmail = String(params.existingEmail || params.email || '').trim().toLowerCase();
    let createdAuthUser = false;
    let requiresEmailVerification = false;

    if (!userId) {
      if (!userEmail || !params.password || params.password.length < 8) {
        throw new Error('Valid email and a password of at least 8 characters are required.');
      }

      const existing = await this.findAuthUserByEmail(userEmail);
      if (existing) {
        if (existing.emailConfirmed) {
          throw new Error(
            'An account with this email already exists. Please sign in first, then create your new company workspace.'
          );
        }
        const anon = getSupabaseAnonAuthClient();
        if (anon) {
          await anon.auth
            .resend({
              type: 'signup',
              email: userEmail,
              options: params.redirectTo ? { emailRedirectTo: params.redirectTo } : undefined,
            })
            .catch(() => {});
        }
        throw new Error(
          'An account with this email is awaiting email verification. Please verify your email inbox first and sign in to create a company workspace.'
        );
      }

      const fullNameTrimmed = (params.fullName || '').trim();
      const anon = getSupabaseAnonAuthClient();

      if (anon) {
        const { data: signUpData, error: signUpErr } = await anon.auth.signUp({
          email: userEmail,
          password: params.password,
          options: {
            data: { full_name: fullNameTrimmed },
            emailRedirectTo: params.redirectTo,
          },
        });
        if (signUpErr || !signUpData?.user) {
          throw new Error(signUpErr?.message || 'Could not create user account.');
        }
        // Supabase returns empty identities if user already existed when enumeration protection is enabled
        if (Array.isArray(signUpData.user.identities) && signUpData.user.identities.length === 0) {
          throw new Error(
            'An account with this email already exists. Please sign in first, then create your new company workspace.'
          );
        }
        userId = signUpData.user.id;
        userEmail = String(signUpData.user.email || userEmail).toLowerCase();
        createdAuthUser = true;
        requiresEmailVerification = !signUpData.user.email_confirmed_at;
      } else {
        const { data: authCreated, error: authErr } = await admin.auth.admin.createUser({
          email: userEmail,
          password: params.password,
          email_confirm: false,
          user_metadata: {
            full_name: fullNameTrimmed,
          },
        });
        if (authErr || !authCreated?.user) {
          throw new Error(authErr?.message || 'Could not create user account.');
        }
        await admin.auth.admin
          .generateLink({
            type: 'signup',
            email: userEmail,
            password: params.password,
            options: params.redirectTo ? { redirectTo: params.redirectTo } : undefined,
          })
          .catch(() => {});
        userId = authCreated.user.id;
        userEmail = String(authCreated.user.email || userEmail).toLowerCase();
        createdAuthUser = true;
        requiresEmailVerification = true;
      }
    }

    try {
      await admin.from('user_profiles').upsert({
        id: userId,
        email: userEmail,
        full_name: (params.fullName || params.existingFullName || '').trim(),
      });

      const baseSlug = slugifyCompanyName(params.companyName);
      const uniqueSuffix = crypto.randomBytes(2).toString('hex');
      const { data: existingSlug } = await admin
        .from('companies')
        .select('id')
        .eq('company_slug', baseSlug)
        .maybeSingle();
      const companySlug = existingSlug ? `${baseSlug}-${uniqueSuffix}` : baseSlug;

      const { data: companyRow, error: companyErr } = await admin
        .from('companies')
        .insert({
          company_name: params.companyName.trim(),
          company_slug: companySlug,
          logo_url: params.logoUrl,
          primary_colour: params.primaryColour,
          secondary_colour: params.secondaryColour,
          subscription_status: 'trialing',
        })
        .select('*')
        .single();

      if (companyErr || !companyRow) {
        throw new Error(companyErr?.message || 'Failed to create company workspace.');
      }

      const { error: memErr } = await admin.from('company_memberships').insert({
        company_id: companyRow.id,
        user_id: userId,
        role: 'company_admin',
        membership_status: requiresEmailVerification ? 'invited' : 'active',
      });

      if (memErr) {
        await admin.from('companies').delete().eq('id', companyRow.id);
        throw new Error(memErr.message || 'Failed to assign company administrator membership.');
      }

      let finalCompanyRow = companyRow;
      if (params.logoUpload) {
        const uploaded = await this.uploadCompanyLogo({
          companyId: companyRow.id,
          userId,
          fileName: params.logoUpload.fileName,
          mimeType: params.logoUpload.mimeType,
          ext: params.logoUpload.ext,
          buffer: params.logoUpload.buffer,
        }).catch(async logoErr => {
          await admin.from('company_memberships').delete().eq('company_id', companyRow.id);
          await admin.from('companies').delete().eq('id', companyRow.id);
          throw logoErr;
        });
        finalCompanyRow = {
          ...companyRow,
          logo_url: uploaded.logoUrl,
          updated_at: uploaded.company.updatedAt,
        };
      }

      await admin.from('audit_logs').insert({
        company_id: finalCompanyRow.id,
        user_id: userId,
        action: 'company_registered',
        resource_type: 'company',
        resource_id: finalCompanyRow.id,
        details: {
          companyName: finalCompanyRow.company_name,
          requiresEmailVerification,
          hasUploadedLogo: Boolean(finalCompanyRow.logo_url),
        },
      });

      return {
        company: mapCompany(finalCompanyRow),
        userId,
        email: userEmail,
        requiresEmailVerification,
        message: requiresEmailVerification
          ? 'Company registered! Please verify your email address via the confirmation link sent to your inbox before signing in.'
          : 'Company workspace created and activated.',
      };
    } catch (err) {
      if (createdAuthUser && userId) {
        await admin.auth.admin.deleteUser(userId).catch(() => {});
      }
      throw err;
    }
  }

  async registerInvitedUser(params: {
    email: string;
    password: string;
    fullName: string;
    redirectTo?: string;
  }) {
    const admin = getSupabaseAdminClient();
    const email = params.email.trim().toLowerCase();
    const fullName = params.fullName.trim();

    const existing = await this.findAuthUserByEmail(email);

    if (existing) {
      await admin.from('user_profiles').upsert({
        id: existing.id,
        email,
        full_name: fullName || existing.fullName,
      });

      if (existing.emailConfirmed) {
        return {
          userId: existing.id,
          email,
          activatedMembershipsCount: 0,
          requiresEmailVerification: false,
          accountAlreadyConfirmed: true,
          message:
            'An account with this email is already verified. Please sign in with your password (or use Forgot Password) to access your company workspace.',
        };
      }

      // User exists from admin inviteUserByEmail or unconfirmed signup — never overwrite password or auto-confirm without email ownership!
      const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName || existing.fullName },
        redirectTo: params.redirectTo,
      });
      if (inviteErr) {
        const anon = getSupabaseAnonAuthClient();
        if (anon) {
          await anon.auth
            .resend({
              type: 'signup',
              email,
              options: params.redirectTo ? { emailRedirectTo: params.redirectTo } : undefined,
            })
            .catch(() => {});
        }
      }

      return {
        userId: existing.id,
        email,
        activatedMembershipsCount: 0,
        requiresEmailVerification: true,
        invitedPending: true,
        message:
          'We sent a fresh invitation / verification link to your email address. Click that link to confirm email ownership, set your password, and activate your workspace.',
      };
    }

    const anon = getSupabaseAnonAuthClient();
    let userId: string;

    if (anon) {
      const { data: signUpData, error: signUpErr } = await anon.auth.signUp({
        email,
        password: params.password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: params.redirectTo,
        },
      });
      if (signUpErr || !signUpData?.user) {
        throw new Error(signUpErr?.message || 'Could not register user account.');
      }
      userId = signUpData.user.id;
    } else {
      const { data: authCreated, error: authErr } = await admin.auth.admin.createUser({
        email,
        password: params.password,
        email_confirm: false,
        user_metadata: { full_name: fullName },
      });
      if (authErr || !authCreated?.user) {
        throw new Error(authErr?.message || 'Could not register user account.');
      }
      userId = authCreated.user.id;
      await admin.auth.admin
        .generateLink({
          type: 'signup',
          email,
          password: params.password,
          options: params.redirectTo ? { redirectTo: params.redirectTo } : undefined,
        })
        .catch(() => {});
    }

    await admin.from('user_profiles').upsert({
      id: userId,
      email,
      full_name: fullName,
    });

    return {
      userId,
      email,
      activatedMembershipsCount: 0,
      requiresEmailVerification: true,
      message:
        'Account created. Please click the verification link sent to your email address before signing in.',
    };
  }

  async acceptPendingInvitations(userId: string, _email: string) {
    const admin = getSupabaseAdminClient();
    const { data: activated, error: actErr } = await admin
      .from('company_memberships')
      .update({ membership_status: 'active' })
      .eq('user_id', userId)
      .eq('membership_status', 'invited')
      .select('id, company_id');

    if (actErr) {
      throw new Error(actErr.message || 'Failed to activate pending invitations.');
    }

    let { data: membershipRows, error: memError } = await admin
      .from('company_memberships')
      .select(
        'id, company_id, user_id, role, governance_roles, membership_status, created_at, companies ( id, company_name, company_slug, logo_url, primary_colour, secondary_colour, subscription_status, created_at, updated_at )'
      )
      .eq('user_id', userId)
      .eq('membership_status', 'active')
      .order('created_at', { ascending: true });

    if (memError && isMissingSchemaColumnError(memError, 'governance_roles')) {
      const fallbackRes = await admin
        .from('company_memberships')
        .select(
          'id, company_id, user_id, role, membership_status, created_at, companies ( id, company_name, company_slug, logo_url, primary_colour, secondary_colour, subscription_status, created_at, updated_at )'
        )
        .eq('user_id', userId)
        .eq('membership_status', 'active')
        .order('created_at', { ascending: true });
      membershipRows = fallbackRes.data as typeof membershipRows;
      memError = fallbackRes.error;
    }

    if (memError) {
      throw new Error(memError.message || 'Failed to load company memberships.');
    }

    const memberships: CompanyMembership[] = (membershipRows || []).map((row: any) => ({
      id: String(row.id),
      companyId: String(row.company_id),
      userId: String(row.user_id),
      role: row.role as CompanyRole,
      governanceRoles: normalizeGovernanceRoles(row.governance_roles),
      membershipStatus: row.membership_status as MembershipStatus,
      createdAt: String(row.created_at),
      company: row.companies ? mapCompany(row.companies) : undefined,
    }));

    return {
      activatedMembershipsCount: Array.isArray(activated) ? activated.length : 0,
      memberships,
    };
  }

  async updateCompany(
    companyId: string,
    userId: string,
    patch: {
      companyName?: string;
      logoUrl?: string | null;
      primaryColour?: string;
      secondaryColour?: string;
    }
  ) {
    const admin = getSupabaseAdminClient();
    const { data: existingRow } = await admin
      .from('companies')
      .select('logo_url')
      .eq('id', companyId)
      .maybeSingle();

    const updates: Record<string, any> = {};
    if (patch.companyName !== undefined) updates.company_name = patch.companyName.trim();
    if (patch.logoUrl !== undefined) updates.logo_url = patch.logoUrl;
    if (patch.primaryColour !== undefined) updates.primary_colour = patch.primaryColour;
    if (patch.secondaryColour !== undefined) updates.secondary_colour = patch.secondaryColour;

    const { data, error } = await admin
      .from('companies')
      .update(updates)
      .eq('id', companyId)
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Failed to update company settings.');
    }

    // Clean up replaced/cleared managed storage logo if the URL changed
    if (patch.logoUrl !== undefined && existingRow?.logo_url && existingRow.logo_url !== patch.logoUrl) {
      const oldPath = extractCompanyLogoStoragePath(existingRow.logo_url, companyId);
      if (oldPath) {
        await admin.storage.from('company-logos').remove([oldPath]).catch(() => {});
      }
    }

    await admin.from('audit_logs').insert({
      company_id: companyId,
      user_id: userId,
      action: 'company_settings_updated',
      resource_type: 'company',
      resource_id: companyId,
      details: updates,
    });

    return mapCompany(data);
  }

  async uploadCompanyLogo(params: {
    companyId: string;
    userId: string;
    fileName: string;
    mimeType: string;
    ext: 'png' | 'jpg' | 'webp';
    buffer: Buffer;
  }) {
    const admin = getSupabaseAdminClient();
    const { data: existingRow } = await admin
      .from('companies')
      .select('logo_url')
      .eq('id', params.companyId)
      .maybeSingle();

    const baseName = sanitizeStorageSegment(
      params.fileName.replace(/\.[^.]+$/, '') || 'logo'
    ).slice(0, 48);
    const storagePath = `${params.companyId}/${crypto.randomUUID()}-${baseName}.${params.ext}`;

    let { error: uploadErr } = await admin.storage
      .from('company-logos')
      .upload(storagePath, params.buffer, {
        contentType: params.mimeType,
        cacheControl: '3600',
        upsert: false,
      });

    // If bucket has not been provisioned yet, create it cleanly with strict limits and retry once
    if (uploadErr && /bucket.*not found|not.*exist/i.test(uploadErr.message || '')) {
      await admin.storage
        .createBucket('company-logos', {
          public: true,
          fileSizeLimit: MAX_COMPANY_LOGO_BYTES,
          allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        })
        .catch(() => {});

      const retry = await admin.storage
        .from('company-logos')
        .upload(storagePath, params.buffer, {
          contentType: params.mimeType,
          cacheControl: '3600',
          upsert: false,
        });
      uploadErr = retry.error;
    }

    if (uploadErr) {
      throw new Error(`Company logo upload failed: ${uploadErr.message}`);
    }

    const { data: pubData } = admin.storage.from('company-logos').getPublicUrl(storagePath);
    const publicUrl = sanitizeHttpUrl(pubData?.publicUrl);
    if (!publicUrl) {
      await admin.storage.from('company-logos').remove([storagePath]).catch(() => {});
      throw new Error('Could not resolve public URL for uploaded company logo.');
    }

    const { data: updatedRow, error: updateErr } = await admin
      .from('companies')
      .update({ logo_url: publicUrl })
      .eq('id', params.companyId)
      .select('*')
      .single();

    if (updateErr || !updatedRow) {
      await admin.storage.from('company-logos').remove([storagePath]).catch(() => {});
      throw new Error(updateErr?.message || 'Failed to save logo reference to company record.');
    }

    // Remove previous managed logo only after new upload & DB update both succeeded
    const oldPath = extractCompanyLogoStoragePath(existingRow?.logo_url, params.companyId);
    if (oldPath && oldPath !== storagePath) {
      await admin.storage.from('company-logos').remove([oldPath]).catch(() => {});
    }

    await admin.from('audit_logs').insert({
      company_id: params.companyId,
      user_id: params.userId,
      action: 'company_logo_uploaded',
      resource_type: 'company',
      resource_id: params.companyId,
      details: { storagePath, mimeType: params.mimeType, bytes: params.buffer.byteLength },
    });

    return {
      company: mapCompany(updatedRow),
      logoUrl: publicUrl,
      storagePath,
    };
  }

  async removeCompanyLogo(companyId: string, userId: string): Promise<CompanyWorkspace> {
    const admin = getSupabaseAdminClient();
    const { data: existingRow } = await admin
      .from('companies')
      .select('logo_url')
      .eq('id', companyId)
      .maybeSingle();

    const { data: updatedRow, error: updateErr } = await admin
      .from('companies')
      .update({ logo_url: null })
      .eq('id', companyId)
      .select('*')
      .single();

    if (updateErr || !updatedRow) {
      throw new Error(updateErr?.message || 'Failed to remove company logo.');
    }

    const oldPath = extractCompanyLogoStoragePath(existingRow?.logo_url, companyId);
    if (oldPath) {
      await admin.storage.from('company-logos').remove([oldPath]).catch(() => {});
    }

    await admin.from('audit_logs').insert({
      company_id: companyId,
      user_id: userId,
      action: 'company_logo_removed',
      resource_type: 'company',
      resource_id: companyId,
      details: {},
    });

    return mapCompany(updatedRow);
  }

  async listMembers(companyId: string): Promise<CompanyMembership[]> {
    const admin = getSupabaseAdminClient();
    let { data, error } = await admin
      .from('company_memberships')
      .select(
        'id, company_id, user_id, role, governance_roles, membership_status, created_at, user_profiles ( id, full_name, email )'
      )
      .eq('company_id', companyId)
      .order('created_at', { ascending: true });

    if (error && isMissingSchemaColumnError(error, 'governance_roles')) {
      const fallbackRes = await admin
        .from('company_memberships')
        .select(
          'id, company_id, user_id, role, membership_status, created_at, user_profiles ( id, full_name, email )'
        )
        .eq('company_id', companyId)
        .order('created_at', { ascending: true });
      data = fallbackRes.data as typeof data;
      error = fallbackRes.error;
    }

    if (error) throw new Error(error.message);
    return (data || []).map((row: any) => ({
      id: String(row.id),
      companyId: String(row.company_id),
      userId: String(row.user_id),
      role: row.role as CompanyRole,
      governanceRoles: normalizeGovernanceRoles(row.governance_roles),
      membershipStatus: row.membership_status as MembershipStatus,
      createdAt: String(row.created_at),
      profile: row.user_profiles
        ? {
            id: String(row.user_profiles.id),
            fullName: String(row.user_profiles.full_name || ''),
            email: String(row.user_profiles.email || ''),
          }
        : undefined,
    }));
  }

  async inviteMember(params: {
    companyId: string;
    invitedByUserId: string;
    email: string;
    fullName: string;
    role: CompanyRole;
    governanceRoles?: GovernanceRole[];
    temporaryPassword?: string;
    redirectTo?: string;
  }): Promise<CompanyMembership> {
    const admin = getSupabaseAdminClient();
    const email = params.email.trim().toLowerCase();
    const trimmedName = params.fullName.trim();
    const normalizedGovRoles =
      params.role === 'reviewer' || params.role === 'company_admin'
        ? normalizeGovernanceRoles(params.governanceRoles)
        : [];

    const existingAuthUser = await this.findAuthUserByEmail(email);

    let targetUserId = existingAuthUser?.id;
    let status: MembershipStatus;

    if (existingAuthUser) {
      await admin.from('user_profiles').upsert({
        id: existingAuthUser.id,
        email,
        full_name: existingAuthUser.fullName || trimmedName,
      });

      const { data: existingMembership } = await admin
        .from('company_memberships')
        .select('id, membership_status')
        .eq('company_id', params.companyId)
        .eq('user_id', existingAuthUser.id)
        .maybeSingle();

      if (existingMembership?.membership_status === 'active') {
        status = 'active';
      } else if (!existingAuthUser.emailConfirmed && !params.temporaryPassword) {
        await admin.auth.admin
          .inviteUserByEmail(email, {
            data: { full_name: trimmedName },
            redirectTo: params.redirectTo,
          })
          .catch(() => {});
        status = 'invited';
      } else {
        status = 'invited';
      }
    } else if (params.temporaryPassword && params.temporaryPassword.length >= 8) {
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password: params.temporaryPassword,
        email_confirm: false,
        user_metadata: { full_name: trimmedName },
      });
      if (error || !created?.user) {
        throw new Error(error?.message || 'Could not create team member account.');
      }
      targetUserId = created.user.id;
      status = 'invited';
      await admin.from('user_profiles').upsert({
        id: targetUserId,
        email,
        full_name: trimmedName,
      });
      await admin.auth.admin
        .inviteUserByEmail(email, {
          data: { full_name: trimmedName },
          redirectTo: params.redirectTo,
        })
        .catch(() => {});
    } else {
      const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: trimmedName },
        redirectTo: params.redirectTo,
      });
      if (error || !invited?.user) {
        throw new Error(
          error?.message ||
            'Could not send Supabase invitation email. Verify SMTP/Auth settings in Supabase.'
        );
      }
      targetUserId = invited.user.id;
      status = 'invited';
      await admin.from('user_profiles').upsert({
        id: targetUserId,
        email,
        full_name: trimmedName,
      });
    }

    if (!targetUserId) {
      throw new Error('Could not resolve invited user account.');
    }

    let { data: memRow, error: memErr } = await admin
      .from('company_memberships')
      .upsert(
        {
          company_id: params.companyId,
          user_id: targetUserId,
          role: params.role,
          governance_roles: normalizedGovRoles,
          membership_status: status,
        },
        { onConflict: 'company_id,user_id' }
      )
      .select(
        'id, company_id, user_id, role, governance_roles, membership_status, created_at, user_profiles ( id, full_name, email )'
      )
      .single();

    if (memErr && isMissingSchemaColumnError(memErr, 'governance_roles')) {
      if (normalizedGovRoles.length > 0) {
        throw new Error(
          'Apply supabase/migrations/005_governance_hardening.sql before assigning governance roles.'
        );
      }
      const fallbackRes = await admin
        .from('company_memberships')
        .upsert(
          {
            company_id: params.companyId,
            user_id: targetUserId,
            role: params.role,
            membership_status: status,
          },
          { onConflict: 'company_id,user_id' }
        )
        .select(
          'id, company_id, user_id, role, membership_status, created_at, user_profiles ( id, full_name, email )'
        )
        .single();
      memRow = fallbackRes.data as typeof memRow;
      memErr = fallbackRes.error;
    }

    if (memErr || !memRow) {
      throw new Error(memErr?.message || 'Failed to add member to company workspace.');
    }

    await admin.from('audit_logs').insert({
      company_id: params.companyId,
      user_id: params.invitedByUserId,
      action: 'member_invited',
      resource_type: 'company_membership',
      resource_id: String(memRow.id),
      details: { email, role: params.role, governanceRoles: normalizedGovRoles, status },
    });

    const profileObj = (memRow as any).user_profiles;
    return {
      id: String(memRow.id),
      companyId: String(memRow.company_id),
      userId: String(memRow.user_id),
      role: memRow.role as CompanyRole,
      governanceRoles: normalizeGovernanceRoles(memRow.governance_roles),
      membershipStatus: memRow.membership_status as MembershipStatus,
      createdAt: String(memRow.created_at),
      profile: profileObj
        ? {
            id: String(profileObj.id),
            fullName: String(profileObj.full_name || params.fullName),
            email: String(profileObj.email || email),
          }
        : { id: targetUserId, fullName: params.fullName, email },
    };
  }

  async updateMember(params: {
    companyId: string;
    memberId: string;
    actorUserId: string;
    role?: CompanyRole;
    governanceRoles?: GovernanceRole[];
    membershipStatus?: MembershipStatus;
  }): Promise<CompanyMembership> {
    const admin = getSupabaseAdminClient();
    const { data: target, error: findErr } = await admin
      .from('company_memberships')
      .select('*')
      .eq('id', params.memberId)
      .eq('company_id', params.companyId)
      .maybeSingle();

    if (findErr || !target) {
      throw new Error('Team membership record not found in your company.');
    }

    const removingAdminPrivilege =
      target.role === 'company_admin' &&
      target.membership_status === 'active' &&
      ((params.role && params.role !== 'company_admin') ||
        (params.membershipStatus && params.membershipStatus !== 'active'));

    if (removingAdminPrivilege) {
      const { count } = await admin
        .from('company_memberships')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', params.companyId)
        .eq('role', 'company_admin')
        .eq('membership_status', 'active');
      if ((count || 0) <= 1) {
        throw new Error('Cannot demote or suspend the last active company administrator.');
      }
    }

    const nextRole = params.role || (target.role as CompanyRole);
    const updates: Record<string, any> = {};
    if (params.role) updates.role = params.role;
    if (params.membershipStatus) updates.membership_status = params.membershipStatus;
    if (params.governanceRoles !== undefined) {
      updates.governance_roles =
        nextRole === 'reviewer' || nextRole === 'company_admin'
          ? normalizeGovernanceRoles(params.governanceRoles)
          : [];
    } else if (params.role && params.role !== 'reviewer' && params.role !== 'company_admin') {
      updates.governance_roles = [];
    }

    let { data: updated, error: updErr } = await admin
      .from('company_memberships')
      .update(updates)
      .eq('id', params.memberId)
      .eq('company_id', params.companyId)
      .select(
        'id, company_id, user_id, role, governance_roles, membership_status, created_at, user_profiles ( id, full_name, email )'
      )
      .single();

    if (updErr && isMissingSchemaColumnError(updErr, 'governance_roles')) {
      if (Array.isArray(updates.governance_roles) && updates.governance_roles.length > 0) {
        throw new Error(
          'Apply supabase/migrations/005_governance_hardening.sql before assigning governance roles.'
        );
      }
      const { governance_roles: _ignoredGov, ...fallbackUpdates } = updates;
      if (Object.keys(fallbackUpdates).length === 0) {
        const refetched = await admin
          .from('company_memberships')
          .select(
            'id, company_id, user_id, role, membership_status, created_at, user_profiles ( id, full_name, email )'
          )
          .eq('id', params.memberId)
          .eq('company_id', params.companyId)
          .single();
        updated = refetched.data as typeof updated;
        updErr = refetched.error;
      } else {
        const fallbackRes = await admin
          .from('company_memberships')
          .update(fallbackUpdates)
          .eq('id', params.memberId)
          .eq('company_id', params.companyId)
          .select(
            'id, company_id, user_id, role, membership_status, created_at, user_profiles ( id, full_name, email )'
          )
          .single();
        updated = fallbackRes.data as typeof updated;
        updErr = fallbackRes.error;
      }
    }

    if (updErr || !updated) {
      throw new Error(updErr?.message || 'Failed to update team member.');
    }

    await admin.from('audit_logs').insert({
      company_id: params.companyId,
      user_id: params.actorUserId,
      action: 'member_updated',
      resource_type: 'company_membership',
      resource_id: params.memberId,
      details: updates,
    });

    const profileObj = (updated as any).user_profiles;
    return {
      id: String(updated.id),
      companyId: String(updated.company_id),
      userId: String(updated.user_id),
      role: updated.role as CompanyRole,
      governanceRoles: normalizeGovernanceRoles(updated.governance_roles),
      membershipStatus: updated.membership_status as MembershipStatus,
      createdAt: String(updated.created_at),
      profile: profileObj
        ? {
            id: String(profileObj.id),
            fullName: String(profileObj.full_name || ''),
            email: String(profileObj.email || ''),
          }
        : undefined,
    };
  }

  async listCourses(companyId: string): Promise<CourseProject[]> {
    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from('courses')
      .select('*')
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data || []).map(mapCourseRowToProject);
  }

  async getCourse(companyId: string, courseIdParam: string): Promise<CourseProject | null> {
    const row = await this.findCourseRow(companyId, courseIdParam);
    return row ? mapCourseRowToProject(row) : null;
  }

  async saveCourse(
    companyId: string,
    userId: string,
    project: CourseProject,
    courseIdParam?: string,
    options?: { expectedUpdatedAt?: string }
  ): Promise<{ project: CourseProject; notFound?: boolean; conflict?: boolean }> {
    const admin = getSupabaseAdminClient();
    const lookupKey = courseIdParam || project.localSourceId || project.id;
    const existing = lookupKey ? await this.findCourseRow(companyId, lookupKey) : null;

    if (!existing && courseIdParam && isValidUuid(courseIdParam)) {
      const existsInOtherCompany = await this.ensureCourseExistsElsewhere(courseIdParam);
      if (existsInOtherCompany) {
        return { project, notFound: true };
      }
    }

    if (existing && options?.expectedUpdatedAt) {
      const expectedMs = Date.parse(options.expectedUpdatedAt);
      const existingMs = Date.parse(String(existing.updated_at || ''));
      const mismatch =
        Number.isFinite(expectedMs) && Number.isFinite(existingMs)
          ? Math.abs(expectedMs - existingMs) > 0
          : String(existing.updated_at || '') !== options.expectedUpdatedAt;
      if (mismatch) {
        return { project: mapCourseRowToProject(existing), conflict: true };
      }
    }

    const lifecycleStatus = VALID_LIFECYCLE_STATUSES.has(project.lifecycleStatus)
      ? project.lifecycleStatus
      : 'draft';
    const courseName = (project.brief?.title || 'Untitled Course Project').trim().slice(0, 220);
    const localSourceId = existing?.local_source_id || project.localSourceId || project.id;

    const existingCourseData = (existing?.course_data || {}) as any;
    const preservedHumanSignOff = existing
      ? existing.lifecycle_status === 'completed'
        ? existingCourseData?.latestQA?.humanSignOff
        : project.latestQA?.humanSignOff || existingCourseData?.latestQA?.humanSignOff
      : undefined;

    const mergedCourseData: any = {
      ...project,
      companyId,
      localSourceId,
    };
    if (mergedCourseData.latestQA && preservedHumanSignOff) {
      mergedCourseData.latestQA = {
        ...mergedCourseData.latestQA,
        humanSignOff: preservedHumanSignOff,
      };
    }

    const payload = {
      company_id: companyId,
      course_name: courseName,
      lifecycle_status: lifecycleStatus,
      local_source_id: localSourceId,
      course_data: mergedCourseData,
    };

    if (existing) {
      let updateQuery = admin
        .from('courses')
        .update(payload)
        .eq('id', existing.id)
        .eq('company_id', companyId);
      if (existing.updated_at) {
        updateQuery = updateQuery.eq('updated_at', existing.updated_at);
      }
      const { data, error } = await updateQuery.select('*').maybeSingle();
      if (error) throw new Error(error.message || 'Failed to update course.');
      if (!data) {
        const latest = await this.findCourseRow(companyId, lookupKey!);
        if (!latest) return { project, notFound: true };
        return { project: mapCourseRowToProject(latest), conflict: true };
      }
      return { project: mapCourseRowToProject(data) };
    }

    const { data, error } = await admin
      .from('courses')
      .insert({
        ...payload,
        created_by: userId,
      })
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message || 'Failed to create course.');
    return { project: mapCourseRowToProject(data) };
  }

  private mapApprovalRow(row: any, courseDisplayId: string): CourseGovernanceApprovalRecord {
    const govRole =
      normalizeGovernanceRole(row.governance_role || row.role_key) || 'sme';
    return {
      id: String(row.id),
      companyId: String(row.company_id),
      courseId: courseDisplayId,
      governanceRole: govRole,
      reviewerUserId: String(row.reviewer_id || ''),
      reviewerName: String(row.reviewer_name || ''),
      status: (row.decision === 'rejected'
        ? 'rejected'
        : row.decision === 'pending'
        ? 'pending'
        : 'approved') as 'pending' | 'approved' | 'rejected',
      approvedAt: String(row.created_at),
      revokedAt: row.revoked_at ? String(row.revoked_at) : undefined,
      notes: row.notes ? String(row.notes) : '',
      active: row.active !== false,
    };
  }

  private buildAuthoritativeHumanSignOff(
    companyId: string,
    courseDisplayId: string,
    approvals: CourseGovernanceApprovalRecord[]
  ): QAEvaluationReport['humanSignOff'] {
    const byRole = new Map<GovernanceRole, CourseGovernanceApprovalRecord>();
    for (const a of approvals) {
      if (a.active && !byRole.has(a.governanceRole)) {
        byRole.set(a.governanceRole, a);
      }
    }

    const buildSlot = (role: GovernanceRole): RoleSignOffRecord => {
      const rec = byRole.get(role);
      if (!rec) {
        return {
          signedOff: false,
          reviewerName: '',
          governanceRole: role,
          companyId,
          courseId: courseDisplayId,
          status: 'pending',
        };
      }
      const isApproved = rec.status === 'approved';
      return {
        signedOff: isApproved,
        reviewerName: rec.reviewerName,
        reviewerUserId: rec.reviewerUserId,
        governanceRole: role,
        companyId,
        courseId: courseDisplayId,
        status: rec.status,
        signedOffAt: isApproved ? rec.approvedAt : undefined,
        notes: rec.notes || '',
      };
    };

    const roles = {
      sme: buildSlot('sme'),
      instructionalDesigner: buildSlot('instructional_designer'),
      complianceAuthorizer: buildSlot('compliance_authorizer'),
    };

    const check = hasGenuineHumanGovernanceSignOff(
      {
        signedOff: Boolean(
          roles.sme.signedOff &&
            roles.instructionalDesigner.signedOff &&
            roles.complianceAuthorizer.signedOff
        ),
        reviewerName: [
          roles.sme.signedOff && `SME: ${roles.sme.reviewerName}`,
          roles.instructionalDesigner.signedOff &&
            `ID: ${roles.instructionalDesigner.reviewerName}`,
          roles.complianceAuthorizer.signedOff &&
            `Compliance: ${roles.complianceAuthorizer.reviewerName}`,
        ]
          .filter(Boolean)
          .join(' | '),
        roles,
      },
      { companyId, courseId: courseDisplayId }
    );

    const signedDates = [roles.sme, roles.instructionalDesigner, roles.complianceAuthorizer]
      .filter(r => r.signedOff && r.signedOffAt)
      .map(r => String(r.signedOffAt))
      .sort();

    return {
      signedOff: check.valid,
      reviewerName: [
        roles.sme.signedOff && `SME: ${roles.sme.reviewerName}`,
        roles.instructionalDesigner.signedOff &&
          `ID: ${roles.instructionalDesigner.reviewerName}`,
        roles.complianceAuthorizer.signedOff &&
          `Compliance: ${roles.complianceAuthorizer.reviewerName}`,
      ]
        .filter(Boolean)
        .join(' | '),
      signedOffAt: check.valid ? signedDates[signedDates.length - 1] : undefined,
      roles,
    };
  }

  private async loadActiveApprovals(
    companyId: string,
    courseRowId: string,
    courseDisplayId: string
  ): Promise<CourseGovernanceApprovalRecord[]> {
    const admin = getSupabaseAdminClient();
    let { data, error } = await admin
      .from('course_approvals')
      .select('*')
      .eq('company_id', companyId)
      .eq('course_id', courseRowId)
      .eq('stage', 6)
      .eq('active', true)
      .order('created_at', { ascending: false });

    if (error && isMissingSchemaColumnError(error, 'active')) {
      const fallbackRes = await admin
        .from('course_approvals')
        .select('*')
        .eq('company_id', companyId)
        .eq('course_id', courseRowId)
        .eq('stage', 6)
        .order('created_at', { ascending: false });
      data = fallbackRes.data as typeof data;
      error = fallbackRes.error;
    }

    if (error) throw new Error(error.message);
    return (data || []).map((row: any) => this.mapApprovalRow(row, courseDisplayId));
  }

  async getCourseGovernance(companyId: string, courseIdParam: string) {
    const row = await this.findCourseRow(companyId, courseIdParam);
    if (!row) {
      return { notFound: true, approvals: [] };
    }
    const project = mapCourseRowToProject(row);
    const approvals = await this.loadActiveApprovals(companyId, row.id, project.id);
    const humanSignOff = this.buildAuthoritativeHumanSignOff(companyId, project.id, approvals);
    return {
      courseId: project.id,
      lifecycleStatus: project.lifecycleStatus,
      approvals,
      humanSignOff,
    };
  }

  async submitCourseGovernanceDecision(params: {
    companyId: string;
    courseIdParam: string;
    actorUserId: string;
    actorName: string;
    actorRole: CompanyRole;
    actorGovernanceRoles: GovernanceRole[];
    governanceRole: GovernanceRole;
    decision: 'approved' | 'rejected';
    notes?: string;
  }) {
    if (!canApproveGovernanceRole(params.actorRole, params.actorGovernanceRoles, params.governanceRole)) {
      return {
        ok: false as const,
        status: 403 as const,
        error: `Forbidden: you are not authorised for the ${GOVERNANCE_ROLE_LABELS[params.governanceRole]} governance role.`,
      };
    }

    const row = await this.findCourseRow(params.companyId, params.courseIdParam);
    if (!row) {
      return { ok: false as const, status: 404 as const, error: 'Course not found in your company workspace.' };
    }

    if (row.lifecycle_status === 'completed') {
      return {
        ok: false as const,
        status: 409 as const,
        error: 'Conflict: governance approvals on a completed course are immutable.',
      };
    }

    const project = mapCourseRowToProject(row);
    if (!project.latestQA) {
      return {
        ok: false as const,
        status: 400 as const,
        error: 'Run Stage 6 Quality Assurance before recording governance approvals.',
      };
    }

    const activeApprovals = await this.loadActiveApprovals(params.companyId, row.id, project.id);
    const existingForSlot = activeApprovals.find(a => a.governanceRole === params.governanceRole);
    if (existingForSlot && existingForSlot.status === 'approved' && existingForSlot.reviewerUserId !== params.actorUserId) {
      return {
        ok: false as const,
        status: 409 as const,
        error: `${GOVERNANCE_ROLE_LABELS[params.governanceRole]} is already approved by ${existingForSlot.reviewerName}. Only that reviewer may revoke their approval before completion.`,
      };
    }

    if (params.decision === 'approved') {
      const otherApprovedBySameUser = activeApprovals.find(
        a =>
          a.status === 'approved' &&
          a.reviewerUserId === params.actorUserId &&
          a.governanceRole !== params.governanceRole
      );
      if (otherApprovedBySameUser) {
        return {
          ok: false as const,
          status: 409 as const,
          error: `Three-person governance rule violated: you already hold the active approval for ${GOVERNANCE_ROLE_LABELS[otherApprovedBySameUser.governanceRole]} on this course.`,
        };
      }
    }

    const admin = getSupabaseAdminClient();
    const uiKey = governanceRoleToUiKey(params.governanceRole);
    const verifiedName = params.actorName.trim();
    if (verifiedName.length < 2) {
      return {
        ok: false as const,
        status: 400 as const,
        error: 'Authenticated reviewer profile must include a verified display name.',
      };
    }

    if (existingForSlot) {
      await admin
        .from('course_approvals')
        .update({
          active: false,
          revoked_at: new Date().toISOString(),
          revoked_by: params.actorUserId,
        })
        .eq('id', existingForSlot.id)
        .eq('company_id', params.companyId);
    }

    const { data: insertedRow, error: insErr } = await admin
      .from('course_approvals')
      .insert({
        company_id: params.companyId,
        course_id: row.id,
        stage: 6,
        role_key: uiKey,
        governance_role: params.governanceRole,
        reviewer_id: params.actorUserId,
        reviewer_name: verifiedName,
        decision: params.decision,
        notes: String(params.notes || '').slice(0, 1000),
        active: true,
      })
      .select('*')
      .single();

    if (insErr || !insertedRow) {
      throw new Error(insErr?.message || 'Failed to record governance decision.');
    }

    const updatedApprovals = await this.loadActiveApprovals(params.companyId, row.id, project.id);
    const humanSignOff = this.buildAuthoritativeHumanSignOff(
      params.companyId,
      project.id,
      updatedApprovals
    );

    const updatedCourseData: CourseProject = {
      ...project,
      latestQA: {
        ...project.latestQA,
        humanSignOff,
      },
      lifecycleStatus:
        params.decision === 'rejected' && project.lifecycleStatus === 'awaiting_review'
          ? 'revision_required'
          : project.lifecycleStatus,
    };

    const { data: savedCourseRow, error: updCourseErr } = await admin
      .from('courses')
      .update({
        course_data: updatedCourseData,
        lifecycle_status: updatedCourseData.lifecycleStatus,
      })
      .eq('id', row.id)
      .eq('company_id', params.companyId)
      .select('*')
      .single();

    if (updCourseErr || !savedCourseRow) {
      throw new Error(updCourseErr?.message || 'Failed to sync governance status to course.');
    }

    await admin.from('audit_logs').insert({
      company_id: params.companyId,
      user_id: params.actorUserId,
      action: params.decision === 'approved' ? 'governance_approved' : 'governance_rejected',
      resource_type: 'course',
      resource_id: row.id,
      details: {
        governanceRole: params.governanceRole,
        reviewerName: verifiedName,
        decision: params.decision,
      },
    });

    return {
      ok: true as const,
      course: mapCourseRowToProject(savedCourseRow),
      approval: this.mapApprovalRow(insertedRow, project.id),
      approvals: updatedApprovals,
    };
  }

  async revokeCourseGovernanceDecision(params: {
    companyId: string;
    courseIdParam: string;
    actorUserId: string;
    actorRole: CompanyRole;
    governanceRole: GovernanceRole;
  }) {
    if (params.actorRole !== 'reviewer' && params.actorRole !== 'company_admin') {
      return {
        ok: false as const,
        status: 403 as const,
        error: 'Forbidden: only Reviewers or authorised Company Administrators can revoke approvals.',
      };
    }

    const row = await this.findCourseRow(params.companyId, params.courseIdParam);
    if (!row) {
      return { ok: false as const, status: 404 as const, error: 'Course not found in your company workspace.' };
    }
    if (row.lifecycle_status === 'completed') {
      return {
        ok: false as const,
        status: 409 as const,
        error: 'Conflict: governance approvals on a completed course are immutable.',
      };
    }

    const project = mapCourseRowToProject(row);
    const activeApprovals = await this.loadActiveApprovals(params.companyId, row.id, project.id);
    const target = activeApprovals.find(a => a.governanceRole === params.governanceRole);
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

    const admin = getSupabaseAdminClient();
    await admin
      .from('course_approvals')
      .update({
        active: false,
        revoked_at: new Date().toISOString(),
        revoked_by: params.actorUserId,
      })
      .eq('id', target.id)
      .eq('company_id', params.companyId);

    const updatedApprovals = await this.loadActiveApprovals(params.companyId, row.id, project.id);
    const humanSignOff = this.buildAuthoritativeHumanSignOff(
      params.companyId,
      project.id,
      updatedApprovals
    );

    const updatedCourseData: CourseProject = {
      ...project,
      ...(project.latestQA
        ? {
            latestQA: {
              ...project.latestQA,
              humanSignOff,
            },
          }
        : {}),
    };

    const { data: savedCourseRow, error: updErr } = await admin
      .from('courses')
      .update({ course_data: updatedCourseData })
      .eq('id', row.id)
      .eq('company_id', params.companyId)
      .select('*')
      .single();

    if (updErr || !savedCourseRow) {
      throw new Error(updErr?.message || 'Failed to sync revoked approval.');
    }

    await admin.from('audit_logs').insert({
      company_id: params.companyId,
      user_id: params.actorUserId,
      action: 'governance_revoked',
      resource_type: 'course',
      resource_id: row.id,
      details: { governanceRole: params.governanceRole },
    });

    return {
      ok: true as const,
      course: mapCourseRowToProject(savedCourseRow),
      approvals: updatedApprovals,
    };
  }

  async completeCourseRelease(params: {
    companyId: string;
    courseIdParam: string;
    actorUserId: string;
    actorName: string;
    actorRole: CompanyRole;
    actorGovernanceRoles: GovernanceRole[];
  }) {
    const perms = getRolePermissions(params.actorRole, params.actorGovernanceRoles);
    if (!perms.canPublishCourse) {
      return {
        ok: false as const,
        status: 403 as const,
        error:
          'Forbidden: only a Reviewer or a separately authorised Company Administrator can complete and publish a course.',
      };
    }

    const row = await this.findCourseRow(params.companyId, params.courseIdParam);
    if (!row) {
      return { ok: false as const, status: 404 as const, error: 'Course not found in your company workspace.' };
    }

    const project = mapCourseRowToProject(row);
    if (!project.latestQA) {
      return {
        ok: false as const,
        status: 400 as const,
        error: 'A Stage 6 Quality Assurance evaluation is required before completing a course.',
      };
    }
    if (project.latestQA.verdict === 'FAIL') {
      return {
        ok: false as const,
        status: 400 as const,
        error: 'Courses with a FAIL QA verdict cannot be completed.',
      };
    }
    if ((project.latestQA.blockingErrors?.length || 0) > 0) {
      return {
        ok: false as const,
        status: 400 as const,
        error: 'All blocking QA issues must be resolved before completion.',
      };
    }

    const activeApprovals = await this.loadActiveApprovals(params.companyId, row.id, project.id);
    const humanSignOff = this.buildAuthoritativeHumanSignOff(
      params.companyId,
      project.id,
      activeApprovals
    );
    const signOffCheck = hasGenuineHumanGovernanceSignOff(humanSignOff, {
      companyId: params.companyId,
      courseId: project.id,
    });
    if (!signOffCheck.valid) {
      return {
        ok: false as const,
        status: 400 as const,
        error: signOffCheck.reason || 'Three distinct human governance approvals are required.',
      };
    }

    const admin = getSupabaseAdminClient();
    const updatedCourseData: CourseProject = {
      ...project,
      currentStage: 7,
      lifecycleStatus: 'completed',
      latestQA: {
        ...project.latestQA,
        humanSignOff,
      },
    };

    const { data: savedRow, error: updErr } = await admin
      .from('courses')
      .update({
        lifecycle_status: 'completed',
        course_data: updatedCourseData,
      })
      .eq('id', row.id)
      .eq('company_id', params.companyId)
      .select('*')
      .single();

    if (updErr || !savedRow) {
      throw new Error(updErr?.message || 'Failed to mark course completed.');
    }

    await admin.from('audit_logs').insert({
      company_id: params.companyId,
      user_id: params.actorUserId,
      action: 'course_completed',
      resource_type: 'course',
      resource_id: row.id,
      details: { releasedBy: params.actorName, role: params.actorRole },
    });

    return { ok: true as const, course: mapCourseRowToProject(savedRow) };
  }

  async deleteCourse(companyId: string, courseIdParam: string): Promise<boolean> {
    const admin = getSupabaseAdminClient();
    const existing = await this.findCourseRow(companyId, courseIdParam);
    if (!existing) return false;
    const { error } = await admin
      .from('courses')
      .delete()
      .eq('id', existing.id)
      .eq('company_id', companyId);
    if (error) throw new Error(error.message);
    return true;
  }

  async listCourseVersions(companyId: string, courseIdParam: string): Promise<CourseVersionSnapshot[]> {
    const admin = getSupabaseAdminClient();
    const courseRow = await this.findCourseRow(companyId, courseIdParam);
    if (!courseRow) return [];
    const { data, error } = await admin
      .from('course_versions')
      .select('*')
      .eq('company_id', companyId)
      .eq('course_id', courseRow.id)
      .order('version_number', { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return (data || []).map((r: any) => ({
      id: String(r.id),
      versionNumber: Number(r.version_number || 1),
      createdAt: String(r.created_at),
      stage: Number(r.snapshot_data?.currentStage || 1) as any,
      trigger: r.trigger || 'manual_snapshot',
      summary: String(r.summary || ''),
      data: r.snapshot_data,
    }));
  }

  async addCourseVersion(
    companyId: string,
    userId: string,
    courseIdParam: string,
    snapshot: CourseVersionSnapshot
  ): Promise<{ version?: CourseVersionSnapshot; notFound?: boolean }> {
    const admin = getSupabaseAdminClient();
    const courseRow = await this.findCourseRow(companyId, courseIdParam);
    if (!courseRow) return { notFound: true };

    const { data, error } = await admin
      .from('course_versions')
      .insert({
        company_id: companyId,
        course_id: courseRow.id,
        version_number: Math.max(1, Number(snapshot.versionNumber) || 1),
        trigger: snapshot.trigger || 'manual_snapshot',
        summary: String(snapshot.summary || '').slice(0, 400),
        snapshot_data: snapshot.data || {},
        created_by: userId,
      })
      .select('*')
      .single();

    if (error || !data) throw new Error(error?.message || 'Failed to store version snapshot.');
    return {
      version: {
        id: String(data.id),
        versionNumber: Number(data.version_number),
        createdAt: String(data.created_at),
        stage: Number(data.snapshot_data?.currentStage || 1) as any,
        trigger: data.trigger,
        summary: String(data.summary || ''),
        data: data.snapshot_data,
      },
    };
  }

  async migrateLocalWorkspace(params: {
    companyId: string;
    userId: string;
    projects: CourseProject[];
    customTemplates: CourseTemplate[];
  }) {
    const admin = getSupabaseAdminClient();
    let migratedCourses = 0;
    let skippedCourses = 0;
    let migratedTemplates = 0;
    let skippedTemplates = 0;

    for (const proj of params.projects) {
      if (!proj?.id) continue;
      const existing = await this.findCourseRow(params.companyId, proj.localSourceId || proj.id);
      if (existing) {
        skippedCourses++;
        continue;
      }
      await this.saveCourse(params.companyId, params.userId, proj);
      migratedCourses++;
    }

    for (const tpl of params.customTemplates) {
      if (!tpl?.id || tpl.isSystemReference) continue;
      const { data: existing } = await admin
        .from('templates')
        .select('id')
        .eq('company_id', params.companyId)
        .eq('local_source_id', tpl.id)
        .maybeSingle();
      if (existing) {
        skippedTemplates++;
        continue;
      }
      await this.saveTemplate(params.companyId, params.userId, tpl);
      migratedTemplates++;
    }

    await admin.from('audit_logs').insert({
      company_id: params.companyId,
      user_id: params.userId,
      action: 'local_workspace_migrated',
      resource_type: 'workspace',
      resource_id: params.companyId,
      details: { migratedCourses, skippedCourses, migratedTemplates, skippedTemplates },
    });

    return { migratedCourses, skippedCourses, migratedTemplates, skippedTemplates };
  }

  async listTemplates(companyId: string): Promise<CourseTemplate[]> {
    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from('templates')
      .select('*')
      .or(`visibility.eq.system,company_id.eq.${companyId}`)
      .order('updated_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data || []).map(mapTemplateRowToTemplate);
  }

  async saveTemplate(
    companyId: string,
    userId: string,
    template: CourseTemplate,
    templateIdParam?: string
  ): Promise<{ template?: CourseTemplate; forbiddenSystem?: boolean; notFound?: boolean }> {
    const admin = getSupabaseAdminClient();
    if (template.isSystemReference || template.visibility === 'system') {
      return { forbiddenSystem: true };
    }

    const lookupKey = templateIdParam || template.localSourceId || template.id;
    let existing: any = null;
    if (lookupKey) {
      if (isValidUuid(lookupKey)) {
        const { data } = await admin.from('templates').select('*').eq('id', lookupKey).maybeSingle();
        existing = data;
      }
      if (!existing) {
        const { data } = await admin
          .from('templates')
          .select('*')
          .eq('company_id', companyId)
          .eq('local_source_id', lookupKey)
          .maybeSingle();
        existing = data;
      }
    }

    if (existing) {
      if (existing.visibility === 'system' || !existing.company_id) {
        return { forbiddenSystem: true };
      }
      if (existing.company_id !== companyId) {
        return { notFound: true };
      }
      const { data, error } = await admin
        .from('templates')
        .update({
          template_name: String(template.name || 'Custom Template').slice(0, 180),
          template_data: {
            ...template,
            companyId,
            visibility: 'company',
            isSystemReference: false,
          },
        })
        .eq('id', existing.id)
        .eq('company_id', companyId)
        .select('*')
        .single();
      if (error || !data) throw new Error(error?.message || 'Failed to update template.');
      return { template: mapTemplateRowToTemplate(data) };
    }

    const localSourceId = template.localSourceId || template.id;
    const { data, error } = await admin
      .from('templates')
      .insert({
        company_id: companyId,
        created_by: userId,
        local_source_id: localSourceId,
        template_name: String(template.name || 'Custom Template').slice(0, 180),
        template_data: {
          ...template,
          companyId,
          localSourceId,
          visibility: 'company',
          isSystemReference: false,
        },
        visibility: 'company',
      })
      .select('*')
      .single();

    if (error || !data) throw new Error(error?.message || 'Failed to save template.');
    return { template: mapTemplateRowToTemplate(data) };
  }

  async deleteTemplate(
    companyId: string,
    templateIdParam: string
  ): Promise<{ deleted: boolean; forbiddenSystem?: boolean }> {
    const admin = getSupabaseAdminClient();
    let existing: any;
    if (isValidUuid(templateIdParam)) {
      const { data } = await admin
        .from('templates')
        .select('id, company_id, visibility')
        .eq('id', templateIdParam)
        .maybeSingle();
      existing = data;
    } else {
      const { data } = await admin
        .from('templates')
        .select('id, company_id, visibility')
        .eq('company_id', companyId)
        .eq('local_source_id', templateIdParam)
        .maybeSingle();
      existing = data;
    }

    if (!existing) return { deleted: false };
    if (existing.visibility === 'system' || !existing.company_id) {
      return { deleted: false, forbiddenSystem: true };
    }
    if (existing.company_id !== companyId) {
      return { deleted: false };
    }

    const { error } = await admin
      .from('templates')
      .delete()
      .eq('id', existing.id)
      .eq('company_id', companyId);
    if (error) throw new Error(error.message);
    return { deleted: true };
  }

  async uploadSourceFile(params: {
    companyId: string;
    userId: string;
    courseId?: string;
    fileName: string;
    mimeType: string;
    buffer: Buffer;
    extractedText: string;
    metadata: Record<string, any>;
  }) {
    const admin = getSupabaseAdminClient();
    const courseRow = params.courseId
      ? await this.findCourseRow(params.companyId, params.courseId)
      : null;

    const courseSegment = courseRow?.id || 'general';
    const sourceUuid = crypto.randomUUID();
    const safeFile = sanitizeStorageSegment(params.fileName);
    const storagePath = `${params.companyId}/${courseSegment}/${sourceUuid}-${safeFile}`;

    const { error: uploadErr } = await admin.storage
      .from('course-sources')
      .upload(storagePath, params.buffer, {
        contentType: params.mimeType || 'application/octet-stream',
        upsert: false,
      });

    if (uploadErr) {
      throw new Error(`Storage upload failed: ${uploadErr.message}`);
    }

    const { data: docRow, error: docErr } = await admin
      .from('source_documents')
      .insert({
        id: sourceUuid,
        company_id: params.companyId,
        course_id: courseRow?.id || null,
        uploaded_by: params.userId,
        file_name: params.fileName,
        mime_type: params.mimeType || 'application/octet-stream',
        file_size_bytes: params.buffer.byteLength,
        storage_path: storagePath,
        metadata: params.metadata || {},
        extracted_text: params.extractedText.slice(0, 200_000),
        verification_status: 'NEEDS REVIEW',
      })
      .select('*')
      .single();

    if (docErr || !docRow) {
      await admin.storage.from('course-sources').remove([storagePath]).catch(() => {});
      throw new Error(docErr?.message || 'Failed to record source document metadata.');
    }

    const { data: signed } = await admin.storage
      .from('course-sources')
      .createSignedUrl(storagePath, 180);

    return {
      sourceId: String(docRow.id),
      storagePath,
      signedUrl: signed?.signedUrl || null,
    };
  }

  async getSourceSignedUrl(companyId: string, sourceId: string) {
    const admin = getSupabaseAdminClient();
    const { data: doc } = await admin
      .from('source_documents')
      .select('id, company_id, storage_path, file_name')
      .eq('id', sourceId)
      .eq('company_id', companyId)
      .maybeSingle();

    if (!doc) return { signedUrl: null, notFound: true };
    const { data: signed, error } = await admin.storage
      .from('course-sources')
      .createSignedUrl(doc.storage_path, 120);
    if (error) throw new Error(error.message);
    return {
      signedUrl: signed?.signedUrl || null,
      fileName: String(doc.file_name || 'document'),
    };
  }

  async deleteSourceDocument(companyId: string, sourceId: string): Promise<boolean> {
    const admin = getSupabaseAdminClient();
    const { data: doc } = await admin
      .from('source_documents')
      .select('id, company_id, storage_path')
      .eq('id', sourceId)
      .eq('company_id', companyId)
      .maybeSingle();

    if (!doc) return false;
    await admin.storage.from('course-sources').remove([doc.storage_path]).catch(() => {});
    await admin.from('source_documents').delete().eq('id', sourceId).eq('company_id', companyId);
    return true;
  }

  async getAiUsageSummary(companyId: string): Promise<AiUsageSummary> {
    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from('ai_usage_records')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw new Error(error.message);
    const records: AiUsageRecord[] = (data || []).map((r: any) => ({
      id: String(r.id),
      companyId: String(r.company_id),
      userId: r.user_id ? String(r.user_id) : null,
      provider: String(r.provider),
      model: String(r.model),
      operation: String(r.operation),
      inputTokens: Number(r.input_tokens || 0),
      outputTokens: Number(r.output_tokens || 0),
      estimatedCost: Number(r.estimated_cost || 0),
      createdAt: String(r.created_at),
    }));

    return {
      totalCalls: records.length,
      totalInputTokens: records.reduce((sum, r) => sum + r.inputTokens, 0),
      totalOutputTokens: records.reduce((sum, r) => sum + r.outputTokens, 0),
      totalEstimatedCost: Number(
        records.reduce((sum, r) => sum + r.estimatedCost, 0).toFixed(6)
      ),
      recentRecords: records,
    };
  }
}

export const defaultTenantService: TenantServiceAdapter = new SupabaseTenantService();

export interface TenantRouterDependencies {
  authVerifier?: TenantAuthVerifier;
  service?: TenantServiceAdapter;
  isConfiguredFn?: () => boolean;
  postAuthRateLimit?: express.RequestHandler;
}

function composeAuthHandlers(
  primary: express.RequestHandler,
  postAuth?: express.RequestHandler
): express.RequestHandler {
  if (!postAuth) return primary;
  return (req, res, next) => {
    primary(req, res, (err?: any) => {
      if (err) return next(err);
      return postAuth(req, res, next);
    });
  };
}

export function attachTenantRoutes(
  router: express.Router,
  deps?: TenantRouterDependencies
): void {
  const verifier = deps?.authVerifier || defaultTenantAuthVerifier;
  const service = deps?.service || defaultTenantService;
  const checkConfigured = deps?.isConfiguredFn || isSupabaseServerConfigured;

  const requireUserSession = composeAuthHandlers(
    createUserSessionMiddleware(verifier),
    deps?.postAuthRateLimit
  );
  const requireTenantAuth = composeAuthHandlers(
    createTenantAuthMiddleware(verifier),
    deps?.postAuthRateLimit
  );

  // Public registration: creates a new organization workspace and sets first user strictly as 'company_admin'
  router.post('/v2/auth/register-company', async (req: express.Request, res: express.Response) => {
    try {
      if (!checkConfigured()) {
        return res.status(503).json({
          success: false,
          error:
            'Supabase server credentials are missing. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
        });
      }

      const body = req.body || {};
      if (hasForbiddenPrivilegeInjection(body)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid role or privilege parameters in company registration request.',
        });
      }

      const companyName = String(body.companyName || '').trim();
      if (companyName.length < 2) {
        return res.status(400).json({
          success: false,
          error: 'Company name must be at least 2 characters.',
        });
      }

      const primaryColour = isValidHexColour(body.primaryColour) ? body.primaryColour : '#052B66';
      const secondaryColour = isValidHexColour(body.secondaryColour)
        ? body.secondaryColour
        : '#45CC42';
      const logoUrl = sanitizeHttpUrl(body.logoUrl);
      let validatedLogoUpload: ParsedLogoUpload | null = null;
      if (body.logoUpload && typeof body.logoUpload === 'object') {
        const parsedLogo = parseAndValidateLogoUpload(body.logoUpload);
        if (parsedLogo.ok === false) {
          return res.status(parsedLogo.statusCode).json({
            success: false,
            error: parsedLogo.error,
          });
        }
        validatedLogoUpload = parsedLogo.logo;
      }

      let existingUserId: string | undefined;
      let existingEmail: string | undefined;
      let existingFullName: string | undefined;

      const bearer = extractBearerToken(req);
      if (bearer) {
        const session = await verifier.verifyAccessToken(bearer);
        if (!session) {
          return res.status(401).json({ success: false, error: 'Invalid session token.' });
        }
        if (session.emailVerified === false) {
          return res.status(403).json({
            success: false,
            code: 'EMAIL_NOT_VERIFIED',
            error: 'Please verify your email address before creating a company workspace.',
          });
        }
        existingUserId = session.userId;
        existingEmail = session.email;
        existingFullName = session.profile.fullName;
      } else {
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        const fullName = String(body.fullName || '').trim();
        if (!fullName || fullName.length < 2) {
          return res.status(400).json({ success: false, error: 'Full name is required.' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return res.status(400).json({ success: false, error: 'Valid email address is required.' });
        }
        if (password.length < 8) {
          return res.status(400).json({
            success: false,
            error: 'Password must be at least 8 characters.',
          });
        }
      }

      const result = await service.registerCompany({
        existingUserId,
        existingEmail,
        existingFullName,
        email: body.email,
        password: body.password,
        fullName: body.fullName,
        redirectTo: sanitizeHttpUrl(body.redirectTo) || undefined,
        companyName,
        primaryColour,
        secondaryColour,
        logoUrl,
        logoUpload: validatedLogoUpload,
      });

      return res.status(201).json({ success: true, ...result });
    } catch (err: any) {
      if (isTransientAuthError(err)) {
        return res.status(503).json({
          success: false,
          code: 'AUTH_SERVICE_UNAVAILABLE',
          error:
            err instanceof AuthServiceUnavailableError
              ? err.message
              : 'Authentication service temporarily unavailable. Please retry shortly.',
        });
      }
      const msg = String(err?.message || 'Company registration failed.');
      const status = msg.toLowerCase().includes('already exists') ? 409 : 400;
      return res.status(status).json({
        success: false,
        error: msg,
      });
    }
  });

  // Public user registration: creates a standard account and activates pending company invitations matching email
  router.post('/v2/auth/register-user', async (req: express.Request, res: express.Response) => {
    try {
      if (!checkConfigured()) {
        return res.status(503).json({
          success: false,
          error:
            'Supabase server credentials are missing. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
        });
      }

      const body = req.body || {};
      if (hasForbiddenPrivilegeInjection(body)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid role or privilege fields in registration request.',
        });
      }

      const fullName = String(body.fullName || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');

      if (fullName.length < 2) {
        return res.status(400).json({ success: false, error: 'Full name is required.' });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, error: 'Valid email address is required.' });
      }
      if (password.length < 8) {
        return res.status(400).json({
          success: false,
          error: 'Password must be at least 8 characters.',
        });
      }

      const result = await service.registerInvitedUser({
        email,
        password,
        fullName,
        redirectTo: sanitizeHttpUrl(body.redirectTo) || undefined,
      });
      return res.status(result.accountAlreadyConfirmed ? 200 : 201).json({ success: true, ...result });
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        error: String(err?.message || 'User registration failed.'),
      });
    }
  });

  // Accept pending invitations for the authenticated, email-verified user
  router.post(
    '/v2/tenant/invitations/accept',
    requireUserSession,
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        const session = req.userSession!;
        if (!service.acceptPendingInvitations) {
          return res.json({
            success: true,
            activatedMembershipsCount: 0,
            memberships: session.memberships,
          });
        }
        const result = await service.acceptPendingInvitations(session.userId, session.email);
        return res.json({ success: true, ...result });
      } catch (err: any) {
        return res.status(400).json({
          success: false,
          error: String(err?.message || 'Could not accept pending invitations.'),
        });
      }
    }
  );

  // Authenticated session bootstrap
  router.get(
    '/v2/tenant/me',
    requireUserSession,
    async (req: AuthenticatedRequest, res: express.Response) => {
      const session = req.userSession!;
      const requestedId = typeof req.headers['x-company-id'] === 'string'
        ? req.headers['x-company-id'].trim()
        : '';
      let activeMembership = session.memberships[0];
      if (requestedId) {
        const matched = session.memberships.find(m => m.companyId === requestedId);
        if (!matched) {
          return res.status(403).json({
            success: false,
            error: 'Forbidden: requested company workspace is not accessible.',
          });
        }
        activeMembership = matched;
      }

      return res.json({
        success: true,
        profile: session.profile,
        memberships: session.memberships,
        activeCompany: activeMembership?.company || null,
        activeRole: activeMembership?.role || null,
        activeGovernanceRoles: activeMembership?.governanceRoles || [],
      });
    }
  );

  // Company Branding & Settings (company_admin only)
  router.patch(
    '/v2/tenant/company',
    requireTenantAuth,
    requireCompanyRole(['company_admin']),
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        const { companyName, logoUrl, primaryColour, secondaryColour } = req.body || {};
        if (companyName !== undefined && String(companyName).trim().length < 2) {
          return res.status(400).json({
            success: false,
            error: 'Company name must be at least 2 characters.',
          });
        }
        if (primaryColour !== undefined && !isValidHexColour(primaryColour)) {
          return res.status(400).json({
            success: false,
            error: 'Primary colour must be a 6-digit hex code (e.g. #052B66).',
          });
        }
        if (secondaryColour !== undefined && !isValidHexColour(secondaryColour)) {
          return res.status(400).json({
            success: false,
            error: 'Secondary colour must be a 6-digit hex code (e.g. #45CC42).',
          });
        }
        let sanitizedLogo: string | null | undefined = undefined;
        if (logoUrl !== undefined) {
          if (logoUrl === null || logoUrl === '') {
            sanitizedLogo = null;
          } else {
            const safe = sanitizeHttpUrl(logoUrl);
            if (!safe) {
              return res.status(400).json({
                success: false,
                error: 'Logo URL must be a valid http://, https://, or /assets/ path.',
              });
            }
            sanitizedLogo = safe;
          }
        }

        const company = await service.updateCompany(
          req.tenantAuth!.companyId,
          req.tenantAuth!.userId,
          {
            companyName: companyName !== undefined ? String(companyName) : undefined,
            logoUrl: sanitizedLogo,
            primaryColour,
            secondaryColour,
          }
        );
        return res.json({ success: true, company });
      } catch (err: any) {
        return res.status(400).json({
          success: false,
          error: String(err?.message || 'Failed to update company settings.'),
        });
      }
    }
  );

  // Company Logo Upload & Replacement (company_admin only; strict magic-byte & 2 MB validation)
  router.post(
    '/v2/tenant/company/logo',
    requireTenantAuth,
    requireCompanyRole(['company_admin']),
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        const parsedLogo = parseAndValidateLogoUpload(req.body || {});
        if (parsedLogo.ok === false) {
          return res.status(parsedLogo.statusCode).json({
            success: false,
            error: parsedLogo.error,
          });
        }

        const result = await service.uploadCompanyLogo({
          companyId: req.tenantAuth!.companyId,
          userId: req.tenantAuth!.userId,
          fileName: parsedLogo.logo.fileName,
          mimeType: parsedLogo.logo.mimeType,
          ext: parsedLogo.logo.ext,
          buffer: parsedLogo.logo.buffer,
        });

        return res.status(201).json({
          success: true,
          company: result.company,
          logoUrl: result.logoUrl,
          storagePath: result.storagePath,
        });
      } catch (err: any) {
        return res.status(400).json({
          success: false,
          error: String(err?.message || 'Failed to upload company logo.'),
        });
      }
    }
  );

  // Company Logo Removal (company_admin only)
  router.delete(
    '/v2/tenant/company/logo',
    requireTenantAuth,
    requireCompanyRole(['company_admin']),
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        const company = await service.removeCompanyLogo(
          req.tenantAuth!.companyId,
          req.tenantAuth!.userId
        );
        return res.json({ success: true, company });
      } catch (err: any) {
        return res.status(400).json({
          success: false,
          error: String(err?.message || 'Failed to remove company logo.'),
        });
      }
    }
  );

  // Company Team Members
  router.get(
    '/v2/tenant/members',
    requireTenantAuth,
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        const members = await service.listMembers(req.tenantAuth!.companyId);
        return res.json({ success: true, members });
      } catch (err: any) {
        return res.status(500).json({
          success: false,
          error: String(err?.message || 'Could not load team members.'),
        });
      }
    }
  );

  router.post(
    '/v2/tenant/members/invite',
    requireTenantAuth,
    requireCompanyRole(['company_admin']),
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        const { email, fullName, role, governanceRoles, temporaryPassword, redirectTo } =
          req.body || {};
        if (hasForbiddenPrivilegeInjection(req.body || {})) {
          return res.status(400).json({ success: false, error: 'Invalid role parameter.' });
        }
        const normalizedEmail = String(email || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
          return res.status(400).json({ success: false, error: 'Valid email is required.' });
        }
        if (!VALID_ROLES.includes(role)) {
          return res.status(400).json({
            success: false,
            error: `Role must be one of: ${VALID_ROLES.join(', ')}.`,
          });
        }
        if (governanceRoles !== undefined && !Array.isArray(governanceRoles)) {
          return res.status(400).json({
            success: false,
            error: 'governanceRoles must be an array of valid governance roles.',
          });
        }
        if (Array.isArray(governanceRoles)) {
          const invalidGov = governanceRoles.find(r => !normalizeGovernanceRole(r));
          if (invalidGov !== undefined) {
            return res.status(400).json({
              success: false,
              error: `Invalid governance role. Allowed values: ${VALID_GOVERNANCE_ROLES.join(', ')}.`,
            });
          }
        }
        const member = await service.inviteMember({
          companyId: req.tenantAuth!.companyId,
          invitedByUserId: req.tenantAuth!.userId,
          email: normalizedEmail,
          fullName: String(fullName || normalizedEmail.split('@')[0]),
          role,
          governanceRoles: normalizeGovernanceRoles(governanceRoles),
          temporaryPassword: temporaryPassword ? String(temporaryPassword) : undefined,
          redirectTo: sanitizeHttpUrl(redirectTo) || undefined,
        });
        return res.status(201).json({ success: true, member });
      } catch (err: any) {
        return res.status(400).json({
          success: false,
          error: String(err?.message || 'Failed to invite team member.'),
        });
      }
    }
  );

  router.patch(
    '/v2/tenant/members/:memberId',
    requireTenantAuth,
    requireCompanyRole(['company_admin']),
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        const { role, governanceRoles, membershipStatus } = req.body || {};
        if (role !== undefined && !VALID_ROLES.includes(role)) {
          return res.status(400).json({ success: false, error: 'Invalid company role.' });
        }
        if (governanceRoles !== undefined && !Array.isArray(governanceRoles)) {
          return res.status(400).json({
            success: false,
            error: 'governanceRoles must be an array.',
          });
        }
        if (Array.isArray(governanceRoles)) {
          const invalidGov = governanceRoles.find(r => !normalizeGovernanceRole(r));
          if (invalidGov !== undefined) {
            return res.status(400).json({
              success: false,
              error: `Invalid governance role. Allowed values: ${VALID_GOVERNANCE_ROLES.join(', ')}.`,
            });
          }
        }
        if (
          membershipStatus !== undefined &&
          !['active', 'invited', 'suspended'].includes(membershipStatus)
        ) {
          return res.status(400).json({ success: false, error: 'Invalid membership status.' });
        }
        const member = await service.updateMember({
          companyId: req.tenantAuth!.companyId,
          memberId: req.params.memberId,
          actorUserId: req.tenantAuth!.userId,
          role,
          governanceRoles:
            governanceRoles !== undefined ? normalizeGovernanceRoles(governanceRoles) : undefined,
          membershipStatus,
        });
        return res.json({ success: true, member });
      } catch (err: any) {
        return res.status(400).json({
          success: false,
          error: String(err?.message || 'Failed to update member.'),
        });
      }
    }
  );

  // Courses CRUD (Tenant Isolated)
  router.get(
    '/v2/courses',
    requireTenantAuth,
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        const courses = await service.listCourses(req.tenantAuth!.companyId);
        return res.json({ success: true, courses });
      } catch (err: any) {
        return res.status(500).json({
          success: false,
          error: String(err?.message || 'Failed to fetch company courses.'),
        });
      }
    }
  );

  router.post(
    '/v2/courses',
    requireTenantAuth,
    requireCompanyRole(['company_admin', 'author']),
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        const project = req.body?.project as CourseProject | undefined;
        if (!project || typeof project !== 'object') {
          return res.status(400).json({ success: false, error: 'Missing course project payload.' });
        }
        const govCheck = validateCourseGovernanceMutation({
          actorRole: req.tenantAuth!.role,
          actorGovernanceRoles: req.tenantAuth!.governanceRoles,
          incomingProject: project,
          existingProject: null,
        });
        if (govCheck.ok === false) {
          return res.status(govCheck.status).json({ success: false, error: govCheck.error });
        }
        const saved = await service.saveCourse(
          req.tenantAuth!.companyId,
          req.tenantAuth!.userId,
          project
        );
        return res.status(201).json({ success: true, course: saved.project });
      } catch (err: any) {
        return res.status(400).json({
          success: false,
          error: String(err?.message || 'Failed to save course.'),
        });
      }
    }
  );

  router.put(
    '/v2/courses/:courseId',
    requireTenantAuth,
    requireCompanyRole(['company_admin', 'author', 'reviewer']),
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        const project = req.body?.project as CourseProject | undefined;
        const expectedUpdatedAt =
          typeof req.body?.expectedUpdatedAt === 'string' && req.body.expectedUpdatedAt.trim()
            ? req.body.expectedUpdatedAt.trim()
            : undefined;
        if (!project || typeof project !== 'object') {
          return res.status(400).json({ success: false, error: 'Missing course project payload.' });
        }
        const existingProject = service.getCourse
          ? await service.getCourse(req.tenantAuth!.companyId, req.params.courseId)
          : null;
        if (existingProject && expectedUpdatedAt) {
          const expectedMs = Date.parse(expectedUpdatedAt);
          const existingMs = Date.parse(String(existingProject.updatedAt || ''));
          const mismatch =
            Number.isFinite(expectedMs) && Number.isFinite(existingMs)
              ? Math.abs(expectedMs - existingMs) > 0
              : String(existingProject.updatedAt || '') !== expectedUpdatedAt;
          if (mismatch) {
            return res.status(409).json({
              success: false,
              code: 'VERSION_CONFLICT',
              error:
                'This course was updated in another session or tab. Review the latest cloud version before overwriting.',
              serverCourse: existingProject,
            });
          }
        }
        const govCheck = validateCourseGovernanceMutation({
          actorRole: req.tenantAuth!.role,
          actorGovernanceRoles: req.tenantAuth!.governanceRoles,
          incomingProject: project,
          existingProject,
        });
        if (govCheck.ok === false) {
          return res.status(govCheck.status).json({ success: false, error: govCheck.error });
        }
        const result = await service.saveCourse(
          req.tenantAuth!.companyId,
          req.tenantAuth!.userId,
          project,
          req.params.courseId,
          expectedUpdatedAt ? { expectedUpdatedAt } : undefined
        );
        if (result.notFound) {
          return res.status(404).json({
            success: false,
            error: 'Course not found within your active company workspace.',
          });
        }
        if (result.conflict) {
          return res.status(409).json({
            success: false,
            code: 'VERSION_CONFLICT',
            error:
              'This course was updated in another session or tab. Review the latest cloud version before overwriting.',
            serverCourse: result.project,
          });
        }
        return res.json({ success: true, course: result.project });
      } catch (err: any) {
        return res.status(400).json({
          success: false,
          error: String(err?.message || 'Failed to update course.'),
        });
      }
    }
  );

  // Authenticated Identity-Based Governance Approval Endpoints
  router.get(
    '/v2/courses/:courseId/governance',
    requireTenantAuth,
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        if (!service.getCourseGovernance) {
          return res.status(501).json({ success: false, error: 'Governance service unavailable.' });
        }
        const [govState, members] = await Promise.all([
          service.getCourseGovernance(req.tenantAuth!.companyId, req.params.courseId),
          service.listMembers(req.tenantAuth!.companyId),
        ]);
        if (govState.notFound) {
          return res.status(404).json({
            success: false,
            error: 'Course not found within your active company workspace.',
          });
        }
        const eligibleReviewers = members
          .filter(
            m =>
              m.membershipStatus === 'active' &&
              (m.role === 'reviewer' || m.role === 'company_admin') &&
              (m.governanceRoles?.length || 0) > 0
          )
          .map(m => ({
            userId: m.userId,
            fullName: m.profile?.fullName || m.profile?.email || m.userId,
            email: m.profile?.email || '',
            role: m.role,
            governanceRoles: m.governanceRoles || [],
          }));

        return res.json({
          success: true,
          courseId: govState.courseId,
          lifecycleStatus: govState.lifecycleStatus,
          approvals: govState.approvals,
          humanSignOff: govState.humanSignOff,
          eligibleReviewers,
        });
      } catch (err: any) {
        return res.status(500).json({
          success: false,
          error: String(err?.message || 'Failed to fetch governance approval state.'),
        });
      }
    }
  );

  router.post(
    '/v2/courses/:courseId/governance/approve',
    requireTenantAuth,
    requireCompanyRole(['company_admin', 'reviewer']),
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        if (!service.submitCourseGovernanceDecision) {
          return res.status(501).json({ success: false, error: 'Governance service unavailable.' });
        }
        const body = req.body || {};
        // Reject explicit forged identity fields if caller attempts to impersonate another user
        if (
          (body.reviewerUserId && String(body.reviewerUserId) !== req.tenantAuth!.userId) ||
          (body.reviewerId && String(body.reviewerId) !== req.tenantAuth!.userId)
        ) {
          return res.status(403).json({
            success: false,
            error: 'Forbidden: reviewer identity is derived from your verified session and cannot be forged.',
          });
        }
        const normalizedGovRole = normalizeGovernanceRole(body.governanceRole || body.roleKey);
        if (!normalizedGovRole) {
          return res.status(400).json({
            success: false,
            error: `Invalid governanceRole. Must be one of: ${VALID_GOVERNANCE_ROLES.join(', ')}.`,
          });
        }
        const decision = body.decision === 'rejected' ? 'rejected' : 'approved';
        const result = await service.submitCourseGovernanceDecision({
          companyId: req.tenantAuth!.companyId,
          courseIdParam: req.params.courseId,
          actorUserId: req.tenantAuth!.userId,
          actorName: req.tenantAuth!.fullName || req.tenantAuth!.email,
          actorRole: req.tenantAuth!.role,
          actorGovernanceRoles: req.tenantAuth!.governanceRoles,
          governanceRole: normalizedGovRole,
          decision,
          notes: typeof body.notes === 'string' ? body.notes : undefined,
        });
        if (result.ok === false) {
          return res.status(result.status).json({ success: false, error: result.error });
        }
        return res.status(200).json({
          success: true,
          course: result.course,
          approval: result.approval,
          approvals: result.approvals,
        });
      } catch (err: any) {
        return res.status(400).json({
          success: false,
          error: String(err?.message || 'Governance decision failed.'),
        });
      }
    }
  );

  router.post(
    '/v2/courses/:courseId/governance/revoke',
    requireTenantAuth,
    requireCompanyRole(['company_admin', 'reviewer']),
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        if (!service.revokeCourseGovernanceDecision) {
          return res.status(501).json({ success: false, error: 'Governance service unavailable.' });
        }
        const normalizedGovRole = normalizeGovernanceRole(req.body?.governanceRole || req.body?.roleKey);
        if (!normalizedGovRole) {
          return res.status(400).json({
            success: false,
            error: `Invalid governanceRole. Must be one of: ${VALID_GOVERNANCE_ROLES.join(', ')}.`,
          });
        }
        const result = await service.revokeCourseGovernanceDecision({
          companyId: req.tenantAuth!.companyId,
          courseIdParam: req.params.courseId,
          actorUserId: req.tenantAuth!.userId,
          actorRole: req.tenantAuth!.role,
          governanceRole: normalizedGovRole,
        });
        if (result.ok === false) {
          return res.status(result.status).json({ success: false, error: result.error });
        }
        return res.json({
          success: true,
          course: result.course,
          approvals: result.approvals,
        });
      } catch (err: any) {
        return res.status(400).json({
          success: false,
          error: String(err?.message || 'Failed to revoke governance approval.'),
        });
      }
    }
  );

  router.post(
    '/v2/courses/:courseId/complete',
    requireTenantAuth,
    requireCompanyRole(['company_admin', 'reviewer']),
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        if (!service.completeCourseRelease) {
          return res.status(501).json({ success: false, error: 'Release service unavailable.' });
        }
        const result = await service.completeCourseRelease({
          companyId: req.tenantAuth!.companyId,
          courseIdParam: req.params.courseId,
          actorUserId: req.tenantAuth!.userId,
          actorName: req.tenantAuth!.fullName || req.tenantAuth!.email,
          actorRole: req.tenantAuth!.role,
          actorGovernanceRoles: req.tenantAuth!.governanceRoles,
        });
        if (result.ok === false) {
          return res.status(result.status).json({ success: false, error: result.error });
        }
        return res.json({ success: true, course: result.course });
      } catch (err: any) {
        return res.status(400).json({
          success: false,
          error: String(err?.message || 'Failed to complete course.'),
        });
      }
    }
  );

  router.delete(
    '/v2/courses/:courseId',
    requireTenantAuth,
    requireCompanyRole(['company_admin', 'author']),
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        const deleted = await service.deleteCourse(req.tenantAuth!.companyId, req.params.courseId);
        if (!deleted) {
          return res.status(404).json({
            success: false,
            error: 'Course not found within your active company workspace.',
          });
        }
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(400).json({
          success: false,
          error: String(err?.message || 'Failed to delete course.'),
        });
      }
    }
  );

  router.get(
    '/v2/courses/:courseId/versions',
    requireTenantAuth,
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        const versions = await service.listCourseVersions(
          req.tenantAuth!.companyId,
          req.params.courseId
        );
        return res.json({ success: true, versions });
      } catch (err: any) {
        return res.status(500).json({
          success: false,
          error: String(err?.message || 'Failed to fetch course version history.'),
        });
      }
    }
  );

  router.post(
    '/v2/courses/:courseId/versions',
    requireTenantAuth,
    requireCompanyRole(['company_admin', 'author', 'reviewer']),
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        const snapshot = req.body?.snapshot as CourseVersionSnapshot | undefined;
        if (!snapshot || typeof snapshot !== 'object') {
          return res.status(400).json({ success: false, error: 'Missing version snapshot.' });
        }
        const result = await service.addCourseVersion(
          req.tenantAuth!.companyId,
          req.tenantAuth!.userId,
          req.params.courseId,
          snapshot
        );
        if (result.notFound) {
          return res.status(404).json({
            success: false,
            error: 'Course not found within your active company workspace.',
          });
        }
        return res.status(201).json({ success: true, version: result.version });
      } catch (err: any) {
        return res.status(400).json({
          success: false,
          error: String(err?.message || 'Failed to record version snapshot.'),
        });
      }
    }
  );

  // Idempotent, non-destructive Local-to-Cloud Migration
  router.post(
    '/v2/courses/migrate-local',
    requireTenantAuth,
    requireCompanyRole(['company_admin', 'author']),
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        const projects = Array.isArray(req.body?.projects) ? req.body.projects : [];
        const customTemplates = Array.isArray(req.body?.customTemplates)
          ? req.body.customTemplates
          : [];
        const summary = await service.migrateLocalWorkspace({
          companyId: req.tenantAuth!.companyId,
          userId: req.tenantAuth!.userId,
          projects,
          customTemplates,
        });
        return res.json({ success: true, ...summary });
      } catch (err: any) {
        return res.status(400).json({
          success: false,
          error: String(err?.message || 'Local workspace migration failed.'),
        });
      }
    }
  );

  // Templates (System templates read-only; company templates isolated)
  router.get(
    '/v2/templates',
    requireTenantAuth,
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        const templates = await service.listTemplates(req.tenantAuth!.companyId);
        return res.json({ success: true, templates });
      } catch (err: any) {
        return res.status(500).json({
          success: false,
          error: String(err?.message || 'Failed to load templates.'),
        });
      }
    }
  );

  router.post(
    '/v2/templates',
    requireTenantAuth,
    requireCompanyRole(['company_admin', 'author']),
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        const tpl = req.body?.template as CourseTemplate | undefined;
        if (!tpl || typeof tpl !== 'object') {
          return res.status(400).json({ success: false, error: 'Missing template payload.' });
        }
        const result = await service.saveTemplate(
          req.tenantAuth!.companyId,
          req.tenantAuth!.userId,
          tpl
        );
        if (result.forbiddenSystem) {
          return res.status(403).json({
            success: false,
            error: 'System templates are read-only. Duplicate as a company template instead.',
          });
        }
        return res.status(201).json({ success: true, template: result.template });
      } catch (err: any) {
        return res.status(400).json({
          success: false,
          error: String(err?.message || 'Failed to save template.'),
        });
      }
    }
  );

  router.put(
    '/v2/templates/:templateId',
    requireTenantAuth,
    requireCompanyRole(['company_admin', 'author']),
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        const tpl = req.body?.template as CourseTemplate | undefined;
        if (!tpl || typeof tpl !== 'object') {
          return res.status(400).json({ success: false, error: 'Missing template payload.' });
        }
        const result = await service.saveTemplate(
          req.tenantAuth!.companyId,
          req.tenantAuth!.userId,
          tpl,
          req.params.templateId
        );
        if (result.forbiddenSystem) {
          return res.status(403).json({
            success: false,
            error: 'System templates cannot be modified.',
          });
        }
        if (result.notFound) {
          return res.status(404).json({
            success: false,
            error: 'Template not found in your company workspace.',
          });
        }
        return res.json({ success: true, template: result.template });
      } catch (err: any) {
        return res.status(400).json({
          success: false,
          error: String(err?.message || 'Failed to update template.'),
        });
      }
    }
  );

  router.delete(
    '/v2/templates/:templateId',
    requireTenantAuth,
    requireCompanyRole(['company_admin', 'author']),
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        const result = await service.deleteTemplate(
          req.tenantAuth!.companyId,
          req.params.templateId
        );
        if (result.forbiddenSystem) {
          return res.status(403).json({
            success: false,
            error: 'System templates cannot be deleted.',
          });
        }
        if (!result.deleted) {
          return res.status(404).json({
            success: false,
            error: 'Template not found in your company workspace.',
          });
        }
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(400).json({
          success: false,
          error: String(err?.message || 'Failed to delete template.'),
        });
      }
    }
  );

  // Private Supabase Storage Upload & Short-Lived Signed URL Retrieval (Author + Company Admin only; Reviewer is view-only)
  router.post(
    '/v2/sources/upload',
    requireTenantAuth,
    requireCompanyRole(['company_admin', 'author']),
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        const { fileName, mimeType, base64Data, rawText, courseId, extractedText, metadata } =
          req.body || {};
        if (!fileName || (!base64Data && !rawText)) {
          return res.status(400).json({
            success: false,
            error: 'Missing fileName or file content for private storage upload.',
          });
        }

        const resolvedMime = String(mimeType || 'text/plain');
        if (mimeType && !ALLOWED_UPLOAD_MIME_TYPES.has(resolvedMime)) {
          return res.status(400).json({
            success: false,
            error: 'Unsupported file MIME type for source storage.',
          });
        }

        const buffer = base64Data
          ? Buffer.from(String(base64Data).replace(/\s+/g, ''), 'base64')
          : Buffer.from(String(rawText || ''), 'utf8');

        if (buffer.byteLength > 4_800_000) {
          return res.status(413).json({
            success: false,
            error: 'Source document exceeds 4.8 MB limit.',
          });
        }

        const stored = await service.uploadSourceFile({
          companyId: req.tenantAuth!.companyId,
          userId: req.tenantAuth!.userId,
          courseId: courseId ? String(courseId) : undefined,
          fileName: String(fileName),
          mimeType: resolvedMime,
          buffer,
          extractedText: String(extractedText || rawText || ''),
          metadata: metadata && typeof metadata === 'object' ? metadata : {},
        });

        return res.status(201).json({ success: true, ...stored });
      } catch (err: any) {
        return res.status(400).json({
          success: false,
          error: String(err?.message || 'Source file upload failed.'),
        });
      }
    }
  );

  router.get(
    '/v2/sources/:sourceId/signed-url',
    requireTenantAuth,
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        const result = await service.getSourceSignedUrl(
          req.tenantAuth!.companyId,
          req.params.sourceId
        );
        if (result.notFound || !result.signedUrl) {
          return res.status(404).json({
            success: false,
            error: 'Source file not found in your company workspace.',
          });
        }
        return res.json({
          success: true,
          signedUrl: result.signedUrl,
          fileName: result.fileName,
          expiresInSeconds: 120,
        });
      } catch (err: any) {
        return res.status(400).json({
          success: false,
          error: String(err?.message || 'Failed to generate signed download URL.'),
        });
      }
    }
  );

  router.delete(
    '/v2/sources/:sourceId',
    requireTenantAuth,
    requireCompanyRole(['company_admin', 'author']),
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        const deleted = await service.deleteSourceDocument(
          req.tenantAuth!.companyId,
          req.params.sourceId
        );
        if (!deleted) {
          return res.status(404).json({
            success: false,
            error: 'Source document not found in your company workspace.',
          });
        }
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(400).json({
          success: false,
          error: String(err?.message || 'Failed to delete source document.'),
        });
      }
    }
  );

  // AI Usage Summary (Company Scoped)
  router.get(
    '/v2/usage',
    requireTenantAuth,
    async (req: AuthenticatedRequest, res: express.Response) => {
      try {
        const summary = await service.getAiUsageSummary(req.tenantAuth!.companyId);
        return res.json({ success: true, summary });
      } catch (err: any) {
        return res.status(500).json({
          success: false,
          error: String(err?.message || 'Failed to load AI usage metrics.'),
        });
      }
    }
  );
}
