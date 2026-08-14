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
   automatisch via `CockpitDbClient`; omzeil dat niet.
6. **Secrets uit env/Vault**, nooit in code of logs.
7. **Model-IDs in config, niet hardcoden.** Haiku-tier classificeert,
   Sonnet-tier plant, Opus-tier alleen waar `plan-heavy` staat.

## Extensiepunten — hier haakt klantmaatwerk aan

Voeg klantspecifieke code toe via deze naden, niet door de kern te bewerken:

| Wil je…                        | Bewerk                                          |
| ------------------------------ | ----------------------------------------------- |
| Andere categorieën             | `packages/agent-core/src/taxonomy/index.ts`      |
| Andere naam/kleuren/navigatie  | `ui/lib/brand.ts` + `ui/app/globals.css`         |
| Een extra intent/specialist    | `packages/agent-core/src/specialists/`           |
| Een side effect na goedkeuring | `agents/mail-agent/src/domain/index.ts`          |
| Eigen events in de auditlog    | `ui/lib/audit-sources.ts`                        |
| Een tweede kanaal (chat)       | `packages/agent-core/src/channels/` + `agents/mail-agent/src/channels.ts` |
| Andere demo-mails              | `ui/lib/demo/scenarios.ts` + `migrations/0005_*` |

## Een nieuwe klant opzetten

Volg `docs/NEW-CLIENT.md`. Kort: vul `client.manifest.yaml`, vervang de
`__PLACEHOLDER__`-tokens, pas taxonomie en branding aan, draai de migraties,
zet de secrets. Het fundament zelf verander je daarbij niet.

Verbeter je tijdens klantwerk iets dat élke klant wil? Breng het terug naar
deze repo — dat is hoe het fundament beter wordt.

## Werkwijze

- Gefaseerd bouwen, stop-and-validate. Niet vooruitlopen op ongevraagde features.
- Falende MCP-calls mogen de pipeline nooit laten crashen: fail-soft terugvallen
  (zie `McpToolResult`). Een agent die stilvalt is erger dan een agent die één
  mail naar review stuurt.
- `pnpm -r typecheck` én `pnpm -r test` groen vóór commit.
- Nederlands in code-commentaar en UI-teksten, consistent met de rest.
