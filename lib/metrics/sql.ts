/**
 * Запросы счёта — один файл, одно место.
 *
 * `MONTH_TOTALS` — заготовка, в которую задачи 3 и 4 допишут себестоимость, рекламу и
 * комиссии тем же приёмом: новые общие таблицы (`costed`, `advertised`, …) и новые колонки
 * в финальном `select`, без перестановки уже написанного. Поэтому CTE, которые сейчас нужны
 * только правилам 1 и 2, уже названы так, как их будут звать дальше — `lines`, `counted`,
 * `money`, `totals` — а не `revenue_lines` под сегодняшнюю задачу узко.
 *
 * Число, которое уйдёт в JavaScript, — всегда `numeric`, приведённый к тексту в самом конце.
 * Округление живёт только здесь и только один раз: `round(x, 2)` в последнем выражении.
 * Документация PostgreSQL 15 про `numeric`: «Calculations with numeric values yield exact
 * results where possible», а про `double precision`: «If you require exact storage and
 * calculations (such as for monetary amounts), use the numeric type instead»
 * (https://www.postgresql.org/docs/15/datatype-numeric.html). Промежуточных округлений
 * нет нигде — сложение шестнадцатизначных дробей не уползает на копейку раньше времени.
 *
 * Месяц берётся у **заказа целиком**, через `order_day`, а не у отдельной строки. Заказ
 * принадлежит одному дню — это обязательство S4, — но слой метрик не опирается на чужой
 * отказ, а исполняет то же сам. Без этого заказ, чьи строки разошлись датой, получил бы
 * свой возврат дважды: свёртка `returned` идёт по паре «заказ + артикул» и месяца не
 * знает. Проверка кода доказала это запуском: пара со строками 100,00 марта и 100,00
 * апреля и одним возвратом 40,00 давала чистую выручку 60,00 в обоих месяцах разом —
 * возврат вычитался из каждого. Через боевой путь это состояние недостижимо (S4
 * отказывается разбирать заказ с разошедшимися датами строк), но слой метрик держит
 * правило и сам, а не только чужим отказом.
 *
 * `o.gross is not null` стоит в `lines` — отсеивает строку источника, а не свёрнутую
 * пару «заказ + артикул». Первая редакция ставила условие после свёртки, в `counted`, и
 * это оказалось неверно: пара с одной пустой и одной заполненной строкой переживает
 * такой отсев — `sum(gross)` пропускает пустые значения молча — и приносит в счёт скидку
 * той строки, выручки которой мы не знаем. Проверено запуском на настоящей базе: отсев
 * по свёртке даёт оборот 10,00 при скидках 5,00, отсев по строке — оборот 10,00 при
 * скидках 0,00. Вычет неизвестного происхождения — то же враньё, что ноль вместо пустой
 * ячейки, только с другой стороны. Условия в `counted` при этом нет: после отсева по
 * строке пара без единой суммы просто не существует, и повторное условие было бы
 * недостижимым замком.
 *
 * Себестоимость — правила 3, 4 и 5. `price` в `counted` берёт **действующую** строку
 * `fact.costs` (`valid_from` не позже даты продажи, максимальная из таких) и не смотрит,
 * пуста ли в ней `cost`: пустая цена даёт `price = null` и уводит строку на запасные 40%,
 * а откат к более ранней, ещё не отменённой строке здесь невозможен по построению — это
 * отступление 2 контракта, названное вслух, а не недосмотр. Причина: более ранняя цена
 * отменена более поздней записью, и подставить её значило бы показать цену, которой на
 * дату продажи уже не было, — причём в доле «посчитано по настоящей цене», то есть
 * соврать именно там, где эта доля заведена против вранья.
 *
 * Ветка `else` в `money.cogs` берёт `c.gross - c.discount - c.refund_amount` — ту же
 * величину, что и `net`, где возвраты уже вычтены один раз. Это стык правил 4 и 5:
 * буква правила 5 велит снять возвраты из себестоимости отдельно, но у строки без цены
 * себестоимость и так считается от **чистой** выручки, и второе вычитание сняло бы
 * возвраты дважды. На боевых числах марта 2026 это стоит 133,80 € себестоимости (7 из
 * 19 возвратов приходятся ровно на NP-011 и NP-012 — два товара без цены поставщика) —
 * подробный расчёт в contract.md, «Отступления от буквы», пункт 1.
 *
 * `greatest(c.units - c.refund_units, 0)` в ветке с ценой — проданных штук не бывает
 * меньше нуля. Найдено проверкой кода: возврат пяти штук на покупку двух давал
 * себестоимость строки −30,00 при чистой выручке 50,00 и завышал прибыль молча. Путь
 * достижим через боевую загрузку — сверки штук возврата со штуками заказа в разборе S4
 * нет, — в отличие от прочих углов этой задачи, которые сегодня недостижимы на боевых
 * данных.
 *
 * `net_real` выведен колонкой в итоговом `select` уже здесь, а не только копится для
 * задачи 5: колонка без выхода наружу — механизм, который нечем наблюдать и нечем
 * сторожить проверкой.
 *
 * Задача 4 — правила 6 и 7. Три новые общие таблицы читают только `fact.ads`, `fact.fx`,
 * `fact.fees`, `fact.opex` и не трогают уже написанные `lines`/`counted`/`money`/`totals`.
 *
 * `ads_eur`: `usd_per_eur` — сколько долларов дают за евро, поэтому перевод в евро — это
 * `spend / usd_per_eur`, деление, а не умножение. Курс берётся за **тот же день**, что и
 * расход (`join fact.fx f on f.date = a.date`), а не курс на конец месяца или на любой
 * другой день: у рекламного дня без курса в `fact.fx` соединение просто не находит строку,
 * и расход этого дня в сумму не попадает — тот самый вид дыры «дней рекламы без курса» из
 * контракта, а не отказ всего расчёта. `nullif(f.usd_per_eur, 0)` — второй круг проверки
 * нашёл, что нулевой курс (в отличие от пустого) до соединения доезжает: отказ S4 сверяет
 * наличие строки на дату, а не её значение, — и без `nullif` деление на ноль рвёт весь
 * запрос и гасит экран, против решения владельца 4. «Нет курса», «курс пуст» и «курс ноль»
 * после `nullif` — одно и то же понятие: строка не даёт делителя, `spend / null` даёт
 * `null`, `sum` его пропускает, расход дня не попадает в счёт.
 *
 * `paid_orders` и `gateway_fees`: комиссия считается по заказу целиком, не по строке
 * счёта — решение владельца 2 и 3. `paid_orders` сворачивает `lines` (уже без строк с
 * пустой суммой — отсев там сделан ещё в задаче 2) до одной строки на заказ:
 * `sum(gross - discount)` — сумма заказа после скидок. Возвраты в эту сумму не входят:
 * решение владельца 3, платёж прошёл и комиссию с него уже удержали.
 *
 * Второй круг проверки нашёл в первой редакции два дефекта именно здесь, и оба остаются
 * достижимыми на боевых данных.
 *
 * Первый: `min(gateway)` при заказе с двумя способами оплаты в одной строке молча берёт
 * ставку алфавитно первого способа и применяет её ко **всей** сумме заказа — проверка кода
 * получила так 2,25 € вместо 25,00 €. Опираться на отказ S4 здесь непоследовательно: в
 * задаче 2 от такой опоры уже отказались. Решение — `count(distinct gateway) as gateways`
 * в `paid_orders` и `where o.gateways = 1` в `gateway_fees`: заказ с разными способами
 * оплаты в комиссию не входит вовсе, а не входит криво.
 *
 * Второй: `percent` хранится в **процентных пунктах** (`1.9000`, а не `0.0190` —
 * проверено на местной базе, `fees_percent_is_points` запрещает и ноль, и отрицательное
 * значение), и `fe.percent / 100` делит именно на сто — без деления комиссия выходит в
 * сто раз больше. Но записанная одной суммой, `amount * percent/100 + fixed` при пустом
 * `percent` или пустом `fixed` даёт `null` на весь заказ: суммирование пропускает такую
 * строку, `coalesce` превращает её в ноль, и это обнуляет **весь способ оплаты**, а не
 * только неизвестную половину ставки — для боевого марта 2026 это 0,00 € вместо 526,12 €.
 * Решение — раздельные слагаемые: `coalesce(sum(o.amount * fe.percent / 100), 0)` и
 * `coalesce(sum(fe.fixed), 0)` складываются уже после того, как каждое само стало нулём
 * по пустым строкам. Известная часть ставки считается даже когда вторая часть пуста.
 *
 * `fixed_costs`: `fact.opex` за месяц `M`, тот же `bounds`, что у остальных таблиц.
 *
 * Условий `a.spend is not null` и `x.amount is not null` в `ads_eur` и `fixed_costs`
 * больше нет — второй круг проверки показал, что оба были холостыми: `sum()` сам
 * пропускает `NULL`, и числовой итог не менялся ни с условием, ни без него (проверено
 * ломкой кода с прогоном проверок задачи 4 — ни одна не покраснела). Условие, снятие
 * которого не красит ни одной проверки, — не страж, а видимость страже.
 *
 * Все суммы обёрнуты `coalesce(…, 0)` внутри своей CTE: это разрешённое контрактом
 * место — пустая сумма по нулю строк (нет рекламы, нет комиссий, нет расходов за месяц)
 * не то же самое, что источник промолчал о значении, и отдельной строки в блоке
 * неполноты не требует (контракт, раздел «Пустая ячейка», абзац про `coalesce` в итоговых
 * суммах).
 */

