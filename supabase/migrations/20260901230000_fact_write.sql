-- Запись слоя фактов и деловые ключи.
--
-- Семь функций снимка — по одной на таблицу фактов, и устроены они так же, как функции
-- записи сырья из S1: вставить новые адреса, обновить изменившиеся с условием «содержимое
-- стало другим», удалить адреса, которых в снимке больше нет. Механизм идемпотентности в
-- проекте один; повторённый вторым способом, он однажды разошёлся бы с первым молча.
--
-- Почему удаление нужно, хотя каскад от сырой строки уже есть. Каскад закрывает случай
-- «сырой строки не стало». Он не закрывает случай «сырая строка есть, а факта у неё быть
-- не должно»: вчера в папке лежал одинокий файл и дал факты, сегодня рядом лёг его
-- экземпляр и победил в разборе — вчерашние факты обязаны уйти.
--
-- ОТЛИЧИЕ ОТ S1: пустой снимок здесь не отказ сам по себе. У сырья ноль строк означал сбой
-- чтения источника; здесь вход — наша же схема raw, и пустой слой фактов при пустом сырье
-- законен. Отказ ставится на другое: непустая сырая таблица при нуле фактов. Так выглядел
-- бы разбор, который прочитал сырьё и молча ничего не разобрал, — тихая потеря всех денег
-- таблицы разом. Проверяет это сама функция: свою сырую таблицу она видит в той же
-- транзакции, и обойти проверку вызывающему нечем.

create function fact.replace_orders(p_rows jsonb) returns void
language plpgsql
as $$
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'снимок для fact.orders не массив: разбор позвал запись неправильно';
  end if;

  if jsonb_array_length(p_rows) = 0 and exists (select 1 from raw.orders) then
    raise exception 'нулевой снимок fact.orders при непустой raw.orders: разбор прочитал сырьё и ничего не разобрал'
      using hint = 'пустые факты законны только при пустом сырье; иначе это тихая потеря всех строк таблицы разом';
  end if;

  insert into fact.orders as t
         (row_no, date, order_id, sku, units, gross, discount, currency, gateway)
  select (r->>'row_no')::integer, (r->>'date')::date, r->>'order_id', r->>'sku',
         (r->>'units')::integer, (r->>'gross')::numeric, (r->>'discount')::numeric,
         r->>'currency', r->>'gateway'
    from jsonb_array_elements(p_rows) as r
      on conflict (row_no) do update
         set date     = excluded.date,
             order_id = excluded.order_id,
             sku      = excluded.sku,
             units    = excluded.units,
             gross    = excluded.gross,
             discount = excluded.discount,
             currency = excluded.currency,
             gateway  = excluded.gateway
       where (t.date, t.order_id, t.sku, t.units, t.gross, t.discount, t.currency, t.gateway)
          is distinct from
             (excluded.date, excluded.order_id, excluded.sku, excluded.units, excluded.gross,
              excluded.discount, excluded.currency, excluded.gateway);

  delete from fact.orders t
   where not exists (
     select 1 from jsonb_array_elements(p_rows) as r
      where (r->>'row_no')::integer = t.row_no
   );
end;
$$;

create function fact.replace_refunds(p_rows jsonb) returns void
language plpgsql
as $$
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'снимок для fact.refunds не массив: разбор позвал запись неправильно';
  end if;

  if jsonb_array_length(p_rows) = 0 and exists (select 1 from raw.refunds) then
    raise exception 'нулевой снимок fact.refunds при непустой raw.refunds: разбор прочитал сырьё и ничего не разобрал'
      using hint = 'пустые факты законны только при пустом сырье';
  end if;

  insert into fact.refunds as t
         (row_no, refund_date, order_id, sku, units, amount, currency)
  select (r->>'row_no')::integer, (r->>'refund_date')::date, r->>'order_id', r->>'sku',
         (r->>'units')::integer, (r->>'amount')::numeric, r->>'currency'
    from jsonb_array_elements(p_rows) as r
      on conflict (row_no) do update
         set refund_date = excluded.refund_date,
             order_id    = excluded.order_id,
             sku         = excluded.sku,
             units       = excluded.units,
             amount      = excluded.amount,
             currency    = excluded.currency
       where (t.refund_date, t.order_id, t.sku, t.units, t.amount, t.currency)
          is distinct from
             (excluded.refund_date, excluded.order_id, excluded.sku, excluded.units,
              excluded.amount, excluded.currency);

  delete from fact.refunds t
   where not exists (
     select 1 from jsonb_array_elements(p_rows) as r
      where (r->>'row_no')::integer = t.row_no
   );
end;
$$;

