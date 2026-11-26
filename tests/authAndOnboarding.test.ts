import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApiRouter, MemoryRateLimitStore } from '../src/server/apiRouter.js';
import { COMPANY_A_ID, createInMemoryTenantEnv } from './helpers/testFixtures.js';

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