/**
 * CTE, общие для итогов (задачи 2–4) и для таблицы товаров (задача 5): границы месяца,
 * день заказа, строка счёта, свёрнутые возвраты, себестоимость строки. Вынесены в свою
 * константу здесь и только сейчас, когда обе задачи, которые их читают, уже написаны и
 * зелены, — чтобы рефакторинг был доказан прогоном, а не верой в то, что текст не
 * разошёлся при копировании. Каждая независимая цепочка CTE (`ads_eur`/`paid_orders`/
 * `gateway_fees`/`fixed_costs` — правила 6 и 7, отдельная тема) остаётся сама по себе,
 * как и было в задачах 3–4: общее — только то, что действительно общее.
 */
const MONEY_CTES = `
with bounds as (
  select $1::date as first_day, ($1::date + interval '1 month')::date as next_month
),
order_day as (
  select o.order_id, min(o.date) as sold_on
    from fact.orders o
   group by o.order_id
),
lines as (
  select o.order_id, o.sku,
         min(d.sold_on)               as sold_on,
         min(o.gateway)               as gateway,
         sum(o.units)                 as units,
         sum(o.gross)                 as gross,
         sum(coalesce(o.discount, 0)) as discount
    from fact.orders o
    join order_day d on d.order_id = o.order_id
    cross join bounds b
   where d.sold_on >= b.first_day and d.sold_on < b.next_month
     and o.gross is not null
   group by o.order_id, o.sku
),
returned as (
  select r.order_id, r.sku,
         sum(r.amount)             as amount,
         coalesce(sum(r.units), 0) as units
    from fact.refunds r
   group by r.order_id, r.sku
),
counted as (
  select l.order_id, l.sku, l.sold_on, l.gateway, l.units, l.gross, l.discount,
         coalesce(t.amount, 0) as refund_amount,
         coalesce(t.units, 0)  as refund_units,
         (select c.cost
            from fact.costs c
           where c.sku = l.sku and c.valid_from <= l.sold_on
           order by c.valid_from desc
           limit 1) as price
    from lines l
    left join returned t on t.order_id = l.order_id and t.sku = l.sku
),
money as (
  select c.*, c.gross - c.discount - c.refund_amount as net,
         case when c.price is not null
              then greatest(c.units - c.refund_units, 0) * c.price
              else 0.40 * (c.gross - c.discount - c.refund_amount)
         end as cogs
    from counted c
)`

