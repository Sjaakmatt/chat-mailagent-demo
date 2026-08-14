# Test-tenant-impact op de agent-Worker

De test-tenant-feature is een **dashboard-feature** en het canonieke design
staat in de dashboard-repo:

- **`FactumAI-dashboard/docs/TEST-TENANTS.md`** — bron van waarheid.

## Wat de agent-Worker moet doen (Fase 5C)

Dit is de agent-Worker-side van het plan. Concreet aanpassen zodra Fase 5A
(schema-migratie in dashboard) live is:

1. **`env.AIOS_ORG_ID` uit runtime-paden.** De hardcoded env-referenties
   in `agents/mail-agent/src/steps.ts` en `agents/mail-agent/src/store.ts`
   vervangen door `signal.organizationId`. De poller leest die uit het
   signal-record dat de mail-MCP schreef, dus de tenant is al bekend
   voor elk MCP-call in de resolve/plan-stap.
2. **`loadPolicyRules(env, orgId)`** — nieuwe orgId-param, roept de
   Supabase-RPC `resolve_policy_rules(target_org_id)` aan i.p.v. directe
   PostgREST-select op `aios_policy_rules`. Cache per orgId (5 min TTL —
   policies wijzigen zelden mid-run).
3. **`USE_MULTI_AGENT_ROUTER` per-org.** Vandaag globale Worker-var; wordt
   een rij in `aios_org_settings` zodat je 'm per test/prod-org apart kunt
   flippen zonder deploy.
4. **Staging-Worker (`aios-agent-staging`) blijft** voor de
   uitzonderlijke gevallen waar agent-code de shared runtime raakt (bv.
   Workflow-bindings die niet backwards-compat zijn). Prompt/config-tests
   verhuizen naar test-org op de prod-Worker.

Zie voor het volledige plan (data-model, roll-out-fasen, open vragen) het
dashboard-doc.
