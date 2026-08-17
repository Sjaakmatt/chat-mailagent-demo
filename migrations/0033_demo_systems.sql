-- 0033_demo_systems
--
-- De bronsystemen waar een goedgekeurde schrijfoperatie in terechtkomt, in
-- demo-vorm.
--
-- `0005_demo_testdata.sql` gaf de agent iets om te LEZEN: orders, tracking,
-- voorraad. Dit geeft hem iets om in te SCHRIJVEN. Zonder die tweede helft
-- eindigt elke goedgekeurde actie op `mislukt` met "geen endpoint voor MCP
-- 'crm'", en dan is de goedkeuringslaag een knop die niets doet.
--
-- ## Waarom dit in het fundament staat en niet bij een klant
--
-- Om dezelfde reden als 0005: een verse klant-agent moet demonstreerbaar zijn
-- vóór er één echte koppeling ligt. Bij een echte klant vervangt de ERP-/CRM-MCP
-- deze tabellen — de actietypen wijzen al naar die tools, en de agentcode, de
-- poorten en het goedkeurscherm veranderen niet mee. Alleen het doelsysteem
-- verschilt.
--
-- Alle namen, adressen en bedragen zijn verzonnen (example.com), en dat moet zo
-- blijven.
--
-- ## Waarom facturen een eigen tabel zijn en geen veld op de order
--
-- Eén order kan meer dan één factuur hebben (deellevering, nalevering,
-- correctie), en een creditnota hoort bij een fáctuur en niet bij een order.
-- Als veld op de order zou "crediteer 89,95" niet te herleiden zijn naar wat er
-- precies is gefactureerd — en dat is nu juist het veld waar de onderbouwing
-- aan hangt.

create table if not exists public.demo_invoices (
  invoice_number text primary key,
  order_number   text,
  customer_email text,
  -- open | betaald | gecrediteerd. Dit veld is de preconditie van een
  -- creditnota: staat hij bij goedkeuring niet meer op `open`, dan wordt er
  -- niets geboekt.
  status         text not null default 'open',
  total_value    numeric,
  currency       text default 'EUR',
  data           jsonb not null,
  created_at     timestamptz not null default now()
);
create index if not exists demo_invoices_order_idx on public.demo_invoices (order_number);

-- ---------------------------------------------------------------------------
-- Schrijfdoelen. Elk met een idempotency-sleutel, want een Workflow-step mag
-- opnieuw draaien en een tweede creditnota van hetzelfde bedrag is precies wat
-- die sleutel moet voorkomen.
-- ---------------------------------------------------------------------------

create table if not exists public.demo_credit_notes (
  id              text primary key,
  invoice_number  text not null,
  amount          numeric not null,
  reason          text,
  idempotency_key text not null unique,
  created_at      timestamptz not null default now()
);

create table if not exists public.demo_backorders (
  id              text primary key,
  order_number    text not null,
  sku             text not null,
  quantity        integer not null,
  idempotency_key text not null unique,
  created_at      timestamptz not null default now()
);

create table if not exists public.demo_carrier_investigations (
  id              text primary key,
  tracking_code   text not null,
  carrier         text,
  reason          text,
  idempotency_key text not null unique,
  created_at      timestamptz not null default now()
);

alter table public.demo_invoices                enable row level security;
alter table public.demo_credit_notes            enable row level security;
alter table public.demo_backorders              enable row level security;
alter table public.demo_carrier_investigations  enable row level security;

-- ---- seed ----
-- Eén factuur per order uit 0005. DEMO-1002 is de klacht-order (afgeleverd,
-- beschadigd aangekomen) — dat is het scenario waar de creditnota op draait.

insert into public.demo_invoices (invoice_number, order_number, customer_email, status, total_value, currency, data) values
('F-2026-1001', 'DEMO-1001', 'j.dekker@example.com', 'open', 149, 'EUR',
 '{"invoiceNumber":"F-2026-1001","orderNumber":"DEMO-1001","customerEmail":"j.dekker@example.com","invoiceDate":"2026-08-06","status":"open","currency":"EUR","totalValue":149,"lines":[{"sku":"DEMO-SKU-A","description":"Demoproduct A","quantity":1,"unitPrice":149,"lineTotal":149}]}'::jsonb),
('F-2026-1002', 'DEMO-1002', 'm.vandenberg@example.com', 'open', 89, 'EUR',
 '{"invoiceNumber":"F-2026-1002","orderNumber":"DEMO-1002","customerEmail":"m.vandenberg@example.com","invoiceDate":"2026-08-01","status":"open","currency":"EUR","totalValue":89,"lines":[{"sku":"DEMO-SKU-B","description":"Demoproduct B","quantity":1,"unitPrice":89,"lineTotal":89}]}'::jsonb),
('F-2026-1003', 'DEMO-1003', 'p.jansen@example.com', 'open', 249, 'EUR',
 '{"invoiceNumber":"F-2026-1003","orderNumber":"DEMO-1003","customerEmail":"p.jansen@example.com","invoiceDate":"2026-08-11","status":"open","currency":"EUR","totalValue":249,"lines":[{"sku":"DEMO-SKU-C","description":"Demoproduct C","quantity":1,"unitPrice":249,"lineTotal":249}]}'::jsonb)
on conflict (invoice_number) do update set
  order_number=excluded.order_number, customer_email=excluded.customer_email,
  status=excluded.status, total_value=excluded.total_value,
  currency=excluded.currency, data=excluded.data;

comment on table public.demo_invoices is
  'Demo-facturen. Bij een echte klant vervangt de ERP-/CRM-MCP deze tabel.';
comment on table public.demo_credit_notes is
  'Schrijfdoel van creditnota_voorstellen. Uniek op idempotency_key.';
