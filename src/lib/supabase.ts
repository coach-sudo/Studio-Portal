import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const isSupabaseConfigured = Boolean(url && anonKey);
export const isDemoMode = import.meta.env.MODE !== "production" && import.meta.env.VITE_ENABLE_DEMO_MODE !== "false";
export const supabase = isSupabaseConfigured ? createClient(url!, anonKey!, { auth: { persistSession: true, detectSessionInUrl: true } }) : null;
