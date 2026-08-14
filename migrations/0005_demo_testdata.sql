-- Demo-testdata: nep order-/ERP-data zodat de agent orders en track & trace op
-- ordernummer kan opzoeken zonder dat er een extern systeem aan hangt. De agent
-- leest deze tabellen direct (steps.ts -> lookupOrderFromDb); in productie
-- vervangt de ERP-MCP die lookup. Alleen via service-role benaderd -> RLS aan
-- zonder policies (net als de aios_* tabellen).
--
-- De seed hieronder hoort bij de demo-scenario's in
-- `ui/lib/demo/scenarios.ts` — de ordernummers komen daar letterlijk in de
-- mails voor, zodat de agent echte lookups doet en de grounding-check iets te
-- verifieren heeft. Vervang beide bij een nieuwe klant, of laat deze migratie
-- weg als je meteen op een echte ERP-MCP aansluit.
--
-- Alle namen, adressen en e-mailadressen zijn verzonnen (example.com).

create table if not exists public.demo_orders (
  order_number   text primary key,
  customer_email text,
  customer_name  text,
  status         text,
  total_value    numeric,
  currency       text,
  carrier        text,
  tracking_code  text,
  data           jsonb not null,
  created_at     timestamptz not null default now()
);
create index if not exists demo_orders_email_idx on public.demo_orders (lower(customer_email));

create table if not exists public.demo_order_tracking (
  tracking_code  text primary key,
  carrier        text,
  current_status text,
  data           jsonb not null,
  created_at     timestamptz not null default now()
);

create table if not exists public.demo_inventory (
  sku            text primary key,
  product_name   text,
  category       text,
  in_stock       integer,
  unit_value     numeric,
  lead_time_days integer,
  data           jsonb not null,
  created_at     timestamptz not null default now()
);

create table if not exists public.demo_customers (
  email      text primary key,
  name       text,
  data       jsonb,
  created_at timestamptz not null default now()
);

alter table public.demo_orders          enable row level security;
alter table public.demo_order_tracking  enable row level security;
alter table public.demo_inventory       enable row level security;
alter table public.demo_customers       enable row level security;

-- ---- seed ----
-- Drie orders die de demo-mails aanhalen: afgeleverd, onderweg en zonder
-- tracking. Genoeg variatie om te laten zien dat de agent alleen beweert wat
-- hij echt heeft opgehaald.

insert into public.demo_orders (order_number, customer_email, customer_name, status, total_value, currency, carrier, tracking_code, data) values
('DEMO-1001', 'j.dekker@example.com', 'Jeroen Dekker', 'shipped', 149, 'EUR', 'PostNL', '3SDEMO0001001',
 '{"orderNumber":"DEMO-1001","customerEmail":"j.dekker@example.com","customerName":"Jeroen Dekker","orderDate":"2026-08-06T10:30:00Z","totalValue":149,"currency":"EUR","items":[{"sku":"DEMO-SKU-A","productName":"Demoproduct A","quantity":1,"unitPrice":149}],"shippingAddress":{"street":"Voorbeeldstraat 1","postalCode":"1000 AA","city":"Amsterdam","country":"NL"},"status":"shipped","trackingCode":"3SDEMO0001001","carrier":"PostNL"}'::jsonb),
('DEMO-1002', 'm.vandenberg@example.com', 'Marieke van den Berg', 'delivered', 89, 'EUR', 'PostNL', '3SDEMO0001002',
 '{"orderNumber":"DEMO-1002","customerEmail":"m.vandenberg@example.com","customerName":"Marieke van den Berg","orderDate":"2026-08-01T14:15:00Z","totalValue":89,"currency":"EUR","items":[{"sku":"DEMO-SKU-B","productName":"Demoproduct B","quantity":1,"unitPrice":89}],"shippingAddress":{"street":"Voorbeeldlaan 22","postalCode":"3500 BB","city":"Utrecht","country":"NL"},"status":"delivered","trackingCode":"3SDEMO0001002","carrier":"PostNL"}'::jsonb),
