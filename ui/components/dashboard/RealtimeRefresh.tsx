"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { getBrowserClient } from "@/lib/supabase/browser";

interface RealtimeRefreshProps {
  /** Tabel om op te luisteren (bv. aios_review_items / aios_shipment_tasks). */
  table: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  /** Vangnet-poll als realtime (nog) niet verbonden is. */
  fallbackMs?: number;
  /**
   * Tenant-scope: alleen postgres_changes voor deze organization_id
   * doortrekken naar de UI. Sinds Fase 5B bevat de aios-DB ook test-tenant-
   * rijen; zonder filter zou de prod-cockpit refreshen op test-updates.
   */
  organizationId: string;
}

/**
 * Ververst de server-component zodra een rij in `table` verandert via Supabase
 * Realtime (postgres_changes) — i.p.v. vaste polling. Toont een live-indicator
 * en een knop om handmatig te verversen. Valt terug op een trage poll zolang
 * het kanaal niet verbonden is.
 */
export function RealtimeRefresh({
  table,
  supabaseUrl,
  supabaseAnonKey,
  fallbackMs = 10000,
  organizationId,
}: RealtimeRefreshProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [live, setLive] = useState(false);

  const liveRef = useRef(false);
  liveRef.current = live;

  const doRefresh = () => startTransition(() => router.refresh());
  const refreshRef = useRef(doRefresh);
  refreshRef.current = doRefresh;

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      if (debounce) clearTimeout(debounce);
      // Korte debounce: meerdere wijzigingen in een burst → één refresh.
      debounce = setTimeout(() => refreshRef.current(), 400);
    };

    let cancelled = false;
    let cleanupChannel: (() => void) | null = null;
    let refreshTokenTimer: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      if (!supabaseUrl || !supabaseAnonKey) return;
      const supabase = getBrowserClient(supabaseUrl, supabaseAnonKey);

      // Geef Realtime de access-token van de sessie expliciet mee — zonder
      // gaat de websocket als anon verbinden en filtert de RLS-policy
      // ("authenticated read ...") alle events weg.
      try {
        const res = await fetch("/api/auth/realtime-token", {
          credentials: "same-origin",
        });
        if (res.ok) {
          const { accessToken, expiresAt } = (await res.json()) as {
            accessToken: string;
            expiresAt: number | null;
          };
          if (cancelled) return;
          await supabase.realtime.setAuth(accessToken);
          // Iets vóór expiry een nieuwe token vragen + setAuth.
          if (typeof expiresAt === "number") {
            const refreshIn = Math.max(
              expiresAt * 1000 - Date.now() - 60_000,
              60_000,
            );
            refreshTokenTimer = setTimeout(() => {
              if (!cancelled) void connect();
            }, refreshIn);
          }
        }
      } catch {
        // Token-fetch fout → ga toch door (sub blijft "Verbinden…" en de
        // vangnet-poll houdt de UI bij).
      }

      // Fase 5B: filter events op tenant zodat de prod-cockpit niet
      // refresht op test-tenant-updates (en vice versa). Uitzondering:
      // `aios_review_edits` heeft geen `organization_id`-kolom — als
      // deze component daar ooit op subscribed, moeten we een andere
      // filter-strategie kiezen. Voor nu is dat niet het geval.
      const channel = supabase
        .channel(`cockpit-${table}-${organizationId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table,
            filter: `organization_id=eq.${organizationId}`,
          },
          trigger,
        )
        .subscribe((status) => setLive(status === "SUBSCRIBED"));
      cleanupChannel = () => {
        void supabase.removeChannel(channel);
      };
    }

    void connect();

    // Vangnet: zolang realtime niet verbonden is, toch periodiek verversen.
    const fallback = setInterval(() => {
      if (!liveRef.current) refreshRef.current();
    }, fallbackMs);

    return () => {
      cancelled = true;
      if (debounce) clearTimeout(debounce);
      if (refreshTokenTimer) clearTimeout(refreshTokenTimer);
      clearInterval(fallback);
      cleanupChannel?.();
    };
  }, [table, supabaseUrl, supabaseAnonKey, fallbackMs, organizationId]);

  return (
    <button
      type="button"
      onClick={doRefresh}
      title="Nu verversen"
      className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-brand-700 transition-colors"
    >
      <span className="relative flex h-2 w-2" aria-hidden="true">
        {live && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 animate-ping" />
        )}
        <span
          className={cn(
            "relative inline-flex rounded-full h-2 w-2",
            live ? "bg-green-500" : "bg-amber-400",
          )}
        />
      </span>
      <RefreshCw className={cn("w-3.5 h-3.5", pending && "animate-spin")} />
      {live ? "Live" : "Verbinden…"}
    </button>
  );
}
