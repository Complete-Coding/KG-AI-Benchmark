import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl) {
  console.warn('Supabase URL is not defined. Set VITE_SUPABASE_URL in your environment.');
}

if (!supabaseAnonKey) {
  console.warn('Supabase anon key is not defined. Set VITE_SUPABASE_ANON_KEY in your environment.');
}

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;
