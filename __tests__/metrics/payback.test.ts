import { Pool } from 'pg'
import { afterAll, describe, expect, test } from 'vitest'

import { projectDatabaseUrl } from '@/lib/db-url'
import { monthlyReport } from '@/lib/metrics/report'
import { PAYBACK_FROM_TOTALS } from '@/lib/metrics/sql'

/**
 * Окупаемость рекламы — кусок S11, шаг 3.
 *
 * Запрос не считает денег сам: он берёт строку итогов месяца. Проверки подставляют выдуманную
 * строку итогов, где числа нарочно не сходятся, — определение, взявшее не то слагаемое, напечатает
 * число, которого по нашему определению быть не должно. Все определения — наши: вклад —
 * (чистая выручка − себестоимость − комиссии) ÷ оборот × 100, порог — 100 ÷ вклад.
 *
 * Якорь снаружи — мартовские числа, сверенные владельцем: по ним наш счёт даёт 0,39 ×, 57,1 % и
 * 1,75 ×; утверждение на марте — в живой проверке задачи 14.
 */

const pool = new Pool({ connectionString: projectDatabaseUrl() })
afterAll(() => pool.end())

type Итоги = {
  gross: string
  net: string
  cogs: string
  ads: string
  fees: string
  fixed: string
  profit: string
  margin_pct: string | null
}

type Окупаемость = {
  roas_by_profit: string | null
  contribution_pct: string | null
  breakeven_roas: string | null
  breakeven_note: string | null
}

async function окупаемость(итоги: Итоги): Promise<Окупаемость> {
  const колонки = Object.entries(итоги)
    .map(([имя, значение]) => (значение === null ? `null::text as ${имя}` : `'${значение}'::text as ${имя}`))
    .join(', ')
  const { rows } = await pool.query(`with totals_row as (select ${колонки}),\n${PAYBACK_FROM_TOTALS}`)
  return rows[0] as Окупаемость
}

/**
 * Числа, которые не выводятся друг из друга. Вклад по нашему определению:
 * (800 − 300 − 20) ÷ 1000 × 100 = 48,0 %; порог — 100 ÷ 48 = 2,08 ×. Маржа итога — 5,0 %, и порог от
 * неё был бы 20,00 ×. Прибыль — 30, реклама — 120: по прибыли 0,25 ×.
 */
const ИТОГИ: Итоги = {
  gross: '1000.00',
  net: '800.00',
  cogs: '300.00',
  ads: '120.00',
  fees: '20.00',
  fixed: '330.00',
  profit: '30.00',
  margin_pct: '5.0',
}

describe('окупаемость рекламы', () => {
  test('окупаемость по прибыли — прибыль ÷ реклама', async () => {
    expect((await окупаемость(ИТОГИ)).roas_by_profit).toBe('0.25')
  })

  test('вклад считается без постоянных расходов', async () => {
    // С постоянными было бы (800 − 300 − 20 − 330) ÷ 1000 = 15,0 %.
    expect((await окупаемость(ИТОГИ)).contribution_pct).toBe('48.0')
  })

  test('вклад считается без рекламы', async () => {
    // С рекламой было бы (800 − 300 − 20 − 120) ÷ 1000 = 36,0 %. Постоянные здесь ноль, чтобы
    // проверка не зависела от соседнего утверждения.
    expect((await окупаемость({ ...ИТОГИ, fixed: '0.00' })).contribution_pct).toBe('48.0')
  })

  test('порог считается от вклада, а не от маржи итога', async () => {
    // От вклада 100 ÷ 48 = 2,08; от маржи итога было бы 100 ÷ 5 = 20,00.
    expect((await окупаемость(ИТОГИ)).breakeven_roas).toBe('2.08')
  })

  test('вклад ноль — порога нет, и сказано словами', async () => {
    const ноль = await окупаемость({ ...ИТОГИ, net: '320.00' })
    expect(ноль.contribution_pct).toBe('0.0')
    expect(ноль.breakeven_roas).toBeNull()
    expect(ноль.breakeven_note).toBe('вклад не положителен')
  })

  test('вклад отрицателен — порога нет, а не отрицательный порог', async () => {
    const минус = await окупаемость({ ...ИТОГИ, cogs: '900.00' })
    expect(минус.contribution_pct).toBe('-12.0')
    expect(минус.breakeven_roas).toBeNull()
    expect(минус.breakeven_note).toBe('вклад не положителен')
  })

  test('оборот ноль или реклама ноль — пусто, а не ноль', async () => {
    const безОборота = await окупаемость({ ...ИТОГИ, gross: '0.00' })
    expect(безОборота.contribution_pct).toBeNull()
    expect(безОборота.breakeven_roas).toBeNull()
    expect(безОборота.breakeven_note).toBeNull()
    expect((await окупаемость({ ...ИТОГИ, ads: '0.00' })).roas_by_profit).toBeNull()
  })
})

describe('окупаемость в отчёте — настоящим путём', () => {
  test('отчёт несёт окупаемость, прочитанную тем же снимком', async () => {
    const прежняя = process.env.NORDIC_PET_DB_TARGET
    process.env.NORDIC_PET_DB_TARGET = 'local'
    try {
      const отчёт = await monthlyReport('2026-03')
      expect(отчёт.payback).toBeDefined()
      expect(Object.keys(отчёт.payback ?? {})).toEqual([
        'roasByProfit', 'contributionPct', 'breakevenRoas', 'breakevenNote',
      ])
    } finally {
      if (прежняя === undefined) delete process.env.NORDIC_PET_DB_TARGET
      else process.env.NORDIC_PET_DB_TARGET = прежняя
    }
  })
})
