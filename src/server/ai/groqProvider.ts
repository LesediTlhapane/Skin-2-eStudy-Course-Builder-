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

function isRetryable(err: any): boolean {
  const status = err?.status || err?.statusCode;
  const msg = String(err?.message || '').toLowerCase();
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('tpm') ||
    msg.includes('timed out')
  );
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
    const timeoutMs = request.timeoutMs || 60000;
    const model = request.model?.trim() || 'openai/gpt-oss-120b';

    let lastError: any = null;

    for (const apiKey of apiKeys) {
      const groq = new Groq({ apiKey });
      const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
      if (request.systemInstruction) {
        messages.push({ role: 'system', content: request.systemInstruction });
      }
      messages.push({ role: 'user', content: request.prompt });

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const callPromise = groq.chat.completions.create({
            model,
            messages,
            temperature: typeof request.temperature === 'number' ? request.temperature : 0.25,
            max_tokens: request.maxTokens || 8192,
            ...(request.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
          });
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Groq request timed out after ${timeoutMs / 1000}s`)),
              timeoutMs
            )
          );
          const completion = await Promise.race([callPromise, timeoutPromise]);
          const text = completion.choices?.[0]?.message?.content || '';
          if (!text.trim()) {
            throw new Error('Groq returned an empty response.');
          }
          return {
            text,
            provider: 'groq',
            model,
            durationMs: Date.now() - startTime,
            usage: completion.usage
              ? {
                  inputTokens: completion.usage.prompt_tokens,
                  outputTokens: completion.usage.completion_tokens,
                }
              : undefined,
          };
        } catch (err: any) {
          lastError = err;
          if (isRetryable(err) && attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 600));
            continue;
          }
          break;
        }
      }
    }

    const msg = lastError?.message || 'Unknown Groq API error';
    if (/401|invalid api key|authentication/i.test(msg)) {
      throw new Error('Groq API authentication failed. Please check GROQ_API_KEY.');
    }
    if (/429|rate limit|tpm|quota/i.test(msg)) {
      throw new Error('Groq Cloud rate limit reached. Please retry briefly.');
    }
    throw new Error(`Groq error: ${msg}`);
  }
}

export const groqProvider = new GroqProvider();
