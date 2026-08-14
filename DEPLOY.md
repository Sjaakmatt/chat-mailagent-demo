# Deploy & secrets runbook

Wat er moet staan om een klant-agent live te krijgen. Dit gaat over de
techniek; de volgorde van het hele traject staat in
[`docs/NEW-CLIENT.md`](docs/NEW-CLIENT.md).

**Vooraf:** het Cloudflare-account moet op **Workers Paid** staan — Durable
Objects, Workflows én Cron-triggers vereisen dat plan.

Twee Workers per klant:

| Worker                       | Wat                                         |
| ---------------------------- | ------------------------------------------- |
| `<slug>-mail-agent`          | poller (DO) + Workflows                     |
| `<slug>-cockpit`             | de werkbak (OpenNext)                       |

---

## Stap 1 — database

Draai de migraties uit `migrations/` op volgorde op het **klant**-Supabase-project
(niet de dashboard-DB):

| Migratie                      | Wat                                          |
| ----------------------------- | -------------------------------------------- |
| `0001_aios_tables`            | signals, review items, memory, automations    |
| `0002_aios_pgmq`              | work-bus + emit/read/archive-RPC's            |
| `0003_memory_pgvector`        | pgvector-memory (nodig als je RAG aanzet)     |
| `0004_allowed_emails`         | cockpit-allowlist + rollen                    |
| `0005_demo_testdata`          | demo-orders — optioneel, alleen voor de demo  |
| `0006`–`0018`                 | audit, beleid, bijlagen, compound, realtime   |

**Controle:** `select count(*) from aios_signals;` geeft `0`, geen foutmelding.

---

## Stap 2 — agent-Worker

Eerst één keer deployen (anders bestaat de Worker nog niet), dan de secrets:

```bash
cd agents/mail-agent
npx wrangler deploy
```

```bash
npx wrangler secret put AIOS_SUPABASE_URL
#   → https://<project-ref>.supabase.co
npx wrangler secret put AIOS_SUPABASE_SERVICE_ROLE_KEY
#   → Supabase → Settings → API → service_role (secret)
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put FACTUMAI_MCP_MAIL_URL
npx wrangler secret put FACTUMAI_MCP_API_KEY
# en de overige MCP's die deze klant gebruikt (ERP, CRM, shipping)
```

Bij MCP's achter Cloudflare Access horen ook `CF_ACCESS_CLIENT_ID` en
`CF_ACCESS_CLIENT_SECRET` — beide, anders antwoordt Access met 403 aan de edge.
Voor de oude `*.workers.dev`-URL's geldt in plaats daarvan
`FACTUMAI_MCP_INBOUND_SECRET`.

`AIOS_ORG_ID` is géén secret: die staat als `var` in `wrangler.jsonc`. Zet 'm op
de organizationId van de klant-tenant. Deze waarde moet **exact** gelijk zijn aan
wat de mail-MCP als org meestuurt, anders vindt de poller de signalen niet.

**Controle:** `npx wrangler secret list` toont wat je verwacht.

---

## Stap 3 — de producer: mail-MCP laten emitten

De mail-MCP schrijft bij inbound mail een Signal naar de klant-DB via de
`aios_emit_signal`-RPC. Zonder deze stap blijft de werkbak leeg.

Zet op de mail-MCP de Signal-emitter-env op de klant-DB:

```bash
npx wrangler secret put PLATFORM_SUPABASE_URL
#   → https://<project-ref>.supabase.co
npx wrangler secret put PLATFORM_SUPABASE_SERVICE_ROLE_KEY
#   → de service_role-key van dezelfde DB
```

(De variabelen heten `PLATFORM_…` in de MCP-code, maar de wáárde is bewust de
klant-DB — daar staan de `aios_*`-RPC's.)

**Controle:** stuur een testmail naar de gekoppelde mailbox; er verschijnt een
rij in `aios_signals` met status `NEW`.

---

## Stap 4 — cockpit-Worker

De cockpit bindt de Execute-Workflow cross-script. Volgorde is dwingend:

1. Agent-Worker deployen (stap 2) → de Workflow `<slug>-workflow-execute` bestaat.
2. Daarna pas de cockpit deployen, anders faalt de binding.

```bash
cd ui
npx wrangler secret put AIOS_SUPABASE_URL
npx wrangler secret put AIOS_SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put SUPABASE_ANON_KEY
#   → de anon/publishable key (Supabase → Settings → API)
pnpm build:cf && pnpm deploy
```

**Zonder `SUPABASE_ANON_KEY` blijft de cockpit fail-closed op slot.** Dat is
opzet: liever niemand binnen dan iedereen.

---

## Stap 5 — toegang

De cockpit gebruikt Supabase Auth op het klant-project. Inloggen gaat met
e-mail + wachtwoord; uitnodigen en wachtwoord-reset via een OTP-code.

**Eenmalig in Supabase** (project → Authentication): zet de e-mailtemplate op de
OTP-code (`{{ .Token }}`) in plaats van de magic-link. Een voorbeeldtemplate
staat in `ui/supabase-magic-link-email.html`.

Wie mag inloggen, staat in `allowed_emails` (rollen: `admin`, `reviewer`,
`viewer`). De eerste admin zet je met de hand in de tabel; daarna kan die via de
Toegang-pagina de rest uitnodigen.

---

## Stap 6 — RAG (optioneel)

Zet aan als de agent uit huisstijl, klanthistorie of SOP's moet putten:

```bash
# agent-Worker én cockpit
npx wrangler secret put VOYAGE_API_KEY
```

En in beide `wrangler.jsonc`: `"AIOS_RAG_ENABLED": "true"`.

pgvector en de `aios_match_memory`-RPC komen uit migratie `0003`.

---

## Stap 7 — eind-tot-eind controle

1. Stuur een testmail naar de gekoppelde mailbox.
2. Er verschijnt een rij in `aios_signals` (status `NEW`).
3. Binnen een minuut pakt de poller 'm op → `PROCESSING` → `DONE`.
4. In `aios_review_items` staat een `PENDING`-item.
5. De werkbak toont het concept met grounding-verwijzingen.
6. Goedkeuren → de Execute-Workflow verstuurt → status `EXECUTED`.

Blijft het bij stap 3 hangen? Kijk met `npx wrangler tail` mee op de
agent-Worker. De meest voorkomende oorzaak is een `AIOS_ORG_ID` die niet
overeenkomt met wat de mail-MCP meestuurt.

---

## Staging

Optionele tweede omgeving op een test-tenant (child-org), die de DB deelt met
prod maar via `AIOS_ORG_ID` gescheiden blijft. Achtergrond en afwegingen:
[`docs/MULTI-ENV-DESIGN.md`](docs/MULTI-ENV-DESIGN.md).

```bash
npx wrangler deploy --env staging
npx wrangler secret put <NAAM> --env staging   # dezelfde secrets als prod
```

De staging-agent heeft bewust **geen** Cron-trigger: hij pollt alleen na een
handmatige `POST /__poller/start`. Zo verwerkt staging niet stilletjes
prod-signalen uit dezelfde queue.

---

## CI

Het fundament levert geen GitHub Actions mee — welke workflows zinnig zijn,
hangt af van hoe de klant-repo beheerd wordt. Een gebruikelijke opzet:

- typecheck + test op elke push;
- deploy van de agent bij wijzigingen in `agents/**` of `packages/**`;
- deploy van de cockpit bij wijzigingen in `ui/**` of `packages/**`.

Beide deploys vereisen de repo-secrets `CLOUDFLARE_API_TOKEN` (template *Edit
Cloudflare Workers*) en `CLOUDFLARE_ACCOUNT_ID`.
