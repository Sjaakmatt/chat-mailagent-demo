-- 0035_demo_klantwereld
--
-- De demo-klantwereld gelijkgetrokken met wat deze winkel verkoopt.
--
-- ## Wat er mis was
--
-- `0024_demo_catalogus.sql` verving het assortiment door de modulaire AI- en
-- softwareproducten van FactumAI, en `packages/agent-core/src/taxonomy` volgde:
-- `order_wijziging` heet hier "Abonnement wijzigen", `levertijd_status` heet
-- "Status van je implementatie". De órders bleven achter. Die kwamen nog uit
-- `0005_demo_testdata.sql`: monitorarmen en bureaulampen, verstuurd met PostNL,
-- met een verzendadres erop.
--
-- Daardoor klopte de agent én had hij ongelijk. Een adreswijziging kreeg netjes
-- het label "Abonnement wijzigen" — correct voor de geconfigureerde winkel —
-- terwijl de order een pakket beschreef. En een samenvatting die een order een
-- "lopend dienstenabonnement zonder fysiek product" noemt, is het model dat
-- twee werelden probeert te rijmen die niet bij elkaar horen.
--
-- Dit zet de orders, de mijlpalen, de klanten en de facturen in dezelfde wereld
-- als de catalogus. De tabellen en kolommen uit 0005 en 0033 blijven ongemoeid:
-- een "order" is hier een implementatietraject, `tracking_code` is het
-- trajectnummer en `demo_order_tracking` bevat de mijlpalen daarvan. Dat is
-- precies de vertaling die 0024 in zijn kop al aankondigde.
--
-- `carrier` blijft leeg. Er is geen vervoerder als er niets wordt vervoerd, en
-- een verzonnen waarde zou de agent laten praten over een pakket dat niet
-- bestaat. Het gevolg is dat `onderzoek_vervoerder` hier nooit voorstelbaar is —
-- terecht: dat actietype hoort bij een klant die dozen verstuurt.
--
-- De SKU's verwijzen naar `demo_inventory` uit 0024, zodat een orderregel en
-- een artikel over hetzelfde ding gaan.
--
-- Alle bedrijfsnamen, personen en adressen zijn verzonnen (example.com).
--
-- Idempotent: opnieuw draaien werkt de rijen bij.

-- ---------------------------------------------------------------------------
-- Klanten. Bedrijven met een contactpersoon, want dat is wie er mailt.
-- ---------------------------------------------------------------------------
insert into public.demo_customers (email, name, data) values
('j.dekker@example.com', 'Jeroen Dekker',
 '{"email":"j.dekker@example.com","name":"Jeroen Dekker","company":"Van Dalen Interieur","role":"Operationeel manager","customerSince":"2026-07-14","trajectCount":1}'::jsonb),
('m.vandenberg@example.com', 'Marieke van den Berg',
 '{"email":"m.vandenberg@example.com","name":"Marieke van den Berg","company":"Bergman Techniek","role":"Hoofd klantenservice","customerSince":"2026-05-20","trajectCount":1}'::jsonb),
('p.jansen@example.com', 'Peter Jansen',
 '{"email":"p.jansen@example.com","name":"Peter Jansen","company":"Jansen Groothandel","role":"Directeur","customerSince":"2026-07-28","trajectCount":1}'::jsonb),
('s.bakker@example.com', 'Sanne Bakker',
 '{"email":"s.bakker@example.com","name":"Sanne Bakker","company":"Bakker Bouwmaterialen","role":"Officemanager","customerSince":"2026-06-30","trajectCount":1}'::jsonb),
('r.smit@example.com', 'Rob Smit',
 '{"email":"r.smit@example.com","name":"Rob Smit","company":"Smit Installatietechniek","role":"Eigenaar","customerSince":"2026-04-02","trajectCount":1}'::jsonb)
on conflict (email) do update set name=excluded.name, data=excluded.data;

-- ---------------------------------------------------------------------------
-- Trajecten. `status` is de fase van het traject:
--
--   wacht_op_aftrap  getekend, nog geen startgesprek geweest
--   in_uitvoering    inrichting loopt, nog niet alles opgeleverd
--   live             draait in productie
--
-- Die woorden staan nergens in code — de agent leest ze uit `data` en geeft ze
-- door. Dat is met opzet: de fasen van een klant zijn van de klant.
--
-- `shippingAddress` heet zo omdat 0005 die naam koos en de schrijfactie
-- `adres_wijzigen` hem gebruikt. Hier is het het adres op het contract.
-- ---------------------------------------------------------------------------
insert into public.demo_orders (order_number, customer_email, customer_name, status, total_value, currency, carrier, tracking_code, data) values

