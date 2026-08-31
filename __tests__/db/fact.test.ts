import { afterAll, describe, expect, test } from 'vitest'

import { inRollback, pool, rows } from './support'

afterAll(() => pool.end())

const snapshot = (value: unknown[]) => JSON.stringify(value)

/** Две строки заказов в сыром слое — опора для фактов, которые на них ссылаются. */
const twoOrders = [
  { row_no: 1, date: '01.03.2026', order_id: 'A-1', sku: 'NP-001', units: '1',
    gross_eur: '10,00', discount_eur: '', gateway: 'stripe' },
  { row_no: 2, date: '2026-03-01', order_id: 'A-2', sku: 'NP-002', units: '1',
    gross_eur: '20,00', discount_eur: '', gateway: 'stripe' },
]

const twoAdsFiles = [
  { file_name: 'meta_2026-03.csv', row_no: 1, date: '2026-03-01', campaign: 'spring',
    spend_usd: '10.00' },
  { file_name: 'google_2026-03.csv', row_no: 1, date: '2026-03-01', campaign: 'search',
    spend_usd: '20.00' },
]

test('в схеме fact ровно семь таблиц, по одной на каждую сырую', async () => {
  const found = await rows<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'fact' order by tablename`,
  )
  expect(found.map((r) => r.tablename)).toEqual([
    'ads',
    'costs',
    'fees',
    'fx',
    'opex',
    'orders',
    'refunds',
  ])
})

test('слой фактов приведён к типам, а не повторяет текст источника', async () => {
  const found = await rows<{ place: string; type: string }>(
    `select table_name || '.' || column_name as place, data_type as type
       from information_schema.columns
      where table_schema = 'fact'
        and column_name in ('date', 'refund_date', 'valid_from', 'month', 'units',
                            'gross', 'discount', 'amount', 'cost', 'fixed', 'percent',
                            'spend', 'usd_per_eur')
      order by 1`,
  )
  const byPlace = Object.fromEntries(found.map((r) => [r.place, r.type]))
  expect(byPlace['orders.date']).toBe('date')
  expect(byPlace['refunds.refund_date']).toBe('date')
  expect(byPlace['costs.valid_from']).toBe('date')
  expect(byPlace['opex.month']).toBe('date')
  expect(byPlace['orders.units']).toBe('integer')
  expect(byPlace['orders.gross']).toBe('numeric')
  expect(byPlace['ads.spend']).toBe('numeric')
  expect(byPlace['fx.usd_per_eur']).toBe('numeric')
})

test('ноль не выдаётся за отсутствие данных ни в одном слое', async () => {
  const violations = await rows(
    `select table_schema || '.' || table_name || '.' || column_name as "место",
            coalesce(column_default, 'обязательна') as "нарушение"
       from information_schema.columns
      where table_schema in ('raw', 'fact')
        and column_name not in ('row_no', 'file_name', 'updated_at')
        and (column_default is not null or is_nullable = 'NO')
      order by 1`,
  )
  expect(violations).toEqual([])
})

test('исчезнувшая сырая строка уносит свой факт', async () => {
  await inRollback(async (client) => {
    await client.query('select raw.replace_orders($1::jsonb)', [snapshot(twoOrders)])
    await client.query(
      `insert into fact.orders (row_no, date, order_id, sku, units, gross, currency, gateway)
       values (1, date '2026-03-01', 'A-1', 'NP-001', 1, 10.00, 'EUR', 'stripe'),
              (2, date '2026-03-01', 'A-2', 'NP-002', 1, 20.00, 'EUR', 'stripe')`,
    )

    await client.query('select raw.replace_orders($1::jsonb)', [snapshot(twoOrders.slice(0, 1))])

    const { rows: left } = await client.query('select row_no from fact.orders order by row_no')
    expect(left.map((r) => r.row_no)).toEqual([1])
  })
})

test('исчезнувший из папки файл уносит и свои факты', async () => {
  await inRollback(async (client) => {
    await client.query('select raw.replace_entire_ads_folder($1::jsonb)', [snapshot(twoAdsFiles)])
    await client.query(
      `insert into fact.ads (file_name, row_no, date, campaign, platform, spend, currency)
       values ('meta_2026-03.csv', 1, date '2026-03-01', 'spring', 'meta', 10.00, 'USD'),
              ('google_2026-03.csv', 1, date '2026-03-01', 'search', 'google', 20.00, 'USD')`,
    )

    await client.query('select raw.replace_entire_ads_folder($1::jsonb)', [
      snapshot(twoAdsFiles.slice(1)),
    ])

    const { rows: left } = await client.query('select file_name from fact.ads')
    expect(left.map((r) => r.file_name)).toEqual(['google_2026-03.csv'])
  })
})

test('факта без сырой строки не бывает: цепочка не перепрыгивается', async () => {
  await inRollback(async (client) => {
    await client.query('select raw.replace_orders($1::jsonb)', [snapshot(twoOrders)])

    await expect(
      client.query(
        `insert into fact.orders (row_no, order_id, gross, currency)
         values (77, 'ниоткуда', 5.00, 'EUR')`,
      ),
    ).rejects.toThrow(/foreign key|внешн/i)
  })
})

// Число без валюты — не деньги. Проверяется у каждой таблицы фактов, где деньги есть.
describe.each([
  { table: 'orders', columns: '(row_no, gross, currency)', values: '(501, 10.00, null)' },
  { table: 'refunds', columns: '(row_no, amount, currency)', values: '(501, 10.00, null)' },
  { table: 'costs', columns: '(row_no, cost, currency)', values: '(501, 4.00, null)' },
  { table: 'fees', columns: '(row_no, fixed, currency)', values: '(501, 0.25, null)' },
  { table: 'opex', columns: '(row_no, amount, currency)', values: '(501, 99.00, null)' },
])('fact.$table', ({ table, columns, values }) => {
  test('сумма без валюты запрещена ограничением', async () => {
    await inRollback(async (client) => {
      // сырая строка-опора с адресом, не занятым посевом: упереться надо в валюту,
      // а не в первичный ключ и не во внешний
      await client.query(`insert into raw.${table} (row_no) values (501)`)

      await expect(
        client.query(`insert into fact.${table} ${columns} values ${values}`),
      ).rejects.toThrow(new RegExp(`${table}_currency_required`))
    })
  })
})

test('fact.ads: трата без валюты запрещена ограничением', async () => {
  await inRollback(async (client) => {
    await client.query(`insert into raw.ads (file_name, row_no) values ('файл.csv', 501)`)

    await expect(
      client.query(
        `insert into fact.ads (file_name, row_no, spend, currency)
         values ('файл.csv', 501, 10.00, null)`,
      ),
    ).rejects.toThrow(/ads_currency_required/)
  })
})
