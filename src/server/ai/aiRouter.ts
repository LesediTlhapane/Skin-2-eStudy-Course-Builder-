import type { AIProvider } from '../../types.js';
import type { AIProviderAdapter, AIRequest, AIResponse } from './types.js';
import { groqProvider } from './groqProvider.js';
import { getDefaultModelForProvider, getRegisteredModels } from './modelRegistry.js';

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
    const provider = this.resolveProvider(request.provider);
    const adapter = this.getAdapter(provider);
    const validModelIds = new Set(getRegisteredModels(provider).map(m => m.id));
    const model =
      request.model?.trim() && validModelIds.has(request.model.trim())
        ? request.model.trim()
        : getDefaultModelForProvider(provider);

    return adapter.execute({
      ...request,
      provider,
      model,
    });
  }
}

export const aiRouter = new AIRouter();

export function extractAndParseJSON<T = any>(rawText: string): T {
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
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
      return JSON.parse(slice) as T;
    }
    throw new Error('AI response did not contain valid JSON.');
  }
}
