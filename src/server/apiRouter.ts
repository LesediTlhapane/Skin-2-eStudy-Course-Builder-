import express from 'express';
import {
  checkKeysConfigured,
  getBackupModelForProvider,
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
  generateCourseIntroductionWithAI,
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
import {
  aiUsageContextStorage,
  getSupabaseAdminClient,
  isSupabaseServerConfigured,
} from './supabaseAdmin.js';
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
  if (msg.includes('503') || msg.includes('overloaded') || msg.includes('temporarily unavailable')) return 503;
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

export interface RateLimitConsumeResult {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  consume(key: string, maxRequests: number, windowMs: number): Promise<RateLimitConsumeResult>;
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
}

export class RateLimitStoreUnavailableError extends Error {
  constructor(
    message = 'Distributed rate limit store unavailable.',
    public readonly storeName: string = 'shared_store'
  ) {
    super(message);
    this.name = 'RateLimitStoreUnavailableError';
  }
}

function logRateLimitFailure(details: {
  store: string;
  reason: string;
  statusCode?: number;
  errorCode?: string;
}): void {
  console.error(
    JSON.stringify({
      level: 'error',
      component: 'rate_limiter',
      timestamp: new Date().toISOString(),
      store: details.store,
      reason: details.reason,
      ...(typeof details.statusCode === 'number' ? { statusCode: details.statusCode } : {}),
      ...(details.errorCode ? { errorCode: details.errorCode } : {}),
    })
  );
}

export class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, number[]>();

  async consume(
    key: string,
    maxRequests: number,
    windowMs: number
  ): Promise<RateLimitConsumeResult> {
    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = (this.buckets.get(key) || []).filter(t => t > cutoff);

    if (timestamps.length >= maxRequests) {
      const oldest = timestamps[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      return { allowed: false, count: timestamps.length, retryAfterSeconds };
    }

    timestamps.push(now);
    this.buckets.set(key, timestamps);
    if (this.buckets.size > 1000) {
      for (const [k, list] of this.buckets.entries()) {
        if (list.every(t => t <= cutoff)) this.buckets.delete(k);
      }
    }
    return {
      allowed: true,
      count: timestamps.length,
      retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
    };
  }
}

export interface SharedRateLimitStoreOptions {
  failClosed?: boolean;
  fallback?: RateLimitStore;
  getAdminClient?: () => {
    rpc: (
      fn: string,
      params?: Record<string, unknown>
    ) => PromiseLike<{ data: any; error: { code?: string; message?: string } | null }>;
  };
}

function normalizeStoreOptions(
  arg?: RateLimitStore | SharedRateLimitStoreOptions
): {
  failClosed: boolean;
  fallback?: RateLimitStore;
  getAdminClient?: SharedRateLimitStoreOptions['getAdminClient'];
} {
  if (!arg) {
    return { failClosed: isProductionRuntime() };
  }
  if (typeof (arg as RateLimitStore).consume === 'function') {
    return {
      failClosed: isProductionRuntime(),
      fallback: arg as RateLimitStore,
    };
  }
  const opts = arg as SharedRateLimitStoreOptions;
  return {
    failClosed: opts.failClosed ?? isProductionRuntime(),
    fallback: opts.fallback,
    getAdminClient: opts.getAdminClient,
  };
}

export class SupabaseRateLimitStore implements RateLimitStore {
  private warnedFallback = false;
  private rpcUnavailableUntil = 0;
  private readonly failClosed: boolean;
  private readonly fallback: RateLimitStore;
  private readonly getAdminClient: NonNullable<SharedRateLimitStoreOptions['getAdminClient']>;

  constructor(storeOptions?: RateLimitStore | SharedRateLimitStoreOptions) {
    const normalized = normalizeStoreOptions(storeOptions);
    this.failClosed = normalized.failClosed;
    this.fallback = normalized.fallback || new MemoryRateLimitStore();
    this.getAdminClient = normalized.getAdminClient || (() => getSupabaseAdminClient());
  }

  private async handleStoreError(
    reason: string,
    key: string,
    maxRequests: number,
    windowMs: number,
    errorCode?: string
  ): Promise<RateLimitConsumeResult> {
    if (this.failClosed) {
      logRateLimitFailure({ store: 'supabase_rpc', reason, errorCode });
      throw new RateLimitStoreUnavailableError(
        'Distributed rate limit store unavailable.',
        'supabase_rpc'
      );
    }
    if (errorCode === 'PGRST202') {
      // Migration 004_rate_limits.sql not yet applied or schema cache pending: avoid hitting RPC on every dev request
      this.rpcUnavailableUntil = Date.now() + 5 * 60_000;
    }
    if (!this.warnedFallback) {
      this.warnedFallback = true;
      const hint =
        errorCode === 'PGRST202'
          ? 'Apply supabase/migrations/004_rate_limits.sql to enable distributed Supabase rate limiting.'
          : `errorCode=${errorCode || reason}`;
      console.warn(
        `Supabase consume_rate_limit RPC unavailable in non-production (${hint}); falling back to local memory store.`
      );
    }
    return this.fallback.consume(key, maxRequests, windowMs);
  }

  async consume(
    key: string,
    maxRequests: number,
    windowMs: number
  ): Promise<RateLimitConsumeResult> {
    if (!this.failClosed && Date.now() < this.rpcUnavailableUntil) {
      return this.fallback.consume(key, maxRequests, windowMs);
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const admin = this.getAdminClient();
        const { data, error } = await admin.rpc('consume_rate_limit', {
          p_key: key,
          p_max_requests: Math.max(1, Math.round(maxRequests)),
          p_window_ms: Math.max(1000, Math.round(windowMs)),
        });
        if (error) {
          // Do not retry schema-missing errors (PGRST202); fail over/closed immediately
          if (attempt === 0 && error.code !== 'PGRST202' && /timeout|502|503|504|temporarily|connection/i.test(String(error.message || ''))) {
            await new Promise(resolve => setTimeout(resolve, 150));
            continue;
          }
          return this.handleStoreError('rpc_error', key, maxRequests, windowMs, error.code || 'rpc_error');
        }
        this.rpcUnavailableUntil = 0;
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) {
          return this.handleStoreError('empty_rpc_result', key, maxRequests, windowMs);
        }
        return {
          allowed: Boolean(row.allowed),
          count: Number(row.current_count || 1),
          retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds || 1)),
        };
      } catch {
        if (attempt === 0) {
          await new Promise(resolve => setTimeout(resolve, 150));
          continue;
        }
        return this.handleStoreError('runtime_error', key, maxRequests, windowMs);
      }
    }

    return this.handleStoreError('runtime_error', key, maxRequests, windowMs);
  }
}

