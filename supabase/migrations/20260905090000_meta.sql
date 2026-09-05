-- Схема meta: служебные отметки самого приложения, а не данные источника.
--
-- Почему отдельная схема, а не raw и не fact. Обе заперты принятыми проверками S1 — «в схеме
-- raw ровно семь таблиц источника» и «в схеме fact ровно семь таблиц», — и восьмая таблица там
-- покрасила бы чужую принятую проверку. Менять принятое ради удобства нового нельзя; значит
-- новому нужно своё место. Смысл у него и вправду свой: здесь не источник и не разобранный
-- источник, а то, что приложение помнит о себе.
--
-- Наружу схема не выставляется — ни через API, ни публичной ролью: в таблице попыток входа
-- лежат адреса посетителей, а отметка свежести говорит о внутренних сроках работы.

create schema meta;

revoke all on schema meta from public;

-- Неудачные попытки входа.
--
-- Удачные здесь не хранятся вовсе: удачный вход стирает записи своего адреса, и это и есть
-- обнуление счёта. Хранить успех было бы хранить лишнее о том, кто и когда работал.
--
-- Адрес посетителя приходит из заголовка, который на нашем хостинге ставит сам хостинг
-- (Vercel: «The public IP address of the client that made the request»; «we currently overwrite
-- the X-Forwarded-For header and do not forward external IPs. This restriction is in place to
-- prevent IP spoofing»). На местной работе заголовка нет, и тогда счёт идёт по общему ведру с
-- явным именем — молчаливого пропуска нет.
create table meta.login_attempts (
  id        bigint generated always as identity primary key,
  address   text not null,
  failed_at timestamptz not null default clock_timestamp()
);

create index login_attempts_address_failed_at on meta.login_attempts (address, failed_at);

-- Отметка того сырья, по которому собраны факты.
--
-- Ровно одна строка на всю базу: это состояние базы, а не запись о событии. Единственность
-- держится ключом по столбцу, который может быть только истиной, — вторую строку сюда не
-- вставить, даже нарочно.
--
-- Пишет её разбор, в своей же транзакции: отметка, записанная отдельно, разошлась бы с фактами
-- ровно тогда, когда разбор отказал на середине, — то есть именно тогда, когда она нужна.
create table meta.fact_freshness (
  only_row    boolean primary key default true check (only_row),
  raw_seen_at timestamptz not null
);

-- Записать неудачную попытку и заодно прибрать просроченные.
--
-- Правило удаления живёт здесь, вместе с записью, и это решение: отдельное расписание было бы
-- ещё одним механизмом, за которым надо следить, а таблица растёт ровно в тот момент, когда в
-- неё пишут. Записи старше окна запирания не нужны никому — ни счёту, ни человеку.
--
-- Возвращает, сколько неудач у этого адреса осталось в окне после записи.
create function meta.record_failure(p_address text, p_window interval)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  delete from meta.login_attempts where failed_at < clock_timestamp() - p_window;
  -- `insert … select`, а не `insert … values (…)`: в этом проекте `values (` в миграции
  -- означает литеральные демонстрационные строки, и принятая проверка S1 сторожит именно это.
  -- Здесь вставляется довод функции, а не данные.
  insert into meta.login_attempts (address) select p_address;
  select count(*) into n from meta.login_attempts where address = p_address;
  return n;
end;
$$;

-- Сколько неудач у адреса в окне и когда была самая ранняя из них.
--
-- Читающая, ничего не пишет: спрашивается до сверки пароля, то есть на каждом заходе, в том
-- числе на удачном. По самой ранней считается, когда запирание отпустит: она уйдёт из окна
-- первой.
create function meta.failures(p_address text, p_window interval)
returns table (n integer, oldest timestamptz)
language sql
as $$
  select count(*)::integer, min(failed_at)
    from meta.login_attempts
   where address = p_address
     and failed_at >= clock_timestamp() - p_window;
$$;

-- Обнулить счёт адреса. Зовётся удачным входом.
create function meta.clear_failures(p_address text)
returns void
language sql
as $$
  delete from meta.login_attempts where address = p_address;
$$;

-- Отметить, по какому сырью собраны факты.
--
-- Функцией, а не запросом из кода, и это устройство всего проекта: сырьё и факты пишутся
-- функциями снимка, а не операторами записи из загрузчика. Принятая проверка S4 сторожит
-- именно это — сборка фактов не посылает в базу ни одного оператора записи, — и отметка
-- свежести не исключение.
--
-- Зовётся разбором внутри его же транзакции: читается тот самый снимок сырья, по которому
-- собраны факты, и откат разбора уносит отметку вместе с фактами.
create function meta.mark_fact_freshness()
returns void
language sql
as $$
  insert into meta.fact_freshness (raw_seen_at)
  select coalesce(max(updated_at), to_timestamp(0)) from (
    select updated_at from raw.orders
    union all select updated_at from raw.refunds
    union all select updated_at from raw.costs
    union all select updated_at from raw.fees
    union all select updated_at from raw.opex
    union all select updated_at from raw.fx
    union all select updated_at from raw.ads
  ) as сырьё
  on conflict (only_row) do update set raw_seen_at = excluded.raw_seen_at;
