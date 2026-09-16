import { Pool } from 'pg'
import { afterAll, expect, test } from 'vitest'

import { projectDatabaseUrl } from '@/lib/db-url'
import { monthlyReport } from '@/lib/metrics/report'
import { FINDINGS_FROM_TOTALS } from '@/lib/metrics/sql'

/**
 * Признаки выводов — кусок S13. Строка итогов подставляется выдуманной, как у каскада: признак,
 * посчитанный не по своей колонке, даст ответ, которого раскладка не предполагает. Последняя проверка
 * идёт настоящим путём.
 */

const pool = new Pool({ connectionString: projectDatabaseUrl() })
afterAll(() => pool.end())

type Итоги = {
  gross: string; net: string; cogs: string; ads: string; fees: string; fixed: string
  profit: string; roas_by_gross: string | null; honest_pct: string | null
}
type Признаки = {
  ads_verdict: string | null; margin_income: string; fixed_share_pct: string | null
  loss: boolean; approximate: boolean
}

async function признаки(итоги: Итоги, естьРеклама = true): Promise<Признаки> {
  const колонки = Object.entries(итоги)
    .map(([имя, з]) => (з === null ? `null::text as ${имя}` : `'${з}'::text as ${имя}`))
    .join(', ')
  const { rows } = await pool.query(
    `with totals_row as (select ${колонки}),\n     cur_state as (select ${естьРеклама} as has_ads),\n${FINDINGS_FROM_TOTALS}`,
  )
  return rows[0] as Признаки
}

/** Вклад (900 − 400 − 100) ÷ 1000 = 40,0 %, порог 2,50; маржинальный доход 900 − 400 − 200 − 100 = 200. */
const БАЗА: Итоги = {
  gross: '1000.00', net: '900.00', cogs: '400.00', ads: '200.00', fees: '100.00',
  fixed: '150.00', profit: '50.00', roas_by_gross: '5.00', honest_pct: '100.0',
}

test('реклама: окупаемость, равная порогу, — «окупается»', async () => {
  expect((await признаки({ ...БАЗА, roas_by_gross: '2.50' })).ads_verdict).toBe('окупается')
})

test('реклама: окупаемость ниже порога — «не окупается»', async () => {
  expect((await признаки({ ...БАЗА, roas_by_gross: '2.49' })).ads_verdict).toBe('не окупается')
})

test('реклама: вклад не положителен — «порога нет»', async () => {
  expect((await признаки({ ...БАЗА, cogs: '850.00' })).ads_verdict).toBe('порога нет')
})

test('реклама: строк рекламы нет, окупаемость пуста или оборота нет — признака нет', async () => {
  expect((await признаки(БАЗА, false)).ads_verdict).toBeNull()
  expect((await признаки({ ...БАЗА, roas_by_gross: null })).ads_verdict).toBeNull()
  expect((await признаки({ ...БАЗА, gross: '0.00' })).ads_verdict).toBeNull()
})

test('маржинальный доход — из показанных сумм итогов', async () => {
  expect((await признаки(БАЗА)).margin_income).toBe('200.00')
})

test('убыток: ниже 100 % — нет, ровно 100 % показанных — да', async () => {
  const ниже = await признаки({ ...БАЗА, fixed: '199.00' })
  expect([ниже.fixed_share_pct, ниже.loss]).toEqual(['99.5', false])
  const ровно = await признаки({ ...БАЗА, fixed: '199.90' })
  expect([ровно.fixed_share_pct, ровно.loss]).toEqual(['100.0', true])
})

test('убыток: маржинальный доход не положителен — доли нет, признак стоит', async () => {
  const ноль = await признаки({ ...БАЗА, ads: '400.00' })
  expect([ноль.fixed_share_pct, ноль.loss]).toEqual([null, true])
})

test('приблизительная: ниже 100 % — да, ровно 100 % и без доли — нет', async () => {
  expect((await признаки({ ...БАЗА, honest_pct: '99.9' })).approximate).toBe(true)
  expect((await признаки({ ...БАЗА, honest_pct: '100.0' })).approximate).toBe(false)
  expect((await признаки({ ...БАЗА, honest_pct: null })).approximate).toBe(false)
})

test('признаки доезжают до отчёта настоящим путём', async () => {
  const прежняя = process.env.NORDIC_PET_DB_TARGET
  process.env.NORDIC_PET_DB_TARGET = 'local'
  try {
    const отчёт = await monthlyReport()
    expect(отчёт.findings).toBeDefined()
    expect(typeof отчёт.findings?.loss).toBe('boolean')
  } finally {
    if (прежняя === undefined) delete process.env.NORDIC_PET_DB_TARGET
    else process.env.NORDIC_PET_DB_TARGET = прежняя
  }
})