export const MONTH_TOTALS = `${MONEY_CTES},
ads_eur as (
  select coalesce(sum(a.spend / nullif(f.usd_per_eur, 0)), 0) as total
    from fact.ads a
    join bounds b on a.date >= b.first_day and a.date < b.next_month
    join fact.fx f on f.date = a.date
),
-- Способ(ы) оплаты заказа считаются по СЫРЫМ строкам fact.orders месяца, а не через
-- \`lines\`: \`lines\` уже свёрнута по паре «заказ + артикул» (\`min(o.gateway)\` внутри
-- каждой такой пары), и заказ, оплаченный двумя способами обеими строками ОДНОГО
-- артикула, свёртку переживал — на уровне заказа оставался один способ. Проверка кода
-- доказала это запуском: 2,00 € комиссии по ставке алфавитно первого способа вместо
-- отказа. \`order_gateways\` смотрит туда же, откуда смотрит \`lines\`, но до свёртки.
order_gateways as (
  select o.order_id,
         min(o.gateway)           as gateway,
         count(distinct o.gateway) as gateways
    from fact.orders o
    join order_day d on d.order_id = o.order_id
    cross join bounds b
   where d.sold_on >= b.first_day and d.sold_on < b.next_month
   group by o.order_id
),
paid_orders as (
  select order_id, sum(gross - discount) as amount
    from lines group by order_id
),
gateway_fees as (
  select coalesce(sum(o.amount * fe.percent / 100), 0)
       + coalesce(sum(fe.fixed), 0) as total
    from paid_orders o
    join order_gateways g on g.order_id = o.order_id
    join fact.fees fe on fe.gateway = g.gateway
   where g.gateways = 1
),
fixed_costs as (
  select coalesce(sum(x.amount), 0) as total
    from fact.opex x, bounds b
   where x.month = b.first_day
),
totals as (
  select sum(gross) as gross, sum(discount) as discounts,
         sum(refund_amount) as refunds, sum(net) as net,
         sum(cogs) as cogs,
         sum(net) filter (where price is not null) as net_real,
         (select total from ads_eur)      as ads,
         (select total from gateway_fees) as fees,
         (select total from fixed_costs)  as fixed
    from money
)
-- Отступление от буквы задачи 5, названное вслух: колонка \`net_real\` в контрактном
-- «Итоговый select целиком» не выведена наружу (она нужна там только внутри выражения
-- \`honest_pct\`). Буква здесь вредна: monthTotals() задач 2–4 отдаёт эту колонку наружу,
-- и её проверяют напрямую принятые тесты — cogs.test.ts, «чистая выручка по строкам с
-- настоящей ценой считается отдельно» (\`totals.net_real\`). Убрать колонку значило бы
-- красить принятую проверку задачи 3 ради буквы задачи 5. Колонка оставлена как была,
-- новые четыре добавлены поверх неё; значение и место всех прежних колонок не менялись.
-- Закрыто тем, что тот самый тест остаётся зелёным без единой правки.
select round(coalesce(gross, 0), 2)::text     as gross,
       round(coalesce(discounts, 0), 2)::text as discounts,
       round(coalesce(refunds, 0), 2)::text   as refunds,
       round(coalesce(net, 0), 2)::text       as net,
       round(coalesce(cogs, 0), 2)::text      as cogs,
       round(coalesce(net_real, 0), 2)::text  as net_real,
       round(ads, 2)::text                    as ads,
       round(fees, 2)::text                   as fees,
       round(fixed, 2)::text                  as fixed,
       round(coalesce(net,0) - coalesce(cogs,0) - ads - fees - fixed, 2)::text as profit,
       round((coalesce(net,0) - coalesce(cogs,0) - ads - fees - fixed)
             / nullif(net, 0) * 100, 1)::text                                  as margin_pct,
       round(coalesce(gross, 0) / nullif(ads, 0), 2)::text                     as roas_by_gross,
       round(coalesce(net_real, 0) / nullif(net, 0) * 100, 1)::text            as honest_pct
  from totals
`

/**
 * Таблица товаров — задача 5. По артикулу: штук продано за вычетом возвращённых, чистая
 * выручка, себестоимость, прибыль строки. `money` — та же общая CTE, что у итогов: одно
 * место, где живёт правило себестоимости (правила 3, 4, 5), второго нет.
 *
 * «Штук» — целое число, а не деньги: не через `Money`, округления не просит. Сортировка —
 * по чистой выручке, по убыванию (контракт, раздел «Таблица товаров»).
 */
export const MONTH_ITEMS = `${MONEY_CTES}
select sku,
       sum(greatest(units - refund_units, 0))::text as units,
       round(sum(net), 2)::text                     as net,
       round(sum(cogs), 2)::text                     as cogs,
       round(sum(net) - sum(cogs), 2)::text          as profit
  from money
 group by sku
 order by sum(net) desc
`

/**
 * Блок неполноты — одиннадцать видов дыр контракта, ни одним больше. Порядок веток —
 * порядок таблицы контракта, и он же порядок, который проверяет
 * `__tests__/metrics/report.test.ts`; `ord` в подзапросе держит этот порядок явно, а не
 * доверяет тому, что `union all` сохранит порядок веток сам.
 *
 * Своя, не общая с `MONEY_CTES`, цепочка CTE — по одной причине: строки «скидки» и
 * «оборот» считаются **по строке источника**, до свёртки пары «заказ + артикул»
 * (контракт: «отсев обязан идти по строке источника»), а `MONEY_CTES.lines` уже свёрнута.
 * `month_orders` — те же строки `fact.orders`, что войдут в `lines`, но не свёрнутые.
 *
 * Дом возврата — месяц его заказа (правило 2), а не месяц самого возврата: `home_date`
 * берёт день заказа через `order_day`, и только когда заказа с таким `order_id` нет
 * вовсе — свою дату, потому что дня заказа тогда взять неоткуда. Этим же приёмом решается
 * пара тестов «пары нет в заказах вовсе» и «её строки выпали из счёта» — оба относятся к
 * месяцу через `home_date` одинаково.
 *
 * Вид «возвраты, не попавшие в счёт» считает **пары**, а не строки возвратов: `distinct
 * (order_id, sku)`, потому что вопрос — «эта пара нашла себя в счёте», а не «сколько было
 * строк возврата у пары». `not exists` вместо `not in` у дня рекламы без курса — чтобы
 * пустая (не бывающая по схеме, но не запрещённая никаким `not null`) строка курса не
 * отравила сравнение: `not in` с `null` в списке даёт `unknown` на каждой строке.
 */
