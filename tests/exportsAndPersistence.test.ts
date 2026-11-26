import { Packer } from 'docx';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApiRouter, MemoryRateLimitStore } from '../src/server/apiRouter.js';
import { compactProjectForCloudPayload, utf8ByteLength } from '../src/utils/apiClient.js';
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
});
