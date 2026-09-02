import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { projectDatabaseUrl } from '@/lib/db-url'
import { monthTotals, withFactSnapshot, type MetricsClient } from '@/lib/metrics/report'

/**
 * Выручка, скидки, возвраты — правила 1 и 2 задания.
 *
 * Сырьё кладётся теми же функциями снимка, что и живая загрузка (S1 — сырой слой) и живая
 * сборка (S4 — слой фактов): второй способ положить строку разошёлся бы с первым молча.
 * Раз слой метрик читает только `fact.*`, а у каждой строки фактов внешний ключ на свою
 * сырую — в сырую таблицу кладётся строка того же адреса, прежде чем класть факт. Само
 * содержимое сырой строки счёту не важно: счёт его не читает, — важен только адрес.
 *
 * Всё происходит внутри одной откатываемой транзакции на проверку, как в
 * `__tests__/facts/build.test.ts`. `withFactSnapshot` открывает свою транзакцию изнутри
 * уже открытой снаружи, поэтому клиент, который ему подсовывают, переводит
 * `begin`/`commit`/`rollback` в точки сохранения — тем же приёмом, что и там.
 */

const pool = new Pool({ connectionString: projectDatabaseUrl() })
afterAll(() => pool.end())

// Среда называется словом: `withFactSnapshot` называет цель до соединения и откажется
// работать без неё, даже если подставленное соединение эту цель не читает.
let savedTarget: string | undefined
beforeAll(() => {
  savedTarget = process.env.NORDIC_PET_DB_TARGET
  process.env.NORDIC_PET_DB_TARGET = 'local'
})
afterAll(() => {
  if (savedTarget === undefined) delete process.env.NORDIC_PET_DB_TARGET
  else process.env.NORDIC_PET_DB_TARGET = savedTarget
})

const FACT_TABLES = ['orders', 'refunds', 'costs', 'fees', 'opex', 'fx', 'ads']

/** Клиент, у которого границы транзакции переведены в точки сохранения. */
function savepointClient(client: PoolClient): MetricsClient {
  let depth = 0
  return {
    async query(sql: string, params?: unknown[]) {
      const command = sql.trim().toLowerCase()
      if (command.startsWith('begin')) {
        depth += 1
        return client.query(`savepoint метрики_${depth}`)
      }
      if (command === 'commit') {
        const at = depth
        depth -= 1
        return client.query(`release savepoint метрики_${at}`)
      }
      if (command === 'rollback') {
        const at = depth
        depth -= 1
        return client.query(`rollback to savepoint метрики_${at}`)
      }
      return client.query(sql, params)
    },
    async release() {},
  }
}

/** Кладёт снимок целиком функцией `raw.replace_<fn>`. Пустой снимок функция отвергает. */
function putRaw(client: PoolClient, fn: string, rows: unknown[]) {
  if (rows.length === 0) return Promise.resolve()
  return client.query(`select raw.replace_${fn}($1::jsonb)`, [JSON.stringify(rows)])
}

/** Кладёт снимок целиком функцией `fact.replace_<table>`. */
function putFact(client: PoolClient, table: string, rows: unknown[]) {
  if (rows.length === 0) return Promise.resolve()
  return client.query(`select fact.replace_${table}($1::jsonb)`, [JSON.stringify(rows)])
}

// Подписи фиксированы заданием и дальше не меняются: подставкой пользуются задачи 2, 3, 4 и 5.
type OrderRow = {
  order: string; sku: string; date: string; units: number
  gross: string | null; discount: string | null; gateway: string
}
type RefundRow = { order: string; sku: string; date: string; units: number; amount: string | null }
type CostRow = { sku: string; cost: string | null; from: string }
type Extras = {
  fees?: Array<{ gateway: string; percent: string; fixed: string }>
  opex?: Array<{ month: string; category: string; amount: string | null }>
  ads?: Array<{
    file: string; row: number; date: string; campaign: string
    platform: string; spend: string | null
  }>
  fx?: Array<{ date: string; rate: string }>
}

/** `YYYY-MM` → первое число месяца: `fact.opex.month` — колонка типа `date`. */
function firstDayOfMonth(month: string): string {
  return month.length === 7 ? `${month}-01` : month
}

/**
 * Кладёт выдуманные факты в откатываемую транзакцию и возвращает строку итогов месяца.
 * Умолчания: одна ставка `card` 1.9000 + 0.25, ни расходов, ни рекламы, ни курса —
 * чтобы проверка выручки не зависела от того, чего она не проверяет.
 */
