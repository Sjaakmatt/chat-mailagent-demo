/**
 * Lichtgewicht Supabase PostgREST-client — gevendord in agent-core zodat de
 * AIOS-stack zelfstandig op de klant-Supabase praat (review-items, signals,
 * memory) zonder dependency op de MCP-laag. Service-role bearer-key uit de
 * credential-store; 429/5xx worden met backoff geretried, 4xx faalt direct.
 */

import type { ICredentialStore, TenantContext } from '../tenant/index.js';

export const SUPABASE_SYSTEM_TYPE = 'supabase';

export interface SupabaseClientConfig {
  /** Supabase project REST-URL, bv. `https://xyz.supabase.co`. Verplicht. */
  projectUrl: string;
  /** Postgres-schema (default 'public'). */
  schema?: string;
}

interface SupabaseCredential {
  apiKey: string;
}

export class SupabaseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
    public readonly pgrstCode?: string,
  ) {
    super(message);
    this.name = 'SupabaseError';
  }
}

export interface SupabaseRequestInit {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  body?: string;
  prefer?: string;
  headers?: Record<string, string>;
}

interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  shouldRetry: (error: unknown) => boolean;
}

async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { maxAttempts, initialDelayMs, maxDelayMs, shouldRetry } = options;
  let lastError: unknown;
  let delay = initialDelayMs;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !shouldRetry(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }
  throw lastError;
}

/**
 * PostgREST-client. Eén instance per service; de per-tenant `apiKey` wordt op
 * call-time uit de credential-store gehaald.
 */
export class SupabaseClient {
  private readonly schema: string;

  constructor(
    private readonly credentialStore: ICredentialStore,
    private readonly config: SupabaseClientConfig,
  ) {
    if (!config.projectUrl) {
      throw new Error("SupabaseClientConfig requires 'projectUrl'");
    }
    this.schema = config.schema ?? 'public';
  }

  /** `<projectUrl>/rest/v1/<table>`. */
  tableUrl(table: string): URL {
    const base = this.config.projectUrl.replace(/\/$/, '');
    return new URL(`${base}/rest/v1/${encodeURIComponent(table)}`);
  }

  /** `<projectUrl>/rest/v1/rpc/<fn>`. */
  rpcUrl(fn: string): URL {
    const base = this.config.projectUrl.replace(/\/$/, '');
    return new URL(`${base}/rest/v1/rpc/${encodeURIComponent(fn)}`);
  }

  async request<T>(ctx: TenantContext, url: URL, init: SupabaseRequestInit): Promise<T> {
    const credential = await this.loadCredential(ctx);

    return withRetry(
      async () => {
        const headers: Record<string, string> = {
          apikey: credential.apiKey,
          Authorization: `Bearer ${credential.apiKey}`,
          'Accept-Profile': this.schema,
          ...(init.headers ?? {}),
        };
        if (init.body) {
          headers['Content-Type'] = 'application/json';
          headers['Content-Profile'] = this.schema;
        }
        if (init.prefer) headers['Prefer'] = init.prefer;
        if (!headers['Accept']) headers['Accept'] = 'application/json';

        const res = await fetch(url, { method: init.method, headers, body: init.body });

        if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
          const text = await safeReadText(res);
          throw new SupabaseError(
            `Supabase ${res.status} ${res.statusText}: ${text}`,
            res.status,
            true,
            extractPgrstCode(text),
          );
        }
        if (!res.ok) {
          const text = await safeReadText(res);
          throw new SupabaseError(
            `Supabase ${res.status} ${res.statusText}: ${text}`,
            res.status,
            false,
            extractPgrstCode(text),
          );
        }
        if (res.status === 204) return undefined as T;
        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) return undefined as T;
        return (await res.json()) as T;
      },
      {
        maxAttempts: 4,
        initialDelayMs: 250,
        maxDelayMs: 4000,
        shouldRetry: (e) => e instanceof SupabaseError && e.retryable,
      },
    );
  }

  private async loadCredential(ctx: TenantContext): Promise<SupabaseCredential> {
    const cred = await this.credentialStore.lookup(ctx, SUPABASE_SYSTEM_TYPE);
    const v = cred.value;
    const apiKey = (v.serviceRoleKey ?? v.service_role_key ?? v.apiKey ?? v.api_key ?? v.key) as
      | string
      | undefined;
    if (!apiKey) {
      throw new Error(
        `supabase credential for tenant ${ctx.organizationId} missing 'serviceRoleKey' (or 'apiKey') string`,
      );
    }
    return { apiKey };
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

interface PgrstErrorBody {
  code?: string;
}

function extractPgrstCode(text: string): string | undefined {
  try {
    return (JSON.parse(text) as PgrstErrorBody).code;
  } catch {
    return undefined;
  }
}
