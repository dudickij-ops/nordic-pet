import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { projectDatabaseUrl } from '@/lib/db-url'
import { buildFacts } from '@/lib/facts/build'
import { monthlyReport, type MetricsClient, type MetricsDeps, type MonthReport } from '@/lib/metrics/report'

/**
 * Проверки задачи 5: итог, доля честности, товары, неполнота и месяцы.
 *
 * Подставка `reportOn` — своя, не общая с `totals-fixture.ts`: та подставка отдаёт сырую
 * строку итогов (`Record<string, string | null>`) для проверок задач 2–4, а здесь нужен
 * готовый `MonthReport` целиком, с товарами, честностью и неполнотой. Раскладка кладётся
 * тем же приёмом — снимком через `raw.replace_<fn>` / `fact.replace_<table>` внутри
 * откатываемой транзакции, переведённой в точки сохранения, — но зовёт публичную
 * `monthlyReport()`, а не внутренний `monthTotals()`.
 */

const pool = new Pool({ connectionString: projectDatabaseUrl() })
afterAll(() => pool.end())

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
        return client.query(`savepoint отчёт_${depth}`)
      }
      if (command === 'commit') {
        const at = depth
        depth -= 1
        return client.query(`release savepoint отчёт_${at}`)
      }
      if (command === 'rollback') {
        const at = depth
        depth -= 1
        return client.query(`rollback to savepoint отчёт_${at}`)
      }
      return client.query(sql, params)
    },
    async release() {},
  }
}

function putRaw(client: PoolClient, fn: string, rows: unknown[]) {
  if (rows.length === 0) return Promise.resolve()
  return client.query(`select raw.replace_${fn}($1::jsonb)`, [JSON.stringify(rows)])
}

function putFact(client: PoolClient, table: string, rows: unknown[]) {
  if (rows.length === 0) return Promise.resolve()
  return client.query(`select fact.replace_${table}($1::jsonb)`, [JSON.stringify(rows)])
}

type OrderRow = {
  order: string; sku: string; date: string; units: number
  gross: string | null; discount: string | null; gateway: string
}
type RefundRow = { order: string; sku: string; date: string; units: number; amount: string | null }
type CostRow = { sku: string; cost: string | null; from: string }
type Extras = {
  fees?: Array<{ gateway: string; percent: string | null; fixed: string | null }>
  opex?: Array<{ month: string; category: string; amount: string | null }>
  ads?: Array<{
    file: string; row: number; date: string; campaign: string
    platform: string; spend: string | null
  }>
  fx?: Array<{ date: string; rate: string | null }>
}
type Layout = {
  orders: OrderRow[]
  refunds?: RefundRow[]
  costs?: CostRow[]
  extras?: Extras
}

/** `YYYY-MM` → первое число месяца: `fact.opex.month` — колонка типа `date`. */
function firstDayOfMonth(month: string): string {
  return month.length === 7 ? `${month}-01` : month
}

/**
 * Кладёт раскладку в откатываемую транзакцию и зовёт `monthlyReport` на том же клиенте.
 * Поля `refunds`, `costs` и `extras` необязательны — их отсутствие означает отсутствие
 * строк в соответствующей таблице фактов, а не скрытое умолчание.
 */
