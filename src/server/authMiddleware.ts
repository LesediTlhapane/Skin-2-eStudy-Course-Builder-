import type express from 'express';
import type {
  CompanyMembership,
  CompanyRole,
  CompanyWorkspace,
  UserProfile,
} from '../types.js';
import {
  getSupabaseAdminClient,
  isSupabaseServerConfigured,
  isValidUuid,
} from './supabaseAdmin.js';

export interface VerifiedTenantContext {
  userId: string;
  email: string;
  fullName: string;
  companyId: string;
  role: CompanyRole;
  company: CompanyWorkspace;
  memberships: CompanyMembership[];
}

export interface VerifiedUserSession {
  userId: string;
  email: string;
  emailVerified?: boolean;
  profile: UserProfile;
  memberships: CompanyMembership[];
}

export interface TenantAuthVerifier {
  verifyAccessToken(token: string): Promise<VerifiedUserSession | null>;
}

export interface AuthenticatedRequest extends express.Request {
  tenantAuth?: VerifiedTenantContext;
  userSession?: VerifiedUserSession;
}

function mapCompanyRow(row: any): CompanyWorkspace {
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

class SupabaseTenantVerifier implements TenantAuthVerifier {
  async verifyAccessToken(token: string): Promise<VerifiedUserSession | null> {
    if (!isSupabaseServerConfigured()) {
      throw new Error('SUPABASE_NOT_CONFIGURED');
    }
    const admin = getSupabaseAdminClient();
    const { data: userResult, error: userError } = await admin.auth.getUser(token);
    if (userError || !userResult?.user) {
      return null;
    }

    const authUser = userResult.user;
    const email = String(authUser.email || '').trim().toLowerCase();
    const emailVerified = Boolean(authUser.email_confirmed_at);
    const metaName = String((authUser.user_metadata as any)?.full_name || '').trim();

    if (!emailVerified) {
      return {
        userId: authUser.id,
        email,
        emailVerified: false,
        profile: {
          id: authUser.id,
          fullName: metaName,
          email,
        },
        memberships: [],
      };
    }

    // Ensure profile row exists
    const { data: profileRow } = await admin
      .from('user_profiles')
      .select('id, full_name, email, created_at, updated_at')
      .eq('id', authUser.id)
      .maybeSingle();

    let profile: UserProfile;
    if (!profileRow) {
      await admin.from('user_profiles').upsert({
        id: authUser.id,
        email,
        full_name: metaName,
      });
      profile = {
        id: authUser.id,
        fullName: metaName,
        email,
      };
    } else {
      profile = {
        id: String(profileRow.id),
        fullName: String(profileRow.full_name || metaName),
        email: String(profileRow.email || email),
        createdAt: profileRow.created_at,
        updatedAt: profileRow.updated_at,
      };
    }

    // Activate any invited memberships waiting for this verified email
    if (email) {
      await admin
        .from('company_memberships')
        .update({ membership_status: 'active' })
        .eq('user_id', authUser.id)
        .eq('membership_status', 'invited');
    }

    const { data: membershipRows, error: memError } = await admin
      .from('company_memberships')
      .select(
        'id, company_id, user_id, role, membership_status, created_at, companies ( id, company_name, company_slug, logo_url, primary_colour, secondary_colour, subscription_status, created_at, updated_at )'
      )
      .eq('user_id', authUser.id)
      .eq('membership_status', 'active')
      .order('created_at', { ascending: true });

    if (memError) {
      throw new Error(`Membership verification failed: ${memError.message}`);
    }

    const memberships: CompanyMembership[] = (membershipRows || []).map((row: any) => ({
      id: String(row.id),
      companyId: String(row.company_id),
      userId: String(row.user_id),
      role: row.role as CompanyRole,
      membershipStatus: row.membership_status,
      createdAt: String(row.created_at),
      company: row.companies ? mapCompanyRow(row.companies) : undefined,
    }));

    return {
      userId: authUser.id,
      email: profile.email,
      emailVerified: true,
      profile,
      memberships,
    };
  }
}

export const defaultTenantAuthVerifier = new SupabaseTenantVerifier();

export function extractBearerToken(req: express.Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function resolveRequestedCompanyId(req: express.Request): string | null {
  const headerVal = req.headers['x-company-id'];
  const raw = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  return null;
}

/**
 * Verifies the user's Supabase JWT ONLY (does not require an active company yet).
 * Used for `/api/v2/tenant/me` and onboarding when creating a company workspace.
 */
export function createUserSessionMiddleware(verifier: TenantAuthVerifier = defaultTenantAuthVerifier) {
  return async (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
    try {
      const token = extractBearerToken(req);
      if (!token) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required. Sign in to continue.',
        });
      }
      const session = await verifier.verifyAccessToken(token);
      if (!session) {
        return res.status(401).json({
          success: false,
          error: 'Invalid or expired authentication session. Please sign in again.',
        });
      }
      if (session.emailVerified === false) {
        return res.status(403).json({
          success: false,
          code: 'EMAIL_NOT_VERIFIED',
          error: 'Please verify your email address before accessing your account or workspace.',
        });
      }
      req.userSession = session;
      return next();
    } catch (err: any) {
      if (String(err?.message || '').includes('SUPABASE_NOT_CONFIGURED')) {
        return res.status(503).json({
          success: false,
          error:
            'Multi-tenant Supabase authentication is not configured on this server (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).',
        });
      }
      return res.status(401).json({
        success: false,
        error: 'Unable to verify authentication session.',
      });
    }
  };
}

