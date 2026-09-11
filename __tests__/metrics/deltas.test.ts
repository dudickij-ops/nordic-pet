import { Pool, type PoolClient } from 'pg'
import { afterAll, describe, expect, test } from 'vitest'

import { projectDatabaseUrl } from '@/lib/db-url'
import { monthlyReport } from '@/lib/metrics/report'
import {
  DELTAS_FROM_ROWS,
  MONTH_DELTAS,
  MONTH_TOTALS,
  PREVIOUS_MONTH_TOTALS,
  WATERFALL_FROM_TOTALS,
} from '@/lib/metrics/sql'

/**
 * Полоса показателей и дельты — кусок S11, шаг 7.
 *
 * Счёт дельт проверяется на **подставленных строках итогов** двух месяцев — теми же приёмами, что у
 * водопада: числа нарочно неудобны, и дельта, посчитанная не от той колонки или не в тех единицах,
 * напечатает число, которого здесь нет. Боевая сборка — прошлый календарный месяц, его заказы, его
 * итоги — проверяется на фактах, положенных в транзакцию, которая откатывается. Переход между путями
 * идёт настоящим отчётом: февральский заказ записывается и убирается (довод — у той проверки).
 */

const pool = new Pool({ connectionString: projectDatabaseUrl() })
afterAll(() => pool.end())

type Итоги = { gross: string; net: string; ads: string; profit: string; margin_pct: string | null }
type Состояние = { month: string | null; has_orders: boolean; has_ads: boolean }
type Показатель = {
  key: string
  unit: string
  good_when_up: boolean
  value: string | null
  delta: string | null
  verdict: string | null
  prev_month: string | null
  has_base: boolean
}

function строкаИтогов(и: Итоги): string {
  const поле = (v: string | null) => (v === null ? 'null::text' : `'${v}'::text`)
  return `select ${поле(и.gross)} as gross, ${поле(и.net)} as net, ${поле(и.ads)} as ads, ${поле(и.profit)} as profit, ${поле(и.margin_pct)} as margin_pct`
}

async function показатели(текущий: Итоги, прошлый: Итоги, состояние: Состояние): Promise<Record<string, Показатель>> {
  const { rows } = await pool.query(
    `with cur_row as (${строкаИтогов(текущий)}),
          prev_row as (${строкаИтогов(прошлый)}),
          prev_state as (select ${состояние.month === null ? 'null::text' : `'${состояние.month}'::text`} as month,
                                ${состояние.has_orders} as has_orders, ${состояние.has_ads} as has_ads),
     ${DELTAS_FROM_ROWS}`,
  )
  return Object.fromEntries((rows as Показатель[]).map((п) => [п.key, п]))
}

/** Март и февраль, выдуманные: числа неудобны, и ни одно не выводится из соседей. */
const МАРТ: Итоги = { gross: '1000.00', net: '800.00', ads: '250.00', profit: '120.00', margin_pct: '12.3' }
const ФЕВРАЛЬ: Итоги = { gross: '640.00', net: '500.00', ads: '96.00', profit: '100.50', margin_pct: '10.1' }
const ЕСТЬ_БАЗА: Состояние = { month: '2026-02', has_orders: true, has_ads: true }

