import type { AIModelMeta, AIProvider } from '../../types.js';
import { getGroqApiKeys } from './groqProvider.js';

export const STATIC_MODEL_REGISTRY: AIModelMeta[] = [
  {
    id: 'openai/gpt-oss-120b',
    provider: 'groq',
    displayName: 'GPT OSS 120B (Groq)',
    description:
      'High-capability 120B reasoning model on Groq LPU with 128k context and JSON mode.',
    contextWindow: 131072,
    enabledForCourseGeneration: true,
    enabledForCopilot: true,
    isDefault: true,
    recommendedBadge: 'Recommended (Groq Default)',
  },
  {
    id: 'qwen/qwen3.8-27b',
    provider: 'groq',
    displayName: 'Qwen 3.8 27B (Groq)',
    description:
      'Fast 27B reasoning and structured JSON model on Groq LPU with high throughput.',
    contextWindow: 131072,
    enabledForCourseGeneration: true,
    enabledForCopilot: true,
  },
  {
    id: 'openai/gpt-oss-20b',
    provider: 'groq',
    displayName: 'GPT OSS 20B (Groq)',
    description: 'Low-latency 20B Groq model for fast Copilot responses and quick edits.',
    contextWindow: 131072,
    enabledForCourseGeneration: true,
    enabledForCopilot: true,
  },
];

export function getRegisteredModels(_provider?: AIProvider): AIModelMeta[] {
  return STATIC_MODEL_REGISTRY;
}

export function getDefaultModelForProvider(_provider: AIProvider): string {
  const match = STATIC_MODEL_REGISTRY.find(m => m.isDefault);
  return match ? match.id : 'openai/gpt-oss-120b';
}

export function checkKeysConfigured() {
  const groqKeys = getGroqApiKeys();
  return {
    groq: groqKeys.length > 0,
    groqKeyCount: groqKeys.length,
  };
}
