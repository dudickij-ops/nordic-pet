-- Запись снимка папки рекламы.
--
-- ВНИМАНИЕ ТОМУ, КТО ПИШЕТ ЗАГРУЗЧИК S3.
-- Эта функция принимает папку ads-exports ЦЕЛИКОМ, все файлы разом, а не файл за файлом.
-- Область подчистки — вся папка: всё, чего нет во входном снимке, удаляется по всем файлам.
-- Позвать её со строками одного файла — значит стереть строки остальных площадок, и функция
-- будет права: отличить «снимок папки» от «снимка одного файла» ей нечем, оба непусты.
-- Отказ на пустом снимке от этой ошибки не спасает.
-- Отсюда и имя функции, и имя её параметра: вызов с одним файлом читается как ложь
-- уже на месте вызова.
--
-- Почему область именно папка, а не файл: иначе исчезнувший из папки файл остался бы
-- в базе навсегда — его строк нет ни в одном снимке, и удалить их было бы некому.
--
-- Адрес строки здесь составной: имя файла плюс номер строки в нём. Площадку из имени файла
-- функция не выводит — это разбор, и живёт он в S4. Побочно это и позволяет принять оба
-- файла meta: у них разные адреса, а решение, какой из них лишний, принимает S3 по содержимому.

create function raw.replace_entire_ads_folder(p_all_files jsonb) returns void
language plpgsql
as $$
begin
  if p_all_files is null
     or jsonb_typeof(p_all_files) <> 'array'
     or jsonb_array_length(p_all_files) = 0 then
    raise exception 'пустой снимок источника для raw.ads: загрузка отменена'
      using hint = 'снимок приходит по всей папке сразу, все файлы разом; ноль строк означает '
                   'сбой чтения папки, а не опустевшую папку';
  end if;

  insert into raw.ads as t (file_name, row_no, date, campaign, spend_usd)
  select r->>'file_name', (r->>'row_no')::integer, r->>'date', r->>'campaign', r->>'spend_usd'
    from jsonb_array_elements(p_all_files) as r
      on conflict (file_name, row_no) do update
         set date       = excluded.date,
             campaign   = excluded.campaign,
             spend_usd  = excluded.spend_usd,
             updated_at = clock_timestamp()
       where (t.date, t.campaign, t.spend_usd)
          is distinct from
             (excluded.date, excluded.campaign, excluded.spend_usd);

  delete from raw.ads t
   where not exists (
     select 1 from jsonb_array_elements(p_all_files) as r
      where r->>'file_name' = t.file_name
        and (r->>'row_no')::integer = t.row_no
   );
end;
$$;