/**
 * Strictly validates BOTH a verified Supabase JWT AND an active company membership.
 * Never trusts client-supplied company_id without checking membership in database.
 */
export function createTenantAuthMiddleware(verifier: TenantAuthVerifier = defaultTenantAuthVerifier) {
  return async (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
    try {
      const token = extractBearerToken(req);
      if (!token) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required. Provide a valid Bearer session token.',
        });
      }

      const session = await verifier.verifyAccessToken(token);
      if (!session) {
        return res.status(401).json({
          success: false,
          error: 'Invalid or expired authentication session.',
        });
      }
      if (session.emailVerified === false) {
        return res.status(403).json({
          success: false,
          code: 'EMAIL_NOT_VERIFIED',
          error: 'Please verify your email address before accessing protected workspace endpoints.',
        });
      }

      req.userSession = session;
      const requestedCompanyId = resolveRequestedCompanyId(req);

      if (session.memberships.length === 0) {
        return res.status(403).json({
          success: false,
          error: 'No active company membership found for your account.',
        });
      }

      let activeMembership: CompanyMembership | undefined;
      if (requestedCompanyId) {
        if (!isValidUuid(requestedCompanyId)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid X-Company-Id header format.',
          });
        }
        activeMembership = session.memberships.find(m => m.companyId === requestedCompanyId);
        if (!activeMembership) {
          return res.status(403).json({
            success: false,
            error: 'Forbidden: you do not hold an active membership for the requested company workspace.',
          });
        }
      } else if (session.memberships.length === 1) {
        activeMembership = session.memberships[0];
      } else {
        return res.status(400).json({
          success: false,
          error: 'Multiple company workspaces found. Select an active company (X-Company-Id required).',
        });
      }

      // Also guard against body.companyId or query.companyId tampering if caller sends conflicting ID
      const bodyCompanyId =
        typeof req.body?.companyId === 'string' && req.body.companyId.trim()
          ? req.body.companyId.trim()
          : null;
      if (bodyCompanyId && bodyCompanyId !== activeMembership.companyId) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: payload companyId does not match verified active company workspace.',
        });
      }

      const fallbackCompany: CompanyWorkspace = activeMembership.company || {
        id: activeMembership.companyId,
        companyName: 'Company Workspace',
        companySlug: 'workspace',
        logoUrl: null,
        primaryColour: '#052B66',
        secondaryColour: '#45CC42',
        subscriptionStatus: 'trialing',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      req.tenantAuth = {
        userId: session.userId,
        email: session.email,
        fullName: session.profile.fullName || session.email,
        companyId: activeMembership.companyId,
        role: activeMembership.role,
        company: fallbackCompany,
        memberships: session.memberships,
      };

      return next();
    } catch (err: any) {
      if (String(err?.message || '').includes('SUPABASE_NOT_CONFIGURED')) {
        return res.status(503).json({
          success: false,
          error:
            'Multi-tenant Supabase authentication is not configured on this server (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).',
        });
      }
      return res.status(401).json({
        success: false,
        error: 'Authentication verification failed.',
      });
    }
  };
}

export function requireCompanyRole(allowedRoles: CompanyRole[]) {
  return (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
    if (!req.tenantAuth) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }
    if (!allowedRoles.includes(req.tenantAuth.role)) {
      return res.status(403).json({
        success: false,
        error: `Forbidden: requires one of roles [${allowedRoles.join(', ')}].`,
      });
    }
    return next();
  };
}
