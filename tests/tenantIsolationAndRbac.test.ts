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

  it('blocks client-forged approvals, impersonation, same-user multi-role approval, and unassigned reviewers while allowing 3-person completion', async () => {
    const { app } = createTestApp();

    // 1. Unassigned reviewer (no explicit governanceRoles) CANNOT approve any governance role
    const unassignedReviewerRes = await request(app)
      .post('/api/v2/courses/course-1/governance/approve')
      .set('Authorization', 'Bearer token-reviewer-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ governanceRole: 'sme', decision: 'approved' });
    expect(unassignedReviewerRes.status).toBe(403);

    // 2. Unassigned company_admin CANNOT approve or complete a course without explicit governance role assignment
    const unassignedAdminApproveRes = await request(app)
      .post('/api/v2/courses/course-1/governance/approve')
      .set('Authorization', 'Bearer token-admin-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ governanceRole: 'sme', decision: 'approved' });
    expect(unassignedAdminApproveRes.status).toBe(403);

    const unassignedAdminCompleteRes = await request(app)
      .post('/api/v2/courses/course-1/complete')
      .set('Authorization', 'Bearer token-admin-a')
      .set('X-Company-Id', COMPANY_A_ID);
    expect(unassignedAdminCompleteRes.status).toBe(403);

    // 3. Author CANNOT approve governance gates
    const authorApproveRes = await request(app)
      .post('/api/v2/courses/course-1/governance/approve')
      .set('Authorization', 'Bearer token-author-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ governanceRole: 'sme', decision: 'approved' });
    expect(authorApproveRes.status).toBe(403);

    // 4. Reviewer CANNOT forge another user's reviewerUserId
    const impersonateRes = await request(app)
      .post('/api/v2/courses/course-1/governance/approve')
      .set('Authorization', 'Bearer token-sme-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ governanceRole: 'sme', reviewerUserId: 'user-id-a', decision: 'approved' });
    expect(impersonateRes.status).toBe(403);

    // 5. Client CANNOT forge approvals in PUT /api/v2/courses/:courseId
    const forgedPutRes = await request(app)
      .put('/api/v2/courses/course-1')
      .set('Authorization', 'Bearer token-reviewer-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        project: buildSampleCourseProject({
          lifecycleStatus: 'completed',
          latestQA: buildSampleQAReport({ humanSignOff: buildGenuineHumanSignOff() }),
        }),
      });
    expect(forgedPutRes.status).toBe(403);

    // 6. Three-person rule: dual-authorised user approves SME, then is blocked from approving Instructional Designer on same course
    const dualSmeRes = await request(app)
      .post('/api/v2/courses/course-1/governance/approve')
      .set('Authorization', 'Bearer token-dual-gov-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ governanceRole: 'sme', decision: 'approved' });
    expect(dualSmeRes.status).toBe(200);
    expect(dualSmeRes.body.approval.reviewerUserId).toBe('user-dual-gov-a');

    const dualSecondRoleRes = await request(app)
      .post('/api/v2/courses/course-1/governance/approve')
      .set('Authorization', 'Bearer token-dual-gov-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ governanceRole: 'instructional_designer', decision: 'approved' });
    expect(dualSecondRoleRes.status).toBe(409);

    // 7. Another user CANNOT revoke dual-gov-a's SME approval -> 403
    const otherRevokeRes = await request(app)
      .post('/api/v2/courses/course-1/governance/revoke')
      .set('Authorization', 'Bearer token-sme-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ governanceRole: 'sme' });
    expect(otherRevokeRes.status).toBe(403);

    // Original owner revokes their own SME approval -> 200
    const ownerRevokeRes = await request(app)
      .post('/api/v2/courses/course-1/governance/revoke')
      .set('Authorization', 'Bearer token-dual-gov-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ governanceRole: 'sme' });
    expect(ownerRevokeRes.status).toBe(200);

    // 8. Cannot complete course with only 2 of 3 approvals
    const smeApproveRes = await request(app)
      .post('/api/v2/courses/course-1/governance/approve')
      .set('Authorization', 'Bearer token-sme-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ governanceRole: 'sme', decision: 'approved' });
    expect(smeApproveRes.status).toBe(200);

    const idApproveRes = await request(app)
      .post('/api/v2/courses/course-1/governance/approve')
      .set('Authorization', 'Bearer token-id-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ governanceRole: 'instructional_designer', decision: 'approved' });
    expect(idApproveRes.status).toBe(200);

    const incompleteReleaseRes = await request(app)
      .post('/api/v2/courses/course-1/complete')
      .set('Authorization', 'Bearer token-reviewer-a')
      .set('X-Company-Id', COMPANY_A_ID);
    expect(incompleteReleaseRes.status).toBe(400);

    // 9. Third distinct human approves Compliance Authoriser -> Reviewer completes course -> 200
    const compApproveRes = await request(app)
      .post('/api/v2/courses/course-1/governance/approve')
      .set('Authorization', 'Bearer token-comp-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ governanceRole: 'compliance_authorizer', decision: 'approved' });
    expect(compApproveRes.status).toBe(200);

    const completeRes = await request(app)
      .post('/api/v2/courses/course-1/complete')
      .set('Authorization', 'Bearer token-reviewer-a')
      .set('X-Company-Id', COMPANY_A_ID);
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.course.lifecycleStatus).toBe('completed');
    expect(completeRes.body.course.latestQA.humanSignOff.signedOff).toBe(true);
    expect(completeRes.body.course.latestQA.humanSignOff.roles.sme.reviewerUserId).toBe('user-sme-a');
    expect(completeRes.body.course.latestQA.humanSignOff.roles.instructionalDesigner.reviewerUserId).toBe('user-id-a');
    expect(completeRes.body.course.latestQA.humanSignOff.roles.complianceAuthorizer.reviewerUserId).toBe('user-comp-a');

    // 10. Completed course governance approvals are strictly immutable -> 409
    const revokeCompletedRes = await request(app)
      .post('/api/v2/courses/course-1/governance/revoke')
      .set('Authorization', 'Bearer token-sme-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ governanceRole: 'sme' });
    expect(revokeCompletedRes.status).toBe(409);

    const reapproveCompletedRes = await request(app)
      .post('/api/v2/courses/course-1/governance/approve')
      .set('Authorization', 'Bearer token-comp-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ governanceRole: 'compliance_authorizer', decision: 'rejected' });
    expect(reapproveCompletedRes.status).toBe(409);
  });

  it('enforces aligned frontend/backend RBAC across sources, templates, courses, versions, and admin governance assignment', async () => {
    const { app } = createTestApp();

    // Reviewer CANNOT upload sources, delete courses, or manage templates (View-only for sources)
    const reviewerUpload = await request(app)
      .post('/api/v2/sources/upload')
      .set('Authorization', 'Bearer token-reviewer-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        fileName: 'policy.txt',
        mimeType: 'text/plain',
        base64Data: Buffer.from('POPIA policy text').toString('base64'),
      });
    expect(reviewerUpload.status).toBe(403);

    const reviewerAnalyse = await request(app)
      .post('/api/v2/sources/analyse')
      .set('Authorization', 'Bearer token-reviewer-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ title: 'Source', rawText: 'Text' });
    expect(reviewerAnalyse.status).toBe(403);

    const reviewerDeleteCourse = await request(app)
      .delete('/api/v2/courses/course-1')
      .set('Authorization', 'Bearer token-reviewer-a')
      .set('X-Company-Id', COMPANY_A_ID);
    expect(reviewerDeleteCourse.status).toBe(403);

    const reviewerTemplateSave = await request(app)
      .post('/api/v2/templates')
      .set('Authorization', 'Bearer token-reviewer-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ template: { id: 'tpl-1', name: 'Custom Tpl' } });
    expect(reviewerTemplateSave.status).toBe(403);

    // Author CAN upload sources and create templates
    const authorUpload = await request(app)
      .post('/api/v2/sources/upload')
      .set('Authorization', 'Bearer token-author-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        fileName: 'policy.txt',
        mimeType: 'text/plain',
        base64Data: Buffer.from('POPIA policy text').toString('base64'),
      });
    expect(authorUpload.status).toBe(201);
    const uploadedSourceId = authorUpload.body.sourceId;

    // Reviewer CAN download signed source URL for read/review, but CANNOT delete it
    const reviewerSignedUrl = await request(app)
      .get(`/api/v2/sources/${uploadedSourceId}/signed-url`)
      .set('Authorization', 'Bearer token-reviewer-a')
      .set('X-Company-Id', COMPANY_A_ID);
    expect(reviewerSignedUrl.status).toBe(200);

    const reviewerDeleteSource = await request(app)
      .delete(`/api/v2/sources/${uploadedSourceId}`)
      .set('Authorization', 'Bearer token-reviewer-a')
      .set('X-Company-Id', COMPANY_A_ID);
    expect(reviewerDeleteSource.status).toBe(403);

    const authorTemplateSave = await request(app)
      .post('/api/v2/templates')
      .set('Authorization', 'Bearer token-author-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ template: { id: 'tpl-author-1', name: 'Author Company Template' } });
    expect(authorTemplateSave.status).toBe(201);

    // Company Admin can explicitly assign a governance role to themselves -> then approve SME
    const assignAdminGovRes = await request(app)
      .patch('/api/v2/tenant/members/mem-admin-a')
      .set('Authorization', 'Bearer token-admin-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ governanceRoles: ['sme'] });
    expect(assignAdminGovRes.status).toBe(200);
    expect(assignAdminGovRes.body.member.governanceRoles).toEqual(['sme']);

    const adminGovApprove = await request(app)
      .post('/api/v2/courses/course-1/governance/approve')
      .set('Authorization', 'Bearer token-admin-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ governanceRole: 'sme', decision: 'approved' });
    expect(adminGovApprove.status).toBe(200);
  });
});
