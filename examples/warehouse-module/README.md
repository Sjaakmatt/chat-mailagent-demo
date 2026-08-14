# Voorbeeld — magazijnmodule

Een complete, werkende domeinmodule zoals die in productie draaide bij een klant
met een eigen magazijn. Hij staat hier als **referentie**, niet als
productiecode: de bestanden worden niet gebouwd of getest door de workspace.

Gebruik 'm op twee manieren:

- **Als voorbeeld.** Bouw je een eigen module (planning, ticketing, CRM-sync)?
  Lees dit dan eerst — het laat zien welke aanhaakpunten er zijn en hoe ze zich
  tot elkaar verhouden.
- **Als startpunt.** Heeft de klant écht een magazijn, dan kopieer je 'm en pas
  je 'm aan.

## Wat de module doet

Wanneer een goedgekeurd antwoord een verzending impliceert (bijvoorbeeld het
nasturen van een ontbrekend onderdeel), maakt de module een werkticket aan voor
het magazijn: klant, adres, te picken artikelen en een verzendlabel. In de
cockpit komt daar een eigen werkbak bij, met een printbaar label en een
audit-tijdlijn die naast de mail-events loopt.

## De vijf aanhaakpunten

Dit is waarom de module leerzaam is: hij raakt élk extensiepunt dat het
fundament biedt, en géén kernbestand.

| # | Aanhaakpunt                                  | In deze module                                    |
| - | -------------------------------------------- | ------------------------------------------------- |
| 1 | `agents/mail-agent/src/domain/index.ts`      | `agent/hooks.ts` → maakt het werkticket na approve |
| 2 | `ui/lib/audit-sources.ts`                    | magazijn-events op de gedeelde audit-tijdlijn      |
| 3 | `ui/lib/brand.ts` → `extraNavItems`          | de nav-items Magazijn en Onderdelen                |
| 4 | `packages/agent-core/src/specialists/`       | `specialists/missing-parts.ts`                     |
| 5 | `migrations/`                                | `aios_shipment_tasks`, `aios_part_batches`         |

## Installeren in een klant-repo

1. **Agent.** Kopieer `agent/` naar `agents/mail-agent/src/warehouse/` en
   registreer de hook:

   ```ts
   // agents/mail-agent/src/domain/index.ts
   import { warehouseHooks } from '../warehouse/hooks.js';
   export const DOMAIN_HOOKS: DomainHooks[] = [warehouseHooks];
   ```

2. **Migraties.** Kopieer `migrations/*.sql` naar de repo-`migrations/` en
   hernummer op de volgende vrije index. Draai ze op de klant-DB.

3. **Cockpit.** Kopieer `ui/app/...` en `ui/components/warehouse/` naar de
   overeenkomstige plekken, en `ui/lib/warehouse.ts` naar `ui/lib/`. Voeg de
   nav-items toe:

   ```ts
   // ui/lib/brand.ts
   import { Package, Boxes } from "lucide-react";
   extraNavItems: [
     { href: "/magazijn", label: "Magazijn", icon: Package },
     { href: "/onderdelen", label: "Onderdelen", icon: Boxes, adminOnly: true },
   ],
   ```

4. **Specialist.** Wil je de `missing_parts`-intent? Kopieer
   `specialists/missing-parts.ts` naar `packages/agent-core/src/specialists/`,
   registreer 'm in `CORE_INTENTS`, en zet de bijbehorende categorie in de
   taxonomie.

5. **Auditbron.** Schrijf een `DomainAuditSource` (zie `ui/lib/audit-sources.ts`
   voor de interface) die `aios_shipment_tasks` uitleest, en registreer 'm in
   `DOMAIN_AUDIT_SOURCES`.

## Let op bij hergebruik

- **De policy-vlag heet nu `creates_task`, niet `creates_shipment`.** De kern
  kent alleen een generieke "deze regel maakt een vervolgtaak"-vlag; wát die taak
  is, bepaalt de module. `agent/hooks.ts` leest `proposed.policy.createsTask`.
- **De hook moet idempotent zijn.** Workflow-steps kunnen opnieuw draaien. Deze
  module gebruikt `id = ship-<reviewItemId>` met merge-duplicates; doe iets
  gelijkwaardigs.
- **Verzendlabels zijn hier nep** (`makeFakeLabel`). Voor echte labels hangt er
  een shipping-MCP aan; de taak-tabel blijft de bron voor de werkbak.
- **De ERP-lookup gaat via `erp_get_order`** met een fail-soft terugval op de
  demo-tabellen. Houd die terugval: een onbereikbare MCP mag de mailafhandeling
  nooit blokkeren.
