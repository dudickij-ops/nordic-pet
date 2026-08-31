-- Запись снимка для остальных пяти листов таблицы.
--
-- Каждая функция — копия raw.replace_orders, в которой заменены имя функции, имя таблицы
-- и список колонок. Три действия одним оператором: вставить новое, обновить изменившееся,
-- удалить адреса, которых в снимке больше нет. Пустой снимок отвергается: ноль строк почти
-- всегда означает сбой чтения источника, а не опустевший лист.
--
-- Пять скучных копий вместо одной общей функции с динамическим SQL — выбор сознательный:
-- общая была бы короче, но это код, который пишет код, и одна ошибка в нём ломала бы
-- все источники разом.

create function raw.replace_refunds(p_rows jsonb) returns void
language plpgsql
as $$
begin
  if p_rows is null
     or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) = 0 then
    raise exception 'пустой снимок источника для raw.refunds: загрузка отменена'
      using hint = 'ноль строк почти всегда означает сбой чтения источника, а не опустевший лист';
  end if;

  insert into raw.refunds as t (row_no, refund_date, order_id, sku, units, amount_eur)
  select (r->>'row_no')::integer, r->>'refund_date', r->>'order_id', r->>'sku',
         r->>'units', r->>'amount_eur'
    from jsonb_array_elements(p_rows) as r
      on conflict (row_no) do update
         set refund_date = excluded.refund_date,
             order_id    = excluded.order_id,
             sku         = excluded.sku,
             units       = excluded.units,
             amount_eur  = excluded.amount_eur,
             updated_at  = clock_timestamp()
       where (t.refund_date, t.order_id, t.sku, t.units, t.amount_eur)
          is distinct from
             (excluded.refund_date, excluded.order_id, excluded.sku, excluded.units,
              excluded.amount_eur);

  delete from raw.refunds t
   where not exists (
     select 1 from jsonb_array_elements(p_rows) as r
      where (r->>'row_no')::integer = t.row_no
   );
end;
$$;

create function raw.replace_costs(p_rows jsonb) returns void
language plpgsql
as $$
begin
  if p_rows is null
     or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) = 0 then
    raise exception 'пустой снимок источника для raw.costs: загрузка отменена'
      using hint = 'ноль строк почти всегда означает сбой чтения источника, а не опустевший лист';
  end if;

  insert into raw.costs as t (row_no, sku, cost_eur, valid_from)
  select (r->>'row_no')::integer, r->>'sku', r->>'cost_eur', r->>'valid_from'
    from jsonb_array_elements(p_rows) as r
      on conflict (row_no) do update
         set sku        = excluded.sku,
             cost_eur   = excluded.cost_eur,
             valid_from = excluded.valid_from,
             updated_at = clock_timestamp()
       where (t.sku, t.cost_eur, t.valid_from)
          is distinct from
             (excluded.sku, excluded.cost_eur, excluded.valid_from);

  delete from raw.costs t
   where not exists (
     select 1 from jsonb_array_elements(p_rows) as r
      where (r->>'row_no')::integer = t.row_no
   );
end;
$$;

create function raw.replace_fees(p_rows jsonb) returns void
language plpgsql
as $$
begin
  if p_rows is null
     or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) = 0 then
    raise exception 'пустой снимок источника для raw.fees: загрузка отменена'
      using hint = 'ноль строк почти всегда означает сбой чтения источника, а не опустевший лист';
  end if;

  insert into raw.fees as t (row_no, gateway, percent, fixed_eur)
  select (r->>'row_no')::integer, r->>'gateway', r->>'percent', r->>'fixed_eur'
    from jsonb_array_elements(p_rows) as r
      on conflict (row_no) do update
         set gateway    = excluded.gateway,
             percent    = excluded.percent,
             fixed_eur  = excluded.fixed_eur,
             updated_at = clock_timestamp()
       where (t.gateway, t.percent, t.fixed_eur)
          is distinct from
             (excluded.gateway, excluded.percent, excluded.fixed_eur);

  delete from raw.fees t
   where not exists (
     select 1 from jsonb_array_elements(p_rows) as r
      where (r->>'row_no')::integer = t.row_no
   );
end;
$$;

create function raw.replace_opex(p_rows jsonb) returns void
language plpgsql
as $$
begin
  if p_rows is null
     or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) = 0 then
    raise exception 'пустой снимок источника для raw.opex: загрузка отменена'
      using hint = 'ноль строк почти всегда означает сбой чтения источника, а не опустевший лист';
  end if;

  insert into raw.opex as t (row_no, month, category, amount_eur)
  select (r->>'row_no')::integer, r->>'month', r->>'category', r->>'amount_eur'
    from jsonb_array_elements(p_rows) as r
      on conflict (row_no) do update
         set month      = excluded.month,
             category   = excluded.category,
             amount_eur = excluded.amount_eur,
             updated_at = clock_timestamp()
       where (t.month, t.category, t.amount_eur)
          is distinct from
             (excluded.month, excluded.category, excluded.amount_eur);

  delete from raw.opex t
   where not exists (
     select 1 from jsonb_array_elements(p_rows) as r
      where (r->>'row_no')::integer = t.row_no
   );
end;
$$;

create function raw.replace_fx(p_rows jsonb) returns void
language plpgsql
as $$
begin
  if p_rows is null
     or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) = 0 then
    raise exception 'пустой снимок источника для raw.fx: загрузка отменена'
      using hint = 'ноль строк почти всегда означает сбой чтения источника, а не опустевший лист';
  end if;

  insert into raw.fx as t (row_no, date, usd_per_eur)
  select (r->>'row_no')::integer, r->>'date', r->>'usd_per_eur'
    from jsonb_array_elements(p_rows) as r
      on conflict (row_no) do update
         set date        = excluded.date,
             usd_per_eur = excluded.usd_per_eur,
             updated_at  = clock_timestamp()
       where (t.date, t.usd_per_eur)
          is distinct from
             (excluded.date, excluded.usd_per_eur);

  delete from raw.fx t
   where not exists (
     select 1 from jsonb_array_elements(p_rows) as r
      where (r->>'row_no')::integer = t.row_no
   );
end;
$$;
