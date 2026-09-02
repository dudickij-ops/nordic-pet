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
 */

export const MONTH_TOTALS = `
with bounds as (
  select $1::date as first_day, ($1::date + interval '1 month')::date as next_month
),
lines as (
  select o.order_id, o.sku,
         min(o.date)                  as sold_on,
         min(o.gateway)               as gateway,
         sum(o.units)                 as units,
         sum(o.gross)                 as gross,
         sum(coalesce(o.discount, 0)) as discount
    from fact.orders o, bounds b
   where o.date >= b.first_day and o.date < b.next_month
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
         coalesce(t.units, 0)  as refund_units
    from lines l
    left join returned t on t.order_id = l.order_id and t.sku = l.sku
   where l.gross is not null
),
money as (
  select c.*, c.gross - c.discount - c.refund_amount as net from counted c
),
totals as (
  select sum(gross) as gross, sum(discount) as discounts,
         sum(refund_amount) as refunds, sum(net) as net
    from money
)
select round(coalesce(gross, 0), 2)::text     as gross,
       round(coalesce(discounts, 0), 2)::text as discounts,
       round(coalesce(refunds, 0), 2)::text   as refunds,
       round(coalesce(net, 0), 2)::text       as net
  from totals
`
