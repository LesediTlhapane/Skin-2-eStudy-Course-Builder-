import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { Packer } from 'docx';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { SYSTEM_TEMPLATES } from '../src/data/templates.js';
import { createApiRouter, MemoryRateLimitStore } from '../src/server/apiRouter.js';
import { parseAndValidateLogoUpload } from '../src/server/tenantRoutes.js';
import {
  computeLogoFitDimensions,
  detectImageFormatFromBytes,
  parseImageDimensions,
  resolveExportBrand,
  toExportBrandOptions,
} from '../src/utils/exportBranding.js';
import {
  buildDeliverableDocxDocument,
  buildDeliverableHtmlDocument,
  buildLmsPackageData,
  type DeliverableType,
} from '../src/utils/exportDeliverables.js';
import { buildScorm12ZipBytes, buildScorm12ZipEntries } from '../src/utils/scormExport.js';
import { buildTemplateDocxDocument } from '../src/utils/templateDocx.js';
import {
  buildSampleCourseProject,
  COMPANY_A_ID,
  COMPANY_B_ID,
  createInMemoryTenantEnv,
} from './helpers/testFixtures.js';

// Minimal valid 1x1 PNG encoded as base64
const TINY_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * Generates an authentic, valid RGBA PNG with exact IHDR dimensions and compressed IDAT scanlines.
 */
function createSyntheticPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = 1 + width * 4;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter None
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;
      raw[px] = rgba[0];
      raw[px + 1] = rgba[1];
      raw[px + 2] = rgba[2];
      raw[px + 3] = rgba[3];
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

/**
 * Generates a valid JPEG binary containing SOI + APP0 + SOF0 (width/height) + SOS + EOI markers.
 */
function createSyntheticJpeg(width: number, height: number, markerByte: number): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ]);
  const sof0 = Buffer.alloc(19);
  sof0[0] = 0xff;
  sof0[1] = 0xc0; // SOF0 baseline
  sof0.writeUInt16BE(17, 2);
  sof0[4] = 8; // precision
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0[9] = 3; // components
  sof0[10] = 1; sof0[11] = 0x11; sof0[12] = 0;
  sof0[13] = 2; sof0[14] = 0x11; sof0[15] = 1;
  sof0[16] = 3; sof0[17] = 0x11; sof0[18] = 1;
  const sos = Buffer.from([
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00,
    markerByte, markerByte, 0x00,
  ]);
  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([soi, app0, sof0, sos, eoi]);
}

/**
 * Parses a PK ZIP archive (both STORE method 0 and DEFLATE method 8, e.g. DOCX & SCORM ZIPs)
 * by reading the Central Directory and inflating each entry directly.
 */