describe('полоса показателей: счёт дельт', () => {
  test('четыре показателя в названном порядке, значения — готовые колонки итогов', async () => {
    const п = await показатели(МАРТ, ФЕВРАЛЬ, ЕСТЬ_БАЗА)
    expect(Object.keys(п)).toEqual(['profit', 'margin', 'net', 'ad_share'])
    expect([п.profit.value, п.margin.value, п.net.value]).toEqual(['120.00', '12.3', '800.00'])
  })

  test('дельты прибыли и выручки — в евро, разность показанных значений, со знаком', async () => {
    const п = await показатели(МАРТ, ФЕВРАЛЬ, ЕСТЬ_БАЗА)
    expect([п.profit.delta, п.profit.unit]).toEqual(['+19.50', 'eur'])
    expect([п.net.delta, п.net.unit]).toEqual(['+300.00', 'eur'])
  })

  test('дельта маржи — в процентных пунктах', async () => {
    // 12,3 − 10,1 = 2,2 пункта. В процентах от прошлой вышло бы 21,8.
    const п = await показатели(МАРТ, ФЕВРАЛЬ, ЕСТЬ_БАЗА)
    expect([п.margin.delta, п.margin.unit]).toEqual(['+2.2', 'pp'])
  })

  test('доля рекламы — реклама ÷ оборот, дельта — в пунктах', async () => {
    // Март: 250 ÷ 1000 = 25,0 %. Февраль: 96 ÷ 640 = 15,0 %. Разность — 10,0 пункта.
    const п = await показатели(МАРТ, ФЕВРАЛЬ, ЕСТЬ_БАЗА)
    expect([п.ad_share.value, п.ad_share.delta, п.ad_share.unit]).toEqual(['25.0', '+10.0', 'pp'])
  })

  test('доля рекламы полосы — та же, что у ступени рекламы в водопаде', async () => {
    const п = await показатели(МАРТ, ФЕВРАЛЬ, ЕСТЬ_БАЗА)
    const итоги = `select '1000.00'::text as gross, '30.00'::text as discounts, '170.00'::text as refunds,
                          '800.00'::text as net, '310.00'::text as cogs, '250.00'::text as ads,
                          '20.00'::text as fees, '100.00'::text as fixed, '120.00'::text as profit`
    const { rows } = await pool.query(`with totals_row as (${итоги}),\n${WATERFALL_FROM_TOTALS}`)
    expect(rows.find((с) => с.key === 'ads')?.share_pct).toBe(п.ad_share.value)
  })

  test('у доли рекламы рост — это плохо, у прибыли — хорошо', async () => {
    const п = await показатели(МАРТ, ФЕВРАЛЬ, ЕСТЬ_БАЗА)
    expect([п.ad_share.good_when_up, п.ad_share.verdict]).toEqual([false, 'хуже'])
    expect([п.profit.good_when_up, п.profit.verdict]).toEqual([true, 'лучше'])
    const вниз = await показатели(ФЕВРАЛЬ, МАРТ, { ...ЕСТЬ_БАЗА, month: '2026-01' })
    expect([вниз.ad_share.delta, вниз.ad_share.verdict]).toEqual(['-10.0', 'лучше'])
    expect([вниз.profit.delta, вниз.profit.verdict]).toEqual(['-19.50', 'хуже'])
  })

  test('без изменений — ноль без знака и слово «без изменений»', async () => {
    const п = await показатели(МАРТ, { ...МАРТ }, ЕСТЬ_БАЗА)
    expect([п.profit.delta, п.profit.verdict]).toEqual(['0.00', 'без изменений'])
  })

  test('нет предыдущего месяца с заказами — дельты пустые, а не нулевые, у всех четырёх разом', async () => {
    const п = await показатели(МАРТ, { gross: '0.00', net: '0.00', ads: '0.00', profit: '0.00', margin_pct: null }, {
      month: '2026-02',
      has_orders: false,
      has_ads: false,
    })
    expect(Object.values(п).map((к) => [к.delta, к.verdict, к.has_base])).toEqual([
      [null, null, false],
      [null, null, false],
      [null, null, false],
      [null, null, false],
    ])
    // Значения при этом стоят: пустой бывает дельта, а не показатель.
    expect(Object.values(п).map((к) => к.value)).toEqual(['120.00', '12.3', '800.00', '25.0'])
    expect(п.profit.prev_month).toBe('2026-02')
  })

  test('в прошлом месяце нет рекламы — дельта доли рекламы пустая, остальные считаются', async () => {
    const п = await показатели(МАРТ, { ...ФЕВРАЛЬ, ads: '0.00' }, { ...ЕСТЬ_БАЗА, has_ads: false })
    expect([п.ad_share.delta, п.ad_share.verdict]).toEqual([null, null])
    expect(п.profit.delta).toBe('+19.50')
  })

  test('оборот ноль — доля рекламы пустая', async () => {
    const п = await показатели({ ...МАРТ, gross: '0.00' }, ФЕВРАЛЬ, ЕСТЬ_БАЗА)
    expect([п.ad_share.value, п.ad_share.delta]).toEqual([null, null])
  })

  test('маржа прошлого месяца пустая — дельта маржи пустая, а не ноль', async () => {
    const п = await показатели(МАРТ, { ...ФЕВРАЛЬ, margin_pct: null }, ЕСТЬ_БАЗА)
    expect([п.margin.delta, п.margin.verdict]).toEqual([null, null])
  })
})