async function reportOn(layout: Layout, month?: string): Promise<MonthReport> {
  const client = await pool.connect()
  try {
    await client.query('begin')

    // Местная база может держать настоящие факты живого прогона загрузки и сборки.
    // Проверка от них не зависит, поэтому слой фактов и его сырьё внутри этой
    // откатываемой транзакции опустошаются, как в totals-fixture.ts.
    for (const table of FACT_TABLES) {
      await client.query(`delete from fact.${table}`)
      await client.query(`delete from raw.${table}`)
    }

    const orders = layout.orders
    await putRaw(client, 'orders', orders.map((o, i) => ({
      row_no: i + 1, date: o.date, order_id: o.order, sku: o.sku,
      units: o.units, gross_eur: o.gross, discount_eur: o.discount, gateway: o.gateway,
    })))
    await putFact(client, 'orders', orders.map((o, i) => ({
      row_no: i + 1, date: o.date, order_id: o.order, sku: o.sku,
      units: o.units, gross: o.gross, discount: o.discount, currency: 'EUR', gateway: o.gateway,
    })))

    const refunds = layout.refunds ?? []
    await putRaw(client, 'refunds', refunds.map((r, i) => ({
      row_no: i + 1, refund_date: r.date, order_id: r.order, sku: r.sku,
      units: r.units, amount_eur: r.amount,
    })))
    await putFact(client, 'refunds', refunds.map((r, i) => ({
      row_no: i + 1, refund_date: r.date, order_id: r.order, sku: r.sku,
      units: r.units, amount: r.amount, currency: 'EUR',
    })))

    const costs = layout.costs ?? []
    await putRaw(client, 'costs', costs.map((c, i) => ({
      row_no: i + 1, sku: c.sku, cost_eur: c.cost, valid_from: c.from,
    })))
    await putFact(client, 'costs', costs.map((c, i) => ({
      row_no: i + 1, sku: c.sku, cost: c.cost, currency: 'EUR', valid_from: c.from,
    })))

    const extras = layout.extras ?? {}

    const fees = extras.fees ?? []
    await putRaw(client, 'fees', fees.map((f, i) => ({
      row_no: i + 1, gateway: f.gateway, percent: f.percent, fixed_eur: f.fixed,
    })))
    await putFact(client, 'fees', fees.map((f, i) => ({
      row_no: i + 1, gateway: f.gateway, percent: f.percent, fixed: f.fixed, currency: 'EUR',
    })))

    const opex = extras.opex ?? []
    await putRaw(client, 'opex', opex.map((o, i) => ({
      row_no: i + 1, month: firstDayOfMonth(o.month), category: o.category, amount_eur: o.amount,
    })))
    await putFact(client, 'opex', opex.map((o, i) => ({
      row_no: i + 1, month: firstDayOfMonth(o.month), category: o.category,
      amount: o.amount, currency: 'EUR',
    })))

    const fx = extras.fx ?? []
    await putRaw(client, 'fx', fx.map((f, i) => ({ row_no: i + 1, date: f.date, usd_per_eur: f.rate })))
    await putFact(client, 'fx', fx.map((f, i) => ({ row_no: i + 1, date: f.date, usd_per_eur: f.rate })))

    const ads = extras.ads ?? []
    await putRaw(client, 'entire_ads_folder', ads.map((a) => ({
      file_name: a.file, row_no: a.row, date: a.date, campaign: a.campaign, spend_usd: a.spend,
    })))
    await putFact(client, 'ads', ads.map((a) => ({
      file_name: a.file, row_no: a.row, date: a.date, campaign: a.campaign,
      platform: a.platform, spend: a.spend, currency: 'USD',
    })))

    return await monthlyReport(month, {
      announce: () => {},
      connect: async () => savepointClient(client),
    })
  } finally {
    await client.query('rollback').catch(() => {})
    client.release()
  }
}

/** Раскладка, на которой держатся первые проверки задачи: net 1000, cogs 400, ads 100, fees 20, fixed 80. */
const РАСКЛАДКА: Layout = {
  orders: [
    { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '1000.00', discount: '0.00', gateway: 'card' },
  ],
  costs: [{ sku: 'NP-001', cost: '400.00', from: '2026-01-01' }],
  extras: {
    fees: [{ gateway: 'card', percent: '2.0000', fixed: '0.00' }],
    opex: [{ month: '2026-03-01', category: 'аренда', amount: '80.00' }],
    ads: [{ file: 'meta.csv', row: 1, date: '2026-03-01', campaign: 'a', platform: 'meta', spend: '200.00' }],
    fx: [{ date: '2026-03-01', rate: '2.0000' }],
  },
}

