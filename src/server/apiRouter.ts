import express from 'express';
import {
  checkKeysConfigured,
  getRegisteredModels,
  extractUploadedDocumentText,
  analyseSourceDocumentWithAI,
  diagnoseExistingCourseWithAI,
  analyseCourseBriefWithAI,
  proposeCurriculumWithAI,
  auditCurriculumCoverageWithAI,
  generateOutcomesWithAI,
  designAssessmentsWithAI,
  generateModuleContentWithAI,
  generateModuleScaffoldWithAI,
  generateSingleLessonWithAI,
  regenerateComponentWithAI,
  processCopilotChatWithAI,
  draftCourseFromCopilotPromptWithAI,
  extractTemplateFromDocumentWithAI,
  generateOrRefineTemplateWithCopilotAI,
  evaluateCourseQAWithAI,
  remediateCourseQualityWithAI,
  parseFilledTemplateTextDeterministically,
  parseFilledCourseBriefWithAI,
} from './ai/index.js';
import {
  createTenantAuthMiddleware,
  requireCompanyRole,
  type AuthenticatedRequest,
} from './authMiddleware.js';
import { aiUsageContextStorage, isSupabaseServerConfigured } from './supabaseAdmin.js';
import { attachTenantRoutes, type TenantRouterDependencies } from './tenantRoutes.js';

const ALLOWED_UPLOAD_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.csv', '.json'];

export function sanitizeErrorMessage(err: any, fallback = 'Request processing failed.'): string {
  const raw = String(err?.message || err || '').trim();
  if (!raw) return fallback;
  return raw
    .replace(/gsk_[A-Za-z0-9_-]{8,}/g, '[redacted-key]')
    .replace(/AIza[A-Za-z0-9_-]{8,}/g, '[redacted-key]')
    .replace(/sb_[A-Za-z0-9_-]{8,}/g, '[redacted-key]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/\s+at\s+[^\n]+/g, '')
    .replace(/\n+/g, ' ')
    .slice(0, 280)
    .trim() || fallback;
}

function resolveErrorStatus(err: any): number {
  const msg = String(err?.message || '').toLowerCase();
  if (msg.includes('exceeds the 4.5 mb') || msg.includes('payload too large')) return 413;
  if (msg.includes('missing') || msg.includes('invalid request') || msg.includes('unsupported file')) return 400;
  if (msg.includes('401') || msg.includes('403') || msg.includes('authentication') || msg.includes('api key')) return 401;
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota') || msg.includes('tpm')) return 429;
  if (msg.includes('timed out') || msg.includes('timeout')) return 504;
  return 502;
}

function validateUploadPayload(body: any): { error?: string } {
  const { fileName, base64Data, rawText } = body || {};
  if (fileName && typeof fileName !== 'string') {
    return { error: 'Invalid request: fileName must be a string.' };
  }
  if (base64Data !== undefined) {
    if (typeof base64Data !== 'string') {
      return { error: 'Invalid request: base64Data must be a base64 string.' };
    }
    if (fileName) {
      const lower = String(fileName).toLowerCase();
      const dotIdx = lower.lastIndexOf('.');
      const ext = dotIdx >= 0 ? lower.slice(dotIdx) : '';
      if (ext && !ALLOWED_UPLOAD_EXTENSIONS.includes(ext)) {
        return {
          error: `Unsupported file type (${ext}). Allowed formats: ${ALLOWED_UPLOAD_EXTENSIONS.join(', ')}.`,
        };
      }
    }
    const compact = base64Data.replace(/\s+/g, '');
    if (compact.length > 6_200_000) {
      return { error: 'Uploaded file exceeds the 4.5 MB limit.' };
    }
    if (compact.length > 0 && !/^[A-Za-z0-9+/=]+$/.test(compact)) {
      return { error: 'Invalid request: base64Data contains invalid characters.' };
    }
  }
  if (rawText !== undefined && typeof rawText === 'string' && rawText.length > 250_000) {
    return { error: 'Invalid request: Pasted text exceeds 250,000 character limit.' };
  }
  return {};
}

export function createRateLimiter(options?: { maxRequests?: number; windowMs?: number }) {
  const maxRequests =
    options?.maxRequests || Math.max(5, Number(process.env.RATE_LIMIT_MAX_PER_MIN) || 60);
  const windowMs = options?.windowMs || 60_000;
  const buckets = new Map<string, number[]>();

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const fwd = req.headers['x-forwarded-for'];
    const rawIp =
      (Array.isArray(fwd) ? fwd[0] : String(fwd || '').split(',')[0].trim()) ||
      req.ip ||
      'local';
    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = (buckets.get(rawIp) || []).filter(t => t > cutoff);

    if (timestamps.length >= maxRequests) {
      const oldest = timestamps[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        error: `Too many requests (${maxRequests}/min limit). Please wait ${retryAfterSeconds}s and retry.`,
        retryAfterSeconds,
      });
    }

    timestamps.push(now);
    buckets.set(rawIp, timestamps);
    if (buckets.size > 500) {
      for (const [key, list] of buckets.entries()) {
        if (list.every(t => t <= cutoff)) buckets.delete(key);
      }
    }
    return next();
  };
}