('DEMO-1001', 'j.dekker@example.com', 'Jeroen Dekker', 'in_uitvoering', 5700, 'EUR', null, 'TRJ-1001',
 '{"orderNumber":"DEMO-1001","customerEmail":"j.dekker@example.com","customerName":"Jeroen Dekker","company":"Van Dalen Interieur","orderDate":"2026-07-14T10:30:00Z","totalValue":5700,"currency":"EUR","status":"in_uitvoering","statusLabel":"Inrichting loopt","items":[{"sku":"FA-AGT-MAIL","productName":"Mailagent","quantity":1,"unitPrice":4500,"monthly":750},{"sku":"FA-KOP-M365","productName":"Microsoft 365 / Exchange","quantity":1,"unitPrice":1200,"monthly":0}],"maandbedrag":750,"shippingAddress":{"street":"Havenstraat 12","postalCode":"1013 AA","city":"Amsterdam","country":"NL"},"trajectCode":"TRJ-1001"}'::jsonb),

('DEMO-1002', 'm.vandenberg@example.com', 'Marieke van den Berg', 'live', 4000, 'EUR', null, 'TRJ-1002',
 '{"orderNumber":"DEMO-1002","customerEmail":"m.vandenberg@example.com","customerName":"Marieke van den Berg","company":"Bergman Techniek","orderDate":"2026-05-20T14:15:00Z","totalValue":4000,"currency":"EUR","status":"live","statusLabel":"Live sinds 15 juni 2026","liveSince":"2026-06-15","items":[{"sku":"FA-AGT-CHAT","productName":"Chatbot","quantity":1,"unitPrice":2500,"monthly":450},{"sku":"FA-MOD-KB","productName":"Kennisbank","quantity":1,"unitPrice":1500,"monthly":250}],"maandbedrag":700,"shippingAddress":{"street":"Industrieweg 88","postalCode":"7551 AB","city":"Hengelo","country":"NL"},"trajectCode":"TRJ-1002"}'::jsonb),

('DEMO-1003', 'p.jansen@example.com', 'Peter Jansen', 'wacht_op_aftrap', 7000, 'EUR', null, 'TRJ-1003',
 '{"orderNumber":"DEMO-1003","customerEmail":"p.jansen@example.com","customerName":"Peter Jansen","company":"Jansen Groothandel","orderDate":"2026-07-28T09:05:00Z","totalValue":7000,"currency":"EUR","status":"wacht_op_aftrap","statusLabel":"Wacht op aftrap","items":[{"sku":"FA-AGT-MAIL","productName":"Mailagent","quantity":1,"unitPrice":4500,"monthly":750},{"sku":"FA-AGT-WA","productName":"WhatsApp-agent","quantity":1,"unitPrice":2500,"monthly":550}],"maandbedrag":1300,"shippingAddress":{"street":"Handelskade 3","postalCode":"5211 AA","city":"s-Hertogenbosch","country":"NL"},"trajectCode":"TRJ-1003"}'::jsonb),

('DEMO-1004', 's.bakker@example.com', 'Sanne Bakker', 'in_uitvoering', 5000, 'EUR', null, 'TRJ-1004',
 '{"orderNumber":"DEMO-1004","customerEmail":"s.bakker@example.com","customerName":"Sanne Bakker","company":"Bakker Bouwmaterialen","orderDate":"2026-06-30T11:20:00Z","totalValue":5000,"currency":"EUR","status":"in_uitvoering","statusLabel":"Documentagent opgeleverd, kennisbank nog niet","items":[{"sku":"FA-AGT-DOC","productName":"Documentagent","quantity":1,"unitPrice":3500,"monthly":650,"opgeleverd":true},{"sku":"FA-MOD-KB","productName":"Kennisbank","quantity":1,"unitPrice":1500,"monthly":250,"opgeleverd":false}],"maandbedrag":900,"shippingAddress":{"street":"Betonweg 41","postalCode":"9723 BB","city":"Groningen","country":"NL"},"trajectCode":"TRJ-1004"}'::jsonb),

('DEMO-1005', 'r.smit@example.com', 'Rob Smit', 'live', 2500, 'EUR', null, 'TRJ-1005',
 '{"orderNumber":"DEMO-1005","customerEmail":"r.smit@example.com","customerName":"Rob Smit","company":"Smit Installatietechniek","orderDate":"2026-04-02T08:40:00Z","totalValue":2500,"currency":"EUR","status":"live","statusLabel":"Live sinds 2 mei 2026","liveSince":"2026-05-02","items":[{"sku":"FA-AGT-CHAT","productName":"Chatbot","quantity":1,"unitPrice":2500,"monthly":450},{"sku":"FA-MOD-TIC","productName":"Ticketing","quantity":1,"unitPrice":0,"monthly":200}],"maandbedrag":650,"shippingAddress":{"street":"Vaartweg 5","postalCode":"8011 CC","city":"Zwolle","country":"NL"},"trajectCode":"TRJ-1005"}'::jsonb)