export const MONTH_GAPS = `
with bounds as (
  select $1::date as first_day, ($1::date + interval '1 month')::date as next_month
),
order_day as (
  select o.order_id, min(o.date) as sold_on
    from fact.orders o
   group by o.order_id
),
month_orders as (
  select o.row_no, o.order_id, o.sku, o.units, o.gross, o.discount, o.gateway, d.sold_on
    from fact.orders o
    join order_day d on d.order_id = o.order_id
    cross join bounds b
   where d.sold_on >= b.first_day and d.sold_on < b.next_month
),
lines as (
  select order_id, sku,
         min(sold_on)               as sold_on,
         min(gateway)               as gateway,
         sum(units)                 as units,
         sum(gross)                 as gross,
         sum(coalesce(discount, 0)) as discount
    from month_orders
   where gross is not null
   group by order_id, sku
),
month_refunds as (
  select r.row_no, r.order_id, r.sku, r.amount,
         coalesce(d.sold_on, r.refund_date) as home_date
    from fact.refunds r
    left join order_day d on d.order_id = r.order_id
    cross join bounds b
   where coalesce(d.sold_on, r.refund_date) >= b.first_day
     and coalesce(d.sold_on, r.refund_date) < b.next_month
),
returned as (
  select order_id, sku,
         sum(amount)             as amount,
         coalesce(sum(units), 0) as units
    from fact.refunds
   group by order_id, sku
),
counted as (
  select l.order_id, l.sku,
         l.units, l.gross, l.discount,
         coalesce(t.amount, 0) as refund_amount,
         coalesce(t.units, 0)  as refund_units,
         (select c.cost
            from fact.costs c
           where c.sku = l.sku and c.valid_from <= l.sold_on
           order by c.valid_from desc
           limit 1) as price
    from lines l
    left join returned t on t.order_id = l.order_id and t.sku = l.sku
),
-- Тот же приём, что в MONTH_TOTALS: способы оплаты считаются по сырым строкам
-- fact.orders месяца (\`month_orders\`), а не через свёрнутую \`lines\` — иначе заказ,
-- оплаченный двумя способами обеими строками одного артикула, свёртку переживал бы
-- молча, и эта самая дыра осталась бы неназванной.
paid_orders as (
  select order_id, count(distinct gateway) as gateways
    from month_orders
   group by order_id
),
missing_refunds as (
  select distinct mr.order_id, mr.sku
    from month_refunds mr
    left join lines l on l.order_id = mr.order_id and l.sku = mr.sku
   where l.order_id is null
)
select kind, count, at
  from (
    select 1 as ord, 'скидки' as kind,
           (select count(*) from month_orders where discount is null)::int as count,
           array(select row_no::text from month_orders where discount is null order by row_no) as at
    union all
    select 2, 'оборот',
           (select count(*) from month_orders where gross is null)::int,
           array(select row_no::text from month_orders where gross is null order by row_no)
    union all
    select 3, 'возвраты без суммы',
           (select count(*) from month_refunds where amount is null)::int,
           array(select row_no::text from month_refunds where amount is null order by row_no)
    union all
    select 4, 'возвраты, не попавшие в счёт',
           (select count(*) from missing_refunds)::int,
           array(select order_id || ' / ' || sku from missing_refunds order by order_id, sku)
    union all
    select 5, 'возвращено больше, чем куплено',
           (select count(*) from counted where refund_units > units)::int,
           array(select order_id || ' / ' || sku from counted
                  where refund_units > units order by order_id, sku)
    union all
    -- Считает СТРОКИ (пары «заказ + артикул»), а не различные артикулы: доля честности
    -- тоже считается по строкам (\`net_real\` в MONTH_TOTALS суммирует \`net\` по строке), и
    -- число здесь обязано стоять на том же основании — иначе товар с ценой до 15 марта и
    -- пустой ценой после засчитывался бы «без цены» целиком, хотя честна половина его
    -- выручки. Адреса при этом — артикулы: они полезнее номеров строк.
    select 6, 'строки продаж без цены поставщика',
           (select count(*) from counted where price is null)::int,
           array(select distinct sku from counted where price is null order by sku)
    union all
    select 7, 'ставки без процента или без фиксированной части',
           (select count(*) from fact.fees where percent is null or fixed is null)::int,
           array(select gateway from fact.fees
                  where percent is null or fixed is null order by gateway)
    union all
    select 8, 'заказы с разными способами оплаты',
           (select count(*) from paid_orders where gateways > 1)::int,
           array(select order_id from paid_orders where gateways > 1 order by order_id)
    union all
    select 9, 'постоянные расходы без суммы',
           (select count(*) from fact.opex x, bounds b
             where x.month = b.first_day and x.amount is null)::int,
           array(select category from fact.opex x, bounds b
                  where x.month = b.first_day and x.amount is null order by category)
    union all
    select 10, 'реклама без суммы',
           (select count(*) from fact.ads a join bounds b
              on a.date >= b.first_day and a.date < b.next_month
             where a.spend is null)::int,
           array(select a.file_name || ':' || a.row_no::text from fact.ads a join bounds b
                   on a.date >= b.first_day and a.date < b.next_month
                  where a.spend is null order by a.file_name, a.row_no)
    union all
    select 11, 'дни рекламы без курса',
           (select count(distinct a.date) from fact.ads a join bounds b
              on a.date >= b.first_day and a.date < b.next_month
             where not exists (
                     select 1 from fact.fx f
                      where f.date = a.date and f.usd_per_eur is not null and f.usd_per_eur <> 0
                   ))::int,
           array(select distinct a.date::text from fact.ads a join bounds b
                   on a.date >= b.first_day and a.date < b.next_month
                  where not exists (
                          select 1 from fact.fx f
                           where f.date = a.date and f.usd_per_eur is not null and f.usd_per_eur <> 0
                        )
                  order by a.date::text)
  ) g
 order by ord
`

/**
 * Список месяцев для переключателя на экране. Месяц входит в список, если за него есть
 * хоть одна строка заказов, рекламы или расходов (контракт, раздел «Экран»); `hasOrders`
 * отличает месяцы с заказами от месяцев, где есть только реклама или только расходы —
 * ровно то различие, которое нужно, чтобы взять «последний месяц, за который есть
 * заказы» по умолчанию, не считая его отдельным запросом.
 *
 * День заказа (`order_day`) здесь **не ограничен** границами какого-то одного месяца —
 * в отличие от `MONEY_CTES`, этот запрос заранее не знает, какой месяц спросят, и должен
 * увидеть все.
 */
