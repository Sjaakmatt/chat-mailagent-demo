# Nieuwe klant opzetten

Van dit fundament naar een draaiende klant-agent. Reken op een halve dag voor de
technische opzet; de inhoudelijke afstemming (categorieën, beleid, toon) loopt
daarna door met de klant.

Werk de stappen in volgorde af. Elke stap eindigt met iets dat je kunt
controleren — sla dat niet over, want een fout in stap 2 zie je pas in stap 8.

---

## Stap 0 — repo aanmaken

```bash
git clone <fundament-url> <klant-slug>-mail-agent
cd <klant-slug>-mail-agent
rm -rf .git && git init
pnpm install
pnpm -r typecheck && pnpm -r test
```

**Controle:** typecheck en tests zijn groen vóór je iets wijzigt. Zo weet je dat
alles wat later stukgaat, van jou komt.

---

## Stap 1 — manifest invullen

Vul `client.manifest.yaml`. Dat is de bron voor alle stappen hierna. `org_id`
mag nog leeg — die krijg je in stap 3.

**Controle:** geen `<...>` meer in het bestand, behalve `org_id`/`test_org_id`.

---

## Stap 2 — placeholders vervangen

Vier tokens staan verspreid door de configuratie:

| Token                    | Uit het manifest      | Voorbeeld                      |
| ------------------------ | --------------------- | ------------------------------ |
| `__CLIENT_SLUG__`        | `client.slug`         | `acme`                         |
| `__CLIENT_NAME__`        | `client.name`         | `Acme B.V.`                    |
| `__CLIENT_ORG_ID__`      | `client.org_id`       | `cmqq...` (stap 3)             |
| `__CLIENT_TEST_ORG_ID__` | `client.test_org_id`  | `cmqq...` (stap 9, optioneel)  |

```bash
grep -rl '__CLIENT_SLUG__' . --exclude-dir=node_modules \
  | xargs sed -i 's/__CLIENT_SLUG__/acme/g'
grep -rl '__CLIENT_NAME__' . --exclude-dir=node_modules \
  | xargs sed -i 's/__CLIENT_NAME__/Acme B.V./g'
```

**Controle:**

```bash
grep -rn '__CLIENT' . --exclude-dir=node_modules
```

Alleen `__CLIENT_ORG_ID__` en `__CLIENT_TEST_ORG_ID__` mogen nog staan.

---

## Stap 3 — Supabase + tenant

1. Maak (of kies) het Supabase-project van de klant. Dit is **niet** de
   dashboard-DB.
2. Draai de migraties uit `migrations/` op volgorde. `0005_demo_testdata.sql`
   is optioneel — alleen nodig als je de demo wilt gebruiken.
3. Maak de FactumAI-org aan en noteer de cuid.
4. Vul `org_id` in het manifest en vervang `__CLIENT_ORG_ID__` in
   `agents/mail-agent/wrangler.jsonc` en `ui/wrangler.jsonc`.

**Controle:** `select count(*) from aios_signals;` geeft `0` in plaats van een
foutmelding.

---

## Stap 4 — taxonomie

Open `packages/agent-core/src/taxonomy/index.ts` en vervang de startset door de
categorieën van deze klant. Dit is de belangrijkste inhoudelijke stap: de
classifier kiest hieruit en het beleid matcht erop.

Vuistregel: een categorie verdient een eigen slug als er ánder beleid of een
andere specialist bij hoort. Anders hoort 'ie bij `overig`. Meestal kom je uit
op 8 à 12.

**Controle:** `pnpm -r test` — de taxonomie-tests bewaken dat elke categorie
naar een bestaande specialist wijst en een label heeft.

---

## Stap 5 — branding

1. `ui/lib/brand.ts` — naam, tagline, footer, eventueel een gesplitst logo.
2. `ui/app/globals.css` — de `--brand-*`, `--accent-*` en `--alert-*` kanalen.

Waarden zijn RGB-kanalen zonder wrapper (`51 65 85`), zodat opacity-varianten
als `bg-brand-900/40` blijven werken. Raak geen componenten aan: die gebruiken
uitsluitend tokens.

**Controle:** `cd ui && pnpm dev` — de werkbak draagt de kleuren van de klant en
er staat nergens meer "FactumAI" waar de klantnaam hoort.

---

## Stap 6 — secrets

Deploy eerst één keer (anders bestaat de Worker nog niet), zet dan de secrets:

```bash
cd agents/mail-agent && npx wrangler deploy
npx wrangler secret put AIOS_SUPABASE_URL
npx wrangler secret put AIOS_SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put FACTUMAI_MCP_MAIL_URL
# en de overige MCP-URL's + auth die deze klant gebruikt
```

Voor de cockpit hetzelfde, plus `SUPABASE_ANON_KEY` — zonder die key blijft de
werkbak fail-closed op slot.

Welke secrets er zijn en waarvoor, staat onderaan beide `wrangler.jsonc`-bestanden.

**Controle:** `npx wrangler secret list` toont wat je verwacht.

---

## Stap 7 — mail-MCP koppelen

Laat de mail-MCP `mail.received`-signalen naar de klant-DB emitten via
`aios_emit_signal`. Zonder deze stap blijft de werkbak leeg, hoe goed de agent
verder ook staat.

**Controle:** stuur een testmail naar de gekoppelde mailbox en kijk of er een rij
in `aios_signals` verschijnt.

---

## Stap 8 — demo (optioneel, aanrader)

Zet `DEMO_MODE: "true"` in `ui/wrangler.jsonc` → `vars` en deploy de cockpit.
Er verschijnt dan een **Demo**-item in de navigatie (admin-only) waarmee je
synthetische mails door de echte pipeline stuurt.

Pas `ui/lib/demo/scenarios.ts` aan naar mails die déze klant herkent — een demo
werkt pas als de prospect z'n eigen werkelijkheid ziet. Houd de ordernummers
gelijk aan de seed in `migrations/0005_demo_testdata.sql`, anders vindt de agent
geen order en heeft de grounding-check niets te verifiëren.

**Zet `DEMO_MODE` nooit aan op een productie-cockpit.**

**Controle:** klik "Start demo" → binnen een minuut staan er concepten in de
werkbak, met grounding-verwijzingen naar de order-lookups.

---

## Stap 9 — staging (optioneel)

Wil je een testomgeving naast productie: maak een test-tenant (child-org), zet
de cuid in `__CLIENT_TEST_ORG_ID__` en deploy met `--env staging`. Achtergrond
staat in `docs/MULTI-ENV-DESIGN.md`.

---

## Stap 10 — inhoud met de klant

Wat overblijft is geen configuratie meer maar afstemming:

- Beleidsregels aanmaken in de cockpit (Beleid-pagina, admin-only).
- Tone-of-voice en SOP's als memory-entries, als je RAG aanzet.
- De eerste weken meekijken in de werkbak: wat de reviewers corrigeren, is het
  leersignaal waarop je de prompts en het beleid bijstelt.

---

## Klant met een eigen domeinmodule

Heeft de klant een magazijn, planning of ticketsysteem dat aan de mailafhandeling
hangt? Begin dan bij `examples/warehouse-module/README.md` — dat is een complete
werkende module met alle aanhaakpunten erin.

## Klant met chat naast mail

Zie `docs/CHANNELS.md`. De lus is al kanaal-onafhankelijk; wat er nog moet
gebeuren staat daar beschreven, inclusief de autonomie-vraag die realtime chat
oproept.
