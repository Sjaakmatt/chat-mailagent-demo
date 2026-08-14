/**
 * Embeddings voor de AIOS-app/Workflow-laag (Build Document A8/A12 — NOOIT in
 * een MCP). Provider-agnostische interface + concrete providers. De
 * stack gebruikt **Voyage AI** (`voyage-3.5`, 1024 dim → past op `vector(1024)`).
 * De Mistral-client blijft beschikbaar als alternatief.
 */

export interface EmbeddingClient {
  /** Geeft de embedding-vector voor één tekst. */
  embed(text: string): Promise<number[]>;
}

// ── Voyage AI ──────────────────────────────────────────────────────────────

export interface VoyageEmbeddingConfig {
  apiKey: string;
  /** Default `voyage-3.5`. */
  model?: string;
  /** Uitvoer-dimensie; default 1024 zodat het op `vector(1024)` past. */
  outputDimension?: number;
  /** Default `https://api.voyageai.com`. */
  baseUrl?: string;
}

interface VoyageEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

export function createVoyageEmbeddingClient(cfg: VoyageEmbeddingConfig): EmbeddingClient {
  const model = cfg.model ?? 'voyage-3.5';
  const outputDimension = cfg.outputDimension ?? 1024;
  const base = (cfg.baseUrl ?? 'https://api.voyageai.com').replace(/\/$/, '');

  return {
    async embed(text: string): Promise<number[]> {
      const res = await fetch(`${base}/v1/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({ model, input: [text], output_dimension: outputDimension }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Voyage embeddings ${res.status}: ${body}`);
      }
      const json = (await res.json()) as VoyageEmbeddingResponse;
      const vec = json.data?.[0]?.embedding;
      if (!Array.isArray(vec)) throw new Error('Voyage embeddings: geen vector in respons');
      return vec;
    },
  };
}

// ── Mistral (alternatief) ────────────────────────────────────────────────────

export interface MistralEmbeddingConfig {
  apiKey: string;
  /** Default `mistral-embed` (1024 dim). */
  model?: string;
  /** Default `https://api.mistral.ai`. */
  baseUrl?: string;
}

interface MistralEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

export function createMistralEmbeddingClient(cfg: MistralEmbeddingConfig): EmbeddingClient {
  const model = cfg.model ?? 'mistral-embed';
  const base = (cfg.baseUrl ?? 'https://api.mistral.ai').replace(/\/$/, '');

  return {
    async embed(text: string): Promise<number[]> {
      const res = await fetch(`${base}/v1/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({ model, input: [text] }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Mistral embeddings ${res.status}: ${body}`);
      }
      const json = (await res.json()) as MistralEmbeddingResponse;
      const vec = json.data?.[0]?.embedding;
      if (!Array.isArray(vec)) throw new Error('Mistral embeddings: geen vector in respons');
      return vec;
    },
  };
}
