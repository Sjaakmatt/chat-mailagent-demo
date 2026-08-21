# Open punten

Dingen die onderweg opvielen en bewust zijn blijven liggen, met erbij waarom en
waar ze thuishoren. Geen wensenlijst: alleen wat nu al scheef staat.

Bijgewerkt tijdens fase 0 en 1 van de fundament-uitbreiding
(`docs/uitbreiding/00-architectuur-en-plan.md`).

## Uit fase 0

**Dode auditfuncties in `ui/lib/db.ts`.**
`listAuditPage` en `listAuditForExport` zijn vervangen door
`listAuditEntriesPage` en `listAuditEntriesForExport`, en worden nergens meer
aangeroepen. Ze staan er nog als "legacy". Ze erven nu wel de modulefilter mee,
dus ze zijn niet gevaarlijk — alleen overbodig. Weghalen zodra fase 4 de
auditpagina toch aanraakt.

**De auditlog gaat nog uit van mail.**
Het icoon bij een kern-event is een envelop (`SourceIcon = domainSrc ? Package :
Mail`), en de kopregels spreken over mail-beslissingen. Dat is schil-kennis van
één module. Hoort bij fase 4, samen met `/item/[id]`.

**Niet elke schrijver vult `module` expliciet.**
Opgelost voor de belangrijkste: de orchestratie zet `pack.descriptor.id` op elk
ReviewItem, de aggregator doet hetzelfde, en `chat/tickets.ts` schrijft 'm op het
ticket. Wat nog op de database-default leunt: `aios_conversations` en
`aios_message_feedback` in `chat/session-do.ts`, en `aios_decision_logs`,
`aios_unknown_intent_log` en `aios_partial_responses` in `store.ts`. Alle vijf
zijn vandaag klantenservice, dus de default klopt — maar de module hoort van de
schrijver te komen, niet van het schema.

**Klantspecifieke tekst in de beleidseditor.**
`ui/components/policy/PolicyEditor.tsx` heeft bij de vlag "Maakt vervolgtaak" de
tooltip *"Maakt bij approve een verzendtaak aan in het magazijn"*. Een magazijn
is maatwerk van één klant; de vlag zelf is generiek (zie
`aios_policy_rules.creates_task`). De tekst hoort neutraal, of van de module te
komen.

**`aios_messages` heeft geen modulekolom.**
Bewust overgeslagen: een bericht hangt aan een gesprek, en dat gesprek draagt de
module wél. Zodra iets berichten los van hun gesprek gaat bevragen, klopt die
redenering niet meer en moet de kolom er alsnog op.

## Uit fase 1

**De feitenlaag is nog leeg.**
`ModulePack.facts` staat in het contract, maar elk pakket levert `[]`. De feiten
komen nog uit vaste lookups in `agents/mail-agent/src/steps.ts`, en de
`toolScope` op elke specialist wordt daardoor nergens gehandhaafd. Dat is fase 3,
en het contract ligt er al voor.

**`aios_proposed_actions.type` draagt geen module.**
Daarom moeten actie-slugs uniek zijn over alle modules heen; `assertRegistry`
bewaakt dat. Werkbaar, maar het is een beperking die uit het schema komt en niet
uit het ontwerp. Wil je 'm weg, dan is dat een migratie die de kolom naar
`module:slug` brengt, samen met een terugval voor bestaande rijen.

**`resolveModule` gaat op volgorde bij een dubbele claim.**
Claimen twee modules hetzelfde domein en type, dan wint de eerste in
manifest-volgorde. `assertRegistry` kan dat niet zien, want een predicaat is pas
bij een echt signaal te beoordelen. Bij fase 5 (administratie naast
klantenservice op dezelfde mailstroom) is dit het eerste wat aandacht vraagt.

**De pagina's van klantenservice staan nog in de schil.**
`ui/app/(dashboard)/mail/[id]/`, `tickets/`, `gesprekken/` en `feedback/`
importeren `KLANTENSERVICE_MODULE` via het subpad om hun guard te zetten. Dat is
correct maar niet waar het hoort: fase 4 verhuist die schermen naar de module.
