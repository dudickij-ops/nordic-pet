import type { PoolClient } from 'pg'
import { afterAll, describe, expect, test } from 'vitest'

import { inRollback, pool } from './support'

afterAll(() => pool.end())

/** Все сырые таблицы листов и папки — чтобы видеть, не задела ли функция соседей. */
const RAW_TABLES = ['orders', 'refunds', 'costs', 'fees', 'opex', 'fx', 'ads'] as const

/**
 * Кладёт по паре строк в каждую сырую таблицу — с адресами, заведомо не встречающимися
 * в снимках проверок. Без этого утверждение «не трогает соседние» бессильно: в пустой
 * соседней таблице чужая подчистка ничего не удалит и останется незамеченной.
 */
async function fillEveryRawTable(client: PoolClient): Promise<void> {
  await client.query(`
    insert into raw.orders  (row_no, order_id) values (91, 'сосед'), (92, 'сосед');
    insert into raw.refunds (row_no, order_id) values (91, 'сосед'), (92, 'сосед');
    insert into raw.costs   (row_no, sku)      values (91, 'сосед'), (92, 'сосед');
    insert into raw.fees    (row_no, gateway)  values (91, 'сосед'), (92, 'сосед');
    insert into raw.opex    (row_no, category) values (91, 'сосед'), (92, 'сосед');
    insert into raw.fx      (row_no, date)     values (91, 'сосед'), (92, 'сосед');
    insert into raw.ads     (file_name, row_no, campaign)
                            values ('сосед.csv', 91, 'сосед'), ('сосед.csv', 92, 'сосед');
  `)
}

async function rawCounts(client: PoolClient): Promise<Record<string, number>> {
  const { rows } = await client.query(
    RAW_TABLES.map((t) => `select '${t}' as name, count(*)::int as n from raw.${t}`).join(
      ' union all ',
    ),
  )
  return Object.fromEntries(rows.map((r) => [r.name, r.n]))
}

const snapshot = (rows: unknown[]) => JSON.stringify(rows)

/**
 * Пять листов, у каждого своя функция записи снимка. Проверки общие,
 * но привязаны к своей функции и своей таблице: подстановка имени идёт
 * в каждый запрос, и функция, которая пишет не туда, краснеет.
 */
const sheets = [
  {
    table: 'refunds',
    fn: 'raw.replace_refunds',
    rows: [
      { row_no: 1, refund_date: '05.03.2026', order_id: 'A-1', sku: 'NP-001', units: '1',
        amount_eur: '10,00' },
      { row_no: 2, refund_date: '2026-03-05', order_id: 'A-2', sku: 'np-002 ', units: '1',
        amount_eur: '5,00' },
      { row_no: 3, refund_date: '06.03.2026', order_id: 'A-3', sku: 'NP-003', units: '2',
        amount_eur: '7,50' },
    ],
    // кривизна, которая обязана доехать нетронутой
    curvature: { column: 'sku', row_no: 2, value: 'np-002 ' },
  },
  {
    table: 'costs',
    fn: 'raw.replace_costs',
    rows: [
      { row_no: 1, sku: 'NP-001', cost_eur: '4,00', valid_from: '01.01.2026' },
      { row_no: 2, sku: 'NP-002', cost_eur: '6,50', valid_from: '2026-02-01' },
      { row_no: 3, sku: 'NP‑003', cost_eur: '', valid_from: '01.02.2026' },
    ],
    // неразрывный дефис U+2011 в артикуле
    curvature: { column: 'sku', row_no: 3, value: 'NP‑003' },
  },
  {
    table: 'fees',
    fn: 'raw.replace_fees',
    rows: [
      { row_no: 1, gateway: 'stripe', percent: '1,4', fixed_eur: '0,25' },
      { row_no: 2, gateway: 'paypal', percent: '2,49', fixed_eur: '0,35' },
      { row_no: 3, gateway: 'Stripe ', percent: '1,4', fixed_eur: '0,25' },
    ],
    curvature: { column: 'gateway', row_no: 3, value: 'Stripe ' },
  },
  {
    table: 'opex',
    fn: 'raw.replace_opex',
    rows: [
      { row_no: 1, month: '2026-03', category: 'аренда', amount_eur: '1 234,50' },
      { row_no: 2, month: '03.2026', category: 'связь', amount_eur: '89,00' },
      { row_no: 3, month: '2026-03', category: 'бухгалтерия', amount_eur: '' },
    ],
    // сумма по-европейски и с неразрывным пробелом U+00A0
    curvature: { column: 'amount_eur', row_no: 1, value: '1 234,50' },
  },
  {
    table: 'fx',
    fn: 'raw.replace_fx',
    rows: [
      { row_no: 1, date: '01.03.2026', usd_per_eur: '1,0850' },
      { row_no: 2, date: '2026-03-02', usd_per_eur: '1,0871' },
      { row_no: 3, date: '03.03.2026', usd_per_eur: '1,0902' },
    ],
    curvature: { column: 'usd_per_eur', row_no: 1, value: '1,0850' },
  },
]

