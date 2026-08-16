# CLAUDE.md — mail-agent-fundament

Werkregels voor Claude Code in deze repo. Dit is het **product**: het startpunt
waaruit elke nieuwe klant-mailagent wordt gescaffold.

## Wat deze repo is

Een herbruikbare, Cloudflare-native mail-agent + werkbak. De kern is de
signaal-tot-actie-lus uit het FactumAI Platform & Agent Build Document:

```
mail binnen → pgmq → poller (DO) → Orchestration-Workflow
   → classify → resolve → retrieve → plan → ground
   → ReviewItem(PENDING) → mens keurt goed in de werkbak
   → Execute-Workflow → verzenden
```

Drie deployables in één pnpm-workspace:

| Map                   | Wat                                                          |
| --------------------- | ------------------------------------------------------------ |
| `packages/agent-core` | Runtime-agnostische lus-kern. Self-contained, volledig getest. |
| `agents/mail-agent`   | De agent-Worker: Durable Object poller + Workflows.           |
| `ui`                  | De cockpit-werkbak (Next.js + OpenNext op Workers).           |
| `migrations`          | SQL voor de klant-Supabase (`aios_*`, pgmq, pgvector).        |
| `examples`            | Referentie-implementaties. Géén productiecode.                |

De werkbak is de **schil**, niet het scherm van de mailagent. Automatiseringen
dokken erin als module — klantenservice vandaag, sales en administratie later —
met een eigen tab, eigen categorieën en eigen schermen. De schil kent geen enkele
module bij naam behalve in `ui/lib/modules/registry.ts`. Lees
[`docs/MODULES.md`](./docs/MODULES.md) vóór je iets aan de werkbak toevoegt:
mailkennis in een kernbestand van de cockpit is een regressie.

## Wat hier NIET in hoort

Dit is het fundament, niet een klant. Houd het leeg van klantspecifieke zaken:

- **Beleidsregels en tone-of-voice.** Die leven in de database en de cockpit,
  per klant, en veranderen continu. Nooit in code.
- **Klantnamen, e-mailadressen, order- of klantgegevens.** De demo-data is
  verzonnen (`example.com`) en moet dat blijven.
- **Domeinspecifieke schermen en tabellen** (magazijn, planning, ticketing).
  Die haken aan via de extensiepunten hieronder; het voorbeeld staat in
  `examples/warehouse-module/`.

Twijfel je of iets in de kern hoort? Vraag: *zou de volgende klant dit ook
willen?* Nee → extensiepunt of `examples/`.

## Harde regels (NOOIT overtreden)

1. **Geen autonome verzending naar externen.** Elke uitgaande actie → ReviewItem
   → mens keurt goed → Execute-Workflow. `autonomy = REVIEW` is de default;
   `AUTO` alleen na expliciete afspraak per workflow.
2. **Geen LLM-calls of beslislogica in MCP's.** Classificatie en planning leven
   in deze agent-laag; MCP's zijn pure data-/actie-services.
3. **Side effects horen in idempotente Workflows**, niet los in een API-route.
   Een step kan opnieuw draaien: schrijf met een stabiele sleutel.
4. **Numerical grounding.** Elke numerieke of feitelijke claim is traceerbaar
   naar een tool-call-respons uit dezelfde run. Geen dekking → weglaten.
5. **Tenant-context op elke MCP-call en elke DB-query.** In de cockpit gaat dat
   automatisch via `CockpitDbClient`; omzeil dat niet. Stuur op elke MCP-call óók
   `dataCategories` mee — laat je ze weg, dan krijg je alleen `operationeel`
   terug en verdwijnen velden stilzwijgend. Zie `docs/RECHTEN.md`.
6. **Secrets uit env/Vault**, nooit in code of logs.
7. **Model-IDs in config, niet hardcoden.** Haiku-tier classificeert,
   Sonnet-tier plant, Opus-tier alleen waar `plan-heavy` staat.

## Extensiepunten — hier haakt klantmaatwerk aan

Voeg klantspecifieke code toe via deze naden, niet door de kern te bewerken:

| Wil je…                        | Bewerk                                          |
| ------------------------------ | ----------------------------------------------- |
| Een tweede automatisering (sales, administratie) | `packages/agent-core/src/modules/` + `ui/lib/modules/` — zie `docs/MODULES.md` |
| Andere categorieën             | `packages/agent-core/src/taxonomy/index.ts`      |
| Waar de agent wél/niet over gaat | `packages/agent-core/src/domain-gate/index.ts` |
| Wanneer iets automatisch mag | `packages/agent-core/src/outcomes/index.ts` |
| Andere naam/kleuren/navigatie  | `ui/lib/brand.ts` + `ui/app/globals.css`         |
| Een extra intent/specialist    | `packages/agent-core/src/specialists/`           |
| Een side effect na goedkeuring | `agents/mail-agent/src/domain/index.ts`          |
| Eigen events in de auditlog    | `ui/lib/audit-sources.ts`                        |
| Wie wat mag zien/goedkeuren    | `aios_role_grants` — zie `docs/RECHTEN.md`; nooit een tweede rechtenmodel |
| Een tweede kanaal (chat)       | `packages/agent-core/src/channels/` + `agents/mail-agent/src/channels.ts` |
| Andere demo-mails              | `ui/lib/demo/scenarios.ts` + `migrations/0005_*` |

## Een nieuwe klant opzetten

Start met `./scripts/new-client.sh <slug> "<Klantnaam>"`; dat zet de klant-repo
op met het fundament als `upstream`-remote. Loop daarna `docs/NEW-CLIENT.md` af:
taxonomie en branding aanpassen, migraties draaien, secrets zetten. Het
fundament zelf verander je daarbij niet.

Een klant haalt latere kernverbeteringen op met `git merge upstream/main`, of
laat `upstream-sync.yml` dat wekelijks doen. Die mergt alleen automatisch als
het schoon gaat én de tests groen zijn; conflicteert het met maatwerk, dan komt
er een PR. Waar maatwerk het goedkoopst zit (extensiepunt of nieuw bestand,
niet middenin een kernbestand) staat in `docs/NEW-CLIENT.md`.

Verbeter je tijdens klantwerk iets dat élke klant wil? Breng het terug naar
deze repo via een branch die alléén die kernwijziging bevat — geen klantnamen,
geen org-id's. Dat is hoe het fundament beter wordt.

## Werkwijze

- Gefaseerd bouwen, stop-and-validate. Niet vooruitlopen op ongevraagde features.
- Falende MCP-calls mogen de pipeline nooit laten crashen: fail-soft terugvallen
  (zie `McpToolResult`). Een agent die stilvalt is erger dan een agent die één
  mail naar review stuurt.
- `pnpm -r typecheck` én `pnpm -r test` groen vóór commit.
- Nederlands in code-commentaar en UI-teksten, consistent met de rest.
