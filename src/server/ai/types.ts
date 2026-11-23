import type { AIProvider } from '../../types.js';

export interface AIRequest {
  provider?: AIProvider;
  model?: string;
  systemInstruction?: string;
  prompt: string;
  responseFormat?: 'json' | 'text';
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface AIResponse {
  text: string;
  provider: AIProvider;
  model: string;
  durationMs: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface AIProviderAdapter {
  provider: AIProvider;
  name: string;
  isConfigured(): boolean;
  getKeyCount(): number;
  execute(request: AIRequest): Promise<AIResponse>;
}
