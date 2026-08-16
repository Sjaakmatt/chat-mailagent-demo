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

**Heeft de org meer dan één mailbox gekoppeld? Zet dan ook de instance.** Dit
is geen `secret` maar een `var` (het is geen geheim, en je wilt in de config
kunnen zien welke bak de agent gebruikt):

```jsonc
"vars": { "FACTUMAI_MCP_MAIL_INSTANCE_KEY": "mail-agent" }
```

Sla je dit over, dan kiest de MCP de instance die als **primair** is
gemarkeerd. Dat is bij de meeste organisaties het adres waar echte klanten
naartoe schrijven — en deze agent leest daar niet alleen uit, hij **antwoordt
er ook vanuit** zodra iemand een concept goedkeurt. De beschikbare sleutels
staan in het dashboard bij de MCP-activaties van de org.

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
pnpm run build:cf && pnpm run deploy
```

> `pnpm run deploy`, niet `pnpm deploy` — dat laatste is een ingebouwd
> pnpm-commando (een workspace-package naar een map kopiëren) en draait het
> script uit `package.json` dus níet.

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

Een rij is óf één adres (`jan@klant.nl`) óf een heel domein (`@klant.nl`). Met
een domeinregel krijgt iedereen met zo'n adres die rol, zonder aparte
uitnodiging — handig als de hele klantorganisatie mee mag kijken. Een
persoonlijke rij gaat vóór de domeinregel, dus je kunt één iemand promoveren of
met `viewer` terugschroeven zonder het domein te raken.

Let op wat een domeinregel betekent: iedereen die een adres op dat domein kan
laten verifiëren via Supabase Auth, komt binnen met die rol. Zet er dus geen
domein in dat je niet zelf beheert, en geef een domeinregel niet lichtvaardig
`admin`.

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

## CI/CD

Het fundament levert twee GitHub Actions-workflows mee:

| Workflow                        | Wanneer                          | Wat                                             |
| ------------------------------- | -------------------------------- | ----------------------------------------------- |
| `.github/workflows/ci.yml`      | elke push + PR                   | typecheck, tests, Next-build van de cockpit      |
| `.github/workflows/deploy.yml`  | push naar `main` + handmatig     | agent-Worker en/of cockpit naar Cloudflare       |
| `.github/workflows/upstream-sync.yml` | wekelijks + handmatig      | fundament-updates ophalen (merge of PR)          |

### Eenmalig instellen

Twee repo-secrets (**Settings → Secrets and variables → Actions**):

| Secret                  | Waar te halen                                                          |
| ----------------------- | ---------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare-dashboard → rechterkolom **Account ID**                     |
| `CLOUDFLARE_API_TOKEN`  | My Profile → API Tokens → Create Token → template **Edit Cloudflare Workers** |

Voor de wekelijkse fundament-sync komen daar in een **klant**-repo nog twee bij:
variable `FUNDAMENT_REPO` (`<org>/mail-agent-fundament`) en secret
`FUNDAMENT_DEPLOY_KEY` (read-only deploy key op die privé-repo — die verloopt
niet). Ontbreken ze, dan slaat die workflow schoon over. Aanmaken:
`docs/NEW-CLIENT.md`.

De runtime-secrets (Supabase, Anthropic, MCP's) blijven bij de Worker via
`wrangler secret put` — ze horen niet in GitHub.

De deploy-jobs draaien in de GitHub-omgevingen `production` en `staging`. Wil je
dat een productie-deploy eerst wordt goedgekeurd, zet dan een required reviewer
op de `production`-omgeving (**Settings → Environments**). De workflow verandert
daar niet voor.

### Hoe het werkt

**Volgorde is dwingend.** De cockpit bindt de Execute-Workflow cross-script aan
de agent-Worker. Daarom staan beide in één workflow met `needs:` ertussen: eerst
de agent, dan de cockpit. Twee losse workflows zouden parallel draaien en op een
verse omgeving faalt de cockpit dan op een binding die nog niet bestaat.

**Alleen deployen wat gewijzigd is.** De `plan`-job diff't de push:

| Gewijzigd                          | Deployt                |
| ---------------------------------- | ---------------------- |
| `agents/**`                        | agent                  |
| `ui/**`                            | cockpit                |
| `packages/**`, lockfile, workspace | beide (agent-core zit in allebei) |
| `docs/**`, `migrations/**`, README | niets                  |

**Migraties worden niet toegepast.** Een groene deploy zegt niets over je
schema — die draai je zelf (stap 1). Wijzig je iets in `migrations/`, dan zet de
workflow een waarschuwing in de run-samenvatting zodat je het niet vergeet.

**Placeholder-guard.** Voorkomt dat een onvolledig geconfigureerde repo een
Worker met de naam `__CLIENT_SLUG__-mail-agent` aanmaakt. Twee uitkomsten:

| Situatie                                     | Wat er gebeurt                        |
| -------------------------------------------- | ------------------------------------- |
| Ongewijzigd fundament (niets ingevuld)       | schoon overgeslagen, groene run       |
| Half geconfigureerd (bv. org-id vergeten)    | faalt, met de ontbrekende tokens erbij |
| Klant compleet                               | deployt                               |

Er wordt alleen gecontroleerd wat vóór *deze* deploy ingevuld moet zijn.
`__CLIENT_TEST_ORG_ID__` telt dus alleen mee bij een staging-deploy — staging is
optioneel, en een klant die alleen productie draait moet gewoon kunnen
uitrollen.

### Handmatig deployen

**Actions → Deploy → Run workflow.** Kies de omgeving (`production` of
`staging`) en wat je wilt deployen (`both`, `agent`, `cockpit`). Handig om
staging te vullen vanaf een feature-branch, of om alleen de cockpit opnieuw uit
te rollen na een branding-wijziging.
