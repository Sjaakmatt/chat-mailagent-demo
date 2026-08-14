"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-Supabase-client (anon-key + sessie uit de auth-cookies). Eén
 * singleton per tab zodat alle realtime-kanalen één websocket delen. Wordt
 * uitsluitend gebruikt voor Realtime-notificaties; data blijft server-side
 * via de service-role lopen.
 */
let cached: SupabaseClient | null = null;

export function getBrowserClient(url: string, anon: string): SupabaseClient {
  if (!cached) cached = createBrowserClient(url, anon);
  return cached;
}
