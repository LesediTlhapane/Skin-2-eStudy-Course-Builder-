import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface AiUsageContext {
  companyId: string;
  userId?: string | null;
  operation: string;
}

export const aiUsageContextStorage = new AsyncLocalStorage<AiUsageContext>();

const PLACEHOLDER_VALUES = new Set([
  '',
  'YOUR_SUPABASE_URL',
  'https://YOUR_PROJECT_REF.supabase.co',
  'YOUR_SUPABASE_ANON_KEY',
  'YOUR_SUPABASE_SERVICE_ROLE_KEY',
]);

export function resolveSupabaseServerEnv(): {
  url: string;
  serviceRoleKey: string;
  anonKey: string;
  configured: boolean;
} {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();

  const isUrlValid =
    url.startsWith('https://') &&
    !PLACEHOLDER_VALUES.has(url) &&
    !url.includes('YOUR_PROJECT_REF');
  const isServiceValid =
    serviceRoleKey.length > 20 &&
    !PLACEHOLDER_VALUES.has(serviceRoleKey) &&
    !serviceRoleKey.includes('YOUR_SUPABASE');

  return {
    url,
    serviceRoleKey,
    anonKey,
    configured: isUrlValid && isServiceValid,
  };
}

export function isSupabaseServerConfigured(): boolean {
  return resolveSupabaseServerEnv().configured;
}

let cachedAdminClient: SupabaseClient | null = null;
let cachedConfigKey = '';

export function getSupabaseAdminClient(): SupabaseClient {
  const env = resolveSupabaseServerEnv();
  if (!env.configured) {
    throw new Error(
      'Supabase server credentials are not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment variables.'
    );
  }
  const cacheKey = `${env.url}::${env.serviceRoleKey.slice(-8)}`;
  if (!cachedAdminClient || cachedConfigKey !== cacheKey) {
    cachedAdminClient = createClient(env.url, env.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    cachedConfigKey = cacheKey;
  }
  return cachedAdminClient;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
}

export function isValidHexColour(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value.trim());
}

export function sanitizeHttpUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/assets/')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function slugifyCompanyName(name: string): string {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'company-workspace';
}

export function sanitizeStorageSegment(name: string): string {
  return String(name || 'file')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96) || 'document';
}

export function estimateGroqCostUsd(model: string, inputTokens = 0, outputTokens = 0): number {
  const lower = String(model || '').toLowerCase();
  // Conservative approximate per-1M token pricing estimates in USD for usage tracking
  let inputPerMillion = 0.25;
  let outputPerMillion = 0.65;
  if (lower.includes('120b') || lower.includes('70b')) {
    inputPerMillion = 0.59;
    outputPerMillion = 0.79;
  } else if (lower.includes('20b') || lower.includes('8b')) {
    inputPerMillion = 0.08;
    outputPerMillion = 0.12;
  }
  const cost =
    (Math.max(0, inputTokens) / 1_000_000) * inputPerMillion +
    (Math.max(0, outputTokens) / 1_000_000) * outputPerMillion;
  return Number(cost.toFixed(6));
}

export async function recordAiUsage(params: {
  companyId: string;
  userId?: string | null;
  provider: string;
  model: string;
  operation: string;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<void> {
  if (!isSupabaseServerConfigured() || !isValidUuid(params.companyId)) return;
  try {
    const admin = getSupabaseAdminClient();
    const inputTokens = Math.max(0, Math.round(params.inputTokens || 0));
    const outputTokens = Math.max(0, Math.round(params.outputTokens || 0));
    const estimatedCost = estimateGroqCostUsd(params.model, inputTokens, outputTokens);
    await admin.from('ai_usage_records').insert({
      company_id: params.companyId,
      user_id: params.userId && isValidUuid(params.userId) ? params.userId : null,
      provider: params.provider,
      model: params.model,
      operation: params.operation,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost: estimatedCost,
    });
  } catch {
    // Non-blocking telemetry: never interrupt AI authoring on logging hiccups
  }
}