export function validateRateLimitConfiguration(options?: {
  injectedStore?: RateLimitStore;
}): { mode: 'supabase' | 'memory' | 'custom'; production: boolean } {
  const production = isProductionRuntime();
  const explicitMode = String(process.env.RATE_LIMIT_STORE || '').trim().toLowerCase();

  if (production && explicitMode === 'memory') {
    logRateLimitFailure({
      store: 'startup',
      reason: 'memory_store_explicitly_rejected_in_production',
    });
    throw new Error('MemoryRateLimitStore is not permitted in production.');
  }

  if (options?.injectedStore) {
    if (production && options.injectedStore instanceof MemoryRateLimitStore) {
      logRateLimitFailure({
        store: 'startup',
        reason: 'memory_store_rejected_in_production',
      });
      throw new Error('MemoryRateLimitStore is not permitted in production.');
    }
    return { mode: 'custom', production };
  }

  if (isSupabaseServerConfigured()) {
    return { mode: 'supabase', production };
  }

  if (production) {
    logRateLimitFailure({ store: 'startup', reason: 'supabase_rate_limit_store_not_configured' });
    throw new Error(
      'Production rate limiting requires Supabase PostgreSQL: configure SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY, and apply supabase/migrations/004_rate_limits.sql.'
    );
  }

  return { mode: 'memory', production };
}

