import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRateLimitKey,
  createAiConcurrencyLimiter,
  createApiRouter,
  MemoryRateLimitStore,
  resolveDefaultRateLimitStore,
  SupabaseRateLimitStore,
  validateRateLimitConfiguration,
} from '../src/server/apiRouter.js';
import { AuthServiceUnavailableError } from '../src/server/authMiddleware.js';
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

  it('scopes auth routes by IP and tenant API routes by verified session without header/token spoofing or cross-tenant interference', async () => {
    const untrustedAuthReq = {
      path: '/v2/auth/register-company',
      headers: { 'x-forwarded-for': '203.0.113.10' },
      ip: '127.0.0.1',
    } as any;
    expect(buildRateLimitKey(untrustedAuthReq)).toBe('v2:auth:ip:127.0.0.1');

    const trustedProxyAuthReq = {
      path: '/v2/auth/register-company',
      headers: { 'x-forwarded-for': '203.0.113.10' },
      ip: '127.0.0.1',
      app: { get: (k: string) => (k === 'trust proxy' ? true : false) },
    } as any;
    expect(buildRateLimitKey(trustedProxyAuthReq)).toBe('v2:auth:ip:203.0.113.10');

    // Arbitrary unverified Bearer tokens must NOT carve out separate pre-auth IP buckets
    const spoofedBearerReq = {
      path: '/v2/courses',
      headers: { authorization: 'Bearer forged-random-token-999' },
      ip: '127.0.0.1',
    } as any;
    expect(buildRateLimitKey(spoofedBearerReq)).toBe('v2:ip:127.0.0.1');

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

  it('distinguishes invalid tokens (401) from upstream auth/database outages (503 AUTH_SERVICE_UNAVAILABLE)', async () => {
    const env = createInMemoryTenantEnv();
    const faultyAuthVerifier = {
      verifyAccessToken: async (token: string) => {
        if (token === 'transient-outage') {
          throw new AuthServiceUnavailableError('Supabase auth service timed out.');
        }
        if (token === 'token-admin-a') {
          throw new AuthServiceUnavailableError('Database connection pool unavailable.');
        }
        return env.authVerifier.verifyAccessToken(token);
      },
    };

    const app = express();
    app.use(express.json());
    app.use(
      '/api',
      createApiRouter({
        rateLimitStore: new MemoryRateLimitStore(),
        tenantDeps: {
          authVerifier: faultyAuthVerifier,
          service: env.service,
          isConfiguredFn: () => true,
        },
      })
    );

    const badTokenRes = await request(app)
      .get('/api/v2/courses')
      .set('Authorization', 'Bearer invalid-token')
      .set('X-Company-Id', COMPANY_A_ID);
    expect(badTokenRes.status).toBe(401);

    const authOutageRes = await request(app)
      .get('/api/v2/courses')
      .set('Authorization', 'Bearer transient-outage')
      .set('X-Company-Id', COMPANY_A_ID);
    expect(authOutageRes.status).toBe(503);
    expect(authOutageRes.body.code).toBe('AUTH_SERVICE_UNAVAILABLE');

    const dbOutageOnMe = await request(app)
      .get('/api/v2/tenant/me')
      .set('Authorization', 'Bearer token-admin-a');
    expect(dbOutageOnMe.status).toBe(503);
    expect(dbOutageOnMe.body.code).toBe('AUTH_SERVICE_UNAVAILABLE');
  });

  it('enforces bounded per-user and per-company active AI concurrency limits with 429 AI_CONCURRENCY_LIMIT', async () => {
    const limiter = createAiConcurrencyLimiter({ maxPerUser: 1, maxPerCompany: 2 });
    const app = express();
    app.use(express.json());

    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    let markEnteredFirst!: () => void;
    let markEnteredSecond!: () => void;
    const gateFirst = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const gateSecond = new Promise<void>(resolve => {
      releaseSecond = resolve;
    });
    const enteredFirst = new Promise<void>(resolve => {
      markEnteredFirst = resolve;
    });
    const enteredSecond = new Promise<void>(resolve => {
      markEnteredSecond = resolve;
    });

    app.post(
      '/ai-test',
      (req: any, _res, next) => {
        req.tenantAuth = {
          userId: req.headers['x-test-user'] || 'user-1',
          companyId: COMPANY_A_ID,
          role: 'author',
          governanceRoles: [],
          email: 'user@acme.test',
          fullName: 'Test User',
        };
        next();
      },
      limiter as any,
      async (req, res) => {
        const slot = req.headers['x-slot'];
        if (slot === '1') {
          markEnteredFirst();
          await gateFirst;
        }
        if (slot === '2') {
          markEnteredSecond();
          await gateSecond;
        }
        res.json({ success: true });
      }
    );

    // Fire request 1 for user-1 (held open; await inside async wrapper starts Supertest immediately)
    const p1 = (async () =>
      request(app).post('/ai-test').set('x-test-user', 'user-1').set('x-slot', '1').send({}))();
    await enteredFirst;

    // Concurrent request from same user-1 exceeds maxPerUser=1 -> 429 AI_CONCURRENCY_LIMIT
    const pUserBlocked = await request(app)
      .post('/ai-test')
      .set('x-test-user', 'user-1')
      .send({});
    expect(pUserBlocked.status).toBe(429);
    expect(pUserBlocked.body.code).toBe('AI_CONCURRENCY_LIMIT');
    expect(pUserBlocked.body.scope).toBe('user');

    // Concurrent request from user-2 in same company fills company slot 2 of 2
    const p2 = (async () =>
      request(app).post('/ai-test').set('x-test-user', 'user-2').set('x-slot', '2').send({}))();
    await enteredSecond;

    // Concurrent request from user-3 in same company exceeds maxPerCompany=2 -> 429 AI_CONCURRENCY_LIMIT
    const pCompanyBlocked = await request(app)
      .post('/ai-test')
      .set('x-test-user', 'user-3')
      .send({});
    expect(pCompanyBlocked.status).toBe(429);
    expect(pCompanyBlocked.body.code).toBe('AI_CONCURRENCY_LIMIT');
    expect(pCompanyBlocked.body.scope).toBe('company');

    releaseFirst();
    releaseSecond();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    // Once slots drain, user-1 can invoke again cleanly
    const afterDrain = await request(app).post('/ai-test').set('x-test-user', 'user-1').send({});
    expect(afterDrain.status).toBe(200);
  });
});
