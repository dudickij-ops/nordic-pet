-- Запись снимка листа orders.
--
-- Вход — снимок листа целиком, а не порция. Отсюда три действия одним оператором:
-- вставить новые адреса, обновить изменившиеся, удалить те, которых в снимке больше нет.
-- Вызов функции — один оператор, значит всё это происходит в одной транзакции:
-- наполовину применённого снимка не бывает.
--
-- Почему подчистка живёт здесь, а не в загрузчике: S2 и S3 написали бы её каждый по-своему
-- и разошлись бы молча. Опознание строки адресом закрывает дописанную, исправленную и
-- вставленную строку, но не удалённую: без delete последний адрес остался бы в базе со старым
-- содержимым, и экран показал бы деньги, которых в источнике уже нет.

create function raw.replace_orders(p_rows jsonb) returns void
language plpgsql
as $$
begin
  -- Ноль строк почти всегда означает сбой чтения источника, а не опустевший лист.
  -- Подчистка на пустом снимке вычистила бы таблицу дочиста, поэтому — отказ.
  if p_rows is null
     or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) = 0 then
    raise exception 'пустой снимок источника для raw.orders: загрузка отменена'
      using hint = 'ноль строк почти всегда означает сбой чтения источника, а не опустевший лист';
  end if;

  insert into raw.orders as t
         (row_no, date, order_id, sku, units, gross_eur, discount_eur, gateway)
  select (r->>'row_no')::integer, r->>'date', r->>'order_id', r->>'sku', r->>'units',
         r->>'gross_eur', r->>'discount_eur', r->>'gateway'
    from jsonb_array_elements(p_rows) as r
      on conflict (row_no) do update
         set date         = excluded.date,
             order_id     = excluded.order_id,
             sku          = excluded.sku,
             units        = excluded.units,
             gross_eur    = excluded.gross_eur,
             discount_eur = excluded.discount_eur,
             gateway      = excluded.gateway,
             updated_at   = clock_timestamp()
       -- Строка переписывается только если её содержимое стало другим. Без этого условия
       -- updated_at менялся бы при каждом вызове, и «повторная загрузка ничего не изменила»
       -- перестало бы быть правдой буквально.
       where (t.date, t.order_id, t.sku, t.units, t.gross_eur, t.discount_eur, t.gateway)
          is distinct from
             (excluded.date, excluded.order_id, excluded.sku, excluded.units,
              excluded.gross_eur, excluded.discount_eur, excluded.gateway);

  delete from raw.orders t
   where not exists (
     select 1 from jsonb_array_elements(p_rows) as r
      where (r->>'row_no')::integer = t.row_no
   );
end;
$$;
