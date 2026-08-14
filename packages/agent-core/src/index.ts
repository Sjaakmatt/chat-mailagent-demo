/**
 * @factumai/agent-core — de runtime-agnostische kern van de AIOS signaal-tot-
 * actie-lus (Build Document A6/C4). Cloudflare Durable Objects + Workflows zijn
 * dunne adapters om deze pure logica heen.
 *
 * In dit fundament is agent-core self-contained: de Supabase-
 * en tenant-helpers zijn hier gevendord zodat de AIOS-stack niet op de MCP-laag
 * (`@factumai/shared`) leunt.
 */

export * from './contracts/index.js';
export * from './llm/index.js';
export * from './embeddings/index.js';
export * from './grounding/index.js';
export * from './orchestrate/index.js';
export * from './execute/index.js';
export * from './poller/index.js';
export * from './feedback/index.js';
export * from './tenant/index.js';
export * from './supabase/index.js';
export * from './memory/index.js';
export * from './signals/index.js';
export * from './specialists/index.js';
export * from './taxonomy/index.js';
export * from './channels/index.js';