async function totalsOn(
  orders: OrderRow[],
  refunds: RefundRow[],
  month: string,
  costs: CostRow[] = [],
  extras: Extras = {},
): Promise<Record<string, string | null>> {
  const client = await pool.connect()
  try {
    await client.query('begin')

    // Местная база может держать настоящие факты живого прогона загрузки и сборки.
    // Проверка выручки от них не зависит, поэтому слой фактов и его сырьё внутри этой
    // откатываемой транзакции опустошаются, как в __tests__/facts/build.test.ts.
    for (const table of FACT_TABLES) {
      await client.query(`delete from fact.${table}`)
      await client.query(`delete from raw.${table}`)
    }

    await putRaw(
      client,
      'orders',
      orders.map((o, i) => ({
        row_no: i + 1, date: o.date, order_id: o.order, sku: o.sku,
        units: o.units, gross_eur: o.gross, discount_eur: o.discount, gateway: o.gateway,
      })),
    )
    await putFact(
      client,
      'orders',
      orders.map((o, i) => ({
        row_no: i + 1, date: o.date, order_id: o.order, sku: o.sku,
        units: o.units, gross: o.gross, discount: o.discount, currency: 'EUR', gateway: o.gateway,
      })),
    )

    await putRaw(
      client,
      'refunds',
      refunds.map((r, i) => ({
        row_no: i + 1, refund_date: r.date, order_id: r.order, sku: r.sku,
        units: r.units, amount_eur: r.amount,
      })),
    )
    await putFact(
      client,
      'refunds',
      refunds.map((r, i) => ({
        row_no: i + 1, refund_date: r.date, order_id: r.order, sku: r.sku,
        units: r.units, amount: r.amount, currency: 'EUR',
      })),
    )

    await putRaw(
      client,
      'costs',
      costs.map((c, i) => ({ row_no: i + 1, sku: c.sku, cost_eur: c.cost, valid_from: c.from })),
    )
    await putFact(
      client,
      'costs',
      costs.map((c, i) => ({
        row_no: i + 1, sku: c.sku, cost: c.cost, currency: 'EUR', valid_from: c.from,
      })),
    )

    const fees = extras.fees ?? [{ gateway: 'card', percent: '1.9000', fixed: '0.25' }]
    await putRaw(
      client,
      'fees',
      fees.map((f, i) => ({ row_no: i + 1, gateway: f.gateway, percent: f.percent, fixed_eur: f.fixed })),
    )
    await putFact(
      client,
      'fees',
      fees.map((f, i) => ({
        row_no: i + 1, gateway: f.gateway, percent: f.percent, fixed: f.fixed, currency: 'EUR',
      })),
    )

    const opex = extras.opex ?? []
    await putRaw(
      client,
      'opex',
      opex.map((o, i) => ({
        row_no: i + 1, month: firstDayOfMonth(o.month), category: o.category, amount_eur: o.amount,
      })),
    )
    await putFact(
      client,
      'opex',
      opex.map((o, i) => ({
        row_no: i + 1, month: firstDayOfMonth(o.month), category: o.category,
        amount: o.amount, currency: 'EUR',
      })),
    )

    const fx = extras.fx ?? []
    await putRaw(
      client,
      'fx',
      fx.map((f, i) => ({ row_no: i + 1, date: f.date, usd_per_eur: f.rate })),
    )
    await putFact(
      client,
      'fx',
      fx.map((f, i) => ({ row_no: i + 1, date: f.date, usd_per_eur: f.rate })),
    )

    const ads = extras.ads ?? []
    // Рекламу кладёт `raw.replace_entire_ads_folder`: имя функции другое, таблица та же.
    await putRaw(
      client,
      'entire_ads_folder',
      ads.map((a) => ({ file_name: a.file, row_no: a.row, date: a.date, campaign: a.campaign, spend_usd: a.spend })),
    )
    await putFact(
      client,
      'ads',
      ads.map((a) => ({
        file_name: a.file, row_no: a.row, date: a.date, campaign: a.campaign,
        platform: a.platform, spend: a.spend, currency: 'USD',
      })),
    )

    return await withFactSnapshot((mc) => monthTotals(mc, month), {
      announce: () => {},
      connect: async () => savepointClient(client),
    })
  } finally {
    await client.query('rollback').catch(() => {})
    client.release()
  }
}