export const ALL_MONTHS = `
with order_day as (
  select o.order_id, min(o.date) as sold_on
    from fact.orders o
   group by o.order_id
),
orders_months as (
  select distinct to_char(date_trunc('month', sold_on), 'YYYY-MM') as month
    from order_day
   where sold_on is not null
),
ads_months as (
  select distinct to_char(date_trunc('month', date), 'YYYY-MM') as month
    from fact.ads
   where date is not null
),
opex_months as (
  select distinct to_char(date_trunc('month', month), 'YYYY-MM') as month
    from fact.opex
   where month is not null
),
all_months as (
  select month from orders_months
  union
  select month from ads_months
  union
  select month from opex_months
)
select am.month as month,
       exists(select 1 from orders_months om where om.month = am.month) as has_orders
  from all_months am
 order by am.month desc
`

/**
 * Есть ли в месяце хоть одна строка рекламы. **Выражение одно**, и о прошлом месяце оно спрашивается
 * тем же сдвигом `$1::date`, каким сдвигаются итоги (`PREVIOUS_MONTH_TOTALS`): второго определения
 * «месяц без рекламы» в коде нет. Поправлено в круге проверки кода 2 — прежде текущий месяц брал
 * границы через `date_trunc`, а прошлый через вычитание месяца, и совпадали они, только пока `$1` —
 * первое число месяца.
 */
export const ЕСТЬ_РЕКЛАМА = `select exists(select 1 from fact.ads a
                 where a.date >= $1::date
                   and a.date < ($1::date + interval '1 month')::date) as has_ads`

/**
 * Водопад «куда ушли деньги» — кусок S11, шаг 1. Девять ступеней: оборот → скидки → возвраты →
 * чистая выручка → себестоимость → реклама → комиссии → постоянные → прибыль. Три итога — оборот,
 * чистая выручка, прибыль — идут от нуля; шесть вычитаний висят от остатка после предыдущих.
 *
 * **Своих выражений денег здесь нет ни одного.** Ступени берут готовую строку итогов месяца —
 * `MONTH_TOTALS` целиком, как подзапрос, — и только раскладывают её колонки по порядку. Прибыль
 * ступени — буквально колонка `profit` итогов, а не её пересчёт из слагаемых: второе выражение
 * прибыли однажды разошлось бы с первым молча. Текст `MONTH_TOTALS` не тронут.
 *
 * Доли — в процентах **от оборота**, как у всех долей экрана (решение владельца: одна база).
 * Делитель — под `nullif`: оборот ноль — доли и основания пусты, на экране слова, а не ноль.
 *
 * **Нет ни одной строки рекламы за месяц — у ступени «Реклама» пусты и сумма, и доля** (круг
 * проверки кода 2): то же правило, что у доли рекламы в полосе показателей, и то же выражение
 * `ЕСТЬ_РЕКЛАМА`. Отсутствие выгрузки — это «данных нет», а не «реклама стоила ноль»; и «съедает
 * больше всего» такую ступень не выбирает, потому что суммы у неё нет. **Края столбиков при этом
 * по-прежнему считаются от нуля рекламы**, как и прибыль в итогах: вычитание нуля — дефект счёта
 * прежнего куска, названный в `docs/ОТЧЁТ.md`, «Где не уверен», и здесь он не чинится. Из-за него
 * цепочка ступеней на таком месяце сходится с прибылью, которая сама завышена.
 *
 * **Наше решение, названное вслух:** доли и основания считаются от денег итогов, уже округлённых
 * до цента, — то есть от тех самых чисел, что стоят на экране. Округление доли одно — здесь, до
 * десятой. Остаток после вычитаний считается от ближайшего итога, а не накоплением от оборота:
 * так нижний край ступени «постоянные» сходится с прибылью, а «возвраты» — с чистой выручкой.
 *
 * Геометрия — числами, готовыми: `share_pct` — доля ступени со знаком, та же, что печатается
 * текстом; `base_pct` — нижний край столбика. Итог от нуля: край — меньшее из нуля и самой доли,
 * поэтому отрицательная прибыль идёт вниз от нуля. `scale_low_pct` и `scale_high_pct` — пределы
 * шкалы: не выше нуля и не ниже ста, шире — если ступень выходит за них.
 *
 * `WATERFALL_FROM_TOTALS` читает строку итогов из `totals_row` и сам итогов не считает; боевой
 * запрос — `MONTH_WATERFALL` — подставляет туда `MONTH_TOTALS`. Проверки подставляют выдуманную
 * строку итогов, чтобы ступени можно было сличить с числами, которые нарочно не сходятся.
 */
