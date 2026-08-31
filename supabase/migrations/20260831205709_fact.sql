-- Слой фактов: те же строки источника, приведённые к типам.
--
-- Строка факта — это разобранная строка источника, а не выдуманная сущность. Поэтому ключ
-- факта — тот же адрес в источнике, что и у сырой строки, и он же внешний ключ на неё.
-- Отсюда две вещи. Цепочка «источник → сырьё → факты» становится проверяемой: у каждого числа
-- на экране есть адрес строки, из которой оно взялось. И подчистка исчезнувших строк достаётся
-- слою фактов даром — исчезнувшая сырая строка уносит свой факт с собой.
--
-- ВНИМАНИЕ ТОМУ, КТО ПИШЕТ РАЗБОР В S4. Каскад закрывает только удаление. Функция записи
-- снимка ещё и обновляет строки: человек исправил опечатку в листе, сырая строка переписалась,
-- а факт остался прежним — каскад тут не сработает, потому что строка не исчезла, а изменилась.
-- Разбор обязан пересчитывать факты и по изменившимся сырым строкам тоже. Признак заложен
-- именно для этого: raw.*.updated_at меняется тогда и только тогда, когда содержимое строки
-- стало другим.
--
-- Деньги хранятся в той валюте, в которой выставлены: валюта — отдельная колонка рядом с
-- суммой, а не намёк в имени поля. Пересчёт по курсу того дня — работа S4.
-- Ни одна колонка с числом источника не объявлена not null и не имеет умолчания:
-- отсутствующая себестоимость обязана остаться отсутствующей, а не превратиться в ноль.

create table fact.orders (
  row_no   integer primary key references raw.orders(row_no) on delete cascade,
  date     date,
  order_id text,
  sku      text,
  units    integer,
  gross    numeric(14,2),
  discount numeric(14,2),
  currency char(3),
  gateway  text,
  constraint orders_currency_required
    check (num_nulls(gross, discount) = 2 or currency is not null)
);

create table fact.refunds (
  row_no      integer primary key references raw.refunds(row_no) on delete cascade,
  refund_date date,
  order_id    text,
  sku         text,
  units       integer,
  amount      numeric(14,2),
  currency    char(3),
  constraint refunds_currency_required check (amount is null or currency is not null)
);

create table fact.costs (
  row_no     integer primary key references raw.costs(row_no) on delete cascade,
  sku        text,
  cost       numeric(14,2),
  currency   char(3),
  valid_from date,
  constraint costs_currency_required check (cost is null or currency is not null)
);

create table fact.fees (
  row_no   integer primary key references raw.fees(row_no) on delete cascade,
  gateway  text,
  percent  numeric(6,4),
  fixed    numeric(14,2),
  currency char(3),
  constraint fees_currency_required check (fixed is null or currency is not null)
);

create table fact.opex (
  row_no   integer primary key references raw.opex(row_no) on delete cascade,
  month    date,
  category text,
  amount   numeric(14,2),
  currency char(3),
  constraint opex_currency_required check (amount is null or currency is not null)
);

-- У курса валюты нет: пара названа в имени колонки, и хранить её отдельно значило бы
-- завести место, где она может разойтись с именем.
create table fact.fx (
  row_no      integer primary key references raw.fx(row_no) on delete cascade,
  date        date,
  usd_per_eur numeric(12,6)
);

-- Площадки в источнике нет — она выводится из имени файла. В слое разобранного это законно.
create table fact.ads (
  file_name text    not null,
  row_no    integer not null,
  date      date,
  campaign  text,
  platform  text,
  spend     numeric(14,2),
  currency  char(3),
  primary key (file_name, row_no),
  foreign key (file_name, row_no) references raw.ads(file_name, row_no) on delete cascade,
  constraint ads_currency_required check (spend is null or currency is not null)
);