function runWithAiTelemetry<T>(
  req: AuthenticatedRequest,
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const auth = req.tenantAuth;
  if (!auth?.companyId) return fn();
  return aiUsageContextStorage.run(
    { companyId: auth.companyId, userId: auth.userId, operation },
    fn
  );
}

export function createApiRouter(options?: {
  rateLimitMaxPerMin?: number;
  tenantDeps?: TenantRouterDependencies;
}): express.Router {
  const router = express.Router();

  router.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.get('/health', (_req, res) => {
    const keys = checkKeysConfigured();
    res.json({
      status: 'ok',
      service: 'eStudy Master Course Builder V2',
      version: '2.0',
      hasGroqKey: keys.groq,
      supabaseConfigured: options?.tenantDeps?.isConfiguredFn
        ? options.tenantDeps.isConfiguredFn()
        : isSupabaseServerConfigured(),
      providers: ['groq'],
    });
  });

  router.get('/ai/models', (_req, res) => {
    const keys = checkKeysConfigured();
    res.json({
      providers: [
        { id: 'groq', name: 'Groq Cloud', isConfigured: keys.groq, keyCount: keys.groqKeyCount },
      ],
      models: getRegisteredModels('groq'),
      keysConfigured: keys,
      defaultProvider: 'groq',
    });
  });

  router.use(
    '/v2',
    createRateLimiter(
      options?.rateLimitMaxPerMin ? { maxRequests: options.rateLimitMaxPerMin } : undefined
    )
  );

  // Attach multi-tenant onboarding, workspace, RBAC, storage, and persistence routes
  attachTenantRoutes(router, options?.tenantDeps);

  const requireTenantAuth = createTenantAuthMiddleware(options?.tenantDeps?.authVerifier);
  const requireEditorRole = requireCompanyRole(['company_admin', 'author', 'reviewer']);

  // Tenant-authenticated AI authoring, QA, Copilot, Source analysis, and Template round-trip endpoints
  router.post(
    '/v2/sources/analyse',
    requireTenantAuth,
    requireEditorRole,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { fileName, mimeType, base64Data, rawText, existingSources, provider, model } = req.body || {};
        if (!fileName && !rawText && !base64Data) {
          return res.status(400).json({ success: false, error: 'Missing document file or text.' });
        }
        const uploadCheck = validateUploadPayload(req.body);
        if (uploadCheck.error) {
          return res.status(400).json({ success: false, error: uploadCheck.error });
        }
        const extractedText = extractUploadedDocumentText({
          fileName: fileName || 'document.txt',
          mimeType,
          base64Data,
          rawText,
        });
        if (!extractedText || extractedText.length < 20) {
          return res.status(400).json({
            success: false,
            error: 'Could not extract readable text from this file. Try pasting text or uploading a text-based PDF/DOCX.',
          });
        }
        const analysis = await runWithAiTelemetry(req, 'sources.analyse', () =>
          analyseSourceDocumentWithAI({
            fileName: fileName || 'Source Document',
            extractedText,
            existingSources,
            provider,
            model,
          })
        );
        return res.json({ success: true, extractedText, ...analysis });
      } catch (err: any) {
        return res
          .status(resolveErrorStatus(err))
          .json({ success: false, error: sanitizeErrorMessage(err, 'Source analysis failed.') });
      }
    }
  );

  router.post(
    '/v2/improve/diagnose',
    requireTenantAuth,
    requireEditorRole,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { fileName, mimeType, base64Data, rawText, provider, model } = req.body || {};
        const uploadCheck = validateUploadPayload(req.body);
        if (uploadCheck.error) {
          return res.status(400).json({ success: false, error: uploadCheck.error });
        }
        const extractedText = extractUploadedDocumentText({
          fileName: fileName || 'existing-course.txt',
          mimeType,
          base64Data,
          rawText,
        });
        if (!extractedText || extractedText.length < 30) {
          return res.status(400).json({
            success: false,
            error: 'Could not extract readable course content. Please upload a DOCX/PDF/TXT or paste the course text.',
          });
        }
        const result = await runWithAiTelemetry(req, 'improve.diagnose', () =>
          diagnoseExistingCourseWithAI({
            fileName: fileName || 'Existing Course',
            extractedText,
            provider,
            model,
          })
        );
        return res.json({ success: true, extractedText, ...result });
      } catch (err: any) {
        return res
          .status(resolveErrorStatus(err))
          .json({ success: false, error: sanitizeErrorMessage(err, 'Course diagnosis failed.') });
      }
    }
  );

  router.post(
    '/v2/templates/extract',
    requireTenantAuth,
    requireEditorRole,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { fileName, mimeType, base64Data, rawText, provider, model } = req.body || {};
        const uploadCheck = validateUploadPayload(req.body);
        if (uploadCheck.error) {
          return res.status(400).json({ success: false, error: uploadCheck.error });
        }
        const extractedText = extractUploadedDocumentText({
          fileName: fileName || 'template.txt',
          mimeType,
          base64Data,
          rawText,
        });
        if (!extractedText || extractedText.length < 20) {
          return res.status(400).json({ success: false, error: 'Could not extract text from uploaded template.' });
        }
        const template = await runWithAiTelemetry(req, 'templates.extract', () =>
          extractTemplateFromDocumentWithAI({
            fileName: fileName || 'Uploaded Template',
            extractedText,
            provider,
            model,
          })
        );
        return res.json({ success: true, template });
      } catch (err: any) {
        return res
          .status(resolveErrorStatus(err))
          .json({ success: false, error: sanitizeErrorMessage(err, 'Template extraction failed.') });
      }
    }
  );

  router.post(
    '/v2/templates/parse-filled',
    requireTenantAuth,
    requireEditorRole,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { fileName, mimeType, base64Data, rawText, template, provider, model } = req.body || {};
        if (!fileName && !rawText && !base64Data) {
          return res.status(400).json({ success: false, error: 'Missing filled template document or text.' });
        }
        const uploadCheck = validateUploadPayload(req.body);
        if (uploadCheck.error) {
          return res.status(400).json({ success: false, error: uploadCheck.error });
        }
        const extractedText = extractUploadedDocumentText({
          fileName: fileName || 'filled-template.docx',
          mimeType,
          base64Data,
          rawText,
        });
        if (!extractedText || extractedText.length < 15) {
          return res.status(400).json({
            success: false,
            error: 'Could not extract readable text from this Word document. Please verify it is a valid .docx, .pdf, or .txt file.',
          });
        }

        const deterministic = parseFilledTemplateTextDeterministically(extractedText, template);
        if (deterministic.populatedCount >= 2 || deterministic.suggestedModules.length > 0) {
          return res.json({
            success: true,
            extractedText,
            ...deterministic,
          });
        }

        const aiParsed = await runWithAiTelemetry(req, 'templates.parse_filled', () =>
          parseFilledCourseBriefWithAI({
            fileName: fileName || 'Filled Template',
            extractedText,
            template,
            provider,
            model,
          })
        );
        return res.json({
          success: true,
          extractedText,
          ...aiParsed,
          matchedTemplateId: aiParsed.matchedTemplateId || deterministic.matchedTemplateId,
          matchedTemplateName: aiParsed.matchedTemplateName || deterministic.matchedTemplateName,
        });
      } catch (err: any) {
        return res
          .status(resolveErrorStatus(err))
          .json({ success: false, error: sanitizeErrorMessage(err, 'Could not parse filled template document.') });
      }
    }
  );

  router.post(
    '/v2/brief/analyse',
    requireTenantAuth,
    requireEditorRole,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { brief, sources, provider, model } = req.body || {};
        if (!brief || typeof brief !== 'object') {
          return res.status(400).json({ success: false, error: 'Missing course brief.' });
        }
        const analysis = await runWithAiTelemetry(req, 'brief.analyse', () =>
          analyseCourseBriefWithAI({ brief, sources: Array.isArray(sources) ? sources : [], provider, model })
        );
        return res.json({ success: true, analysis });
      } catch (err: any) {
        return res.status(resolveErrorStatus(err)).json({ success: false, error: sanitizeErrorMessage(err, 'Brief analysis failed.') });
      }
    }
  );

  router.post(
    '/v2/curriculum/propose',
    requireTenantAuth,
    requireEditorRole,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { brief, sources, desiredModuleCount, existingModules, provider, model } = req.body || {};
        if (!brief || typeof brief !== 'object') {
          return res.status(400).json({ success: false, error: 'Missing course brief.' });
        }
        const curriculum = await runWithAiTelemetry(req, 'curriculum.propose', () =>
          proposeCurriculumWithAI({
            brief,
            sources: Array.isArray(sources) ? sources : [],
            desiredModuleCount,
            existingModules,
            provider,
            model,
          })
        );
        return res.json({ success: true, curriculum });
      } catch (err: any) {
        return res.status(resolveErrorStatus(err)).json({ success: false, error: sanitizeErrorMessage(err, 'Curriculum proposal failed.') });
      }
    }
  );

  router.post(
    '/v2/curriculum/check-coverage',
    requireTenantAuth,
    requireEditorRole,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { brief, sources, curriculum, provider, model } = req.body || {};
        if (!brief || !curriculum) return res.status(400).json({ success: false, error: 'Missing brief or curriculum.' });
        const result = await runWithAiTelemetry(req, 'curriculum.check_coverage', () =>
          auditCurriculumCoverageWithAI({
            brief,
            sources: Array.isArray(sources) ? sources : [],
            curriculum,
            provider,
            model,
          })
        );
        return res.json({ success: true, ...result });
      } catch (err: any) {
        return res.status(resolveErrorStatus(err)).json({ success: false, error: sanitizeErrorMessage(err, 'Coverage check failed.') });
      }
    }
  );

  router.post(
    '/v2/outcomes/generate',
    requireTenantAuth,
    requireEditorRole,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { brief, curriculum, provider, model } = req.body || {};
        if (!brief || !curriculum) return res.status(400).json({ success: false, error: 'Missing brief or curriculum.' });
        const outcomes = await runWithAiTelemetry(req, 'outcomes.generate', () =>
          generateOutcomesWithAI({ brief, curriculum, provider, model })
        );
        return res.json({ success: true, outcomes });
      } catch (err: any) {
        return res.status(resolveErrorStatus(err)).json({ success: false, error: sanitizeErrorMessage(err, 'Outcome generation failed.') });
      }
    }
  );

  router.post(
    '/v2/assessments/design',
    requireTenantAuth,
    requireEditorRole,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { brief, curriculum, outcomes, provider, model } = req.body || {};
        if (!brief || !curriculum || !outcomes) {
          return res.status(400).json({ success: false, error: 'Missing brief, curriculum, or outcomes.' });
        }
        const design = await runWithAiTelemetry(req, 'assessments.design', () =>
          designAssessmentsWithAI({ brief, curriculum, outcomes, provider, model })
        );
        return res.json({ success: true, ...design });
      } catch (err: any) {
        return res.status(resolveErrorStatus(err)).json({ success: false, error: sanitizeErrorMessage(err, 'Assessment design failed.') });
      }
    }
  );

  router.post(
    '/v2/content/generate-module',
    requireTenantAuth,
    requireEditorRole,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { brief, modulePlan, allModules, outcomes, assessments, sources, provider, model } = req.body || {};
        if (!brief || !modulePlan) {
          return res.status(400).json({ success: false, error: 'Missing brief or module plan.' });
        }
        const moduleContent = await runWithAiTelemetry(req, 'content.generate_module', () =>
          generateModuleContentWithAI({
            brief,
            modulePlan,
            allModules: allModules || [modulePlan],
            outcomes,
            assessments: assessments || [],
            sources: sources || [],
            provider,
            model,
          })
        );
        return res.json({ success: true, moduleContent });
      } catch (err: any) {
        return res.status(resolveErrorStatus(err)).json({ success: false, error: sanitizeErrorMessage(err, 'Module content generation failed.') });
      }
    }
  );

  router.post(
    '/v2/content/generate-module-scaffold',
    requireTenantAuth,
    requireEditorRole,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { brief, modulePlan, allModules, outcomes, assessments, sources, provider, model } = req.body || {};
        if (!brief || !modulePlan) {
          return res.status(400).json({ success: false, error: 'Missing brief or module plan.' });
        }
        const moduleContent = await runWithAiTelemetry(req, 'content.generate_module_scaffold', () =>
          generateModuleScaffoldWithAI({
            brief,
            modulePlan,
            allModules: allModules || [modulePlan],
            outcomes: outcomes || { courseOutcomes: [], moduleOutcomes: [], durationRealismNote: '', nqfSummaryNote: '', approval: { approved: false } },
            assessments: assessments || [],
            sources: sources || [],
            provider,
            model,
          })
        );
        return res.json({ success: true, moduleContent });
      } catch (err: any) {
        return res.status(resolveErrorStatus(err)).json({ success: false, error: sanitizeErrorMessage(err, 'Module overview generation failed.') });
      }
    }
  );

  router.post(
    '/v2/content/generate-lesson',
    requireTenantAuth,
    requireEditorRole,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { brief, modulePlan, lessonPlan, lessonIndex, outcomes, sources, provider, model } = req.body || {};
        if (!brief || !modulePlan || !lessonPlan) {
          return res.status(400).json({ success: false, error: 'Missing brief, module plan, or lesson plan.' });
        }
        const lesson = await runWithAiTelemetry(req, 'content.generate_lesson', () =>
          generateSingleLessonWithAI({
            brief,
            modulePlan,
            lessonPlan,
            lessonIndex: Number(lessonIndex) || 0,
            outcomes: outcomes || { courseOutcomes: [], moduleOutcomes: [], durationRealismNote: '', nqfSummaryNote: '', approval: { approved: false } },
            sources: sources || [],
            provider,
            model,
          })
        );
        return res.json({ success: true, lesson });
      } catch (err: any) {
        return res.status(resolveErrorStatus(err)).json({ success: false, error: sanitizeErrorMessage(err, 'Lesson generation failed.') });
      }
    }
  );

  router.post(
    '/v2/content/regenerate',
    requireTenantAuth,
    requireEditorRole,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { project, targetType, moduleId, targetId, instruction, provider, model } = req.body || {};
        if (!project || !targetType || !moduleId) {
          return res.status(400).json({ success: false, error: 'Missing project, targetType, or moduleId.' });
        }
        const result = await runWithAiTelemetry(req, 'content.regenerate', () =>
          regenerateComponentWithAI({
            project,
            targetType,
            moduleId,
            targetId,
            instruction,
            provider,
            model,
          })
        );
        return res.json({ success: true, ...result });
      } catch (err: any) {
        return res.status(resolveErrorStatus(err)).json({ success: false, error: sanitizeErrorMessage(err, 'Selective regeneration failed.') });
      }
    }
  );

  router.post(
    '/v2/qa/evaluate',
    requireTenantAuth,
    requireEditorRole,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { project, weights, provider, model } = req.body || {};
        if (!project || typeof project !== 'object' || !Array.isArray(weights) || weights.length === 0) {
          return res.status(400).json({ success: false, error: 'Missing project or weights array.' });
        }
        const report = await runWithAiTelemetry(req, 'qa.evaluate', () =>
          evaluateCourseQAWithAI({ project, weights, provider, model })
        );
        return res.json({ success: true, report });
      } catch (err: any) {
        return res.status(resolveErrorStatus(err)).json({ success: false, error: sanitizeErrorMessage(err, 'QA evaluation failed.') });
      }
    }
  );

  router.post(
    '/v2/qa/remediate',
    requireTenantAuth,
    requireEditorRole,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { project, provider, model } = req.body || {};
        if (!project || typeof project !== 'object') {
          return res.status(400).json({ success: false, error: 'Missing project payload.' });
        }
        const result = await runWithAiTelemetry(req, 'qa.remediate', () =>
          remediateCourseQualityWithAI({ project, provider, model })
        );
        return res.json({ success: true, ...result });
      } catch (err: any) {
        return res.status(resolveErrorStatus(err)).json({
          success: false,
          error: sanitizeErrorMessage(err, 'Guided QA remediation failed.'),
        });
      }
    }
  );

  router.post(
    '/v2/copilot/chat',
    requireTenantAuth,
    requireEditorRole,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { project, messages, userMessage, selectedTextContext, activeModuleId, provider, model } = req.body || {};
        if (!project || typeof project !== 'object' || !userMessage || !String(userMessage).trim()) {
          return res.status(400).json({ success: false, error: 'Missing project or userMessage.' });
        }
        const result = await runWithAiTelemetry(req, 'copilot.chat', () =>
          processCopilotChatWithAI({
            project,
            messages: Array.isArray(messages) ? messages : [],
            userMessage: String(userMessage).slice(0, 8000),
            selectedTextContext,
            activeModuleId,
            provider,
            model,
          })
        );
        return res.json({ success: true, ...result });
      } catch (err: any) {
        return res.status(resolveErrorStatus(err)).json({ success: false, error: sanitizeErrorMessage(err, 'Copilot chat failed.') });
      }
    }
  );

  router.post(
    '/v2/copilot/draft-course',
    requireTenantAuth,
    requireEditorRole,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { prompt, template, currentBrief, currentModules, messages, provider, model } = req.body || {};
        if (!prompt || !String(prompt).trim()) {
          return res.status(400).json({ success: false, error: 'Missing prompt describing the course.' });
        }
        const result = await runWithAiTelemetry(req, 'copilot.draft_course', () =>
          draftCourseFromCopilotPromptWithAI({
            prompt: String(prompt).trim().slice(0, 8000),
            template,
            currentBrief,
            currentModules,
            messages,
            provider,
            model,
          })
        );
        return res.json({ success: true, ...result });
      } catch (err: any) {
        return res.status(resolveErrorStatus(err)).json({ success: false, error: sanitizeErrorMessage(err, 'Copilot draft failed.') });
      }
    }
  );

  router.post(
    '/v2/templates/copilot-draft',
    requireTenantAuth,
    requireEditorRole,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { prompt, currentTemplate, messages, provider, model } = req.body || {};
        if (!prompt || !String(prompt).trim()) {
          return res.status(400).json({ success: false, error: 'Please describe the template you want to create.' });
        }
        const result = await runWithAiTelemetry(req, 'templates.copilot_draft', () =>
          generateOrRefineTemplateWithCopilotAI({
            prompt: String(prompt).trim().slice(0, 8000),
            currentTemplate: currentTemplate || null,
            messages: Array.isArray(messages) ? messages : [],
            provider,
            model,
          })
        );
        return res.json({ success: true, ...result });
      } catch (err: any) {
        return res
          .status(resolveErrorStatus(err))
          .json({ success: false, error: sanitizeErrorMessage(err, 'Template Copilot failed.') });
      }
    }
  );

  router.use((_req, res) => {
    res.status(404).json({ success: false, error: 'API route not found.' });
  });

  return router;
}