describe('месячный отчёт', () => {
  test('прибыль — разность пяти слагаемых', async () => {
    const о = await reportOn(РАСКЛАДКА, '2026-03')
    expect(о.revenue.net).toBe('1000.00')
    expect(о.costs).toEqual({ cogs: '400.00', ads: '100.00', fees: '20.00', fixed: '80.00' })
    expect(о.bottom.profit).toBe('400.00')
  })

  test('маржа — прибыль ÷ чистую выручку', async () => {
    const о = await reportOn(РАСКЛАДКА, '2026-03')
    expect(о.bottom.marginPct).toBe('40.0')
  })

  test('окупаемость — оборот ÷ рекламу', async () => {
    const о = await reportOn(РАСКЛАДКА, '2026-03')
    expect(о.revenue.gross).toBe('1000.00')
    expect(о.bottom.roasByGross).toBe('10.00')
  })

  test('окупаемость считается от оборота, а не от чистой выручки', async () => {
    const со_скидкой: Layout = {
      ...РАСКЛАДКА,
      orders: [{ order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '1000.00', discount: '200.00', gateway: 'card' }],
    }
    const о = await reportOn(со_скидкой, '2026-03')
    expect(о.revenue.net).toBe('800.00')
    expect(о.bottom.roasByGross).toBe('10.00') // 1000 ÷ 100, а не 800 ÷ 100
  })

  test('при нулевой чистой выручке маржа — нет данных, а не ноль', async () => {
    const о = await reportOn({ orders: [], costs: [], extras: {} }, '2026-03')
    expect(о.revenue.net).toBe('0.00')
    expect(о.bottom.marginPct).toBeNull()
  })

  test('при нулевой рекламе окупаемость — нет данных', async () => {
    const о = await reportOn({ ...РАСКЛАДКА, extras: { ...РАСКЛАДКА.extras, ads: [], fx: [] } }, '2026-03')
    expect(о.costs.ads).toBe('0.00')
    expect(о.bottom.roasByGross).toBeNull()
  })

  test('доля честности считается от чистой выручки, а не от оборота', async () => {
    // Оборот 1200, чистая выручка 1000. От чистой доля 90,0; от оборота была бы 75,0.
    // Без этого расхождения проверка не различала бы два знаменателя вовсе.
    const о = await reportOn({
      orders: [
        { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '1000.00', discount: '100.00', gateway: 'card' },
        { order: 'A-2', sku: 'NP-012', date: '2026-03-02', units: 1, gross: '200.00', discount: '100.00', gateway: 'card' },
      ],
      costs: [{ sku: 'NP-001', cost: '10.00', from: '2026-01-01' }],
      extras: {},
    }, '2026-03')
    expect(о.revenue.gross).toBe('1200.00')
    expect(о.revenue.net).toBe('1000.00')
    expect(о.honesty.sharePct).toBe('90.0')   // не 75.0
    expect(о.honesty.skusWithoutPrice).toEqual(['NP-012'])
  })

  test('товары отсортированы по чистой выручке убыванием, штуки — за вычетом возвращённых', async () => {
    // У товара с большей выручкой артикул ПОЗЖЕ по алфавиту. Без этого сортировка по выручке
    // и сортировка по артикулу давали бы один и тот же порядок, и проверка не различала бы их.
    const о = await reportOn({
      orders: [
        { order: 'A-1', sku: 'NP-012', date: '2026-03-02', units: 3, gross: '900.00', discount: '0.00', gateway: 'card' },
        { order: 'A-2', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' },
      ],
      refunds: [{ order: 'A-1', sku: 'NP-012', date: '2026-03-09', units: 1, amount: '300.00' }],
      costs: [{ sku: 'NP-012', cost: '10.00', from: '2026-01-01' }],
      extras: {},
    }, '2026-03')
    expect(о.items.map((i) => i.sku)).toEqual(['NP-012', 'NP-001'])   // не по алфавиту
    expect(о.items[0]).toMatchObject({ units: '2', net: '600.00', cogs: '20.00', profit: '580.00' })
    expect(о.items[1]).toMatchObject({ units: '1', net: '100.00', cogs: '40.00', profit: '60.00' })
  })

  test('блок неполноты печатает все одиннадцать видов и нули, когда дыр нет', async () => {
    const о = await reportOn(РАСКЛАДКА, '2026-03')
    expect(о.gaps).toHaveLength(11)
    expect(о.gaps.map((g) => g.kind)).toEqual([
      'скидки', 'оборот', 'возвраты без суммы', 'возвраты, не попавшие в счёт',
      'возвращено больше, чем куплено', 'строки продаж без цены поставщика',
      'ставки без процента или без фиксированной части', 'заказы с разными способами оплаты',
      'постоянные расходы без суммы', 'реклама без суммы', 'дни рекламы без курса',
    ])
    expect(о.gaps.every((g) => g.count === 0)).toBe(true)
  })

  test('каждая найденная дыра называет адрес', async () => {
    const о = await reportOn({
      orders: [{ order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '50.00', discount: null, gateway: 'card' }],
      costs: [{ sku: 'NP-001', cost: '10.00', from: '2026-01-01' }],
      extras: {},
    }, '2026-03')
    const скидки = о.gaps.find((g) => g.kind === 'скидки')!
    expect(скидки.count).toBe(1)
    expect(скидки.at).toEqual(['1'])
  })

  test('возврат, не попавший в счёт, назван — и когда пары нет, и когда пара выпала', async () => {
    const о = await reportOn({
      orders: [{ order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '50.00', discount: '0.00', gateway: 'card' }],
      refunds: [{ order: 'A-9', sku: 'NP-777', date: '2026-03-09', units: 1, amount: '50.00' }],
      costs: [{ sku: 'NP-001', cost: '10.00', from: '2026-01-01' }],
      extras: {},
    }, '2026-03')
    expect(о.revenue.net).toBe('50.00')
    const дыра = о.gaps.find((g) => g.kind === 'возвраты, не попавшие в счёт')!
    expect(дыра.count).toBe(1)
    expect(дыра.at).toEqual(['A-9 / NP-777'])
  })

  test('возврат к паре, выпавшей из счёта из-за пустой суммы, тоже назван', async () => {
    const о = await reportOn({
      orders: [{ order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: null, discount: '0.00', gateway: 'card' }],
      refunds: [{ order: 'A-1', sku: 'NP-001', date: '2026-03-09', units: 1, amount: '50.00' }],
      costs: [{ sku: 'NP-001', cost: '10.00', from: '2026-01-01' }],
      extras: {},
    }, '2026-03')
    expect(о.revenue.refunds).toBe('0.00')
    const дыра = о.gaps.find((g) => g.kind === 'возвраты, не попавшие в счёт')!
    expect(дыра.count).toBe(1)   // не ноль: сумма у возврата есть, и пара в заказах есть
    expect(дыра.at).toEqual(['A-1 / NP-001'])
  })

  test('месяц по умолчанию — последний, за который есть заказы', async () => {
    const о = await reportOn({
      orders: [
        { order: 'A-1', sku: 'NP-001', date: '2026-02-10', units: 1, gross: '10.00', discount: '0.00', gateway: 'card' },
        { order: 'A-2', sku: 'NP-001', date: '2026-03-10', units: 1, gross: '10.00', discount: '0.00', gateway: 'card' },
      ],
      costs: [{ sku: 'NP-001', cost: '1.00', from: '2026-01-01' }],
      extras: { opex: [{ month: '2026-04-01', category: 'аренда', amount: '5.00' }] },
    })
    expect(о.month).toBe('2026-03')
    expect(о.months.map((m) => m.month)).toEqual(['2026-04', '2026-03', '2026-02'])
    expect(о.months.find((m) => m.month === '2026-04')!.hasOrders).toBe(false)
  })

  test('пустой слой фактов не роняет отчёт', async () => {
    const о = await reportOn({ orders: [], costs: [], extras: {} })
    expect(о.month).toBeNull()
    expect(о.months).toEqual([])
    expect(о.revenue.net).toBe('0.00')
    expect(о.bottom.marginPct).toBeNull()
  })

  test('на настоящей базе, без единого довода, по всей цепочке', async () => {
    // Посев наполняет только сырой слой: после db:reset в raw.orders четыре строки, в
    // fact.orders ноль, и три проверки S1 на это опираются. Поэтому боевая проверка сперва
    // зовёт сборку фактов — это и есть настоящая цепочка посев → сырьё → факты → метрики, —
    // а потом возвращает слой фактов пустым. Приём тот же, что у принятой боевой проверки S4
    // в __tests__/facts/build.test.ts, и по той же причине.
    process.env.NORDIC_PET_DB_TARGET = 'local'
    try {
      await buildFacts()
      const о = await monthlyReport()
      expect(о.month).toBe('2026-03')
      expect(о.revenue.gross).toBe('192.30')   // 24,90 + 51,80 + 25,90 + 89,70
    } finally {
      // Один оператор, а не семь: отказ третьего из семи `delete` оставлял бы базу
      // наполовину прибранной и заслонял бы исходную ошибку своей собственной.
      await pool.query(
        'truncate fact.orders, fact.refunds, fact.costs, fact.fees, fact.opex, fact.fx, fact.ads',
      )
    }
  })
})

/**
 * Каждый вид дыры доказывается случаем, когда он срабатывает, а не только случаем, когда
 * дыр нет. Правило появилось после проверки кода: счётчик, ослеплённый в постоянный ноль,
 * проходит проверку «все виды на месте и все нули» идеально — она доказывает состав
 * списка, а не работу счётчиков. Каждая раскладка ниже собрана так, чтобы создавать ровно
 * одну дыру, и только её: остальные десять счётчиков на ней остаются нулём — иначе
 * проверка доказывала бы не тот счётчик, который названа.
 */
const раскладкаБезСкидки = {
  orders: [{ order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '50.00', discount: null, gateway: 'card' }],
  costs: [{ sku: 'NP-001', cost: '10.00', from: '2026-01-01' }],
  extras: {},
}

const раскладкаБезСуммы = {
  orders: [{ order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: null, discount: '0.00', gateway: 'card' }],
  costs: [{ sku: 'NP-001', cost: '10.00', from: '2026-01-01' }],
  extras: {},
}

const раскладкаВозвратаБезСуммы = {
  orders: [{ order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 3, gross: '90.00', discount: '0.00', gateway: 'card' }],
  refunds: [{ order: 'A-1', sku: 'NP-001', date: '2026-03-09', units: 1, amount: null }],
  costs: [{ sku: 'NP-001', cost: '10.00', from: '2026-01-01' }],
  extras: {},
}

const раскладкаЧужогоВозврата = {
  orders: [{ order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '50.00', discount: '0.00', gateway: 'card' }],
  refunds: [{ order: 'A-9', sku: 'NP-777', date: '2026-03-09', units: 1, amount: '50.00' }],
  costs: [{ sku: 'NP-001', cost: '10.00', from: '2026-01-01' }],
  extras: {},
}

const раскладкаИзбыточногоВозврата = {
  orders: [{ order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 2, gross: '60.00', discount: '0.00', gateway: 'card' }],
  refunds: [{ order: 'A-1', sku: 'NP-001', date: '2026-03-09', units: 5, amount: '10.00' }],
  costs: [{ sku: 'NP-001', cost: '10.00', from: '2026-01-01' }],
  extras: {},
}

const раскладкаБезЦены = {
  orders: [{ order: 'A-1', sku: 'NP-012', date: '2026-03-02', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' }],
  costs: [],
  extras: {},
}

const раскладкаНеполнойСтавки = {
  orders: [{ order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '50.00', discount: '0.00', gateway: 'card' }],
  costs: [{ sku: 'NP-001', cost: '10.00', from: '2026-01-01' }],
  extras: { fees: [{ gateway: 'card', percent: null, fixed: '0.25' }] },
}

const раскладкаСмешаннойОплаты = {
  orders: [
    { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' },
    { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '100.00', discount: '0.00', gateway: 'paypal' },
  ],
  costs: [{ sku: 'NP-001', cost: '10.00', from: '2026-01-01' }],
  extras: {},
}

const раскладкаРасходаБезСуммы = {
  orders: [{ order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '50.00', discount: '0.00', gateway: 'card' }],
  costs: [{ sku: 'NP-001', cost: '10.00', from: '2026-01-01' }],
  extras: { opex: [{ month: '2026-03-01', category: 'бухгалтерия', amount: null }] },
}

const раскладкаРекламыБезСуммы = {
  orders: [{ order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '50.00', discount: '0.00', gateway: 'card' }],
  costs: [{ sku: 'NP-001', cost: '10.00', from: '2026-01-01' }],
  extras: {
    ads: [{ file: 'meta.csv', row: 1, date: '2026-03-01', campaign: 'a', platform: 'meta', spend: null }],
    fx: [{ date: '2026-03-01', rate: '2.0000' }],
  },
}

const раскладкаБезКурса = {
  orders: [{ order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '50.00', discount: '0.00', gateway: 'card' }],
  costs: [{ sku: 'NP-001', cost: '10.00', from: '2026-01-01' }],
  extras: {
    ads: [{ file: 'meta.csv', row: 1, date: '2026-03-01', campaign: 'a', platform: 'meta', spend: '100.00' }],
    fx: [],
  },
}

describe('блок неполноты — каждый счётчик доказан случаем, когда он не ноль', () => {
  test.each([
    ['скидки', раскладкаБезСкидки, 1, ['1']],
    ['оборот', раскладкаБезСуммы, 1, ['1']],
    ['возвраты без суммы', раскладкаВозвратаБезСуммы, 1, ['1']],
    ['возвраты, не попавшие в счёт', раскладкаЧужогоВозврата, 1, ['A-9 / NP-777']],
    ['возвращено больше, чем куплено', раскладкаИзбыточногоВозврата, 1, ['A-1 / NP-001']],
    ['строки продаж без цены поставщика', раскладкаБезЦены, 1, ['NP-012']],
    ['ставки без процента или без фиксированной части', раскладкаНеполнойСтавки, 1, ['card']],
    ['заказы с разными способами оплаты', раскладкаСмешаннойОплаты, 1, ['A-1']],
    ['постоянные расходы без суммы', раскладкаРасходаБезСуммы, 1, ['бухгалтерия']],
    ['реклама без суммы', раскладкаРекламыБезСуммы, 1, ['meta.csv:1']],
    ['дни рекламы без курса', раскладкаБезКурса, 1, ['2026-03-01']],
  ])('счётчик «%s» срабатывает и называет адрес', async (вид, раскладка, число, адреса) => {
    const о = await reportOn(раскладка as Layout, '2026-03')
    const дыра = о.gaps.find((g) => g.kind === вид)!
    expect(дыра.count).toBe(число)
    expect(дыра.at).toEqual(адреса)
  })

  test('дыра соседнего месяца в счётчики не попадает', async () => {
    const о = await reportOn({
      orders: [{ order: 'A-1', sku: 'NP-001', date: '2026-04-02', units: 1, gross: '10.00', discount: null, gateway: 'card' }],
      costs: [{ sku: 'NP-001', cost: '1.00', from: '2026-01-01' }], extras: {},
    }, '2026-03')
    expect(о.gaps.find((g) => g.kind === 'скидки')!.count).toBe(0)
  })

  test('дыра рекламы соседнего месяца в счётчики не попадает', async () => {
    const о = await reportOn({
      orders: [], costs: [], extras: {
        ads: [
          { file: 'meta.csv', row: 1, date: '2026-04-01', campaign: 'a', platform: 'meta', spend: null },
          { file: 'meta.csv', row: 2, date: '2026-04-02', campaign: 'b', platform: 'meta', spend: '10.00' },
        ],
        fx: [],
      },
    }, '2026-03')
    expect(о.gaps.find((g) => g.kind === 'реклама без суммы')!.count).toBe(0)
    expect(о.gaps.find((g) => g.kind === 'дни рекламы без курса')!.count).toBe(0)
  })

  test('штуки товара не бывают отрицательными на экране', async () => {
    const о = await reportOn({
      orders: [{ order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 2, gross: '80.00', discount: '0.00', gateway: 'card' }],
      refunds: [{ order: 'A-1', sku: 'NP-001', date: '2026-03-09', units: 5, amount: '0.00' }],
      costs: [{ sku: 'NP-001', cost: '10.00', from: '2026-01-01' }], extras: {},
    }, '2026-03')
    expect(о.items[0].units).toBe('0')   // не «−3»
  })

  test('заказ, оплаченный двумя способами по одному артикулу, комиссии не даёт и назван', async () => {
    const о = await reportOn({
      orders: [
        { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' },
        { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '100.00', discount: '0.00', gateway: 'paypal' },
      ],
      costs: [{ sku: 'NP-001', cost: '1.00', from: '2026-01-01' }],
      extras: { fees: [
        { gateway: 'card', percent: '1.0000', fixed: '0.00' },
        { gateway: 'paypal', percent: '50.0000', fixed: '0.00' },
      ] },
    }, '2026-03')
    expect(о.costs.fees).toBe('0.00')   // не 2.00 по ставке алфавитно первого способа
    expect(о.gaps.find((g) => g.kind === 'заказы с разными способами оплаты')!.count).toBe(1)
  })
})

describe('кривой месяц отклоняется до похода в базу', () => {
  // Дверь, которая не должна открыться: проверка формы обязана отказать раньше первого
  // обращения к соединению. Если бы отказ приходил из SQL («invalid input syntax for
  // type date»), эта подставка сама бы это доказала своей ошибкой — а не читаемым словом
  // «ГГГГ-ММ».
  const подставки: Partial<MetricsDeps> = {
    announce: () => {},
    connect: async () => {
      throw new Error('за проверкой формы месяца в базу ходить не должны')
    },
  }

  test('кривой месяц — отказ нашими словами, а не ошибка базы', async () => {
    await expect(monthlyReport('boom', подставки)).rejects.toThrow(/ГГГГ-ММ/)
    await expect(monthlyReport('2026-13', подставки)).rejects.toThrow(/ГГГГ-ММ/)
  })
})
