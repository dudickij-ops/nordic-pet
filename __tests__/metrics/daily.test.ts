import { Pool } from 'pg'
import { afterAll, describe, expect, test } from 'vitest'

import { projectDatabaseUrl } from '@/lib/db-url'
import { monthlyReport } from '@/lib/metrics/report'
import { DAILY_FROM_MONEY } from '@/lib/metrics/sql'

/**
 * Чистая выручка по дням — кусок S11, шаг 2.
 *
 * Ряд не считает денег сам: он группирует готовую цепочку `money` по дню заказа. Поэтому проверки
 * подставляют **выдуманные строки `money`**, у которых выручка нарочно не равна «оборот − скидка −
 * возврат», — ряд, посчитавший выручку своим выражением, напечатает число, которого в строках нет.
 *
 * Последняя проверка идёт настоящим путём, через `monthlyReport()` на местной базе. Якорь снаружи —
 * живая проверка марта: сумма ряда — сверенные владельцем 17 277,04 €.
 */

const pool = new Pool({ connectionString: projectDatabaseUrl() })
afterAll(() => pool.end())

type Строка = { день: string; оборот: string; скидка: string; возврат: string; выручка: string }
type День = { day: string; label: string; net: string | null; share_pct: string | null }

/** Ряд по подставленным строкам `money` — тем же запросом, что в бою. */
async function ряд(месяц: string, строки: Строка[]): Promise<День[]> {
  const деньги =
    строки.length === 0
      ? 'select null::date as sold_on, null::numeric as gross, null::numeric as discount, ' +
        'null::numeric as refund_amount, null::numeric as net where false'
      : 'select * from (values ' +
        строки
          .map(
            (с) =>
              `('${с.день}'::date, ${с.оборот}::numeric, ${с.скидка}::numeric, ` +
              `${с.возврат}::numeric, ${с.выручка}::numeric)`,
          )
          .join(', ') +
        ') as v(sold_on, gross, discount, refund_amount, net)'
  const { rows } = await pool.query(
    `with bounds as (
       select $1::date as first_day, ($1::date + interval '1 month')::date as next_month
     ),
     money as (${деньги}),
     ${DAILY_FROM_MONEY}`,
    [`${месяц}-01`],
  )
  return rows as День[]
}

/** Деньги строкой → целые центы. Счёт в проверке, а не на экране. */
function центы(деньги: string): number {
  const [целые, дробь = ''] = деньги.replace('-', '').split('.')
  const знак = деньги.startsWith('-') ? -1 : 1
  return знак * (Number(целые) * 100 + Number(дробь.padEnd(2, '0')))
}

/** Строки, у которых выручка не выводится из оборота, скидки и возврата. */
const НЕСХОДЯЩИЕСЯ: Строка[] = [
  { день: '2026-03-02', оборот: '100.00', скидка: '10.00', возврат: '0.00', выручка: '71.11' },
  { день: '2026-03-02', оборот: '50.00', скидка: '0.00', возврат: '5.00', выручка: '22.22' },
  { день: '2026-03-05', оборот: '300.00', скидка: '0.00', возврат: '0.00', выручка: '133.33' },
]

describe('выручка по дням', () => {
  test('в ряду все дни месяца, по порядку', async () => {
    const март = await ряд('2026-03', НЕСХОДЯЩИЕСЯ)
    expect(март).toHaveLength(31)
    expect(март[0].day).toBe('2026-03-01')
    expect(март[30].day).toBe('2026-03-31')
    expect(await ряд('2026-02', [])).toHaveLength(28)
  })

  test('день без заказов — пусто, а не ноль', async () => {
    const март = await ряд('2026-03', НЕСХОДЯЩИЕСЯ)
    const первое = март.find((д) => д.day === '2026-03-01')
    expect(первое?.net).toBeNull()
    expect(первое?.share_pct).toBeNull()
  })

  test('сумма ряда по дням — чистая выручка месяца, из той же цепочки money', async () => {
    const март = await ряд('2026-03', НЕСХОДЯЩИЕСЯ)
    const сумма = март.reduce((в, д) => в + (д.net === null ? 0 : центы(д.net)), 0)
    // Чистая выручка месяца в итогах — `sum(net)` той же цепочки: 71,11 + 22,22 + 133,33.
    expect(сумма).toBe(центы('71.11') + центы('22.22') + центы('133.33'))
    expect(март.find((д) => д.day === '2026-03-02')?.net).toBe('93.33')
  })

  test('доля дня — от наибольшей по модулю выручки дня, процентами со знаком', async () => {
    const март = await ряд('2026-03', [
      { день: '2026-03-03', оборот: '0.00', скидка: '0.00', возврат: '0.00', выручка: '-200.00' },
      { день: '2026-03-04', оборот: '0.00', скидка: '0.00', возврат: '0.00', выручка: '100.00' },
    ])
    expect(март.find((д) => д.day === '2026-03-03')?.share_pct).toBe('-100.0')
    expect(март.find((д) => д.day === '2026-03-04')?.share_pct).toBe('50.0')
  })

  test('наибольшая выручка дня ноль — доли пусты, а выручка дня — честный ноль', async () => {
    const март = await ряд('2026-03', [
      { день: '2026-03-07', оборот: '40.00', скидка: '0.00', возврат: '40.00', выручка: '0.00' },
    ])
    const седьмое = март.find((д) => д.day === '2026-03-07')
    expect(седьмое?.net).toBe('0.00')
    expect(седьмое?.share_pct).toBeNull()
  })

  test('подпись дня приходит готовой строкой', async () => {
    const март = await ряд('2026-03', [])
    expect(март[0].label).toBe('1 марта')
    expect(март[30].label).toBe('31 марта')
  })
})

describe('выручка по дням в отчёте — настоящим путём', () => {
  test('отчёт несёт ряд из всех дней месяца, прочитанный тем же снимком', async () => {
    const прежняя = process.env.NORDIC_PET_DB_TARGET
    process.env.NORDIC_PET_DB_TARGET = 'local'
    try {
      const отчёт = await monthlyReport('2026-03')
      expect(отчёт.daily?.days).toHaveLength(31)
      expect(отчёт.daily?.days[0]).toMatchObject({ day: '2026-03-01', label: '1 марта' })
    } finally {
      if (прежняя === undefined) delete process.env.NORDIC_PET_DB_TARGET
      else process.env.NORDIC_PET_DB_TARGET = прежняя
    }
  })
})