$$;

-- Замок на два одновременных обновления.
--
-- Строкой в таблице, а не совещательным замком PostgreSQL, и это решение по итогам проверки
-- кода. Совещательный замок сеансового уровня в бою не работает вовсе: боевой адрес идёт через
-- объединитель соединений в транзакционном режиме, а его карта возможностей говорит про
-- сеансовые совещательные замки «Never» и предупреждает: «This mode breaks a few session-based
-- features of PostgreSQL». Взятие ушло бы на один задний конец, отпускание — на другой, и
-- кнопка «Обновить» закрылась бы навсегда после первого нажатия. Местная база этого не
-- показывает: там прямое соединение.
--
-- Строка в таблице сеансового состояния не требует и работает через любой объединитель.
create table meta.refresh_lock (
  only_row boolean primary key default true check (only_row),
  taken_at timestamptz,
  -- Жетон владельца: по нему отпускание узнаёт свой замок.
  --
  -- Отдельным столбцом, а не отметкой времени. Отметка, съездившая в код и обратно, зависит от
  -- того, как её отрисовал сеанс: часовой пояс и формат дат — сеансовые настройки, а взятие и
  -- отпускание в бою идут разными обращениями через объединитель соединений. Разошлись бы
  -- настройки — отпускание не совпало бы ни разу и молча: ноль строк, никакой ошибки, и кнопка
  -- заперта на всю аренду после каждого обновления. Найдено проверкой кода.
  token uuid
);

-- Взять замок, если он свободен или его аренда протухла.
--
-- Аренда нужна ровно потому, что таблица, в отличие от сеансового замка, сама не отпустится:
-- процесс, убитый посреди обновления, оставил бы кнопку запертой навсегда. Длительность аренды
-- называет зовущий — она живёт рядом с числами куска, а не спрятана здесь.
--
-- Второй вызов, пришедший вплотную, ждёт не дольше первой команды: `update` берёт замок строки,
-- а дождавшись, перечитывает условие и видит уже занятое — и возвращает отказ, а не очередь.
--
-- Жетон нужен отпусканию: без него отпускание обнуляло бы строку не глядя, и обновление,
-- пережившее аренду, отдало бы замок второму прогону, а потом своим же завершением открыло бы
-- дорогу третьему — поверх работающего второго. Найдено проверкой кода.
--
-- Возвращает **жетон владельца** строкой, или NULL, если замок занят. Жетон — случайный, а не
-- производный от времени: отметка времени зависела бы и от точности (микросекунды базы против
-- миллисекунд кода), и от сеансовых настроек отрисовки.
create function meta.take_refresh_lock(p_lease interval)
returns text
language plpgsql
as $$
declare
  жетон text;
begin
  insert into meta.refresh_lock (only_row, taken_at) select true, null
  on conflict (only_row) do nothing;

  update meta.refresh_lock
     set taken_at = clock_timestamp(),
         token = gen_random_uuid()
   where taken_at is null or taken_at < clock_timestamp() - p_lease
  returning token::text into жетон;

  return жетон;
end;
$$;

-- Отпустить замок — только свой.
--
-- Жетон не совпал — значит замок уже отобрали по истечении аренды и он принадлежит другому
-- прогону. Тогда не трогаем: чужой замок отпускает чужая работа.
create function meta.release_refresh_lock(p_жетон text)
returns void
language sql
as $$
  update meta.refresh_lock
     set taken_at = null, token = null
   where token::text = p_жетон;
$$;

-- Отстали ли факты от сырья.
--
-- Одно определение на весь проект: прежде объединение семи сырых таблиц было написано дважды —
-- здесь и в слое метрик, — и восьмая таблица сырья развела бы половины молча, дав «свежо» на
-- устаревших числах. Найдено проверкой кода.
create function meta.facts_are_stale()
returns boolean
language sql
as $$
  select coalesce(
    (select coalesce(max(updated_at), to_timestamp(0)) from (
       select updated_at from raw.orders
       union all select updated_at from raw.refunds
       union all select updated_at from raw.costs
       union all select updated_at from raw.fees
       union all select updated_at from raw.opex
       union all select updated_at from raw.fx
       union all select updated_at from raw.ads
     ) as сырьё) > (select raw_seen_at from meta.fact_freshness),
    true);
$$;
