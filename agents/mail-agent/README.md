# mail-agent — de agent-Worker

Agent = Durable Object, durable execution = Workflows, work-bus = pgmq, alle
pure lus-logica in `@factumai/agent-core`.

> **Datalaag = het Supabase-project van de klant** (niet factumai-dashboard).
> De `aios_*`-tabellen, pgmq en pgvector komen uit `../../migrations/`.

## Runtime-skelet

```
poller (DO-alarm)   → read pgmq → start Orchestration-Workflow
                      (id=orch-${msg_id}, idem-key=msg_id) → archive ná succes → back-off
orchestration       → load-signal → orchestrate[classify → resolve → retrieve(if RAG)
                      → plan → ground] → ReviewItem(PENDING) → werkbak
execute (na approve) → idempotent: bezorgen via het kanaal → MemoryEntry[if RAG]
                      → EXECUTED / Signal=DONE → domeinhooks
```

| Bestand                          | Rol                                                                    |
| -------------------------------- | ---------------------------------------------------------------------- |
| `src/poller-do.ts`               | `MailPoller` — DO-alarm poller (`runPoll` + `PgmqSignalConsumer`)       |
| `src/workflows/orchestration.ts` | single-workflow pad → ReviewItem(PENDING)                              |
| `src/workflows/router.ts`        | multi-agent: kiest intent, dispatcht specialist(en)                    |
| `src/workflows/specialist.ts`    | één intent → ReviewItem of PartialResponse                             |
| `src/workflows/aggregator.ts`    | compound fan-in: weeft partials tot één antwoord                       |
| `src/workflows/execute.ts`       | `executeApproved()` + domeinhooks; idempotent                          |
| `src/steps.ts`                   | classify / resolve / plan / hydrate / retrieve + `deliverMailReply`     |
| `src/channels.ts`                | kanaal-dispatch: welke bezorgroutine hoort bij welke ReviewItem-soort   |
| `src/domain/index.ts`            | extensiepunt voor klant-specifieke side effects na goedkeuring          |
| `src/llm-anthropic.ts`           | Anthropic-`LlmClient` (model-IDs uit config)                            |
| `src/mcp.ts`                     | MCP-client (streamable HTTP + bearer + tenant-context)                  |
| `src/store.ts`                   | klant-DB: Signal/ReviewItem via PostgREST (service-role)                |

## Guardrails (via agent-core)

- **Geen autonome verzending**: orchestratie levert altijd `ReviewItem(PENDING)`;
  uitvoeren pas ná approve via `ExecuteWorkflow`.
- **Idempotente side effects**: `executeApproved` met idempotency-key = pgmq `msg_id`.
- **Numerical grounding**: `validateGrounding` koppelt elke claim aan een
  tool-call; ongedekte getallen verlagen de confidence en zetten een
  guardrail-vlag.
- **Geen LLM in MCP's**: de LLM-client zit hier, achter de `LlmClient`-interface;
  model-IDs komen uit `vars`.
- **Fail-soft domeinhooks**: een kapotte domeinmodule laat een al verstuurd
  antwoord nooit alsnog falen.

## Intake

pgmq + de RPC's `aios_emit_signal` / `aios_read_signals` / `aios_archive_signal`
staan in de klant-DB (`../../migrations/0002_aios_pgmq.sql`). De poller leest via
`PgmqSignalConsumer` uit agent-core. Producer is de mail-MCP: die emit bij
inbound mail een Signal naar dezelfde DB — zie `../../DEPLOY.md`, stap 3.

## Multi-agent

`USE_MULTI_AGENT_ROUTER=false` (default) draait het single-workflow pad. Op
`true` start de poller de Router in plaats van Orchestration. Beide paden
bestaan naast elkaar, zodat terugschakelen een var-wijziging is en geen deploy.

## Lokaal

```bash
pnpm typecheck
pnpm test
```

De Cloudflare-runtime (DO's, Workflows) draait niet lokaal — testen doe je op de
staging-Worker. Deploy en secrets: `../../DEPLOY.md`.
