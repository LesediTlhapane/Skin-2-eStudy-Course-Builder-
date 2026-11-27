import { Packer } from 'docx';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApiRouter, MemoryRateLimitStore } from '../src/server/apiRouter.js';
import { parseAndValidateLogoUpload } from '../src/server/tenantRoutes.js';
import { buildDeliverableDocxDocument } from '../src/utils/exportDeliverables.js';
import { buildScorm12ZipEntries } from '../src/utils/scormExport.js';
import {
  buildSampleCourseProject,
  COMPANY_A_ID,
  createInMemoryTenantEnv,
} from './helpers/testFixtures.js';

// Minimal valid 1x1 PNG encoded as base64
const TINY_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('Company Branding Persistence, Logo Validation & Branded Deliverables', () => {
  it('validates company logo uploads via magic bytes and rejects malformed/disallowed payloads', () => {
    const valid = parseAndValidateLogoUpload({
      fileName: 'acme-logo.png',
      base64Data: TINY_PNG_BASE64,
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.logo.ext).toBe('png');
      expect(valid.logo.mimeType).toBe('image/png');
      expect(valid.logo.buffer.byteLength).toBeGreaterThan(20);
    }

    const fakePng = parseAndValidateLogoUpload({
      fileName: 'evil.png',
      base64Data: 'data:image/png;base64,' + Buffer.from('<svg><script>alert(1)</script></svg>').toString('base64'),
    });
    expect(fakePng.ok).toBe(false);

    const missing = parseAndValidateLogoUpload({});
    expect(missing.ok).toBe(false);
  });

  it('persists logoUpload during company registration and reflects logoUrl across fresh tenant bootstrap/me fetches', async () => {
    const env = createInMemoryTenantEnv();
    // Override registerCompany to persist a mock storage URL when logoUpload is supplied
    const origRegister = env.service.registerCompany;
    env.service.registerCompany = async params => {
      const uploadedLogoUrl = params.logoUpload
        ? `https://cdn.example.test/company-logos/${params.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${params.logoUpload.ext}`
        : params.logoUrl ?? null;
      return origRegister({
        ...params,
        logoUrl: uploadedLogoUrl,
      });
    };

    const app = express();
    app.use(express.json({ limit: '6mb' }));
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

    // 1. Register new company with logoUpload (authenticated existing user mode -> immediate membership)
    const regRes = await request(app)
      .post('/api/v2/auth/register-company')
      .set('Authorization', 'Bearer token-author-a')
      .send({
        companyName: 'Meridian Academy',
        primaryColour: '#0A2540',
        secondaryColour: '#00D4B6',
        logoUpload: {
          fileName: 'meridian.png',
          base64Data: TINY_PNG_BASE64,
        },
      });

    expect(regRes.status).toBe(201);
    expect(regRes.body.success).toBe(true);
    expect(regRes.body.company.logoUrl).toBe(
      'https://cdn.example.test/company-logos/meridian-academy.png'
    );

    // 2. Fetch /api/v2/tenant/me -> simulates page reload / fresh hydration
    const meRes = await request(app)
      .get('/api/v2/tenant/me')
      .set('Authorization', 'Bearer token-author-a');
    expect(meRes.status).toBe(200);
    const meridianMembership = meRes.body.memberships.find(
      (m: any) => m.company?.companyName === 'Meridian Academy'
    );
    expect(meridianMembership?.company?.logoUrl).toBe(
      'https://cdn.example.test/company-logos/meridian-academy.png'
    );
  });

  it('rejects invalid logoUpload payload on registration cleanly before creating company', async () => {
    const env = createInMemoryTenantEnv();
    const app = express();
    app.use(express.json({ limit: '6mb' }));
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

    const badReg = await request(app)
      .post('/api/v2/auth/register-company')
      .set('Authorization', 'Bearer token-author-a')
      .send({
        companyName: 'Broken Logo Corp',
        logoUpload: {
          fileName: 'fake.png',
          base64Data: Buffer.from('not-a-valid-png').toString('base64'),
        },
      });

    expect(badReg.status).toBe(400);
    expect(badReg.body.success).toBe(false);
  });

  it('updates and persists company logo via POST /api/v2/tenant/company/logo and renders company brand & Course Introduction in exports', async () => {
    const env = createInMemoryTenantEnv();
    env.service.uploadCompanyLogo = async params => {
      const logoUrl = `https://cdn.example.test/${params.companyId}/logo.${params.ext}`;
      const company = await env.service.updateCompany(params.companyId, params.userId, {
        logoUrl,
      });
      return {
        company,
        logoUrl,
        storagePath: `company-logos/${params.companyId}/logo.${params.ext}`,
      };
    };

    const app = express();
    app.use(express.json({ limit: '6mb' }));
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

    const uploadRes = await request(app)
      .post('/api/v2/tenant/company/logo')
      .set('Authorization', 'Bearer token-admin-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        fileName: 'acme.png',
        base64Data: TINY_PNG_BASE64,
      });

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.company.logoUrl).toBe(
      `https://cdn.example.test/${COMPANY_A_ID}/logo.png`
    );

    // Branded SCORM & DOCX deliverables include companyName and Course Introduction
    const project = buildSampleCourseProject();
    project.content.courseIntroduction = {
      whyThisMatters: 'Accurate personal information handling prevents costly compliance breaches.',
      intendedLearners: 'Operational managers and HR leads.',
      prerequisitesSummary: 'Standard induction completed.',
      outcomesOverview: 'Evaluate lawful grounds and implement technical safeguards.',
      structureRoadmap: 'One core module followed by practical workplace audit.',
      assessmentOverview: '50% Knowledge Check and 50% Practical Safeguard Audit.',
    };

    const scormEntries = buildScorm12ZipEntries(project, { companyName: 'Acme Training Co' });
    const indexEntry = scormEntries.find(e => e.name === 'index.html');
    const indexHtml =
      typeof indexEntry?.content === 'string'
        ? indexEntry.content
        : new TextDecoder().decode(indexEntry!.content);
    expect(indexHtml).toContain('Acme Training Co');
    expect(indexHtml).toContain('Course Introduction');
    expect(indexHtml).toContain('Accurate personal information handling prevents costly compliance breaches.');

    const doc = buildDeliverableDocxDocument(project, 'complete_course', {
      companyName: 'Acme Training Co',
    });
    const docxBuffer = await Packer.toBuffer(doc);
    expect(docxBuffer.byteLength).toBeGreaterThan(1000);
    expect(docxBuffer[0]).toBe(0x50);
    expect(docxBuffer[1]).toBe(0x4b);
  });
});
