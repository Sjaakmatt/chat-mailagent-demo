# Migraties

SQL voor het **klant**-Supabase-project (niet de dashboard-DB). Draai ze op
nummervolgorde. Additief en idempotent: elk bestand mag opnieuw draaien zonder
schade.

RLS staat overal aan, zónder policies. Dat is opzet: de Workers benaderen de
tabellen met de service-role (die RLS omzeilt), en `anon`/`authenticated` krijgen
niets. Fail-closed dus, ook als er ooit per ongeluk een publieke key uitlekt.

| Migratie                    | Wat                                                |
| --------------------------- | -------------------------------------------------- |
| `0001_aios_tables`          | signals, review items, memory, automations          |
| `0002_aios_pgmq`            | work-bus + `aios_emit/read/archive_signal`          |
| `0003_memory_pgvector`      | pgvector-memory + `aios_match_memory` (voor RAG)    |
| `0004_allowed_emails`       | cockpit-allowlist + rollen                          |
| `0005_demo_testdata`        | demo-orders/tracking — **optioneel**, alleen demo   |
| `0006_review_decided_by`    | wie de beslissing nam                               |
| `0007_policy_rules`         | beleidsregels + de generieke `creates_task`-vlag    |
| `0010_attachments_bucket`   | storage-bucket voor bijlagen                        |
| `0012_realtime_publication` | realtime-publicatie voor de werkbak                 |
| `0014_review_edits`         | edit-snapshots (leersignaal)                        |
| `0016_partial_responses`    | compound fan-in tussenlaag                          |
| `0017_review_items_compound`| compound-vlag + per-taak samenvattingen             |
| `0018_unknown_intent_log`   | router-misses, voedt latere intent-discovery        |
| `0019_decision_logs`        | beslislog per run: poort, uitkomst, bronnen         |
| `0020_conversations_tickets`| gesprekken, berichten, tickets + nummerteller       |
| `0021_revoke_security_definer` | RPC-grants dichtzetten — **verplicht** op bestaande DB's |
| `0022_allowlist_domains`    | `invited_by` + hele domeinen op de allowlist        |
| `0023_demo_context`         | beleidsregels per categorie — **demo**, verzonnen cijfers |
| `0024_demo_catalogus`       | assortiment + trajecten — **gegenereerd**, zie hieronder |
| `0025_message_feedback`     | duim + toelichting per chatantwoord, en het eval-label |
| `0026_policy_handover_reason` | waarom een mens erbij komt, in de ticketbevestiging |
| `0027_proposed_actions`     | voorgestelde acties: datamodel + statusmachine      |
| `0030_review_items_module`  | `module` per voorstel — de werkbak tabt per proces   |
| `0031_role_grants`          | rol → (module, datacategorieën) — één rechtenmodel   |
| `0032_allowed_emails_modules` | afdelingen per gebruiker, begrensd door de afname |

## Waarom de gaten in de nummering

`0008`, `0009`, `0011`, `0013` en `0015` hoorden bij de magazijnmodule van één
klant. Die zijn verhuisd naar `examples/warehouse-module/migrations/`. De
nummers zijn bewust niet hergebruikt: zo blijft de volgorde van de bestaande
migraties gelijk aan wat er al draait, en blijft de historie navolgbaar.

Neem je de magazijnmodule over in een klant-repo, hernummer die bestanden dan op
de volgende vrije index in plaats van de oude gaten te vullen.

`0023` t/m `0029` zijn overgeslagen omdat een klant-repo die nummers al in
gebruik heeft. Twee bestanden met hetzelfde nummer geeft een dubbelzinnige
volgorde zodra die repo `upstream/main` mergt — en dat merkt niemand tot een
migratie in de verkeerde volgorde draait. Laat bij een nieuwe fundament-migratie
dus ruimte boven wat klant-repo's al gebruiken.

## Nieuwe migratie toevoegen

Volgende vrije nummer, beschrijvende naam, en houd 'm idempotent
(`create table if not exists`, `add column if not exists`, `on conflict do
nothing`). Een migratie die maar één keer kan draaien, gaat een keer stuk op het
verkeerde moment.

## `0024_demo_catalogus` niet met de hand bewerken

Dat bestand wordt gegenereerd uit `data/catalog.mjs` in de **factum-webshop**-repo:

```bash
node scripts/seed-sql.mjs > ../chat-mailagent-demo/migrations/0024_demo_catalogus.sql
```

De winkel en de agent moeten hetzelfde assortiment kennen. Bewerk je de SQL met
de hand, dan noemt de chatbot vroeg of laat een prijs die de bezoeker naast zich
op het scherm ziet tegenspreken. Pas de catalogus aan en genereer opnieuw.