export function resolveDefaultRateLimitStore(): RateLimitStore {
  const config = validateRateLimitConfiguration();
  const failClosed = config.production;

  if (config.mode === 'supabase') {
    return new SupabaseRateLimitStore({ failClosed });
  }
  return new MemoryRateLimitStore();
}

function normalizeClientIp(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return 'local';
  return trimmed.replace(/^::ffff:/i, '');
}

export function resolveTrustedClientIp(req: express.Request): string {
  const trustProxy =
    Boolean(typeof req.app?.get === 'function' && req.app.get('trust proxy')) ||
    process.env.VERCEL === '1';

  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    const firstFwd = Array.isArray(fwd)
      ? fwd[0]
      : String(fwd || '')
          .split(',')[0]
          .trim();
    if (firstFwd) {
      return normalizeClientIp(firstFwd);
    }
  }

  return normalizeClientIp(req.ip || req.socket?.remoteAddress || 'local');
}

export function buildRateLimitKey(req: express.Request): string {
  const clientIp = resolveTrustedClientIp(req);
  const reqPath = String(req.path || req.originalUrl || '');
  const authReq = req as AuthenticatedRequest;

  if (reqPath.startsWith('/auth/') || reqPath.startsWith('/v2/auth/')) {
    return `v2:auth:ip:${clientIp}`;
  }

  // Only trust server-verified identity for tenant/user rate-limit buckets.
  // Unverified Authorization headers must NEVER carve out separate bypass buckets.
  if (authReq.tenantAuth) {
    return `v2:tenant:${authReq.tenantAuth.companyId.toLowerCase()}:user:${authReq.tenantAuth.userId}`;
  }
  if (authReq.userSession) {
    return `v2:user:${authReq.userSession.userId}`;
  }

  return `v2:ip:${clientIp}`;
}

async function enforceRateLimitBucket(
  store: RateLimitStore,
  key: string,
  maxRequests: number,
  windowMs: number,
  res: express.Response
): Promise<'allowed' | 'blocked' | 'unavailable'> {
  try {
    const result = await store.consume(key, maxRequests, windowMs);
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
      res.status(429).json({
        success: false,
        error: `Too many requests (${maxRequests}/min limit). Please wait ${result.retryAfterSeconds}s and retry.`,
        retryAfterSeconds: result.retryAfterSeconds,
      });
      return 'blocked';
    }
    return 'allowed';
  } catch (err) {
    const storeName =
      err instanceof RateLimitStoreUnavailableError ? err.storeName : 'rate_limit_store';
    logRateLimitFailure({
      store: storeName,
      reason: 'rate_limit_enforcement_unavailable',
      statusCode: 503,
    });
    if (isProductionRuntime() || err instanceof RateLimitStoreUnavailableError) {
      res.status(503).json({
        success: false,
        code: 'RATE_LIMIT_UNAVAILABLE',
        error:
          'Service temporarily unavailable while verifying request rate limits. Please retry shortly.',
      });
      return 'unavailable';
    }
    return 'allowed';
  }
}

export function resolveConfiguredRateLimitMax(explicitMax?: number): number {
  const envMax = Number(
    process.env.RATE_LIMIT_MAX_PER_MIN || process.env.RATE_LIMIT_MAX_PER_LIMIT
  );
  return (
    explicitMax ||
    Math.max(5, Number.isFinite(envMax) && envMax > 0 ? Math.round(envMax) : 60)
  );
}

