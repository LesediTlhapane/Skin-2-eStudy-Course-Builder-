import type { AIProvider } from '../../types.js';
import type { AIProviderAdapter, AIRequest, AIResponse } from './types.js';
import { groqProvider } from './groqProvider.js';
import {
  getBackupModelForProvider,
  getDefaultModelForProvider,
  getRegisteredModels,
} from './modelRegistry.js';
import { aiUsageContextStorage, recordAiUsage } from '../supabaseAdmin.js';

class AIRouter {
  private adapters: Map<AIProvider, AIProviderAdapter> = new Map();

  constructor() {
    this.adapters.set('groq', groqProvider);
  }

  public getAdapter(provider: AIProvider): AIProviderAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new Error(`Unsupported AI provider: ${provider}`);
    }
    return adapter;
  }

  public resolveProvider(_requested?: AIProvider): AIProvider {
    return 'groq';
  }

  public async execute(request: AIRequest): Promise<AIResponse> {
    const usageCtx = aiUsageContextStorage.getStore();
    const preferBackupModel = Boolean(request.preferBackupModel || usageCtx?.preferBackupModel);
    const provider = this.resolveProvider(request.provider);
    const adapter = this.getAdapter(provider);
    const validModelIds = new Set(getRegisteredModels(provider).map(m => m.id));
    const requestedModel = request.model?.trim();
    const model = preferBackupModel
      ? getBackupModelForProvider(provider)
      : requestedModel && validModelIds.has(requestedModel)
      ? requestedModel
      : getDefaultModelForProvider(provider);

    const response = await adapter.execute({
      ...request,
      preferBackupModel,
      provider,
      model,
    });

    if (usageCtx?.companyId) {
      void recordAiUsage({
        companyId: usageCtx.companyId,
        userId: usageCtx.userId,
        provider: response.provider,
        model: response.model,
        operation: usageCtx.operation,
        inputTokens: response.usage?.inputTokens,
        outputTokens: response.usage?.outputTokens,
      });
    }

    return response;
  }
}

export const aiRouter = new AIRouter();

export function extractAndParseJSON<T = any>(rawText: string): T {
  const cleaned = rawText
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  const tryParse = (candidate: string): T => {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      const noTrailingCommas = candidate.replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(noTrailingCommas) as T;
    }
  };

  try {
    return tryParse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const firstBracket = cleaned.indexOf('[');
    let start = -1;
    let end = -1;
    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      start = firstBrace;
      end = cleaned.lastIndexOf('}');
    } else if (firstBracket !== -1) {
      start = firstBracket;
      end = cleaned.lastIndexOf(']');
    }
    if (start !== -1 && end > start) {
      const slice = cleaned.slice(start, end + 1);
      try {
        return tryParse(slice);
      } catch {
        // fall through to clear error
      }
    }
    throw new Error('AI response did not contain valid JSON.');
  }
}