create function fact.replace_costs(p_rows jsonb) returns void
language plpgsql
as $$
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'снимок для fact.costs не массив: разбор позвал запись неправильно';
  end if;

  if jsonb_array_length(p_rows) = 0 and exists (select 1 from raw.costs) then
    raise exception 'нулевой снимок fact.costs при непустой raw.costs: разбор прочитал сырьё и ничего не разобрал'
      using hint = 'пустые факты законны только при пустом сырье';
  end if;

  insert into fact.costs as t (row_no, sku, cost, currency, valid_from)
  select (r->>'row_no')::integer, r->>'sku', (r->>'cost')::numeric, r->>'currency',
         (r->>'valid_from')::date
    from jsonb_array_elements(p_rows) as r
      on conflict (row_no) do update
         set sku        = excluded.sku,
             cost       = excluded.cost,
             currency   = excluded.currency,
             valid_from = excluded.valid_from
       where (t.sku, t.cost, t.currency, t.valid_from)
          is distinct from
             (excluded.sku, excluded.cost, excluded.currency, excluded.valid_from);

  delete from fact.costs t
   where not exists (
     select 1 from jsonb_array_elements(p_rows) as r
      where (r->>'row_no')::integer = t.row_no
   );
end;
$$;

create function fact.replace_fees(p_rows jsonb) returns void
language plpgsql
as $$
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'снимок для fact.fees не массив: разбор позвал запись неправильно';
  end if;

  if jsonb_array_length(p_rows) = 0 and exists (select 1 from raw.fees) then
    raise exception 'нулевой снимок fact.fees при непустой raw.fees: разбор прочитал сырьё и ничего не разобрал'
      using hint = 'пустые факты законны только при пустом сырье';
  end if;

  insert into fact.fees as t (row_no, gateway, percent, fixed, currency)
  select (r->>'row_no')::integer, r->>'gateway', (r->>'percent')::numeric,
         (r->>'fixed')::numeric, r->>'currency'
    from jsonb_array_elements(p_rows) as r
      on conflict (row_no) do update
         set gateway  = excluded.gateway,
             percent  = excluded.percent,
             fixed    = excluded.fixed,
             currency = excluded.currency
       where (t.gateway, t.percent, t.fixed, t.currency)
          is distinct from
             (excluded.gateway, excluded.percent, excluded.fixed, excluded.currency);

  delete from fact.fees t
   where not exists (
     select 1 from jsonb_array_elements(p_rows) as r
      where (r->>'row_no')::integer = t.row_no
   );
end;
$$;

create function fact.replace_opex(p_rows jsonb) returns void
language plpgsql
as $$
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'снимок для fact.opex не массив: разбор позвал запись неправильно';
  end if;

  if jsonb_array_length(p_rows) = 0 and exists (select 1 from raw.opex) then
    raise exception 'нулевой снимок fact.opex при непустой raw.opex: разбор прочитал сырьё и ничего не разобрал'
      using hint = 'пустые факты законны только при пустом сырье';
  end if;

  insert into fact.opex as t (row_no, month, category, amount, currency)
  select (r->>'row_no')::integer, (r->>'month')::date, r->>'category',
         (r->>'amount')::numeric, r->>'currency'
    from jsonb_array_elements(p_rows) as r
      on conflict (row_no) do update
         set month    = excluded.month,
             category = excluded.category,
             amount   = excluded.amount,
             currency = excluded.currency
       where (t.month, t.category, t.amount, t.currency)
          is distinct from
             (excluded.month, excluded.category, excluded.amount, excluded.currency);

  delete from fact.opex t
   where not exists (
     select 1 from jsonb_array_elements(p_rows) as r
      where (r->>'row_no')::integer = t.row_no
   );
end;
$$;

create function fact.replace_fx(p_rows jsonb) returns void
language plpgsql
as $$
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'снимок для fact.fx не массив: разбор позвал запись неправильно';
  end if;

  if jsonb_array_length(p_rows) = 0 and exists (select 1 from raw.fx) then
    raise exception 'нулевой снимок fact.fx при непустой raw.fx: разбор прочитал сырьё и ничего не разобрал'
      using hint = 'пустые факты законны только при пустом сырье';
  end if;

  insert into fact.fx as t (row_no, date, usd_per_eur)
  select (r->>'row_no')::integer, (r->>'date')::date, (r->>'usd_per_eur')::numeric
    from jsonb_array_elements(p_rows) as r
      on conflict (row_no) do update
         set date        = excluded.date,
             usd_per_eur = excluded.usd_per_eur
       where (t.date, t.usd_per_eur)
          is distinct from (excluded.date, excluded.usd_per_eur);

  delete from fact.fx t
   where not exists (
     select 1 from jsonb_array_elements(p_rows) as r
      where (r->>'row_no')::integer = t.row_no
   );
