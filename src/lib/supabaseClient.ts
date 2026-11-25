import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const PLACEHOLDER_CLIENT_VALUES = new Set([
  '',
  'https://YOUR_PROJECT_REF.supabase.co',
  'YOUR_SUPABASE_ANON_KEY',
]);

export function resolveSupabaseClientEnv(): {
  url: string;
  anonKey: string;
  configured: boolean;
} {
  const url = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
  const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

  const configured =
    url.startsWith('https://') &&
    !PLACEHOLDER_CLIENT_VALUES.has(url) &&
    !url.includes('YOUR_PROJECT_REF') &&
    anonKey.length > 20 &&
    !PLACEHOLDER_CLIENT_VALUES.has(anonKey) &&
    !anonKey.includes('YOUR_SUPABASE');

  return { url, anonKey, configured };
}

export function isSupabaseClientConfigured(): boolean {
  return resolveSupabaseClientEnv().configured;
}

let cachedBrowserClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  const env = resolveSupabaseClientEnv();
  if (!env.configured) return null;
  if (!cachedBrowserClient) {
    cachedBrowserClient = createClient(env.url, env.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return cachedBrowserClient;
}
