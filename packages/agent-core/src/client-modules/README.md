# Klantspecifieke modulepakketten

**Het fundament raakt deze map nooit aan.** Dat is de hele reden dat hij bestaat:
een module die alleen deze klant heeft, hoort niet in `modules/` te staan, want
dan botst elke `git merge upstream/main` op een bestand dat het fundament ook
denkt te bezitten.

## Een klantmodule toevoegen

1. Maak `<id>/pack.ts` met dezelfde vorm als
   `../modules/klantenservice/pack.ts`, en exporteer hem als `<id>Pack`
   (`inkoop` → `inkoopPack`; een streepje wordt camelCase: `mijn-module` →
   `mijnModulePack`).
2. Maak de UI-helft in `ui/lib/client-modules/<id>.ts`, geëxporteerd als
   `<id>Module`.
3. Zet 'm in het `modules:`-blok van `client.manifest.yaml` met
   `source: "client"`.
4. Draai `pnpm modules:generate` en commit de twee gegenereerde registers.

Verder is er niets: de kern kent geen enkele module bij naam, dus er is ook geen
plek waar je 'm moet aanmelden.

## Wanneer hoort iets hier, en wanneer in het fundament

Vraag: *zou de volgende klant dit ook willen?* Ja → breng het terug naar het
fundament, in `modules/`, via een branch die alléén die kernwijziging bevat.
Nee → hier.

Een werkend voorbeeld van een klant-eigen uitbreiding staat in
`examples/warehouse-module/`.
