import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRateLimitKey,
  createApiRouter,
  MemoryRateLimitStore,
  resolveDefaultRateLimitStore,
  SupabaseRateLimitStore,
  validateRateLimitConfiguration,
} from '../src/server/apiRouter.js';
import { COMPANY_A_ID, COMPANY_B_ID, createInMemoryTenantEnv } from './helpers/testFixtures.js';

function createTestApp(rateLimitMaxPerMin = 60) {
  const env = createInMemoryTenantEnv();
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use(
    '/api',
    createApiRouter({
      rateLimitMaxPerMin,
      rateLimitStore: new MemoryRateLimitStore(),
      tenantDeps: {
        authVerifier: env.authVerifier,
        service: env.service,
        isConfiguredFn: () => true,
      },
    })
  );
  return { app, env };
}

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

describe('Priority 1 — Authentication, Invitations & Email Verification', () => {
  it('completes admin invite -> user password setup -> workspace access without duplicate user errors', async () => {
    const { app, env } = createTestApp();

    // 1. Admin invites a new user
    const inviteRes = await request(app)
      .post('/api/v2/tenant/members/invite')
      .set('Authorization', 'Bearer token-admin-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        email: 'new.designer@acme.test',
        fullName: 'New Designer',
        role: 'author',
      });

    expect(inviteRes.status).toBe(201);
    expect(inviteRes.body.success).toBe(true);
    expect(inviteRes.body.member.membershipStatus).toBe('invited');
    expect(inviteRes.body.member.role).toBe('author');

    // 2. Inviting an already-existing confirmed user cleanly attaches/returns membership without duplicate crash
    const reInviteExistingRes = await request(app)
      .post('/api/v2/tenant/members/invite')
      .set('Authorization', 'Bearer token-admin-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        email: 'author@acme.test',
        fullName: 'Acme Author',
        role: 'reviewer',
      });
    expect(reInviteExistingRes.status).toBe(201);
    expect(reInviteExistingRes.body.success).toBe(true);

    // 3. Invited user registers and establishes their password (must handle pre-created Auth account)
    const regRes = await request(app)
      .post('/api/v2/auth/register-user')
      .send({
        email: 'new.designer@acme.test',
        fullName: 'New Designer',
        password: 'StrongPassword#2026',
      });

    expect(regRes.status).toBe(201);
    expect(regRes.body.success).toBe(true);
    expect(regRes.body.activatedMembershipsCount).toBe(1);

    // 4. Re-submitting register-user for an already confirmed user returns 200 (no duplicate-user crash)
    const duplicateRegRes = await request(app)
      .post('/api/v2/auth/register-user')
      .send({
        email: 'new.designer@acme.test',
        fullName: 'New Designer',
        password: 'StrongPassword#2026',
      });
    expect(duplicateRegRes.status).toBe(200);
    expect(duplicateRegRes.body.accountAlreadyConfirmed).toBe(true);

    // 5. Verified invited user accesses company workspace cleanly
    const userToken = Array.from(env.tokens.entries()).find(
      ([k]) => k === 'token-new.designer@acme.test'
    )?.[0];
    expect(userToken).toBeTruthy();

    const meRes = await request(app)
      .get('/api/v2/tenant/me')
      .set('Authorization', `Bearer ${userToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.activeCompany.id).toBe(COMPANY_A_ID);
    expect(meRes.body.activeRole).toBe('author');
  });

  it('blocks unverified public accounts with HTTP 403 on protected tenant endpoints', async () => {
    const { app, env } = createTestApp();

    // Public company registration marks requiresEmailVerification: true
    const pubRegRes = await request(app)
      .post('/api/v2/auth/register-company')
      .send({
        fullName: 'Public Founder',
        email: 'founder@neworg.test',
        password: 'FounderPassword#1',
        companyName: 'NewOrg Academy',
      });
    expect(pubRegRes.status).toBe(201);
    expect(pubRegRes.body.requiresEmailVerification).toBe(true);

    // Unverified caller cannot access /api/v2/tenant/me, /api/v2/courses, or /api/v2/tenant/invitations/accept
    for (const path of ['/api/v2/tenant/me', '/api/v2/courses']) {
      const res = await request(app)
        .get(path)
        .set('Authorization', 'Bearer token-founder@neworg.test');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    }

    const acceptUnverifiedRes = await request(app)
      .post('/api/v2/tenant/invitations/accept')
      .set('Authorization', 'Bearer token-founder@neworg.test');
    expect(acceptUnverifiedRes.status).toBe(403);
    expect(acceptUnverifiedRes.body.code).toBe('EMAIL_NOT_VERIFIED');

    // Unverified caller supplying a session token to register-company also receives 403
    const createWithUnverifiedSession = await request(app)
      .post('/api/v2/auth/register-company')
      .set('Authorization', 'Bearer token-unverified')
      .send({ companyName: 'Blocked Org' });
    expect(createWithUnverifiedSession.status).toBe(403);
    expect(createWithUnverifiedSession.body.code).toBe('EMAIL_NOT_VERIFIED');

    // Duplicate confirmed account rejected with 409
    const dupConfirmedCompany = await request(app)
      .post('/api/v2/auth/register-company')
      .send({
        fullName: 'Duplicate',
        email: 'admin@acme.test',
        password: 'Password#1234',
        companyName: 'Another Co',
      });
    expect(dupConfirmedCompany.status).toBe(409);

    // Once email is verified, protected endpoints succeed
    env.verifyUserEmail('founder@neworg.test');
    const verifiedCoursesRes = await request(app)
      .get('/api/v2/courses')
      .set('Authorization', 'Bearer token-founder@neworg.test');
    expect(verifiedCoursesRes.status).toBe(200);
    expect(verifiedCoursesRes.body.success).toBe(true);
  });

  it('enforces shared-interface rate limiting with HTTP 429 and Retry-After header', async () => {
    const { app } = createTestApp(3);
    for (let i = 0; i < 3; i++) {
      const okRes = await request(app)
        .get('/api/v2/tenant/me')
        .set('Authorization', 'Bearer token-admin-a');
      expect(okRes.status).toBe(200);
    }
    const blockedRes = await request(app)
      .get('/api/v2/tenant/me')
      .set('Authorization', 'Bearer token-admin-a');
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers['retry-after']).toBeDefined();
  });
});

describe('Priority 2 — Production Rate Limiting Configuration & Fail-Closed Enforcement', () => {
  it('requires Supabase server config in production, rejects MemoryRateLimitStore, and selects SupabaseRateLimitStore when configured', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    expect(() => validateRateLimitConfiguration()).toThrow(/Supabase PostgreSQL/i);
    expect(() => resolveDefaultRateLimitStore()).toThrow(/Supabase PostgreSQL/i);
    expect(() =>
      createApiRouter({
        rateLimitStore: new MemoryRateLimitStore(),
      })
    ).toThrow(/MemoryRateLimitStore/i);

    process.env.RATE_LIMIT_STORE = 'memory';
    expect(() => validateRateLimitConfiguration()).toThrow(/MemoryRateLimitStore/i);
    delete process.env.RATE_LIMIT_STORE;

    // When Supabase server credentials are configured in production, selects SupabaseRateLimitStore
    process.env.SUPABASE_URL = 'https://example-project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_key_placeholder_for_test_12345';
    expect(validateRateLimitConfiguration()).toEqual({ mode: 'supabase', production: true });
    expect(resolveDefaultRateLimitStore()).toBeInstanceOf(SupabaseRateLimitStore);
  });

  it('fails closed with HTTP 503 when Supabase consume_rate_limit RPC fails in production without exposing secrets', async () => {
    process.env.NODE_ENV = 'production';
    const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rpcSpy = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find consume_rate_limit' },
    });

    const supaStore = new SupabaseRateLimitStore({
      failClosed: true,
      getAdminClient: () => ({ rpc: rpcSpy }),
    });
    const env = createInMemoryTenantEnv();
    const app = express();
    app.use(express.json());
    app.use(
      '/api',
      createApiRouter({
        rateLimitMaxPerMin: 20,
        rateLimitStore: supaStore,
        tenantDeps: {
          authVerifier: env.authVerifier,
          service: env.service,
          isConfiguredFn: () => true,
        },
      })
    );

    const res = await request(app)
      .get('/api/v2/courses')
      .set('Authorization', 'Bearer token-admin-a')
      .set('X-Company-Id', COMPANY_A_ID);

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('RATE_LIMIT_UNAVAILABLE');
    expect(rpcSpy).toHaveBeenCalledTimes(1);

    const logged = consoleErrSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logged).toContain('supabase_rpc');
    expect(logged).toContain('PGRST202');
    expect(logged).not.toContain('token-admin-a');
  });

  it('honors RATE_LIMIT_MAX_PER_MIN environment setting', async () => {
    process.env.NODE_ENV = 'test';
    process.env.RATE_LIMIT_MAX_PER_MIN = '5';
    const env = createInMemoryTenantEnv();
    const app = express();
    app.use(express.json());
    app.use(
      '/api',
      createApiRouter({
        rateLimitStore: new MemoryRateLimitStore(),
        tenantDeps: {
          authVerifier: env.authVerifier,
          service: env.service,
          isConfiguredFn: () => true,
        },
      })
    );

    for (let i = 0; i < 5; i++) {
      const okRes = await request(app)
        .get('/api/v2/tenant/me')
        .set('Authorization', 'Bearer token-admin-a');
      expect(okRes.status).toBe(200);
    }
    const blockedRes = await request(app)
      .get('/api/v2/tenant/me')
      .set('Authorization', 'Bearer token-admin-a');
    expect(blockedRes.status).toBe(429);
  });

  it('scopes auth routes by IP and tenant API routes by tenant + actor hash without cross-tenant interference', async () => {
    const authReq = {
      path: '/v2/auth/register-company',
      headers: { 'x-forwarded-for': '203.0.113.10' },
      ip: '127.0.0.1',
    } as any;
    expect(buildRateLimitKey(authReq)).toBe('v2:auth:ip:203.0.113.10');

    const env = createInMemoryTenantEnv();
    const app = express();
    app.use(express.json());
    app.use(
      '/api',
      createApiRouter({
        rateLimitMaxPerMin: 2,
        rateLimitStore: new MemoryRateLimitStore(),
        tenantDeps: {
          authVerifier: env.authVerifier,
          service: env.service,
          isConfiguredFn: () => true,
        },
      })
    );

    // Exhaust Company A limit
    expect(
      (
        await request(app)
          .get('/api/v2/courses')
          .set('Authorization', 'Bearer token-admin-a')
          .set('X-Company-Id', COMPANY_A_ID)
      ).status
    ).toBe(200);
    expect(
      (
        await request(app)
          .get('/api/v2/courses')
          .set('Authorization', 'Bearer token-admin-a')
          .set('X-Company-Id', COMPANY_A_ID)
      ).status
    ).toBe(200);
    expect(
      (
        await request(app)
          .get('/api/v2/courses')
          .set('Authorization', 'Bearer token-admin-a')
          .set('X-Company-Id', COMPANY_A_ID)
      ).status
    ).toBe(429);

    // Company B actor remains completely unaffected
    const companyBRes = await request(app)
      .get('/api/v2/courses')
      .set('Authorization', 'Bearer token-admin-b')
      .set('X-Company-Id', COMPANY_B_ID);
    expect(companyBRes.status).toBe(200);
  });

  it('handles PGRST202 missing consume_rate_limit RPC cleanly in non-production without console.error spam', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.VERCEL_ENV;
    const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rpcSpy = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.consume_rate_limit' },
    });

    const supaStore = new SupabaseRateLimitStore({
      failClosed: false,
      getAdminClient: () => ({ rpc: rpcSpy }),
    });

    const first = await supaStore.consume('v2:tenant:test:actor:1', 2, 60_000);
    const second = await supaStore.consume('v2:tenant:test:actor:1', 2, 60_000);
    const third = await supaStore.consume('v2:tenant:test:actor:1', 2, 60_000);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    // Called RPC once before entering non-production missing-RPC cooldown
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrSpy).not.toHaveBeenCalled();
  });

  it('detects missing governance_roles / active columns cleanly for backward-compatible auth queries', async () => {
    const { isMissingSchemaColumnError } = await import('../src/server/authMiddleware.js');
    expect(
      isMissingSchemaColumnError(
        { code: '42703', message: 'column company_memberships.governance_roles does not exist' },
        'governance_roles'
      )
    ).toBe(true);
    expect(
      isMissingSchemaColumnError(
        {
          code: 'PGRST204',
          message: "Could not find the 'governance_roles' column of 'company_memberships' in the schema cache",
        },
        'governance_roles'
      )
    ).toBe(true);
    expect(
      isMissingSchemaColumnError({ code: '23505', message: 'duplicate key value' }, 'governance_roles')
    ).toBe(false);
  });
});
