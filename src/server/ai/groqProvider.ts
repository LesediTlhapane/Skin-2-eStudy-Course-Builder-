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

const GROQ_FALLBACK_ORDER = [
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-20b',
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
    msg.includes('econnreset')
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
  provider: 'groq' = 'groq';
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
    const modelsToTry = [
      primaryModel,
      ...GROQ_FALLBACK_ORDER.filter(m => m !== primaryModel),
    ];

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
      attemptTimeoutMs: number
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

    for (const model of modelsToTry) {
      for (const apiKey of apiKeys) {
        if (deadKeys.has(apiKey)) continue;
        const remaining = deadline - Date.now();
        if (remaining < 3500) break;

        const perModelTimeout = Math.min(24000, remaining - 500);
        try {
          return await runCall(apiKey, model, true, perModelTimeout);
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
                return await runCall(apiKey, model, false, Math.min(20000, remAfter - 500));
              } catch (err2: any) {
                lastError = err2;
              }
            }
            continue;
          }

          if (err?.status === 404 || /model_not_found|does not exist/i.test(String(err?.message || ''))) {
            break; // skip unavailable model on all keys and move to next model
          }

          if (isRateLimitOrSizeError(err)) {
            sawRateLimit = true;
            // Rotate to backup API key on same model first, then fallback models
            continue;
          }

          if (isRetryableTransient(err)) {
            const remRetry = deadline - Date.now();
            if (remRetry > 5000) {
              await new Promise(resolve => setTimeout(resolve, 600));
              try {
                return await runCall(apiKey, model, true, Math.min(20000, deadline - Date.now() - 400));
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
    const liveKeys = apiKeys.filter(k => !deadKeys.has(k));
    if (sawRateLimit && lastError && liveKeys.length > 0) {
      const suggestedWait = parseRetryDelayMs(lastError);
      const waitMs = suggestedWait > 0 ? Math.min(suggestedWait + 300, 4000) : 2200;
      const remaining = deadline - Date.now();
      if (remaining > waitMs + 5000) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
        for (const fallbackModel of ['qwen/qwen3.8-27b', 'openai/gpt-oss-20b']) {
          for (const key of liveKeys) {
            const rem = deadline - Date.now();
            if (rem < 4000) break;
            try {
              return await runCall(key, fallbackModel, true, Math.min(18000, rem - 300));
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
