# Open punten

Dingen die onderweg opvielen en bewust zijn blijven liggen, met erbij waarom en
waar ze thuishoren. Geen wensenlijst: alleen wat nu al scheef staat.

Bijgewerkt tijdens fase 0 van de fundament-uitbreiding
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

**Nieuwe schrijvers vullen `module` nog niet expliciet.**
Migratie 0035 zet de kolom met `klantenservice` als default, en alle schrijvers
in deze repo zijn vandaag klantenservice — dus het klopt. Maar `docs/MODULES.md`
zegt dat een schrijver het veld altijd invult, en dat doen `store.ts`,
`session-do.ts` en `delivery.ts` nog niet. Fase 1 lost dit op: dan komt de module
uit de resolved `ModulePack` en is er iets zinnigs om neer te zetten. Alleen
`chat/tickets.ts` zet 'm nu al, omdat de ticketteller per module loopt.

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
