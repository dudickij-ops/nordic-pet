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

export const MONTH_TOTALS = `
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
),
totals as (
  select sum(gross) as gross, sum(discount) as discounts,
         sum(refund_amount) as refunds, sum(net) as net,
         sum(cogs) as cogs,
         sum(net) filter (where price is not null) as net_real
    from money
),
ads_eur as (
  select coalesce(sum(a.spend / nullif(f.usd_per_eur, 0)), 0) as total
    from fact.ads a
    join bounds b on a.date >= b.first_day and a.date < b.next_month
    join fact.fx f on f.date = a.date
),
paid_orders as (
  select order_id,
         min(gateway)          as gateway,
         count(distinct gateway) as gateways,
         sum(gross - discount) as amount
    from lines group by order_id
),
gateway_fees as (
  select coalesce(sum(o.amount * fe.percent / 100), 0)
       + coalesce(sum(fe.fixed), 0) as total
    from paid_orders o
    join fact.fees fe on fe.gateway = o.gateway
   where o.gateways = 1
),
fixed_costs as (
  select coalesce(sum(x.amount), 0) as total
    from fact.opex x, bounds b
   where x.month = b.first_day
)
select round(coalesce(gross, 0), 2)::text     as gross,
       round(coalesce(discounts, 0), 2)::text as discounts,
       round(coalesce(refunds, 0), 2)::text   as refunds,
       round(coalesce(net, 0), 2)::text       as net,
       round(coalesce(cogs, 0), 2)::text      as cogs,
       round(coalesce(net_real, 0), 2)::text  as net_real,
       round((select total from ads_eur), 2)::text      as ads,
       round((select total from gateway_fees), 2)::text as fees,
       round((select total from fixed_costs), 2)::text  as fixed
  from totals
`
