import { createClient, SupabaseClient } from '@supabase/supabase-js';
let instance: SupabaseClient | null = null;
export function supabase() {
  if (!instance) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('Configure Supabase in frontend/.env.local');
    instance = createClient(url, key);
  }
  return instance;
}
const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export function apiUrl() {
  const url = new URL(configuredApiUrl);
  if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
    && ['localhost', '127.0.0.1'].includes(url.hostname)) {
    url.hostname = window.location.hostname;
  }
  return url.toString().replace(/\/$/, '');
}

export async function fetchApi(path: string, init?: RequestInit) {
  const baseUrl = apiUrl();
  try {
    return await fetch(`${baseUrl}${path}`, init);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Could not reach Buddy's backend at ${baseUrl}. Check that the backend is running and NEXT_PUBLIC_API_URL is correct.`);
    }
    throw error;
  }
}