on conflict (order_number) do update set
  customer_email=excluded.customer_email, customer_name=excluded.customer_name,
  status=excluded.status, total_value=excluded.total_value, currency=excluded.currency,
  carrier=excluded.carrier, tracking_code=excluded.tracking_code, data=excluded.data;

-- ---------------------------------------------------------------------------
-- Mijlpalen. Wat bij een webshop de track & trace is, is hier de voortgang van
-- de inrichting: dezelfde vraag ("waar staat het nu?"), dezelfde vorm (een
-- reeks gebeurtenissen met een datum), ander onderwerp.
-- ---------------------------------------------------------------------------
insert into public.demo_order_tracking (tracking_code, carrier, current_status, data) values

('TRJ-1001', null, 'Inrichting',
 '{"trajectCode":"TRJ-1001","currentStatus":"Inrichting","fase":"Inrichting","verwachteOplevering":"2026-09-01","mijlpalen":[{"timestamp":"2026-07-16T10:00:00Z","status":"Aftrap gehouden","toelichting":"Doelen en categorieen vastgelegd"},{"timestamp":"2026-07-24T14:30:00Z","status":"Mailbox gekoppeld","toelichting":"Microsoft 365, gescoped op klantenservice@"},{"timestamp":"2026-08-07T09:15:00Z","status":"Beleid ingericht","toelichting":"Eerste set regels staat, meelezen loopt"}],"volgendeMijlpaal":"Proefdraaien met het team"}'::jsonb),

('TRJ-1002', null, 'Live',
 '{"trajectCode":"TRJ-1002","currentStatus":"Live","fase":"Beheer","liveSince":"2026-06-15","mijlpalen":[{"timestamp":"2026-05-22T10:00:00Z","status":"Aftrap gehouden"},{"timestamp":"2026-06-03T11:00:00Z","status":"Kennisbank gevuld","toelichting":"412 documenten ingelezen"},{"timestamp":"2026-06-15T09:00:00Z","status":"Live gegaan","toelichting":"Widget staat op de site"}],"volgendeMijlpaal":"Maandelijkse bijsturing"}'::jsonb),

('TRJ-1003', null, 'Wacht op aftrap',
 '{"trajectCode":"TRJ-1003","currentStatus":"Wacht op aftrap","fase":"Wacht op aftrap","mijlpalen":[{"timestamp":"2026-07-28T09:05:00Z","status":"Getekend"}],"volgendeMijlpaal":"Aftrap inplannen","toelichting":"Er is nog geen startgesprek geweest"}'::jsonb),

('TRJ-1004', null, 'Inrichting',
 '{"trajectCode":"TRJ-1004","currentStatus":"Inrichting","fase":"Inrichting","verwachteOplevering":"2026-09-15","mijlpalen":[{"timestamp":"2026-07-02T10:00:00Z","status":"Aftrap gehouden"},{"timestamp":"2026-07-29T15:45:00Z","status":"Documentagent opgeleverd","toelichting":"Facturen en pakbonnen lopen door"}],"volgendeMijlpaal":"Kennisbank inrichten","toelichting":"De kennisbank uit het traject is nog niet opgeleverd"}'::jsonb),

('TRJ-1005', null, 'Live',
 '{"trajectCode":"TRJ-1005","currentStatus":"Live","fase":"Beheer","liveSince":"2026-05-02","mijlpalen":[{"timestamp":"2026-04-08T10:00:00Z","status":"Aftrap gehouden"},{"timestamp":"2026-05-02T09:00:00Z","status":"Live gegaan"},{"timestamp":"2026-08-14T07:20:00Z","status":"Storing","toelichting":"Ticketing was 14 tot en met 16 augustus onbereikbaar"}],"volgendeMijlpaal":"Maandelijkse bijsturing"}'::jsonb)

on conflict (tracking_code) do update set
  carrier=excluded.carrier, current_status=excluded.current_status, data=excluded.data;

-- ---------------------------------------------------------------------------
-- Facturen.
--
-- Twee soorten, want dat is wat deze winkel factureert: een eenmalige
-- implementatiefactuur bij de start, en daarna maandfacturen per module. Dat
-- onderscheid is niet decoratief — een creditnota gaat hier over een maand die
-- niet geleverd is, en dan moet er een maandregel zijn om naar te wijzen.
--
-- De bedragen zijn zo gekozen dat beide kanten van de drempel (€ 250) in de
-- demo voorkomen: de ticketing-regel op F-2026-1005 mag een medewerker
-- aftekenen, de chatbot-regel op F-2026-1002 vraagt om een beheerder.
-- ---------------------------------------------------------------------------
insert into public.demo_invoices (invoice_number, order_number, customer_email, status, total_value, currency, data) values