function extractZipEntries(zipBytes: Uint8Array): Map<string, Buffer> {
  const buf = Buffer.from(zipBytes);
  // Locate End of Central Directory (0x06054b50)
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Invalid ZIP archive: EOCD signature not found.');
  }
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const centralOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries = new Map<string, Buffer>();
  let ptr = centralOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) {
      throw new Error('Invalid ZIP central directory header.');
    }
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localHeaderOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    ptr += 46 + nameLen + extraLen + commentLen;

    if (buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Invalid ZIP local header for ${name}`);
    }
    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);
    const content =
      method === 0
        ? Buffer.from(compressed)
        : method === 8
          ? zlib.inflateRawSync(compressed)
          : (() => {
              throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
            })();
    entries.set(name, content);
  }
  return entries;
}

describe('Company Branding Persistence, Logo Validation & Export Logo Audit', () => {
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

  it('parses PNG & JPEG image dimensions and preserves original aspect ratio when fitting logos', () => {
    const widePng = createSyntheticPng(200, 50, [10, 40, 120, 255]);
    const squareJpg = createSyntheticJpeg(80, 80, 0x42);

    expect(detectImageFormatFromBytes(widePng)).toEqual({ mimeType: 'image/png', ext: 'png' });
    expect(detectImageFormatFromBytes(squareJpg)).toEqual({ mimeType: 'image/jpeg', ext: 'jpg' });
    expect(parseImageDimensions(widePng, 'png')).toEqual({ width: 200, height: 50 });
    expect(parseImageDimensions(squareJpg, 'jpg')).toEqual({ width: 80, height: 80 });

    const fittedWide = computeLogoFitDimensions({ width: 200, height: 50 }, 160, 52);
    expect(fittedWide).toEqual({ width: 160, height: 40 }); // exact 4:1 ratio

    const fittedSquare = computeLogoFitDimensions({ width: 80, height: 80 }, 160, 52);
    expect(fittedSquare).toEqual({ width: 52, height: 52 }); // exact 1:1 ratio
  });

  it('persists logoUpload during company registration and reflects logoUrl across fresh tenant bootstrap/me fetches', async () => {
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
    expect(regRes.body.company.logoUrl).toMatch(/^https:\/\/storage\.test\/company-logos\/.+\/logo\.png$/);

    const meRes = await request(app)
      .get('/api/v2/tenant/me')
      .set('Authorization', 'Bearer token-author-a');
    expect(meRes.status).toBe(200);
    const meridianMembership = meRes.body.memberships.find(
      (m: any) => m.company?.companyName === 'Meridian Academy'
    );
    expect(meridianMembership?.company?.logoUrl).toBe(regRes.body.company.logoUrl);
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

  it('isolates persisted logo retrieval across Company A, Company B, Company C, refresh, sign-out/sign-in, and invalid URLs', async () => {
    const env = createInMemoryTenantEnv();
    const logoA = createSyntheticPng(200, 50, [5, 43, 102, 255]);
    const logoB = createSyntheticJpeg(80, 80, 0x77);

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

    // Upload Logo A for Company A and Logo B for Company B
    const upA = await request(app)
      .post('/api/v2/tenant/company/logo')
      .set('Authorization', 'Bearer token-admin-a')
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        fileName: 'acme-wide.png',
        base64Data: `data:image/png;base64,${logoA.toString('base64')}`,
      });
    expect(upA.status).toBe(201);

    const upB = await request(app)
      .post('/api/v2/tenant/company/logo')
      .set('Authorization', 'Bearer token-admin-b')
      .set('X-Company-Id', COMPANY_B_ID)
      .send({
        fileName: 'beta-square.jpg',
        base64Data: `data:image/jpeg;base64,${logoB.toString('base64')}`,
      });
    expect(upB.status).toBe(201);

    // Create Company C (Admin A also owns Company C, with NO logo uploaded)
    const regC = await request(app)
      .post('/api/v2/auth/register-company')
      .set('Authorization', 'Bearer token-admin-a')
      .send({
        companyName: 'Gamma Advisory',
        primaryColour: '#1E293B',
        secondaryColour: '#0EA5E9',
      });
    expect(regC.status).toBe(201);
    const companyCId = regC.body.company.id as string;

    // Cross-tenant isolation: Company A admin cannot fetch Company B logo asset
    const crossAsset = await request(app)
      .get('/api/v2/tenant/company/logo/asset')
      .set('Authorization', 'Bearer token-admin-a')
      .set('X-Company-Id', COMPANY_B_ID);
    expect(crossAsset.status).toBe(403);

    // Simulate switching Company A -> Company C -> refresh -> sign-out & sign-in as Company B admin
    const makeTestApiFetch = (token: string) => {
      return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const headers = new Headers(init?.headers || {});
        const targetCompany = headers.get('X-Company-Id') || '';
        const res = await request(app)
          .get(String(input).replace(/^https?:\/\/[^/]+/, ''))
          .set('Authorization', `Bearer ${token}`)
          .set('X-Company-Id', targetCompany);
        const bodyBuf = Buffer.isBuffer(res.body)
          ? res.body
          : Buffer.from(res.text || '', 'utf8');
        return new Response(new Uint8Array(bodyBuf), {
          status: res.status,
          headers: { 'Content-Type': String(res.headers['content-type'] || 'application/octet-stream') },
        });
      };
    };

    // Session 1 (User A, Company A) after refresh
    const meA = await request(app)
      .get('/api/v2/tenant/me')
      .set('Authorization', 'Bearer token-admin-a')
      .set('X-Company-Id', COMPANY_A_ID);
    expect(meA.status).toBe(200);
    const resolvedA = await resolveExportBrand(toExportBrandOptions(meA.body.activeCompany), {
      apiFetchImpl: makeTestApiFetch('token-admin-a'),
    });
    expect(resolvedA?.logoAsset?.ext).toBe('png');
    expect(Buffer.from(resolvedA!.logoAsset!.bytes)).toEqual(logoA);

    // User A switches to Company C (no logo)
    const meC = await request(app)
      .get('/api/v2/tenant/me')
      .set('Authorization', 'Bearer token-admin-a')
      .set('X-Company-Id', companyCId);
    expect(meC.status).toBe(200);
    const resolvedC = await resolveExportBrand(toExportBrandOptions(meC.body.activeCompany), {
      apiFetchImpl: makeTestApiFetch('token-admin-a'),
    });
    expect(resolvedC?.companyName).toBe('Gamma Advisory');
    expect(resolvedC?.logoAsset).toBeUndefined();

    // Sign out & sign back in as User B (Company B)
    const meB = await request(app)
      .get('/api/v2/tenant/me')
      .set('Authorization', 'Bearer token-admin-b')
      .set('X-Company-Id', COMPANY_B_ID);
    expect(meB.status).toBe(200);
    const resolvedB = await resolveExportBrand(toExportBrandOptions(meB.body.activeCompany), {
      apiFetchImpl: makeTestApiFetch('token-admin-b'),
    });
    expect(resolvedB?.logoAsset?.ext).toBe('jpg');
    expect(Buffer.from(resolvedB!.logoAsset!.bytes)).toEqual(logoB);

    // Temporary blob: preview URLs or 404/HTML error responses fail gracefully without throwing
    const blobGraceful = await resolveExportBrand(
      { companyName: 'Broken Brand', logoUrl: 'blob:https://app.test/temp-preview' },
      {
        fetchImpl: (async () => new Response('<html>404</html>', { status: 404 })) as typeof fetch,
      }
    );
    expect(blobGraceful?.logoAsset).toBeUndefined();

    const htmlErrorGraceful = await resolveExportBrand(
      { companyName: 'Broken Remote Brand', logoUrl: 'https://cdn.example.test/missing.png' },
      {
        fetchImpl: (async () => new Response('<html>Error</html>', { status: 200 })) as typeof fetch,
      }
    );
    expect(htmlErrorGraceful?.logoAsset).toBeUndefined();
  });

  it('embeds exact company-specific logos into actual DOCX, HTML/Print, SCORM 1.2 ZIP, Template DOCX, and LMS JSON exports with zero cross-company leakage', async () => {
    const logoABytes = createSyntheticPng(200, 50, [5, 43, 102, 255]);
    const logoBBytes = createSyntheticJpeg(80, 80, 0x99);

    const brandA = await resolveExportBrand({
      companyId: COMPANY_A_ID,
      companyName: 'Acme Training Co',
      primaryColour: '#052B66',
      secondaryColour: '#45CC42',
      logoUrl: `data:image/png;base64,${logoABytes.toString('base64')}`,
    });
    const brandB = await resolveExportBrand({
      companyId: COMPANY_B_ID,
      companyName: 'Beta Learning Ltd',
      primaryColour: '#7C2D12',
      secondaryColour: '#F59E0B',
      logoUrl: `data:image/jpeg;base64,${logoBBytes.toString('base64')}`,
    });
    const brandC = await resolveExportBrand({
      companyId: '33333333-3333-4333-8333-333333333333',
      companyName: 'Gamma Advisory',
      primaryColour: '#1E293B',
      secondaryColour: '#38BDF8',
      logoUrl: null,
    });

    const project = buildSampleCourseProject();
    project.content.courseIntroduction = {
      whyThisMatters: 'Accurate personal information handling prevents compliance breaches.',
      intendedLearners: 'Operational managers and HR leads.',
      prerequisitesSummary: 'Standard induction completed.',
      outcomesOverview: 'Evaluate lawful grounds and implement technical safeguards.',
      structureRoadmap: 'One core module followed by practical workplace audit.',
      assessmentOverview: '50% Knowledge Check and 50% Practical Safeguard Audit.',
    };

    const deliverableTypes: Array<Exclude<DeliverableType, 'lms_package'>> = [
      'complete_course',
      'learner_manual',
      'facilitator_guide',
      'assessment_document',
      'marking_guide',
      'curriculum_overview',
      'alignment_matrix',
      'qa_report',
      'source_register',
    ];

    // 1. Audit ALL 9 DOCX deliverables for Company A, Company B, and Company C (no logo)
    for (const deliverableType of deliverableTypes) {
      const docxA = await Packer.toBuffer(buildDeliverableDocxDocument(project, deliverableType, brandA));
      const zipA = extractZipEntries(docxA);
      const mediaA = Array.from(zipA.keys()).filter(k => k.startsWith('word/media/'));
      expect(mediaA.length).toBe(1);
      expect(zipA.get(mediaA[0])).toEqual(logoABytes);
      const xmlA = zipA.get('word/document.xml')!.toString('utf8');
      const footerA = zipA.get('word/footer1.xml')!.toString('utf8');
      expect(xmlA).toContain('Acme Training Co');
      expect(xmlA).not.toContain('Beta Learning Ltd');
      expect(footerA).toContain('Acme Training Co');
      // 160x40 px converted to EMUs (1 px = 9525 EMU) preserves 4:1 aspect ratio
      expect(xmlA).toContain('cx="1524000" cy="381000"');

      const docxB = await Packer.toBuffer(buildDeliverableDocxDocument(project, deliverableType, brandB));
      const zipB = extractZipEntries(docxB);
      const mediaB = Array.from(zipB.keys()).filter(k => k.startsWith('word/media/'));
      expect(mediaB.length).toBe(1);
      expect(zipB.get(mediaB[0])).toEqual(logoBBytes);
      expect(zipB.get(mediaB[0])).not.toEqual(logoABytes);
      const xmlB = zipB.get('word/document.xml')!.toString('utf8');
      expect(xmlB).toContain('Beta Learning Ltd');
      expect(xmlB).not.toContain('Acme Training Co');
      // 52x52 px preserves 1:1 aspect ratio
      expect(xmlB).toContain('cx="495300" cy="495300"');

      const docxC = await Packer.toBuffer(buildDeliverableDocxDocument(project, deliverableType, brandC));
      const zipC = extractZipEntries(docxC);
      const mediaC = Array.from(zipC.keys()).filter(k => k.startsWith('word/media/'));
      expect(mediaC.length).toBe(0);
      const xmlC = zipC.get('word/document.xml')!.toString('utf8');
      expect(xmlC).toContain('Gamma Advisory');
      expect(xmlC).toContain('>GA<'); // clean monogram fallback

      // 2. Audit ALL 9 HTML & Print/PDF documents
      const htmlA = buildDeliverableHtmlDocument(project, deliverableType, brandA);
      expect(htmlA).toContain(brandA!.logoAsset!.dataUri);
      expect(htmlA).not.toContain(brandB!.logoAsset!.dataUri);
      expect(htmlA).toContain('Acme Training Co');
      expect(htmlA).toContain('object-fit: contain');
      expect(htmlA).toContain('@media print');

      const htmlB = buildDeliverableHtmlDocument(project, deliverableType, brandB);
      expect(htmlB).toContain(brandB!.logoAsset!.dataUri);
      expect(htmlB).not.toContain(brandA!.logoAsset!.dataUri);
      expect(htmlB).toContain('Beta Learning Ltd');

      const htmlC = buildDeliverableHtmlDocument(project, deliverableType, brandC);
      expect(htmlC).not.toContain('<img ');
      expect(htmlC).toContain('logo-monogram');
      expect(htmlC).toContain('>GA<');
      expect(htmlC).toContain('Gamma Advisory');
    }

    // 3. Audit actual extracted SCORM 1.2 (.zip) packages for A, B, and C
    const scormZipA = extractZipEntries(buildScorm12ZipBytes(project, brandA));
    expect(scormZipA.get('assets/company-logo.png')).toEqual(logoABytes);
    expect(scormZipA.has('assets/company-logo.jpg')).toBe(false);
    const manifestA = scormZipA.get('imsmanifest.xml')!.toString('utf8');
    expect(manifestA).toContain('<file href="assets/company-logo.png"/>');
    for (const scoName of ['index.html', 'module-1.html', 'assessments.html']) {
      const scoHtml = scormZipA.get(scoName)!.toString('utf8');
      expect(scoHtml).toContain('src="assets/company-logo.png"');
      expect(scoHtml).toContain('Acme Training Co');
      expect(scoHtml).not.toContain('Beta Learning Ltd');
    }
    const courseDataA = JSON.parse(scormZipA.get('course-data.json')!.toString('utf8'));
    expect(courseDataA.companyName).toBe('Acme Training Co');
    expect(courseDataA.logoAssetPath).toBe('assets/company-logo.png');

    const scormZipB = extractZipEntries(buildScorm12ZipBytes(project, brandB));
    expect(scormZipB.get('assets/company-logo.jpg')).toEqual(logoBBytes);
    expect(scormZipB.has('assets/company-logo.png')).toBe(false);
    const manifestB = scormZipB.get('imsmanifest.xml')!.toString('utf8');
    expect(manifestB).toContain('<file href="assets/company-logo.jpg"/>');
    for (const scoName of ['index.html', 'module-1.html', 'assessments.html']) {
      const scoHtml = scormZipB.get(scoName)!.toString('utf8');
      expect(scoHtml).toContain('src="assets/company-logo.jpg"');
      expect(scoHtml).toContain('Beta Learning Ltd');
      expect(scoHtml).not.toContain('Acme Training Co');
    }

    const scormZipC = extractZipEntries(buildScorm12ZipBytes(project, brandC));
    expect(Array.from(scormZipC.keys()).some(k => k.startsWith('assets/company-logo'))).toBe(false);
    expect(scormZipC.get('imsmanifest.xml')!.toString('utf8')).not.toContain('assets/company-logo');
    expect(scormZipC.get('index.html')!.toString('utf8')).toContain('logo-monogram');
    expect(scormZipC.get('index.html')!.toString('utf8')).toContain('>GA<');

    // Keep test covering buildScorm12ZipEntries direct Course Introduction check
    const scormEntriesA = buildScorm12ZipEntries(project, brandA);
    const indexEntryA = scormEntriesA.find(e => e.name === 'index.html');
    const indexTextA =
      typeof indexEntryA?.content === 'string'
        ? indexEntryA.content
        : new TextDecoder().decode(indexEntryA!.content);
    expect(indexTextA).toContain('Course Introduction');
    expect(indexTextA).toContain('Accurate personal information handling prevents compliance breaches.');

    // 4. Audit Fillable Word Template DOCX (both Master v9 and Standard/Custom templates)
    const v9Template = SYSTEM_TEMPLATES[0];
    const customTemplate = SYSTEM_TEMPLATES[1] || SYSTEM_TEMPLATES[0];

    for (const tpl of [v9Template, customTemplate]) {
      const tplDocxA = await Packer.toBuffer(buildTemplateDocxDocument(tpl, project, brandA));
      const tplZipA = extractZipEntries(tplDocxA);
      const tplMediaA = Array.from(tplZipA.keys()).filter(k => k.startsWith('word/media/'));
      expect(tplMediaA.length).toBe(1);
      expect(tplZipA.get(tplMediaA[0])).toEqual(logoABytes);
      expect(tplZipA.get('word/document.xml')!.toString('utf8')).toContain('Acme Training Co');

      const tplDocxB = await Packer.toBuffer(buildTemplateDocxDocument(tpl, project, brandB));
      const tplZipB = extractZipEntries(tplDocxB);
      const tplMediaB = Array.from(tplZipB.keys()).filter(k => k.startsWith('word/media/'));
      expect(tplMediaB.length).toBe(1);
      expect(tplZipB.get(tplMediaB[0])).toEqual(logoBBytes);
      expect(tplZipB.get('word/document.xml')!.toString('utf8')).toContain('Beta Learning Ltd');

      const tplDocxC = await Packer.toBuffer(buildTemplateDocxDocument(tpl, project, brandC));
      const tplZipC = extractZipEntries(tplDocxC);
      const tplMediaC = Array.from(tplZipC.keys()).filter(k => k.startsWith('word/media/'));
      expect(tplMediaC.length).toBe(0);
      expect(tplZipC.get('word/document.xml')!.toString('utf8')).toContain('Gamma Advisory');
    }

    // 5. Audit LMS Structured Data JSON export
    const lmsA = buildLmsPackageData(project, brandA);
    expect(lmsA.branding.companyName).toBe('Acme Training Co');
    expect(lmsA.branding.embeddedLogoDataUri).toBe(brandA!.logoAsset!.dataUri);

    const lmsB = buildLmsPackageData(project, brandB);
    expect(lmsB.branding.companyName).toBe('Beta Learning Ltd');
    expect(lmsB.branding.embeddedLogoDataUri).toBe(brandB!.logoAsset!.dataUri);
    expect(lmsB.branding.embeddedLogoDataUri).not.toBe(brandA!.logoAsset!.dataUri);

    const lmsC = buildLmsPackageData(project, brandC);
    expect(lmsC.branding.companyName).toBe('Gamma Advisory');
    expect(lmsC.branding.embeddedLogoDataUri).toBeUndefined();

    // Ensure sha256 hashes of extracted Company A vs Company B assets are distinct
    const hashA = crypto.createHash('sha256').update(logoABytes).digest('hex');
    const hashB = crypto.createHash('sha256').update(logoBBytes).digest('hex');
    expect(hashA).not.toBe(hashB);
  });
});