export const WATERFALL_FROM_TOTALS = `
steps as (
  select s.ord, s.key, s.kind, s.amount, s.edge_from, s.edge_to
    from totals_row t
   cross join cur_state cs
   cross join lateral (values
     (1, 'gross',     'итог',      t.gross::numeric,     0::numeric,
                                   t.gross::numeric),
     (2, 'discounts', 'вычитание', t.discounts::numeric, t.gross::numeric,
                                   t.gross::numeric - t.discounts::numeric),
     (3, 'refunds',   'вычитание', t.refunds::numeric,   t.gross::numeric - t.discounts::numeric,
                                   t.gross::numeric - t.discounts::numeric - t.refunds::numeric),
     (4, 'net',       'итог',      t.net::numeric,       0::numeric,
                                   t.net::numeric),
     (5, 'cogs',      'вычитание', t.cogs::numeric,      t.net::numeric,
                                   t.net::numeric - t.cogs::numeric),
     (6, 'ads',       'вычитание', case when cs.has_ads then t.ads::numeric end,
                                   t.net::numeric - t.cogs::numeric,
                                   t.net::numeric - t.cogs::numeric - t.ads::numeric),
     (7, 'fees',      'вычитание', t.fees::numeric,
                                   t.net::numeric - t.cogs::numeric - t.ads::numeric,
                                   t.net::numeric - t.cogs::numeric - t.ads::numeric - t.fees::numeric),
     (8, 'fixed',     'вычитание', t.fixed::numeric,
                                   t.net::numeric - t.cogs::numeric - t.ads::numeric - t.fees::numeric,
                                   t.net::numeric - t.cogs::numeric - t.ads::numeric - t.fees::numeric
                                     - t.fixed::numeric),
     (9, 'profit',    'итог',      t.profit::numeric,    0::numeric,
                                   t.profit::numeric)
   ) as s(ord, key, kind, amount, edge_from, edge_to)
),
-- Расхождения цепочек — решение владельца по развилке Ж2. Каждая сумма итогов округлена до цента
-- отдельно, а чистая выручка и прибыль считаются из неокруглённых слагаемых и округляются один раз:
-- показанные ступени, сложенные глазами, могут разойтись с показанным итогом на центы (на марте
-- 2026 — 1 738,54 против 1 738,53). Здесь — ровно разница показанных чисел, без порога и без
-- округления: слагаемые уже в центах. Нет расхождения — пусто, и строки под водопадом нет.
base as (
  select t.gross::numeric as gross,
         nullif(t.gross::numeric - t.discounts::numeric - t.refunds::numeric - t.net::numeric, 0)
           as net_gap,
         nullif(t.net::numeric - t.cogs::numeric - t.ads::numeric - t.fees::numeric
                  - t.fixed::numeric - t.profit::numeric, 0)
           as profit_gap
    from totals_row t
)
select s.key,
       s.kind,
       s.amount::text                                                            as amount,
       round(s.amount / nullif(b.gross, 0) * 100, 1)::text                       as share_pct,
       round(least(s.edge_from, s.edge_to) / nullif(b.gross, 0) * 100, 1)::text  as base_pct,
       round(least(0, min(least(s.edge_from, s.edge_to)) over ())
             / nullif(b.gross, 0) * 100, 1)::text                                as scale_low_pct,
       round(greatest(b.gross, max(greatest(s.edge_from, s.edge_to)) over ())
             / nullif(b.gross, 0) * 100, 1)::text                                as scale_high_pct,
       b.net_gap::text                                                           as net_gap,
       b.profit_gap::text                                                        as profit_gap,
       -- «Съедает больше всего» — решение владельца: самое большое вычитание, признаком в той же
       -- строке, что и ступень; второго определения «самого большого» разметка не заводит. Равенство
       -- до цента помечает все равные ступени — строка назовёт их поровну, а не выберет одну наугад.
       -- Все вычитания ноль — не помечено ничего: «съедает больше всего ничто» — не подпись.
       (s.kind = 'вычитание'
        and s.amount > 0
        and s.amount = max(s.amount) filter (where s.kind = 'вычитание') over ())  as largest
  from steps s
 cross join base b
 order by s.ord
`

export const MONTH_WATERFALL = `
with totals_row as (${MONTH_TOTALS}),
cur_state as (${ЕСТЬ_РЕКЛАМА}),
${WATERFALL_FROM_TOTALS}`

/**
 * Чистая выручка по дням — кусок S11, шаг 2 (задача Д-7). Блок называется выручкой и только
 * выручкой: прибыль по дням не считается, потому что постоянные расходы лежат в базе помесячно,
 * и разнести их по дням значило бы выдумать число (развилка Д2′-а, решение владельца).
 *
 * **Своих выражений денег здесь нет.** Ряд берёт готовую цепочку `money` из `MONEY_CTES` — ту же,
 * из которой итоги берут `sum(net)`, — и группирует её по дню заказа. Суммы дня — точные центы:
 * выручка, скидка и возврат строки хранятся в фактах с двумя знаками, поэтому ряд сходится с
 * чистой выручкой месяца до цента, а не с точностью до округления.
 *
 * В ряду **все дни месяца**: день без заказов приходит пустой строкой выручки, а не нулём и не
 * пропуском (развилка Д2′-б: на экране — разрыв, линия отсчёта пунктиром). Ноль возможен и честен:
 * заказы были, но всё вернули.
 *
 * Доля столбика — выручка дня ÷ наибольшая **по модулю** выручка дня месяца, процентами со знаком:
 * отрицательный день в грязных данных возможен и идёт вниз, а не ломает шкалу. Делитель — под
 * `nullif`. Подпись дня — готовой строкой («5 марта»): форматирование даты — тоже счёт.
 *
 * `DAILY_FROM_MONEY` читает `bounds` и `money` и сам их не строит; боевой запрос — `MONTH_DAILY` —
 * подставляет `MONEY_CTES`. Проверки подставляют выдуманные строки `money`, у которых выручка
 * нарочно не равна «оборот − скидка − возврат»: ряд, посчитавший выручку своим выражением, это
 * покажет.
 */
export const DAILY_FROM_MONEY = `
days as (
  select d::date as day
    from bounds b
   cross join generate_series(b.first_day, b.next_month - 1, interval '1 day') as d
),
by_day as (
  select m.sold_on as day, sum(m.net) as net
    from money m
   group by m.sold_on
),
-- Шкала ряда — один раз на месяц. Делитель долей — наибольшая по модулю выручка дня, под nullif;
-- края шкалы — не выше нуля и не ниже нуля, с двумя знаками, чтобы подпись оси печаталась деньгами.
peak as (
  select nullif(max(abs(net)), 0) as top,
         least(0.00, min(net))    as low_net,
         greatest(0.00, max(net)) as high_net,
         count(net) > 0           as has_orders
    from by_day
)
select to_char(d.day, 'YYYY-MM-DD')                                             as day,
       extract(day from d.day)::int || ' ' ||
         (array['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа',
                'сентября', 'октября', 'ноября', 'декабря'])[extract(month from d.day)::int]
                                                                                 as label,
       bd.net::text                                                              as net,
       round(bd.net / p.top * 100, 1)::text                                      as share_pct,
       round(least(0, bd.net) / p.top * 100, 1)::text                            as base_pct,
       round(p.low_net / p.top * 100, 1)::text                                   as scale_low_pct,
       round(p.high_net / p.top * 100, 1)::text                                  as scale_high_pct,
       p.high_net::text                                                          as top_net,
       p.low_net::text                                                           as bottom_net,
       -- Видимая подпись — у каждого пятого дня, начиная с первого: 1, 6, 11, 16, 21, 26, 31.
       -- Тридцать одна подпись в ширину не входит; доступная подпись при этом есть у каждого дня.
       case when (extract(day from d.day)::int - 1) % 5 = 0
            then extract(day from d.day)::int::text end                          as tick,
       p.has_orders                                                              as month_has_orders
  from days d
  left join by_day bd on bd.day = d.day
 cross join peak p
 order by d.day
`

