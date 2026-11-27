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
    id: 'llama-3.3-70b-versatile',
    provider: 'groq',
    displayName: 'Llama 3.3 70B Versatile (Groq Backup)',
    description:
      'High-reliability 70B backup model on Groq LPU for automatic failover during rate limits or model outages.',
    contextWindow: 131072,
    enabledForCourseGeneration: true,
    enabledForCopilot: true,
    recommendedBadge: 'Backup Model',
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
  {
    id: 'llama-3.1-8b-instant',
    provider: 'groq',
    displayName: 'Llama 3.1 8B Instant (Groq Emergency Fallback)',
    description: 'Ultra-high-TPM emergency fallback Groq model when primary quotas are saturated.',
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

export function getBackupModelForProvider(_provider: AIProvider): string {
  const configuredBackup = String(process.env.GROQ_BACKUP_MODEL || '').trim();
  if (configuredBackup) {
    return configuredBackup;
  }
  return 'llama-3.3-70b-versatile';
}

export function checkKeysConfigured() {
  const groqKeys = getGroqApiKeys();
  return {
    groq: groqKeys.length > 0,
    groqKeyCount: groqKeys.length,
  };
}