('F-2026-1001', 'DEMO-1001', 'j.dekker@example.com', 'open', 5700, 'EUR',
 '{"invoiceNumber":"F-2026-1001","orderNumber":"DEMO-1001","customerEmail":"j.dekker@example.com","invoiceDate":"2026-07-15","soort":"eenmalig","status":"open","currency":"EUR","totalValue":5700,"lines":[{"sku":"FA-AGT-MAIL","description":"Mailagent - inrichting","quantity":1,"unitPrice":4500,"lineTotal":4500},{"sku":"FA-KOP-M365","description":"Koppeling Microsoft 365 - inrichting","quantity":1,"unitPrice":1200,"lineTotal":1200}]}'::jsonb),

('F-2026-1002', 'DEMO-1002', 'm.vandenberg@example.com', 'open', 700, 'EUR',
 '{"invoiceNumber":"F-2026-1002","orderNumber":"DEMO-1002","customerEmail":"m.vandenberg@example.com","invoiceDate":"2026-08-01","soort":"maandelijks","periode":"augustus 2026","status":"open","currency":"EUR","totalValue":700,"lines":[{"sku":"FA-AGT-CHAT","description":"Chatbot - augustus 2026","quantity":1,"unitPrice":450,"lineTotal":450},{"sku":"FA-MOD-KB","description":"Kennisbank - augustus 2026","quantity":1,"unitPrice":250,"lineTotal":250}]}'::jsonb),

('F-2026-1003', 'DEMO-1003', 'p.jansen@example.com', 'open', 7000, 'EUR',
 '{"invoiceNumber":"F-2026-1003","orderNumber":"DEMO-1003","customerEmail":"p.jansen@example.com","invoiceDate":"2026-07-29","soort":"eenmalig","status":"open","currency":"EUR","totalValue":7000,"lines":[{"sku":"FA-AGT-MAIL","description":"Mailagent - inrichting","quantity":1,"unitPrice":4500,"lineTotal":4500},{"sku":"FA-AGT-WA","description":"WhatsApp-agent - inrichting","quantity":1,"unitPrice":2500,"lineTotal":2500}]}'::jsonb),

('F-2026-1004', 'DEMO-1004', 's.bakker@example.com', 'open', 900, 'EUR',
 '{"invoiceNumber":"F-2026-1004","orderNumber":"DEMO-1004","customerEmail":"s.bakker@example.com","invoiceDate":"2026-08-01","soort":"maandelijks","periode":"augustus 2026","status":"open","currency":"EUR","totalValue":900,"lines":[{"sku":"FA-AGT-DOC","description":"Documentagent - augustus 2026","quantity":1,"unitPrice":650,"lineTotal":650},{"sku":"FA-MOD-KB","description":"Kennisbank - augustus 2026","quantity":1,"unitPrice":250,"lineTotal":250}]}'::jsonb),

('F-2026-1005', 'DEMO-1005', 'r.smit@example.com', 'open', 650, 'EUR',
 '{"invoiceNumber":"F-2026-1005","orderNumber":"DEMO-1005","customerEmail":"r.smit@example.com","invoiceDate":"2026-08-01","soort":"maandelijks","periode":"augustus 2026","status":"open","currency":"EUR","totalValue":650,"lines":[{"sku":"FA-AGT-CHAT","description":"Chatbot - augustus 2026","quantity":1,"unitPrice":450,"lineTotal":450},{"sku":"FA-MOD-TIC","description":"Ticketing - augustus 2026","quantity":1,"unitPrice":200,"lineTotal":200}]}'::jsonb)

on conflict (invoice_number) do update set
  order_number=excluded.order_number, customer_email=excluded.customer_email,
  status=excluded.status, total_value=excluded.total_value,
  currency=excluded.currency, data=excluded.data;

-- Opruimen: mijlpaalrijen waar geen traject meer naar wijst. Die blijven anders
-- staan als losse track & trace van een pakket dat niet bestaat, en de agent
-- kan ze niet vinden maar een mens die in de tabel kijkt wel.
delete from public.demo_order_tracking
 where tracking_code not in (
   select tracking_code from public.demo_orders where tracking_code is not null
 );

-- Opruimen: de fysieke artikelen uit 0005 waar 0024 geen vervanger voor had.
-- Blijven ze staan, dan kan de agent een monitorarm opzoeken in een winkel die
-- die niet verkoopt.
delete from public.demo_inventory where sku like 'DEMO-SKU-%';

comment on table public.demo_orders is
  'Demo-trajecten. Een "order" is hier een implementatietraject; tracking_code is het trajectnummer.';
comment on table public.demo_order_tracking is
  'Mijlpalen van een implementatietraject. Bij een fysieke klant is dit track & trace.';
