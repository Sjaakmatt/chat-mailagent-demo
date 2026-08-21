# Klantspecifieke modules in de werkbak

De UI-helft van een klantmodule. **Het fundament raakt deze map nooit aan**, net
als `packages/agent-core/src/client-modules/`.

Een bestand hier heeft dezelfde vorm als `../modules/klantenservice.ts`: het
levert een `WorkbenchModule` — tab, kaart-viewmodel, detail-link, en optioneel
een auditbron en eigen zijbalk-items. Géén React-componenten: de schil rendert,
de module levert gegevens. Zie [`docs/MODULES.md`](../../../docs/MODULES.md).

Exporteer als `<id>Module` (`inkoop` → `inkoopModule`), zet de module in het
`modules:`-blok van `client.manifest.yaml` met `source: "client"`, en draai
`pnpm modules:generate`.

Heeft de module eigen schermen, zet ze dan op `navItems` en zet
`requireModulePage(<MODULE>.id)` bovenaan elke pagina. `scripts/check-module-guards.mjs`
leest die routes uit de registratie en faalt als de guard ontbreekt.
