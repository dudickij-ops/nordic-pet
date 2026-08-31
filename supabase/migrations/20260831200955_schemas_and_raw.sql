-- Сырой слой: копия источника вместе с его кривизной.
-- Схемы намеренно не public: всё, что лежит в public, читается публичным ключом из браузера.

create schema raw;
create schema fact;

revoke all on schema raw from public;
revoke all on schema fact from public;

-- Все колонки источника — text. Ни одного приведения типа: разбор живёт в S4.
-- row_no и file_name — адрес строки в источнике, а не её содержимое.
-- updated_at меняется только тогда, когда содержимое строки стало другим.

create table raw.orders (
  row_no       integer primary key,
  date         text,
  order_id     text,
  sku          text,
  units        text,
  gross_eur    text,
  discount_eur text,
  gateway      text,
  updated_at   timestamptz not null default now()
);

create table raw.refunds (
  row_no      integer primary key,
  refund_date text,
  order_id    text,
  sku         text,
  units       text,
  amount_eur  text,
  updated_at  timestamptz not null default now()
);

create table raw.costs (
  row_no     integer primary key,
  sku        text,
  cost_eur   text,
  valid_from text,
  updated_at timestamptz not null default now()
);

create table raw.fees (
  row_no    integer primary key,
  gateway   text,
  percent   text,
  fixed_eur text,
  updated_at timestamptz not null default now()
);

create table raw.opex (
  row_no     integer primary key,
  month      text,
  category   text,
  amount_eur text,
  updated_at timestamptz not null default now()
);

create table raw.fx (
  row_no      integer primary key,
  date        text,
  usd_per_eur text,
  updated_at  timestamptz not null default now()
);

-- У рекламы адрес составной: площадка различима только по имени файла,
-- а в папке лежит дубликат выгрузки. Обе строки обязаны поместиться.
create table raw.ads (
  file_name  text    not null,
  row_no     integer not null,
  date       text,
  campaign   text,
  spend_usd  text,
  updated_at timestamptz not null default now(),
  primary key (file_name, row_no)
);
