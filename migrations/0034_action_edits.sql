-- 0034_action_edits
--
-- Een medewerker mag een voorstel corrigeren vóór hij het goedkeurt.
--
-- ## Waarom dit er niet meteen in zat
--
-- Het eerste ontwerp maakte de payload onbewerkbaar, met als redenering: de
-- onderbouwing koppelt elk veld aan een tool-call, en een handmatig
-- overschreven veld maakt die koppeling een leugen.
--
-- Dat klopt over de herkomst, maar de conclusie was verkeerd. Een reviewer die
-- op de foto ziet dat één van twee artikelen kapot is, hoort € 89 naar € 45 te
-- kunnen bijstellen. Dat is precies waar een menselijke controle voor is; hem
-- dwingen af te wijzen en te wachten tot de agent het opnieuw probeert, maakt
-- van de goedkeuringslaag een obstakel in plaats van een vangnet.
--
-- De oplossing is niet "geen bewerking" maar "bewerking mét vastgelegde
-- herkomst": we bewaren wat de agent voorstelde, wie het aanpaste en wanneer.
-- Daarmee is een aangepast veld beter gedocumenteerd dan voorheen, niet slechter.
--
-- ## Waarom het origineel een kolom is en geen aparte tabel
--
-- Er is precies één origineel: dat wat de agent voorstelde. Latere correcties
-- overschrijven elkaar, en de vraag die een auditor stelt is "wat stelde de
-- agent voor en wat is er uitgevoerd" — niet "hoe vaak is er getypt". Een
-- edits-tabel zou dat detail bewaren en de belangrijke vraag duurder maken.
--
-- Wélke velden bewerkbaar zijn, staat in de registratie in agent-core
-- (`ActionPayloadField.editable`), niet hier. De grens loopt daar langs: je mag
-- een grootheid of een tekst corrigeren, je mag de actie niet op een ander
-- record richten.

alter table public.aios_proposed_actions
  add column if not exists original_payload jsonb,
  add column if not exists edited_by        text,
  add column if not exists edited_at        timestamptz;

comment on column public.aios_proposed_actions.original_payload is
  'De payload zoals de agent hem voorstelde. Alleen gevuld zodra er iets is aangepast; velden die hiervan afwijken zijn door een mens gezet.';
