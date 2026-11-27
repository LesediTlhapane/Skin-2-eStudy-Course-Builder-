import Groq from 'groq-sdk';
import type { AIProviderAdapter, AIRequest, AIResponse } from './types.js';

const PLACEHOLDER_KEYS = new Set([
  'MY_GROQ_API_KEY',
  'MY_SECOND_GROQ_API_KEY',
  'MY_BACKUP_GROQ_API_KEY',
  'YOUR_GROQ_API_KEY',
]);

export function getGroqApiKeys(): string[] {
  const rawSources = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_BACKUP_API_KEY,
    process.env.GROQ_API_KEY_BACKUP,
    process.env.GROQ_API_KEYS,
  ];
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawSources) {
    if (!raw || typeof raw !== 'string') continue;
    const parts = raw
      .split(/[,;\s]+/)
      .map(s => s.trim())
      .filter(Boolean);
    for (const part of parts) {
      if (part.length > 10 && !PLACEHOLDER_KEYS.has(part) && !seen.has(part)) {
        seen.add(part);
        keys.push(part);
      }
    }
  }
  return keys;
}

export const GROQ_BACKUP_MODELS = [
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
  'llama-3.1-8b-instant',
];

const GROQ_FALLBACK_ORDER = [
  'openai/gpt-oss-120b',
  ...GROQ_BACKUP_MODELS,
];

function isRateLimitOrSizeError(err: any): boolean {
  const status = err?.status || err?.statusCode;
  const msg = String(err?.message || '').toLowerCase();
  return (
    status === 429 ||
    status === 413 ||
    msg.includes('429') ||
    msg.includes('413') ||
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('tpm') ||
    msg.includes('tokens per minute') ||
    msg.includes('request too large') ||
    msg.includes('quota')
  );
}

function isModelUnavailableError(err: any): boolean {
  const status = err?.status || err?.statusCode;
  const msg = String(err?.message || '').toLowerCase();
  return (
    status === 404 ||
    msg.includes('model_not_found') ||
    msg.includes('model_decommissioned') ||
    msg.includes('does not exist') ||
    msg.includes('decommissioned') ||
    msg.includes('not supported') ||
    msg.includes('context_length_exceeded') ||
    msg.includes('reduce the length')
  );
}

function isJsonValidationError(err: any): boolean {
  const status = err?.status || err?.statusCode;
  const msg = String(err?.message || '').toLowerCase();
  return (
    status === 400 &&
    (msg.includes('json_validate_failed') ||
      msg.includes('failed to generate json') ||
      msg.includes('response_format'))
  );
}

function isRetryableTransient(err: any): boolean {
  const status = err?.status || err?.statusCode;
  const msg = String(err?.message || '').toLowerCase();
  return (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('service unavailable')
  );
}

function parseRetryDelayMs(err: any): number {
  const headerVal =
    err?.headers?.get?.('retry-after') ??
    err?.headers?.['retry-after'] ??
    err?.headers?.['retry-after-ms'];
  if (headerVal) {
    const num = Number(headerVal);
    if (!Number.isNaN(num) && num > 0) {
      return num > 100 ? num : num * 1000;
    }
  }
  const msg = String(err?.message || '');
  const match = msg.match(/try again in\s+([\d.]+)\s*(ms|s)\b/i);
  if (match) {
    const val = Number(match[1]);
    if (!Number.isNaN(val)) {
      return match[2].toLowerCase() === 'ms' ? val : val * 1000;
    }
  }
  return 0;
}

export class GroqProvider implements AIProviderAdapter {
  provider = 'groq' as const;
  name = 'Groq Cloud';

  isConfigured(): boolean {
    return getGroqApiKeys().length > 0;
  }

  getKeyCount(): number {
    return getGroqApiKeys().length;
  }

