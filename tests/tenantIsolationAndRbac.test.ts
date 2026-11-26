import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApiRouter, MemoryRateLimitStore } from '../src/server/apiRouter.js';
import {
  buildGenuineHumanSignOff,
  buildSampleCourseProject,
  buildSampleQAReport,
  COMPANY_A_ID,
  COMPANY_B_ID,
  createInMemoryTenantEnv,
} from './helpers/testFixtures.js';

function createTestApp() {
  const env = createInMemoryTenantEnv();
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use(
    '/api',
    createApiRouter({
      rateLimitMaxPerMin: 100,
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

describe('Priority 2 — Tenant Isolation, Multi-Role RBAC & Human Governance Approval', () => {
  it('blocks cross-company X-Company-Id and payload companyId tampering with HTTP 403', async () => {
    const { app } = createTestApp();

    const crossTenantGet = await request(app)
      .get('/api/v2/courses')
      .set('Authorization', 'Bearer token-admin-a')
      .set('X-Company-Id', COMPANY_B_ID);
    expect(crossTenantGet.status).toBe(403);

    const payloadTamperPost = await request(app)
      .post('/api/v2/courses')
      .set('Authorization', 'Bearer token-admin-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        companyId: COMPANY_B_ID,
        project: buildSampleCourseProject({ id: 'course-new', companyId: COMPANY_B_ID }),
      });
    expect(payloadTamperPost.status).toBe(403);
  });

  it('enforces read-only access for viewer across all mutating endpoints', async () => {
    const { app } = createTestApp();

    const readCourses = await request(app)
      .get('/api/v2/courses')
      .set('Authorization', 'Bearer token-viewer-a')
      .set('X-Company-Id', COMPANY_A_ID);
    expect(readCourses.status).toBe(200);

    const createCourse = await request(app)
      .post('/api/v2/courses')
      .set('Authorization', 'Bearer token-viewer-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ project: buildSampleCourseProject({ id: 'viewer-course' }) });
    expect(createCourse.status).toBe(403);

    const updateCourse = await request(app)
      .put('/api/v2/courses/course-1')
      .set('Authorization', 'Bearer token-viewer-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ project: buildSampleCourseProject() });
    expect(updateCourse.status).toBe(403);

    const deleteCourse = await request(app)
      .delete('/api/v2/courses/course-1')
      .set('Authorization', 'Bearer token-viewer-a')
      .set('X-Company-Id', COMPANY_A_ID);
    expect(deleteCourse.status).toBe(403);

    const snapshotRes = await request(app)
      .post('/api/v2/courses/course-1/versions')
      .set('Authorization', 'Bearer token-viewer-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        snapshot: {
          id: 'snap-1',
          versionNumber: 1,
          createdAt: new Date().toISOString(),
          stage: 6,
          trigger: 'manual_snapshot',
          summary: 'Attempted viewer snapshot',
          data: buildSampleCourseProject(),
        },
      });
    expect(snapshotRes.status).toBe(403);
  });

  it('prevents authors from completing courses or forging governance approvals while allowing normal authoring', async () => {
    const { app } = createTestApp();

    // Author CAN edit draft courses
    const authorEdit = await request(app)
      .put('/api/v2/courses/course-1')
      .set('Authorization', 'Bearer token-author-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        project: buildSampleCourseProject({ lifecycleStatus: 'awaiting_review' }),
      });
    expect(authorEdit.status).toBe(200);

    // Author CANNOT transition lifecycleStatus to completed
    const authorComplete = await request(app)
      .put('/api/v2/courses/course-1')
      .set('Authorization', 'Bearer token-author-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        project: buildSampleCourseProject({
          lifecycleStatus: 'completed',
          latestQA: buildSampleQAReport({ humanSignOff: buildGenuineHumanSignOff() }),
        }),
      });
    expect(authorComplete.status).toBe(403);

    // Author CANNOT forge SME/ID/Compliance humanSignOff even in draft
    const authorForgeSignoff = await request(app)
      .put('/api/v2/courses/course-1')
      .set('Authorization', 'Bearer token-author-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        project: buildSampleCourseProject({
          lifecycleStatus: 'in_development',
          latestQA: buildSampleQAReport({ humanSignOff: buildGenuineHumanSignOff() }),
        }),
      });
    expect(authorForgeSignoff.status).toBe(403);

    // Author CANNOT invite members or manage company settings
    const authorInvite = await request(app)
      .post('/api/v2/tenant/members/invite')
      .set('Authorization', 'Bearer token-author-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ email: 'x@acme.test', role: 'viewer', fullName: 'X' });
    expect(authorInvite.status).toBe(403);
  });

  it('rejects AI-generated provisional sign-offs on completion and permits reviewer completion with genuine 3-role human sign-off', async () => {
    const { app } = createTestApp();

    // Reviewer attempting completion with AI provisional reviewer name -> 400
    const aiSignOffProject = buildSampleCourseProject({
      lifecycleStatus: 'completed',
      latestQA: buildSampleQAReport({
        humanSignOff: {
          signedOff: true,
          reviewerName: 'AI QA Auto-Sign-Off (Provisional — Pending Human Review)',
          signedOffAt: new Date().toISOString(),
          roles: {
            sme: {
              signedOff: true,
              reviewerName: 'AI QA Auto-Sign-Off (Provisional — Pending Human Review)',
            },
            instructionalDesigner: { signedOff: true, reviewerName: 'Jane ID' },
            complianceAuthorizer: { signedOff: true, reviewerName: 'John Compliance' },
          },
        },
      }),
    });

    const aiCompleteRes = await request(app)
      .put('/api/v2/courses/course-1')
      .set('Authorization', 'Bearer token-reviewer-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ project: aiSignOffProject });
    expect(aiCompleteRes.status).toBe(400);

    // Reviewer attempting completion with missing role sign-off -> 400
    const partialRolesProject = buildSampleCourseProject({
      lifecycleStatus: 'completed',
      latestQA: buildSampleQAReport({
        humanSignOff: {
          signedOff: true,
          reviewerName: 'Dr. Thabo Mokoena',
          roles: {
            sme: { signedOff: true, reviewerName: 'Dr. Thabo Mokoena' },
            instructionalDesigner: { signedOff: true, reviewerName: 'Nomsa Dlamini' },
            complianceAuthorizer: { signedOff: false, reviewerName: '' },
          },
        },
      }),
    });
    const partialRes = await request(app)
      .put('/api/v2/courses/course-1')
      .set('Authorization', 'Bearer token-reviewer-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ project: partialRolesProject });
    expect(partialRes.status).toBe(400);

    // Reviewer with complete genuine human multi-role sign-off -> 200
    const validCompleteProject = buildSampleCourseProject({
      lifecycleStatus: 'completed',
      latestQA: buildSampleQAReport({ humanSignOff: buildGenuineHumanSignOff() }),
    });
    const validRes = await request(app)
      .put('/api/v2/courses/course-1')
      .set('Authorization', 'Bearer token-reviewer-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ project: validCompleteProject });
    expect(validRes.status).toBe(200);
    expect(validRes.body.course.lifecycleStatus).toBe('completed');

    // Reviewer CANNOT delete courses or invite team members
    const reviewerDelete = await request(app)
      .delete('/api/v2/courses/course-1')
      .set('Authorization', 'Bearer token-reviewer-a')
      .set('X-Company-Id', COMPANY_A_ID);
    expect(reviewerDelete.status).toBe(403);
  });
});