describe('выручка, скидки и возвраты', () => {
  test('чистая выручка = оборот − скидки − возвраты', async () => {
    const totals = await totalsOn([
      { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 2, gross: '100.00', discount: '10.00', gateway: 'card' },
    ], [
      { order: 'A-1', sku: 'NP-001', date: '2026-03-05', units: 1, amount: '30.00' },
    ], '2026-03')
    expect(totals.gross).toBe('100.00')
    expect(totals.discounts).toBe('10.00')
    expect(totals.refunds).toBe('30.00')
    expect(totals.net).toBe('60.00')
  })

  test('возврат уменьшает месяц заказа, а не месяц возврата', async () => {
    const totals = await totalsOn([
      { order: 'A-1', sku: 'NP-001', date: '2026-03-31', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' },
    ], [
      { order: 'A-1', sku: 'NP-001', date: '2026-04-07', units: 1, amount: '100.00' },
    ], '2026-03')
    expect(totals.net).toBe('0.00')
  })

  test('сдвиг даты возврата на месяц вперёд не меняет ни один итог марта', async () => {
    const orders = [
      { order: 'A-1', sku: 'NP-001', date: '2026-03-31', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' },
    ]
    const близко = await totalsOn(orders, [{ order: 'A-1', sku: 'NP-001', date: '2026-03-31', units: 1, amount: '40.00' }], '2026-03')
    const далеко = await totalsOn(orders, [{ order: 'A-1', sku: 'NP-001', date: '2026-04-30', units: 1, amount: '40.00' }], '2026-03')
    // Сравнение двух итогов друг с другом зелено и на сплошных нулях; число закрепляется отдельно.
    expect(близко.net).toBe('60.00')
    expect(далеко).toEqual(близко)
  })

  test('пустая скидка вычитает ноль', async () => {
    const totals = await totalsOn([
      { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '50.00', discount: null, gateway: 'card' },
    ], [], '2026-03')
    expect(totals.discounts).toBe('0.00')
    expect(totals.net).toBe('50.00')
  })

  test('возврат без суммы выручку не уменьшает', async () => {
    const totals = await totalsOn([
      { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 2, gross: '50.00', discount: '0.00', gateway: 'card' },
    ], [{ order: 'A-1', sku: 'NP-001', date: '2026-03-09', units: 1, amount: null }], '2026-03')
    expect(totals.refunds).toBe('0.00')
    expect(totals.net).toBe('50.00')
  })

  test('две строки одной пары «заказ + артикул» складываются, а не теряются', async () => {
    const totals = await totalsOn([
      { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '30.00', discount: '0.00', gateway: 'card' },
      { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '20.00', discount: '0.00', gateway: 'card' },
    ], [], '2026-03')
    expect(totals.gross).toBe('50.00')
  })

  test('строка без суммы не даёт ни оборота, ни скидки', async () => {
    const totals = await totalsOn([
      { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: null, discount: '5.00', gateway: 'card' },
      { order: 'A-2', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '10.00', discount: '0.00', gateway: 'card' },
    ], [], '2026-03')
    expect(totals.gross).toBe('10.00')
    expect(totals.discounts).toBe('0.00')
  })

  test('заказ с разошедшимися датами строк идёт в один месяц, и возврат вычитается один раз', async () => {
    const заказ = [
      { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' },
      { order: 'A-1', sku: 'NP-001', date: '2026-04-02', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' },
    ]
    const возврат = [{ order: 'A-1', sku: 'NP-001', date: '2026-03-09', units: 1, amount: '40.00' }]
    const март = await totalsOn(заказ, возврат, '2026-03')
    const апрель = await totalsOn(заказ, возврат, '2026-04')
    expect(март.net).toBe('160.00')   // 200 − 40, а не 60
    expect(апрель.net).toBe('0.00')   // а не вторые 60
  })

  test('в паре с пустой суммой пустая строка уносит свою скидку, а сосед остаётся', async () => {
    const totals = await totalsOn([
      { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: null, discount: '5.00', gateway: 'card' },
      { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '10.00', discount: '0.00', gateway: 'card' },
    ], [], '2026-03')
    expect(totals.gross).toBe('10.00')
    expect(totals.discounts).toBe('0.00')  // не 5.00: вычет неизвестного происхождения
    expect(totals.net).toBe('10.00')
  })

  test('заказ соседнего месяца в счёт не попадает', async () => {
    const totals = await totalsOn([
      { order: 'A-1', sku: 'NP-001', date: '2026-04-01', units: 1, gross: '99.00', discount: '0.00', gateway: 'card' },
    ], [], '2026-03')
    expect(totals.gross).toBe('0.00')
  })
})
