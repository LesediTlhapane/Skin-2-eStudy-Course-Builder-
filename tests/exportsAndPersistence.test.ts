import { Packer } from 'docx';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApiRouter, MemoryRateLimitStore } from '../src/server/apiRouter.js';
import { compactProjectForCloudPayload, utf8ByteLength } from '../src/utils/apiClient.js';
import {
  buildCloudRecoveryKey,
  clearCloudRecoveryDraft,
  loadCloudRecoveryDrafts,
  reconcileCloudRecoveryDrafts,
  saveCloudRecoveryDraftSync,
  type CloudRecoveryDraft,
} from '../src/utils/cloudRecovery.js';
import { buildDeliverableDocxDocument } from '../src/utils/exportDeliverables.js';
import { buildScorm12ZipBytes, buildScorm12ZipEntries } from '../src/utils/scormExport.js';
import {
  buildSampleCourseProject,
  COMPANY_A_ID,
  createInMemoryTenantEnv,
} from './helpers/testFixtures.js';

describe('Priority 3 & Exports — Cloud Version History, Payload Compaction, Security Headers & Exports', () => {
  it('persists and retrieves course version snapshots across fresh cloud API requests', async () => {
    const env = createInMemoryTenantEnv();
    const app = express();
    app.use(express.json({ limit: '4mb' }));
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

    const sampleProject = buildSampleCourseProject();
    const { versions: _ignored, ...snapshotData } = sampleProject;

    const saveVerRes = await request(app)
      .post('/api/v2/courses/course-1/versions')
      .set('Authorization', 'Bearer token-author-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        snapshot: {
          id: 'ver-snapshot-1',
          versionNumber: 2,
          createdAt: '2026-11-26T02:00:00.000Z',
          stage: 6,
          trigger: 'manual_snapshot',
          summary: 'Pre-QA checkpoint',
          data: snapshotData,
        },
      });
    expect(saveVerRes.status).toBe(201);
    expect(saveVerRes.body.version.id).toBe('ver-snapshot-1');

    // Retrieve version history on fresh request (simulating reload/new device)
    const listVerRes = await request(app)
      .get('/api/v2/courses/course-1/versions')
      .set('Authorization', 'Bearer token-viewer-a')
      .set('X-Company-Id', COMPANY_A_ID);
    expect(listVerRes.status).toBe(200);
    expect(listVerRes.body.versions).toHaveLength(1);
    expect(listVerRes.body.versions[0].summary).toBe('Pre-QA checkpoint');
  });

  it('compacts oversized local course payloads under target Vercel safe byte budget', () => {
    const bigProject = buildSampleCourseProject();
    const hugeChunk = 'A'.repeat(600_000);
    bigProject.sources = [
      { ...bigProject.sources[0], id: 'big-1', extractedText: hugeChunk },
      { ...bigProject.sources[0], id: 'big-2', extractedText: hugeChunk },
      { ...bigProject.sources[0], id: 'big-3', extractedText: hugeChunk },
      { ...bigProject.sources[0], id: 'big-4', extractedText: hugeChunk },
    ];
    bigProject.versions = Array.from({ length: 5 }, (_, idx) => {
      const { versions: _v, ...rest } = bigProject;
      return {
        id: `v-${idx}`,
        versionNumber: idx + 1,
        createdAt: new Date().toISOString(),
        stage: 5 as const,
        trigger: 'auto_save' as const,
        summary: `Snapshot ${idx}`,
        data: rest,
      };
    });

    const maxBytes = 1_500_000;
    const { project: compacted, trimmed } = compactProjectForCloudPayload(bigProject, maxBytes);
    expect(trimmed).toBe(true);
    expect(utf8ByteLength(JSON.stringify({ project: compacted }))).toBeLessThanOrEqual(maxBytes);
    expect(compacted.content.modules[0].lessons[0].explanation.length).toBeGreaterThan(50);
  });

  it('generates valid DOCX archives (ZIP PK header) for complete_course, learner_manual, and qa_report', async () => {
    const project = buildSampleCourseProject();
    for (const deliverableType of ['complete_course', 'learner_manual', 'qa_report'] as const) {
      const doc = buildDeliverableDocxDocument(project, deliverableType);
      const buffer = await Packer.toBuffer(doc);
      expect(buffer.byteLength).toBeGreaterThan(1000);
      expect(buffer[0]).toBe(0x50); // 'P'
      expect(buffer[1]).toBe(0x4b); // 'K'
    }
  });

  it('generates valid SCORM 1.2 ZIP package containing imsmanifest.xml and module launch files', () => {
    const project = buildSampleCourseProject();
    const entries = buildScorm12ZipEntries(project);
    const names = entries.map(e => e.name);
    expect(names).toContain('imsmanifest.xml');
    expect(names).toContain('shared/scorm_api.js');
    expect(names).toContain('index.html');
    expect(names).toContain('module-1.html');

    const zipBytes = buildScorm12ZipBytes(project);
    expect(zipBytes.byteLength).toBeGreaterThan(500);
    expect(zipBytes[0]).toBe(0x50);
    expect(zipBytes[1]).toBe(0x4b);
  });

  it('attaches baseline HTTP security headers on API responses', async () => {
    const env = createInMemoryTenantEnv();
    const app = express();
    app.use('/api', createApiRouter({
      rateLimitStore: new MemoryRateLimitStore(),
      tenantDeps: {
        authVerifier: env.authVerifier,
        service: env.service,
        isConfiguredFn: () => false,
      },
    }));

    const healthRes = await request(app).get('/api/health');
    expect(healthRes.status).toBe(200);
    expect(healthRes.headers['x-content-type-options']).toBe('nosniff');
    expect(healthRes.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(healthRes.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
    expect(healthRes.headers['cache-control']).toBe('no-store');
  });

  it('persists verified 3-person governance provenance on completed courses across subsequent cloud fetches', async () => {
    const env = createInMemoryTenantEnv();
    const app = express();
    app.use(express.json({ limit: '4mb' }));
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

    await request(app)
      .post('/api/v2/courses/course-1/governance/approve')
      .set('Authorization', 'Bearer token-sme-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ governanceRole: 'sme', decision: 'approved' });
    await request(app)
      .post('/api/v2/courses/course-1/governance/approve')
      .set('Authorization', 'Bearer token-id-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ governanceRole: 'instructional_designer', decision: 'approved' });
    await request(app)
      .post('/api/v2/courses/course-1/governance/approve')
      .set('Authorization', 'Bearer token-comp-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({ governanceRole: 'compliance_authorizer', decision: 'approved' });

    const completeRes = await request(app)
      .post('/api/v2/courses/course-1/complete')
      .set('Authorization', 'Bearer token-reviewer-a')
      .set('X-Company-Id', COMPANY_A_ID);
    expect(completeRes.status).toBe(200);

    const listRes = await request(app)
      .get('/api/v2/courses')
      .set('Authorization', 'Bearer token-viewer-a')
      .set('X-Company-Id', COMPANY_A_ID);
    expect(listRes.status).toBe(200);
    const savedCourse = listRes.body.courses.find((c: any) => c.id === 'course-1');
    expect(savedCourse.lifecycleStatus).toBe('completed');
    expect(savedCourse.latestQA.humanSignOff.signedOff).toBe(true);
    expect(savedCourse.latestQA.humanSignOff.roles.sme.reviewerUserId).toBe('user-sme-a');
    expect(savedCourse.latestQA.humanSignOff.roles.instructionalDesigner.reviewerUserId).toBe(
      'user-id-a'
    );
    expect(savedCourse.latestQA.humanSignOff.roles.complianceAuthorizer.reviewerUserId).toBe(
      'user-comp-a'
    );
  });

  it('reconciles unsaved cloud recovery drafts safely across session kicks and concurrent edits', () => {
    const serverCourse = buildSampleCourseProject({ id: 'course-sync-1' });
    serverCourse.updatedAt = '2026-11-27T08:00:00.000Z';
    serverCourse.currentStage = 3;

    const soloOfflineEdit = buildSampleCourseProject({ id: 'course-sync-1' });
    soloOfflineEdit.updatedAt = '2026-11-27T08:05:00.000Z';
    soloOfflineEdit.currentStage = 5;
    soloOfflineEdit.brief.title = 'Updated Before Session Kick';

    const unsavedNewCourse = buildSampleCourseProject({ id: 'course-new-unsaved' });
    unsavedNewCourse.updatedAt = '2026-11-27T08:06:00.000Z';
    unsavedNewCourse.brief.title = 'Created Right Before Kick';

    const conflictedServerCourse = buildSampleCourseProject({ id: 'course-conflict-1' });
    conflictedServerCourse.updatedAt = '2026-11-27T08:10:00.000Z';

    const staleBaseEdit = buildSampleCourseProject({ id: 'course-conflict-1' });
    staleBaseEdit.updatedAt = '2026-11-27T08:07:00.000Z';
    staleBaseEdit.brief.title = 'My Local Conflicting Edit';

    const drafts: CloudRecoveryDraft[] = [
      {
        recoveryKey: buildCloudRecoveryKey(COMPANY_A_ID, 'course-sync-1'),
        companyId: COMPANY_A_ID,
        projectId: 'course-sync-1',
        baseServerUpdatedAt: '2026-11-27T08:00:00.000Z',
        isNewCourse: false,
        savedOfflineAt: '2026-11-27T08:05:01.000Z',
        project: soloOfflineEdit,
      },
      {
        recoveryKey: buildCloudRecoveryKey(COMPANY_A_ID, 'course-new-unsaved'),
        companyId: COMPANY_A_ID,
        projectId: 'course-new-unsaved',
        baseServerUpdatedAt: null,
        isNewCourse: true,
        savedOfflineAt: '2026-11-27T08:06:01.000Z',
        project: unsavedNewCourse,
      },
      {
        recoveryKey: buildCloudRecoveryKey(COMPANY_A_ID, 'course-conflict-1'),
        companyId: COMPANY_A_ID,
        projectId: 'course-conflict-1',
        baseServerUpdatedAt: '2026-11-27T08:00:00.000Z',
        isNewCourse: false,
        savedOfflineAt: '2026-11-27T08:07:01.000Z',
        project: staleBaseEdit,
      },
    ];

    const result = reconcileCloudRecoveryDrafts(
      [serverCourse, conflictedServerCourse],
      drafts,
      raw => raw
    );

    expect(result.autoRecoveredIds).toEqual(['course-sync-1', 'course-new-unsaved']);
    expect(result.autoRecoveredNewIds).toEqual(['course-new-unsaved']);
    expect(result.conflictingDrafts).toHaveLength(1);
    expect(result.conflictingDrafts[0].projectId).toBe('course-conflict-1');

    const restoredExisting = result.projects.find(p => p.id === 'course-sync-1');
    expect(restoredExisting?.currentStage).toBe(5);
    expect(restoredExisting?.brief.title).toBe('Updated Before Session Kick');

    const restoredNew = result.projects.find(p => p.id === 'course-new-unsaved');
    expect(restoredNew?.brief.title).toBe('Created Right Before Kick');

    // Server version of conflicted course remains untouched until user chooses
    const untouchedConflicted = result.projects.find(p => p.id === 'course-conflict-1');
    expect(untouchedConflicted?.updatedAt).toBe('2026-11-27T08:10:00.000Z');
  });

  it('isolates localStorage cloud recovery drafts per companyId and clears them cleanly', async () => {
    const store = new Map<string, string>();
    const prevLocalStorage = (globalThis as any).localStorage;
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };

    try {
      const projA = buildSampleCourseProject({ id: 'course-a' });
      const projB = buildSampleCourseProject({ id: 'course-b' });

      saveCloudRecoveryDraftSync({
        recoveryKey: buildCloudRecoveryKey('company-a', 'course-a'),
        companyId: 'company-a',
        projectId: 'course-a',
        baseServerUpdatedAt: null,
        isNewCourse: false,
        savedOfflineAt: '2026-11-27T08:00:00.000Z',
        project: projA,
      });
      saveCloudRecoveryDraftSync({
        recoveryKey: buildCloudRecoveryKey('company-b', 'course-b'),
        companyId: 'company-b',
        projectId: 'course-b',
        baseServerUpdatedAt: null,
        isNewCourse: false,
        savedOfflineAt: '2026-11-27T08:00:00.000Z',
        project: projB,
      });

      const draftsA = await loadCloudRecoveryDrafts('company-a');
      expect(draftsA.map(d => d.projectId)).toEqual(['course-a']);

      await clearCloudRecoveryDraft('company-a', 'course-a');
      const draftsAAfterClear = await loadCloudRecoveryDrafts('company-a');
      const draftsBAfterClear = await loadCloudRecoveryDrafts('company-b');
      expect(draftsAAfterClear).toHaveLength(0);
      expect(draftsBAfterClear.map(d => d.projectId)).toEqual(['course-b']);
    } finally {
      if (prevLocalStorage === undefined) {
        delete (globalThis as any).localStorage;
      } else {
        (globalThis as any).localStorage = prevLocalStorage;
      }
    }
  });
});