describe.each(sheets)('$fn', ({ table, fn, rows: sourceRows, curvature }) => {
  test('снимок записывается, и кривизна источника переживает запись', async () => {
    await inRollback(async (client) => {
      await client.query(`select ${fn}($1::jsonb)`, [snapshot(sourceRows)])

      const { rows } = await client.query(
        `select ${curvature.column} as value from raw.${table} where row_no = $1`,
        [curvature.row_no],
      )
      expect(rows[0].value).toBe(curvature.value)
    })
  })

  // Ловушка общих проверок: шесть раз пощупать одну и ту же функцию и выглядеть
  // как шесть проверок. Поэтому здесь смотрим на все сырые таблицы разом.
  test('пишет в свою таблицу и не трогает соседние', async () => {
    await inRollback(async (client) => {
      await fillEveryRawTable(client)
      const before = await rawCounts(client)

      await client.query(`select ${fn}($1::jsonb)`, [snapshot(sourceRows)])

      const after = await rawCounts(client)
      // своя таблица становится точной копией снимка — вместе с подчисткой соседских строк,
      // которых в снимке нет; чужие таблицы остаются нетронутыми
      const expected = { ...before, [table]: sourceRows.length }
      expect(after).toEqual(expected)
    })
  })

  test('тот же снимок дважды подряд не меняет ни одного байта', async () => {
    await inRollback(async (client) => {
      await client.query(`select ${fn}($1::jsonb)`, [snapshot(sourceRows)])
      await client.query(
        `create temporary table before_state on commit drop as table raw.${table}`,
      )

      await client.query(`select ${fn}($1::jsonb)`, [snapshot(sourceRows)])

      // сравнение целиком и внутри базы: в JavaScript микросекунды времени теряются
      const { rows: difference } = await client.query(
        `select 'пропало' as side, row_no from (table before_state except table raw.${table}) a
         union all
         select 'появилось', row_no from (table raw.${table} except table before_state) b
         order by 1, 2`,
      )
      expect(difference).toEqual([])
    })
  })

  test('исчезнувший из источника адрес исчезает из таблицы', async () => {
    await inRollback(async (client) => {
      await client.query(`select ${fn}($1::jsonb)`, [snapshot(sourceRows)])
      await client.query(`select ${fn}($1::jsonb)`, [snapshot(sourceRows.slice(0, 2))])

      const { rows } = await client.query(`select row_no from raw.${table} order by row_no`)
      expect(rows.map((r) => r.row_no)).toEqual([1, 2])
    })
  })

  test('пустой снимок отвергается, и отказ называет свою таблицу', async () => {
    await inRollback(async (client) => {
      await expect(client.query(`select ${fn}('[]'::jsonb)`)).rejects.toThrow(
        new RegExp(`пустой снимок источника для raw\\.${table}`),
      )
    })
  })
})