end;
$$;

-- У рекламы адрес составной, как и в сыром слое: имя файла плюс номер строки. Площадка —
-- колонка результата разбора, а не часть адреса: один и тот же файл целиком принадлежит
-- одной площадке.
create function fact.replace_ads(p_rows jsonb) returns void
language plpgsql
as $$
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'снимок для fact.ads не массив: разбор позвал запись неправильно';
  end if;

  if jsonb_array_length(p_rows) = 0 and exists (select 1 from raw.ads) then
    raise exception 'нулевой снимок fact.ads при непустой raw.ads: разбор прочитал сырьё и ничего не разобрал'
      using hint = 'свёртка копий всегда оставляет один экземпляр, поэтому непустая папка обязана дать факты';
  end if;

  insert into fact.ads as t (file_name, row_no, date, campaign, platform, spend, currency)
  select r->>'file_name', (r->>'row_no')::integer, (r->>'date')::date, r->>'campaign',
         r->>'platform', (r->>'spend')::numeric, r->>'currency'
    from jsonb_array_elements(p_rows) as r
      on conflict (file_name, row_no) do update
         set date     = excluded.date,
             campaign = excluded.campaign,
             platform = excluded.platform,
             spend    = excluded.spend,
             currency = excluded.currency
       where (t.date, t.campaign, t.platform, t.spend, t.currency)
          is distinct from
             (excluded.date, excluded.campaign, excluded.platform, excluded.spend,
              excluded.currency);

  delete from fact.ads t
   where not exists (
     select 1 from jsonb_array_elements(p_rows) as r
      where r->>'file_name' = t.file_name
        and (r->>'row_no')::integer = t.row_no
   );
end;
$$;

-- Деловые ключи.
--
-- S1 оставил слою фактов возможность держать две строки на один деловой ключ и оставил S4
-- обязательство такие противоречия заметить. Разбор их и замечает — отказом, человеческими
-- словами, с указанием ключа. Ограничения ниже стоят за этим отказом вторым рубежом: они
-- делают молчаливую запись противоречия невозможной, а не нежелательной. Запись мимо разбора
-- упрётся в них, даже если однажды разбор ошибётся.
--
-- Все четыре объявлены ОТЛОЖЕННЫМИ. Проверять деловой ключ на промежуточном состоянии
-- нельзя: внутри одной записи два курса могут обменяться датами, и в середине оператора
-- уникальность законно нарушена, хотя в конце всё сходится. Проверено запуском на
-- PostgreSQL 15.18: без отложенности обмен упирается в «duplicate key», с отложенностью
-- проходит.
--
-- `nulls not distinct` — потому что две пустые даты это одна беда, а не две разные строки.
-- Без него указатель пропустил бы ровно тот случай, ради которого стоит.

alter table fact.fx
  add constraint fx_one_rate_per_day
  unique nulls not distinct (date) deferrable initially deferred;

alter table fact.costs
  add constraint costs_one_price_per_sku_and_start
  unique nulls not distinct (sku, valid_from) deferrable initially deferred;

alter table fact.fees
  add constraint fees_one_rate_per_gateway
  unique nulls not distinct (gateway) deferrable initially deferred;

alter table fact.ads
  add constraint ads_one_row_per_platform_day_campaign
  unique nulls not distinct (platform, date, campaign) deferrable initially deferred;

-- Процент комиссии хранится в процентных пунктах, как в источнике: у карты это 1.9000,
-- а не 0.0190.
--
-- Ограничение запрещает ноль и отрицательное: нулевая ставка молча обнулила бы комиссию по
-- всем заказам этого способа оплаты, а правило 7 задания при этом выглядело бы исполненным.
--
-- ЧЕГО ЭТО ОГРАНИЧЕНИЕ НЕ ДЕЛАЕТ, И ЭТО НАДО ЗНАТЬ. Долю, записанную вместо пунктов, оно НЕ
-- ловит: 0.0190 больше нуля и проходит. Отличить «доля вместо пунктов» от законной ставки в
-- сотую долю процента базе нечем, а порога, ниже которого ставок не бывает, нет ни в задании,
-- ни в какой доступной нам документации, — и выдумывать его мы не станем.
-- Верхнюю границу ставит сам тип колонки: numeric(6,4) держит не больше 99.9999, и 120
-- упирается в «numeric field overflow» ещё до проверки. Отдельного условия «не больше ста»
-- здесь поэтому нет: недостижимое условие создавало бы видимость замка, которого нет.
alter table fact.fees
  add constraint fees_percent_is_points
  check (percent is null or percent > 0);