export const MONTH_DAILY = `${MONEY_CTES},
${DAILY_FROM_MONEY}`

/**
 * Окупаемость рекламы — кусок S11, шаг 3 (задачи 3 и 10). Три новых числа рядом с прежней
 * окупаемостью по обороту: по прибыли, вклад с евро оборота и порог окупаемости.
 *
 * **Все определения — наши**, в справочниках их нет; так они и помечены на экране:
 *   · по прибыли — прибыль ÷ реклама;
 *   · вклад — (чистая выручка − себестоимость − комиссии) ÷ оборот × 100: сколько с евро оборота
 *     остаётся на рекламу и постоянные расходы. Реклама и постоянные во вклад не входят нарочно:
 *     постоянные от рекламы не зависят, а рекламу вклад и должен покрыть (развилка 4, вариант А);
 *   · порог — 100 ÷ вклад: ниже этой окупаемости по обороту реклама себя не окупает.
 *
 * **Порог — от вклада, а не от маржи экрана.** Маржа считается уже после рекламы, и порог от неё
 * вычитал бы рекламу дважды: на марте вышло бы 9,90 × и вывод «не окупается» вместо 1,75 × и
 * «окупается». Это решение владельца, и подпись порога на экране называет его базу.
 *
 * Как и водопад, запрос берёт строку итогов месяца целиком (`MONTH_TOTALS`) и своих выражений денег
 * не заводит; прежняя окупаемость по обороту остаётся колонкой итогов и здесь не пересчитывается.
 * Вклад не положителен — порога нет: никакая окупаемость рекламу не оправдает, и это сказано словами.
 */
export const PAYBACK_FROM_TOTALS = `
parts as (
  select t.ads::numeric    as ads,
         t.profit::numeric as profit,
         (t.net::numeric - t.cogs::numeric - t.fees::numeric) / nullif(t.gross::numeric, 0) * 100
                           as contribution
    from totals_row t
)
select round(p.profit / nullif(p.ads, 0), 2)::text                         as roas_by_profit,
       round(p.contribution, 1)::text                                      as contribution_pct,
       (case when p.contribution > 0 then round(100 / p.contribution, 2) end)::text
                                                                           as breakeven_roas,
       case when p.contribution <= 0 then 'вклад не положителен' end       as breakeven_note
  from parts p
`

export const MONTH_PAYBACK = `
with totals_row as (${MONTH_TOTALS}),
${PAYBACK_FROM_TOTALS}`

/**
 * Товары — кусок S11, шаг 4 (задачи 4, Д-1, Д-3). Новые колонки строки и строка над таблицей.
 *
 * **Своих выражений денег нет.** Запрос берёт готовые строки таблицы товаров — `MONTH_ITEMS`
 * целиком, как подзапрос, — и считает от их показанных сумм: база долей — сумма прибыли строк,
 * ровно то, что человек получит, сложив колонку «Прибыль». Текст `MONTH_ITEMS` не тронут.
 *
 *   · маржа строки — прибыль строки ÷ чистая выручка строки × 100; выручка ноль — пусто;
 *   · доля в прибыли товаров — прибыль строки ÷ сумма прибыли строк × 100 (решение владельца:
 *     делитель — сумма прибыли строк, 11 248,93 € на марте, а не прибыль месяца); сумма не
 *     положительна — пусто у всех строк разом;
 *   · сколько артикулов дают 80 % прибыли товаров — по убыванию прибыли, от той же суммы; при
 *     равной прибыли порядок — по артикулу, чтобы счёт не зависел от случая;
 *   · в минусе — прибыль строки строго меньше нуля (развилка Д1, вариант А). Счётчик и подсветка
 *     строки берут **этот один признак**, а не каждый свой.
 *
 * Прибыль месяца у таблицы товаров не та же, что сумма прибыли строк: строка — выручка минус
 * себестоимость, месяц — ещё минус реклама, комиссии и постоянные. На экране это названо у строки
 * над таблицей числами обеих.
 */
export const ITEMS_FROM_ROWS = `
base as (
  select sum(r.profit::numeric) as total, count(*) as skus from items_row r
),
ranked as (
  select r.sku, r.net::numeric as net, r.profit::numeric as profit,
         r.profit::numeric < 0 as loss,
         sum(r.profit::numeric) over (order by r.profit::numeric desc, r.sku
                                      rows between unbounded preceding and 1 preceding) as before
    from items_row r
)
select k.sku,
       round(k.profit / nullif(k.net, 0) * 100, 1)::text                     as margin_pct,
       (case when b.total > 0 then round(k.profit / b.total * 100, 1) end)::text
                                                                             as profit_share_pct,
       k.loss                                                                as loss,
       b.total::text                                                         as products_profit,
       b.skus::int                                                           as skus_total,
       (case when b.total > 0
             then count(*) filter (where coalesce(k.before, 0) < 0.8 * b.total) over () end)::int
                                                                             as skus_for_80,
       (count(*) filter (where k.loss) over ())::int                         as negative_count
  from ranked k
 cross join base b
`

export const MONTH_ITEMS_EXTRA = `
with items_row as (${MONTH_ITEMS}),
${ITEMS_FROM_ROWS}`

/**
 * Время чтения источников — кусок S11, шаг 6 (задача 5): готовой строкой `ГГГГ-ММ-ДД ЧЧ:ММ UTC`.
 *
 * **Что это за время — словами, потому что на экране подпись обязана говорить правду.** Это
 * `meta.fact_freshness.raw_seen_at` — время самого свежего сырья, по которому собраны факты, а не
 * время разбора: разбор, прогнанный дважды подряд без изменений в источнике, отметку не двигает.
 * Отсюда подпись «источники прочитаны по состоянию на …» — решение владельца по развилке 5.
 *
 * Форматирование — здесь, а не в разметке: это счёт. Пояс — UTC и назван в самой строке, иначе
 * время читалось бы как местное; `at time zone 'UTC'` снимает зависимость от пояса сеанса. Секунды
 * отбрасываются, а не округляются: строка не называет время позже настоящего.
 *
 * Отметки нет — пусто, и строка ответа всё равно одна. Эпоха — тоже пусто: её пишет сама запись
 * отметки, когда сырьё пустое (`coalesce(max(updated_at), to_timestamp(0))`), и это не время чтения.
 */