  async execute(request: AIRequest): Promise<AIResponse> {
    const apiKeys = getGroqApiKeys();
    if (apiKeys.length === 0) {
      throw new Error('GROQ_API_KEY is not configured in environment secrets.');
    }

    const startTime = Date.now();
    // Cap overall invocation under 48s so Vercel serverless functions return clean JSON before 60s 504
    const totalBudgetMs = Math.min(Math.max(request.timeoutMs || 45000, 10000), 48000);
    const deadline = startTime + totalBudgetMs;

    const primaryModel = request.model?.trim() || 'openai/gpt-oss-120b';
    const envBackupModel = String(process.env.GROQ_BACKUP_MODEL || '').trim();
    const backupList = [
      ...(envBackupModel ? [envBackupModel] : []),
      ...GROQ_BACKUP_MODELS,
    ];
    const modelsToTry = Array.from(
      new Set(
        request.preferBackupModel
          ? [...backupList, primaryModel]
          : [primaryModel, ...backupList, ...GROQ_FALLBACK_ORDER]
      )
    );

    // When explicit backup failover is requested and a secondary API key is configured, rotate backup key first
    const orderedKeys =
      request.preferBackupModel && apiKeys.length > 1
        ? [...apiKeys.slice(1), apiKeys[0]]
        : apiKeys;

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (request.systemInstruction) {
      messages.push({ role: 'system', content: request.systemInstruction });
    }
    messages.push({ role: 'user', content: request.prompt });

    let lastError: any = null;
    let sawRateLimit = false;

    const runCall = async (
      apiKey: string,
      model: string,
      useJsonMode: boolean,
      attemptTimeoutMs: number,
      isBackupAttempt: boolean
    ) => {
      const groq = new Groq({ apiKey });
      const callPromise = groq.chat.completions.create({
        model,
        messages,
        temperature: typeof request.temperature === 'number' ? request.temperature : 0.25,
        max_tokens: request.maxTokens || 8192,
        ...(useJsonMode && request.responseFormat === 'json'
          ? { response_format: { type: 'json_object' } }
          : {}),
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Groq request timed out after ${Math.round(attemptTimeoutMs / 1000)}s`)),
          attemptTimeoutMs
        )
      );
      const completion = await Promise.race([callPromise, timeoutPromise]);
      const text = completion.choices?.[0]?.message?.content || '';
      if (!text.trim()) {
        throw new Error('Groq returned an empty response.');
      }
      return {
        text,
        provider: 'groq' as const,
        model,
        failoverUsed: isBackupAttempt,
        durationMs: Date.now() - startTime,
        usage: completion.usage
          ? {
              inputTokens: completion.usage.prompt_tokens,
              outputTokens: completion.usage.completion_tokens,
            }
          : undefined,
      };
    };

    const deadKeys = new Set<string>();

    for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
      const model = modelsToTry[mIdx];
      const hasRemainingBackupModels = mIdx < modelsToTry.length - 1;
      for (let kIdx = 0; kIdx < orderedKeys.length; kIdx++) {
        const apiKey = orderedKeys[kIdx];
        if (deadKeys.has(apiKey)) continue;
        const remaining = deadline - Date.now();
        if (remaining < 3500) break;

        // Reserve budget for backup models & backup API keys when primary stalls
        const maxPerAttempt = hasRemainingBackupModels ? 16000 : 24000;
        const perModelTimeout = Math.min(maxPerAttempt, remaining - 500);
        const isBackupAttempt = Boolean(request.preferBackupModel) || model !== primaryModel || kIdx > 0;

        try {
          return await runCall(apiKey, model, true, perModelTimeout, isBackupAttempt);
        } catch (err: any) {
          lastError = err;
          if (/401|403|invalid api key|authentication/i.test(String(err?.message || '')) || err?.status === 401) {
            deadKeys.add(apiKey);
            continue;
          }

          // If strict JSON mode rejected, retry immediately without response_format
          if (isJsonValidationError(err)) {
            const remAfter = deadline - Date.now();
            if (remAfter > 4000) {
              try {
                return await runCall(apiKey, model, false, Math.min(16000, remAfter - 500), isBackupAttempt);
              } catch (err2: any) {
                lastError = err2;
              }
            }
            continue;
          }

          if (isModelUnavailableError(err)) {
            break; // skip unavailable/decommissioned model and move immediately to next backup model
          }

          if (isRateLimitOrSizeError(err)) {
            sawRateLimit = true;
            // Rotate to backup API key on same model first, then backup models
            continue;
          }

          if (isRetryableTransient(err)) {
            const remRetry = deadline - Date.now();
            if (remRetry > 5000 && !hasRemainingBackupModels) {
              await new Promise(resolve => setTimeout(resolve, 600));
              try {
                return await runCall(apiKey, model, true, Math.min(18000, deadline - Date.now() - 400), isBackupAttempt);
              } catch (err2: any) {
                lastError = err2;
              }
            }
            continue;
          }
        }
      }
    }

    // Last-chance short backoff if all models/keys hit 429 and retry-after fits safely in budget
    const liveKeys = orderedKeys.filter(k => !deadKeys.has(k));
    if (sawRateLimit && lastError && liveKeys.length > 0) {
      const suggestedWait = parseRetryDelayMs(lastError);
      const waitMs = suggestedWait > 0 ? Math.min(suggestedWait + 350, 7500) : 2500;
      const remaining = deadline - Date.now();
      if (remaining > waitMs + 4500) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
        for (const fallbackModel of backupList) {
          for (const key of liveKeys) {
            const rem = deadline - Date.now();
            if (rem < 4000) break;
            try {
              return await runCall(key, fallbackModel, true, Math.min(16000, rem - 300), true);
            } catch (retryErr: any) {
              lastError = retryErr;
            }
          }
        }
      }
    }

    const msg = lastError?.message || 'Unknown Groq API error';
    if (/401|403|invalid api key|authentication/i.test(msg)) {
      throw new Error('Groq API authentication failed. Please check GROQ_API_KEY.');
    }
    if (sawRateLimit || isRateLimitOrSizeError(lastError)) {
      throw new Error('Groq Cloud rate limit reached. Please retry briefly.');
    }
    throw new Error(`Groq error: ${msg}`);
  }
}

export const groqProvider = new GroqProvider();
