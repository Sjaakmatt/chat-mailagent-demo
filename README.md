# Mail-agent fundament

Het herbruikbare startpunt voor een FactumAI klant-mailagent: een
Cloudflare-native agent die inkomende klantmail classificeert, verrijkt met
feiten uit de systemen van de klant, en een concept-antwoord voorstelt — dat een
mens goedkeurt in de werkbak vóór er iets de deur uitgaat.

Nieuwe klant? Begin bij **[`docs/NEW-CLIENT.md`](docs/NEW-CLIENT.md)**.

## De lus

```
mail binnen
   │
   ▼  mail-MCP emit een Signal (pgmq, transactional outbox)
poller (Durable Object)
   │
   ▼  Orchestration-Workflow
classify ──→ resolve ──→ retrieve ──→ plan ──→ ground
  Haiku      contact/     RAG +      Sonnet   elke claim
             order        few-shot            traceerbaar
   │
   ▼
ReviewItem (PENDING)  ──→  werkbak: mens keurt goed / bewerkt / wijst af
   │
   ▼  Execute-Workflow (idempotent)
antwoord verstuurd
```

Er gaat **nooit** iets autonoom naar buiten. De orchestrator produceert altijd
een voorstel; alleen het goedkeuringspad voert uit.

## Structuur

```
packages/agent-core/   Runtime-agnostische lus-kern: contracts, orchestrate,
                       execute, poller, grounding, memory, specialisten,
                       taxonomie, kanalen. Self-contained en volledig getest.
agents/mail-agent/     De agent-Worker: Durable Object poller + Workflows
                       (Orchestration, Router, Specialist, Aggregator, Execute).
ui/                    De cockpit-werkbak (Next.js + OpenNext op Workers):
                       werkbak, analytics, auditlog, beleid, toegang, demo.
migrations/            SQL voor de klant-Supabase (aios_*, pgmq, pgvector).
examples/              Referentie-implementaties, géén productiecode.
docs/                  NEW-CLIENT, CHANNELS, MULTI-ENV-DESIGN.
client.manifest.yaml   Vul dit als eerste in bij een nieuwe klant.
```

## Lokaal

```bash
pnpm install
pnpm -r typecheck
pnpm -r test
cd ui && pnpm dev     # werkbak op localhost:3000
```

## Wat je per klant aanpast

Alles wat klantspecifiek is, zit in een handvol bestanden — de rest laat je met
rust:

| Onderwerp                      | Bestand                                       |
| ------------------------------ | --------------------------------------------- |
| Slug, naam, org-id, MCP's      | `client.manifest.yaml` + de wrangler-configs   |
| Categorieën                    | `packages/agent-core/src/taxonomy/index.ts`    |
| Naam, kleuren, navigatie       | `ui/lib/brand.ts` + `ui/app/globals.css`       |
| Demo-mails                     | `ui/lib/demo/scenarios.ts`                     |
| Beleidsregels, tone-of-voice   | in de cockpit / database — **niet** in code    |

## CI/CD

Twee GitHub Actions-workflows: `ci.yml` (typecheck, tests en cockpit-build op
elke push) en `deploy.yml` (push naar `main` of handmatig → Cloudflare). De
deploy rolt alleen uit wat gewijzigd is, houdt de volgorde agent → cockpit aan,
en weigert te draaien zolang er nog `__CLIENT_*`-placeholders in de configs
staan. Instellen: twee repo-secrets, zie [`DEPLOY.md`](DEPLOY.md).

## Demo

Met `DEMO_MODE=true` op de cockpit-Worker verschijnt een Demo-pagina waarmee je
synthetische klantmails door de **echte** pipeline stuurt. Wat de prospect ziet
is dus het werkelijke gedrag van de agent, geen schermafdruk. Zet dit nooit aan
op productie.

## Uitbreiden

De kern verander je niet; je haakt aan via extensiepunten. Welke er zijn en waar
ze zitten, staat in [`CLAUDE.md`](CLAUDE.md). Een complete werkende
domeinmodule staat in [`examples/warehouse-module/`](examples/warehouse-module/).
Voor een tweede kanaal naast mail: [`docs/CHANNELS.md`](docs/CHANNELS.md).