export function createRateLimiter(options?: {
  maxRequests?: number;
  windowMs?: number;
  store?: RateLimitStore;
}) {
  validateRateLimitConfiguration({ injectedStore: options?.store });
  const maxRequests = resolveConfiguredRateLimitMax(options?.maxRequests);
  const windowMs = options?.windowMs || 60_000;
  const store = options?.store || resolveDefaultRateLimitStore();
  if (isProductionRuntime() && store instanceof MemoryRateLimitStore) {
    throw new Error('MemoryRateLimitStore is not permitted in production.');
  }

  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = buildRateLimitKey(req);
    const hasBearerHeader = String(req.headers.authorization || '').trim().toLowerCase().startsWith('bearer ');
    const isAuthPath = key.startsWith('v2:auth:ip:');

    // Pre-auth IP ceiling allows corporate NAT sharing for Bearer-authenticated requests
    // (exact per-user/per-tenant limits are enforced post-auth via verified session identity).
    const preAuthLimit =
      !isAuthPath && hasBearerHeader ? Math.max(maxRequests * 5, maxRequests + 20) : maxRequests;
    const preAuthKey = !isAuthPath && hasBearerHeader ? `v2:nat:${key}` : key;

    const status = await enforceRateLimitBucket(store, preAuthKey, preAuthLimit, windowMs, res);
    if (status === 'allowed') {
      return next();
    }
    return;
  };
}

export function createPostAuthRateLimiter(options?: {
  maxRequests?: number;
  windowMs?: number;
  store?: RateLimitStore;
}) {
  const maxRequests = resolveConfiguredRateLimitMax(options?.maxRequests);
  const windowMs = options?.windowMs || 60_000;
  const store = options?.store || resolveDefaultRateLimitStore();

  return async (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
    if (!req.tenantAuth && !req.userSession) {
      return next();
    }
    const key = buildRateLimitKey(req);
    const status = await enforceRateLimitBucket(store, key, maxRequests, windowMs, res);
    if (status === 'allowed') {
      return next();
    }
    return;
  };
}

export function createAiConcurrencyLimiter(options?: {
  maxPerUser?: number;
  maxPerCompany?: number;
}) {
  const envUser = Number(process.env.MAX_CONCURRENT_AI_PER_USER);
  const envCompany = Number(process.env.MAX_CONCURRENT_AI_PER_COMPANY);
  const maxPerUser =
    options?.maxPerUser ||
    Math.min(10, Math.max(1, Number.isFinite(envUser) && envUser > 0 ? Math.round(envUser) : 2));
  const maxPerCompany =
    options?.maxPerCompany ||
    Math.min(
      25,
      Math.max(maxPerUser, Number.isFinite(envCompany) && envCompany > 0 ? Math.round(envCompany) : 5)
    );

  const userActive = new Map<string, number>();
  const companyActive = new Map<string, number>();

  return (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
    const auth = req.tenantAuth;
    if (!auth) {
      return next();
    }

    const userKey = `${auth.companyId}:${auth.userId}`;
    const companyKey = auth.companyId;
    const currentUser = userActive.get(userKey) || 0;
    const currentCompany = companyActive.get(companyKey) || 0;

    if (currentUser >= maxPerUser) {
      res.setHeader('Retry-After', '5');
      return res.status(429).json({
        success: false,
        code: 'AI_CONCURRENCY_LIMIT',
        scope: 'user',
        retryAfterSeconds: 5,
        error: `Too many concurrent AI requests for your user account (limit: ${maxPerUser}). Please wait for an active generation to finish and retry.`,
      });
    }

    if (currentCompany >= maxPerCompany) {
      res.setHeader('Retry-After', '5');
      return res.status(429).json({
        success: false,
        code: 'AI_CONCURRENCY_LIMIT',
        scope: 'company',
        retryAfterSeconds: 5,
        error: `Your workspace has reached the concurrent AI generation limit (${maxPerCompany} active jobs). Please retry in a few seconds.`,
      });
    }

    userActive.set(userKey, currentUser + 1);
    companyActive.set(companyKey, currentCompany + 1);

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const u = (userActive.get(userKey) || 1) - 1;
      if (u <= 0) userActive.delete(userKey);
      else userActive.set(userKey, u);

      const c = (companyActive.get(companyKey) || 1) - 1;
      if (c <= 0) companyActive.delete(companyKey);
      else companyActive.set(companyKey, c);
    };

    res.once('finish', release);
    res.once('close', release);
    return next();
  };
}

