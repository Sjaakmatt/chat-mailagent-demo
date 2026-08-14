# cockpit — de werkbak

Een mens keurt concept-`ReviewItem`s goed, bewerkt of wijst ze af. Next.js
(App Router) op Cloudflare via `@opennextjs/cloudflare`; leest de klant-DB met
PostgREST (service-role) en start bij approve/edit de **Execute-Workflow** van
de agent-Worker.

## Schermen

| Route                        | Wat                                                        |
| ---------------------------- | ---------------------------------------------------------- |
| `/`                          | Werkbak: triage-buckets over `aios_review_items`            |
| `/mail/[id]`                 | Detail: concept, grounding, confidence, tijdlijn, bewerken  |
| `/analytics`                 | Doorlooptijden en volumes                                   |
| `/audit`                     | Auditlog (mail-beslissingen + domeinbronnen) + CSV-export   |
| `/policy`                    | Beleidsregels (admin)                                       |
| `/admin`                     | Toegang: allowlist + rollen (admin)                         |
| `/account`                   | Wachtwoord wijzigen                                         |
| `/demo`                      | Demo starten (admin, alleen bij `DEMO_MODE=true`)           |

## Belangrijk

- **Side effects via de Workflow, niet de UI.** De cockpit zet alleen de status
  (APPROVED/EDITED/REJECTED) en start `ExecuteWorkflow` op de agent-Worker
  (binding `EXECUTE` via `script_name` in `wrangler.jsonc`). De verzending draait
  in die Workflow. **Afwijzen verstuurt nooit.**
- **Auth**: Supabase-sessie (e-mail + wachtwoord; OTP-code voor invite en reset),
  afgedwongen in `middleware.ts`. Fail-closed: zonder auth-config komt niemand
  binnen. Rollen (`admin`/`reviewer`/`viewer`) uit `allowed_emails`. Zet in
  productie Cloudflare Access ervóór als extra ring.
- **Tenant-isolatie**: elke DB-query loopt via `CockpitDbClient`, die
  automatisch `organization_id=eq.<AIOS_ORG_ID>` meebakt. Omzeil dat niet — de
  enige uitzondering is `tableUrlNoTenant()`, bewust opvallend genoemd zodat een
  grep alle "vertrouw-mij"-plekken toont.

## Per klant aanpassen

| Onderwerp                 | Bestand                          |
| ------------------------- | -------------------------------- |
| Naam, tagline, navigatie  | `lib/brand.ts`                   |
| Kleuren                   | `app/globals.css` (`--brand-*`)  |
| Demo-mails                | `lib/demo/scenarios.ts`          |
| Eigen audit-events        | `lib/audit-sources.ts`           |

## Lokaal

```bash
pnpm dev          # localhost:3000
pnpm typecheck
```

Build en deploy draaien `opennextjs-cloudflare`. Secrets: zie `../DEPLOY.md`.