export const SOURCES_READ_AT = `
select (
  select to_char(f.raw_seen_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC'
    from meta.fact_freshness f
   where f.raw_seen_at > to_timestamp(0)
) as read_at
`

/**
 * Полоса показателей — кусок S11, шаг 7 (задача 1): четыре показателя месяца и их дельты к
 * предыдущему **календарному** месяцу (решение владельца по развилке 7). Прибыль и чистая выручка —
 * в евро, маржа и доля рекламы — в процентных пунктах: дельта процентной величины — это разность
 * пунктов, а не процент от прошлой.
 *
 * **Своих выражений денег здесь нет.** Значения — колонки готовой строки итогов (`cur_row`), та же
 * прибыль и та же маржа, что в «Итоге»; прошлый месяц — такая же строка (`prev_row`). Дельта —
 * разность **показанных** значений, уже округлённых: напечатанная дельта ровно равна разнице двух
 * чисел, которые человек увидит на двух месяцах. Доля рекламы — реклама ÷ оборот × 100, то же
 * выражение, что у доли ступени рекламы в водопаде; равенство утверждает проверка.
 *
 * **Пустое — пустое, а не ноль.** Нет предыдущего месяца или в нём нет заказов (`prev_state`) —
 * дельты пусты у всех четырёх разом, значения при этом стоят. Оборот ноль — доля рекламы пуста. В
 * прошлом месяце нет ни одной строки рекламы — пуста дельта доли рекламы (контракт, правило «нет
 * данных — словами»): отсутствие выгрузки — это «данных нет», а не «реклама стоила ноль».
 *
 * **То же правило — и для текущего месяца (`cur_state`), и это правка круга проверки кода 1.**
 * Прежде месяц, для которого файлы рекламы ещё не загружены, показывал долю рекламы 0,0 % и дельту к
 * прошлому месяцу — то есть ноль вместо «нет данных», да ещё с вердиктом «лучше». Теперь нет ни одной
 * строки рекламы в границах месяца — доля рекламы пуста и дельта пуста; прочие три показателя стоят.
 * **Чего эта правка не чинит:** сами итоги месяца (`MONTH_TOTALS`, кусок S5) считают рекламу без
 * выгрузки нулём, и прибыль такого месяца завышена. Это дефект счёта прежнего куска; он назван в
 * `docs/ОТЧЁТ.md`, «Где не уверен».
 *
 * Признак «рост — это хорошо» заведён здесь, у числа: прибыль, маржа, выручка — да, доля рекламы —
 * нет. Отсюда и вывод `verdict` — «лучше», «хуже», «без изменений»; разметка знак с нулём не
 * сравнивает. Знак плюс у дельты ставится здесь же: разметка его не выводит.
 *
 * Переход между «нет базы» и «есть база» — от данных и только от них: появился прошлый месяц с
 * заказами — дельты считаются, исчез — снова пусто. Ни флага, ни настройки.
 */
export const DELTAS_FROM_ROWS = `
kpi as (
  select k.ord, k.key, k.unit, k.good_when_up, k.value, k.cur, k.prev,
         s.month as prev_month, s.has_orders
    from cur_row c
   cross join prev_row p
   cross join prev_state s
   cross join cur_state cs
   cross join lateral (values
     (1, 'profit',   'eur', true,  c.profit,     c.profit::numeric,     p.profit::numeric),
     (2, 'margin',   'pp',  true,  c.margin_pct, c.margin_pct::numeric, p.margin_pct::numeric),
     (3, 'net',      'eur', true,  c.net,        c.net::numeric,        p.net::numeric),
     (4, 'ad_share', 'pp',  false,
         case when cs.has_ads then round(c.ads::numeric / nullif(c.gross::numeric, 0) * 100, 1) end::text,
         case when cs.has_ads then round(c.ads::numeric / nullif(c.gross::numeric, 0) * 100, 1) end,
         case when s.has_ads then round(p.ads::numeric / nullif(p.gross::numeric, 0) * 100, 1) end)
   ) as k(ord, key, unit, good_when_up, value, cur, prev)
),
diff as (
  select k.*, case when k.has_orders then k.cur - k.prev end as d
    from kpi k
)
select key, unit, good_when_up, value,
       (case when d > 0 then '+' else '' end || d::text) as delta,
       case when d is null then null
            when d = 0 then 'без изменений'
            when (d > 0) = good_when_up then 'лучше'
            else 'хуже'
       end                                                as verdict,
       prev_month,
       has_orders                                         as has_base
  from diff
 order by ord
`

/**
 * Итоги предыдущего календарного месяца — **тот же текст `MONTH_TOTALS`**, у которого граница
 * месяца сдвинута на месяц назад. Параметр месяца в нём стоит ровно дважды, оба раза как
 * `$1::date` в границах месяца, и замена трогает только их. Равенство этих итогов итогам
 * `MONTH_TOTALS`, спрошенным за прошлый месяц напрямую, утверждает проверка — на фактах, где оба
 * месяца не пусты. Второго выражения итогов нет: сам текст `MONTH_TOTALS` не тронут.
 */
export const PREVIOUS_MONTH_TOTALS = MONTH_TOTALS.replaceAll('$1::date', "($1::date - interval '1 month')::date")

/**
 * Боевой запрос полосы. Есть ли у прошлого месяца заказы — по тому же определению, что у
 * переключателя месяцев (`ALL_MONTHS`, `has_orders`), второго определения нет.
 */
export const MONTH_DELTAS = `
with cur_row as (${MONTH_TOTALS}),
prev_row as (${PREVIOUS_MONTH_TOTALS}),
cur_state as (${ЕСТЬ_РЕКЛАМА}),
prev_state as (
  select to_char($1::date - interval '1 month', 'YYYY-MM') as month,
         exists(select 1 from (${ALL_MONTHS}) m
                 where m.month = to_char($1::date - interval '1 month', 'YYYY-MM')
                   and m.has_orders)                                   as has_orders,
         (${ЕСТЬ_РЕКЛАМА.replaceAll('$1::date', "($1::date - interval '1 month')::date")})  as has_ads
),
${DELTAS_FROM_ROWS}`