/**
 * Боевая сборка — на фактах в транзакции, которая откатывается. Прежние факты на время проверки
 * снимаются в той же транзакции: сравнение идёт только по положенным здесь заказам.
 */
type Заказ = { номер: number; день: string; сумма: string }

async function положить(client: PoolClient, заказы: Заказ[]): Promise<void> {
  await client.query('delete from fact.orders')
  await client.query('delete from fact.refunds')
  await client.query('delete from fact.ads')
  await client.query('delete from fact.opex')
  for (const з of заказы) {
    await client.query(
      `insert into raw.orders (row_no, date, order_id, sku, units, gross_eur, discount_eur, gateway)
       values ($1, $2, $3, 'NP-T', '1', $4, '0', 'card')`,
      [з.номер, з.день, `T-${з.номер}`, з.сумма],
    )
    await client.query(
      `insert into fact.orders (row_no, date, order_id, sku, units, gross, discount, currency, gateway)
       values ($1, $2::date, $3, 'NP-T', 1, $4::numeric, 0, 'EUR', 'card')`,
      [з.номер, з.день, `T-${з.номер}`, з.сумма],
    )
  }
}

async function вТранзакции<T>(заказы: Заказ[], работа: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await положить(client, заказы)
    return await работа(client)
  } finally {
    await client.query('rollback')
    client.release()
  }
}

const МАРТОВСКИЙ: Заказ = { номер: 9701, день: '2026-03-10', сумма: '300.00' }
const ФЕВРАЛЬСКИЙ: Заказ = { номер: 9702, день: '2026-02-12', сумма: '120.00' }
const ЯНВАРСКИЙ: Заказ = { номер: 9703, день: '2026-01-20', сумма: '75.00' }

async function дельтыМарта(client: PoolClient): Promise<Показатель[]> {
  const { rows } = await client.query(MONTH_DELTAS, ['2026-03-01'])
  return rows as Показатель[]
}

describe('полоса показателей: боевая сборка', () => {
  test('итоги прошлого месяца — тот же запрос итогов, сдвинутый на месяц', async () => {
    await вТранзакции([МАРТОВСКИЙ, ФЕВРАЛЬСКИЙ], async (client) => {
      const сдвинутые = await client.query(PREVIOUS_MONTH_TOTALS, ['2026-03-01'])
      const прямые = await client.query(MONTH_TOTALS, ['2026-02-01'])
      expect(сдвинутые.rows).toEqual(прямые.rows)
      expect(прямые.rows[0].gross, 'февраль не пуст — сравнение не нулей с нулями').toBe('120.00')
    })
  })

  test('база сравнения — предыдущий календарный месяц, даже когда он пуст', async () => {
    // Заказы есть в январе и марте, в феврале нет. Сравнивать март с январём нельзя.
    await вТранзакции([МАРТОВСКИЙ, ЯНВАРСКИЙ], async (client) => {
      const п = await дельтыМарта(client)
      expect(п.map((к) => [к.delta, к.has_base, к.prev_month])).toEqual([
        [null, false, '2026-02'],
        [null, false, '2026-02'],
        [null, false, '2026-02'],
        [null, false, '2026-02'],
      ])
    })
  })

  test('прошлый месяц с заказами — дельты считаются от его итогов', async () => {
    await вТранзакции([МАРТОВСКИЙ, ФЕВРАЛЬСКИЙ], async (client) => {
      const п = await дельтыМарта(client)
      // Чистая выручка: 300,00 против 120,00. Себестоимости и затрат нет — прочие поля не нужны.
      expect(п.find((к) => к.key === 'net')?.delta).toBe('+180.00')
      expect(п.every((к) => к.has_base)).toBe(true)
    })
  })
})

/**
 * Переход между путями — **настоящим отчётом**, `monthlyReport()` без единой подставки, одним и тем
 * же вызовом до и после того, как у марта появился прошлый месяц с заказами, и после того, как он
 * исчез. Февральский заказ записывается в местную базу и убирается в `finally`; прочие факты не
 * трогаются. Ни флага, ни переменной среды проверка не ставит — переход обязан случиться от данных.
 *
 * Подставить отчёту соединение с уже открытой транзакцией нельзя: снимок отчёта начинается с
 * `begin isolation level repeatable read`, и Postgres отказывает ему внутри начатой транзакции
 * (код 25001). Поэтому запись, а не транзакция с откатом.
 */
