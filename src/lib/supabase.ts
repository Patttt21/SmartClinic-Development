import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface PublicSupabaseConfig {
  configured: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
  bootstrapArmed: boolean;
}

let cachedClient: SupabaseClient | null = null;
let cachedConfigPromise: Promise<PublicSupabaseConfig> | null = null;

export async function fetchPublicSupabaseConfig(): Promise<PublicSupabaseConfig> {
  if (!cachedConfigPromise) {
    cachedConfigPromise = (async () => {
      const buildUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
      const buildKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

      try {
        const resp = await fetch('/api/supabase/public-config');
        if (resp.ok) {
          const data = await resp.json();
          const url = String(data.supabaseUrl || buildUrl).trim();
          const key = String(data.supabaseAnonKey || buildKey).trim();
          const serverConfigured = Boolean(data.configured && url && key);
          return {
            configured: serverConfigured,
            supabaseUrl: url,
            supabaseAnonKey: key,
            bootstrapArmed: Boolean(data.bootstrapArmed),
          };
        }
      } catch {
        // Fallback if offline
      }

      return {
        configured: false,
        supabaseUrl: buildUrl,
        supabaseAnonKey: buildKey,
        bootstrapArmed: false,
      };
    })();
  }
  return cachedConfigPromise;
}

export async function getBrowserSupabaseClient(): Promise<SupabaseClient | null> {
  const cfg = await fetchPublicSupabaseConfig();
  if (!cfg.configured || !cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    return null;
  }
  if (!cachedClient) {
    cachedClient = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  }
  return cachedClient;
}