function runWithAiTelemetry<T>(
  req: AuthenticatedRequest,
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const auth = req.tenantAuth;
  const preferBackupModel = Boolean(req.body?.useBackupModel);
  if (!auth?.companyId && !preferBackupModel) return fn();
  return aiUsageContextStorage.run(
    {
      companyId: auth?.companyId || '',
      userId: auth?.userId,
      operation,
      preferBackupModel,
    },
    fn
  );
}

export function createApiRouter(options?: {
  rateLimitMaxPerMin?: number;
  rateLimitStore?: RateLimitStore;
  tenantDeps?: TenantRouterDependencies;
  aiConcurrency?: { maxPerUser?: number; maxPerCompany?: number };
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
      backupModel: getBackupModelForProvider('groq'),
    });
  });

  validateRateLimitConfiguration({ injectedStore: options?.rateLimitStore });
  const sharedRateLimitStore = options?.rateLimitStore || resolveDefaultRateLimitStore();

  router.use(
    '/v2',
    createRateLimiter({
      maxRequests: options?.rateLimitMaxPerMin,
      store: sharedRateLimitStore,
    })
  );

  const postAuthRateLimit = createPostAuthRateLimiter({
    maxRequests: options?.rateLimitMaxPerMin,
    store: sharedRateLimitStore,
  });

  // Attach multi-tenant onboarding, workspace, RBAC, storage, and persistence routes
  attachTenantRoutes(router, {
    ...options?.tenantDeps,
    postAuthRateLimit,
  });

  const baseTenantAuth = createTenantAuthMiddleware(options?.tenantDeps?.authVerifier);
  const requireTenantAuth: express.RequestHandler = (req, res, next) => {
    baseTenantAuth(req, res, (err?: any) => {
      if (err) return next(err);
      return postAuthRateLimit(req as AuthenticatedRequest, res, next);
    });
  };
  const requireEditorRole = requireCompanyRole(['company_admin', 'author', 'reviewer']);
  const requireAuthorOrAdminRole = requireCompanyRole(['company_admin', 'author']);
  const requireAiConcurrencySlot = createAiConcurrencyLimiter(options?.aiConcurrency);

  // Tenant-authenticated AI authoring, QA, Copilot, Source analysis, and Template round-trip endpoints
  router.post(
    '/v2/sources/analyse',
    requireTenantAuth,
    requireAuthorOrAdminRole,
    requireAiConcurrencySlot,
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
    requireAiConcurrencySlot,
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
    requireAuthorOrAdminRole,
    requireAiConcurrencySlot,
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
    requireAuthorOrAdminRole,
    requireAiConcurrencySlot,
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
    requireAiConcurrencySlot,
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
    requireAiConcurrencySlot,
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
    requireAiConcurrencySlot,
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
    requireAiConcurrencySlot,
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
    requireAiConcurrencySlot,
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
    requireAiConcurrencySlot,
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
    requireAiConcurrencySlot,
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
    requireAiConcurrencySlot,
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
    '/v2/content/generate-course-intro',
    requireTenantAuth,
    requireEditorRole,
    requireAiConcurrencySlot,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { project, provider, model } = req.body || {};
        if (!project || typeof project !== 'object' || !project.brief) {
          return res.status(400).json({ success: false, error: 'Missing project payload.' });
        }
        const courseIntroduction = await runWithAiTelemetry(req, 'content.generate_course_intro', () =>
          generateCourseIntroductionWithAI({ project, provider, model })
        );
        return res.json({ success: true, courseIntroduction });
      } catch (err: any) {
        return res.status(resolveErrorStatus(err)).json({
          success: false,
          error: sanitizeErrorMessage(err, 'Course introduction generation failed.'),
        });
      }
    }
  );

  router.post(
    '/v2/content/regenerate',
    requireTenantAuth,
    requireEditorRole,
    requireAiConcurrencySlot,
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
    requireAiConcurrencySlot,
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
    requireAiConcurrencySlot,
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
    requireAiConcurrencySlot,
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
    requireAiConcurrencySlot,
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
    requireAuthorOrAdminRole,
    requireAiConcurrencySlot,
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