const ФЕВРАЛЬ_В_БАЗЕ = { номер: 9702, день: '2026-02-12', заказ: 'T-9702' }

async function полоса() {
  const прежняя = process.env.NORDIC_PET_DB_TARGET
  process.env.NORDIC_PET_DB_TARGET = 'local'
  try {
    return (await monthlyReport('2026-03')).kpis
  } finally {
    if (прежняя === undefined) delete process.env.NORDIC_PET_DB_TARGET
    else process.env.NORDIC_PET_DB_TARGET = прежняя
  }
}

async function убратьФевраль(): Promise<void> {
  await pool.query('delete from fact.orders where row_no = $1', [ФЕВРАЛЬ_В_БАЗЕ.номер])
  await pool.query('delete from raw.orders where row_no = $1', [ФЕВРАЛЬ_В_БАЗЕ.номер])
}

describe('полоса показателей в отчёте', () => {
  test('появился предыдущий месяц — дельты считаются; исчез — снова слова', async () => {
    const { rows: февраль } = await pool.query(
      "select count(*)::int as n from fact.orders where date >= '2026-02-01' and date < '2026-03-01'",
    )
    expect(февраль[0].n, 'до проверки у февраля в местной базе нет заказов').toBe(0)
    try {
      const до = await полоса()
      expect([до?.hasBase, до?.items.map((к) => к.delta)]).toEqual([false, [null, null, null, null]])

      await pool.query(
        `insert into raw.orders (row_no, date, order_id, sku, units, gross_eur, discount_eur, gateway)
         values ($1, $2, $3, 'NP-T', '1', '120.00', '0', 'card')`,
        [ФЕВРАЛЬ_В_БАЗЕ.номер, ФЕВРАЛЬ_В_БАЗЕ.день, ФЕВРАЛЬ_В_БАЗЕ.заказ],
      )
      await pool.query(
        `insert into fact.orders (row_no, date, order_id, sku, units, gross, discount, currency, gateway)
         values ($1, $2::date, $3, 'NP-T', 1, 120.00, 0, 'EUR', 'card')`,
        [ФЕВРАЛЬ_В_БАЗЕ.номер, ФЕВРАЛЬ_В_БАЗЕ.день, ФЕВРАЛЬ_В_БАЗЕ.заказ],
      )
      const после = await полоса()
      expect(после?.hasBase).toBe(true)
      // Прибыль и выручка считаются при любых фактах марта в местной базе; маржа и доля рекламы
      // зависят от того, что там лежит (у пустого марта маржа пуста), и здесь не утверждаются.
      expect(после?.items.filter((к) => к.unit === 'eur').map((к) => [к.key, к.delta === null])).toEqual([
        ['profit', false],
        ['net', false],
      ])

      await убратьФевраль()
      const снова = await полоса()
      expect([снова?.hasBase, снова?.items.map((к) => к.delta)]).toEqual([false, [null, null, null, null]])
    } finally {
      await убратьФевраль()
    }
  })

  test('отчёт несёт полосу показателей: значения — те же, что в итогах и в водопаде', async () => {
    // Настоящим путём, без подставки соединения: какие бы факты ни лежали в местной базе.
    const прежняя = process.env.NORDIC_PET_DB_TARGET
    process.env.NORDIC_PET_DB_TARGET = 'local'
    try {
      const отчёт = await monthlyReport('2026-03')
      const значения = Object.fromEntries((отчёт.kpis?.items ?? []).map((к) => [к.key, к.value]))
      expect(значения).toEqual({
        profit: отчёт.bottom.profit,
        margin: отчёт.bottom.marginPct,
        net: отчёт.revenue.net,
        ad_share: отчёт.waterfall?.steps.find((с) => с.key === 'ads')?.sharePct,
      })
      expect(отчёт.kpis?.prevMonth).toBe('2026-02')
    } finally {
      if (прежняя === undefined) delete process.env.NORDIC_PET_DB_TARGET
      else process.env.NORDIC_PET_DB_TARGET = прежняя
    }
  })
})