('DEMO-1003', 'p.jansen@example.com', 'Peter Jansen', 'pending', 249, 'EUR', null, null,
 '{"orderNumber":"DEMO-1003","customerEmail":"p.jansen@example.com","customerName":"Peter Jansen","orderDate":"2026-08-11T09:05:00Z","totalValue":249,"currency":"EUR","items":[{"sku":"DEMO-SKU-C","productName":"Demoproduct C","quantity":1,"unitPrice":249}],"shippingAddress":{"street":"Voorbeeldweg 7","postalCode":"5600 CC","city":"Eindhoven","country":"NL"},"status":"pending"}'::jsonb)
on conflict (order_number) do update set
  customer_email=excluded.customer_email, customer_name=excluded.customer_name,
  status=excluded.status, total_value=excluded.total_value, currency=excluded.currency,
  carrier=excluded.carrier, tracking_code=excluded.tracking_code, data=excluded.data;

insert into public.demo_order_tracking (tracking_code, carrier, current_status, data) values
('3SDEMO0001001', 'PostNL', 'In bezorging',
 '{"trackingCode":"3SDEMO0001001","carrier":"PostNL","currentStatus":"In bezorging","estimatedDelivery":"2026-08-15T17:00:00Z","events":[{"timestamp":"2026-08-14T08:10:00Z","status":"In bezorging","location":"Amsterdam sorteercentrum"},{"timestamp":"2026-08-13T21:30:00Z","status":"Aangekomen in sorteercentrum","location":"Amsterdam"}]}'::jsonb),
('3SDEMO0001002', 'PostNL', 'Afgeleverd',
 '{"trackingCode":"3SDEMO0001002","carrier":"PostNL","currentStatus":"Afgeleverd","estimatedDelivery":"2026-08-04T17:00:00Z","events":[{"timestamp":"2026-08-04T15:42:00Z","status":"Afgeleverd aan ontvanger","location":"Utrecht"},{"timestamp":"2026-08-04T08:05:00Z","status":"In bezorging","location":"Utrecht sorteercentrum"}]}'::jsonb)
on conflict (tracking_code) do update set
  carrier=excluded.carrier, current_status=excluded.current_status, data=excluded.data;

insert into public.demo_inventory (sku, product_name, category, in_stock, unit_value, lead_time_days, data) values
('DEMO-SKU-A', 'Demoproduct A', 'demo', 42, 149, 2, '{"sku":"DEMO-SKU-A","productName":"Demoproduct A","inStock":42,"leadTimeDays":2}'::jsonb),
('DEMO-SKU-B', 'Demoproduct B', 'demo', 0,  89, 14, '{"sku":"DEMO-SKU-B","productName":"Demoproduct B","inStock":0,"leadTimeDays":14}'::jsonb),
('DEMO-SKU-C', 'Demoproduct C', 'demo', 7, 249, 5, '{"sku":"DEMO-SKU-C","productName":"Demoproduct C","inStock":7,"leadTimeDays":5}'::jsonb)
on conflict (sku) do update set
  product_name=excluded.product_name, category=excluded.category, in_stock=excluded.in_stock,
  unit_value=excluded.unit_value, lead_time_days=excluded.lead_time_days, data=excluded.data;

insert into public.demo_customers (email, name, data) values
('j.dekker@example.com', 'Jeroen Dekker', '{"email":"j.dekker@example.com","name":"Jeroen Dekker","orderCount":1}'::jsonb),
('m.vandenberg@example.com', 'Marieke van den Berg', '{"email":"m.vandenberg@example.com","name":"Marieke van den Berg","orderCount":1}'::jsonb),
('p.jansen@example.com', 'Peter Jansen', '{"email":"p.jansen@example.com","name":"Peter Jansen","orderCount":1}'::jsonb)
on conflict (email) do update set name=excluded.name, data=excluded.data;
