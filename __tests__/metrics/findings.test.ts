import { Pool } from 'pg'
import { afterAll, expect, test } from 'vitest'

import { projectDatabaseUrl } from '@/lib/db-url'
import { buildFacts } from '@/lib/facts/build'
import { monthlyReport } from '@/lib/metrics/report'
import { FINDINGS_FROM_TOTALS } from '@/lib/metrics/sql'
import { MONTH_FINDINGS } from '@/lib/metrics/sql'

/**
 * Признаки выводов — кусок S13. Строка итогов подставляется выдуманной, как у каскада: признак,
 * посчитанный не по своей колонке, даст ответ, которого раскладка не предполагает. Две последние проверки
 * идут настоящим путём (вторая дописана в задаче 17).
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

/**
 * Кусок S13, задача 17, правка по итоговой проверке (М3). Краевой случай строки приёмки «маржинальный доход
 * отрицательный»: проверка выше берёт ноль. Маржинальный доход 900 − 400 − 500 − 100 = −100.
 */
test('убыток: маржинальный доход отрицательный — доли нет, признак стоит', async () => {
  const минус = await признаки({ ...БАЗА, ads: '500.00' })
  expect([минус.margin_income, минус.fixed_share_pct, минус.loss]).toEqual(['-100.00', null, true])
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

/**
 * Кусок S13, задача 17, правка по итоговой проверке (М5). Проверка выше утверждает только, что поле есть:
 * признак, прочитанный из колонки с перепутанным именем, дал бы `undefined`, `null` или `false` и прошёл бы
 * зелёным. Здесь — посев местной базы, собранный в факты. Приём и уборка — те же, что у боевой проверки
 * `__tests__/metrics/report.test.ts` «на настоящей базе, без единого довода, по всей цепочке»: посев наполняет
 * только сырой слой, сборка фактов кладёт его в факты, после — слой фактов снова пуст.
 *
 * Сторожит проверка чтение колонок отчётом, а не счёт признаков: поля отчёта сличаются с колонками того же
 * запроса `MONTH_FINDINGS` на том же месяце, и счёт признаков, испорченный в SQL, меняет обе стороны разом.
 * Но сличение двух сторон зелено и тогда, когда обе пусты, поэтому у каждой колонки, кроме доли, есть якорь
 * снаружи: на посеве слово рекламы и сумма есть, а убыток и приблизительная прибыль — «да», то есть не то,
 * что дало бы перепутанное имя. **Чего проверка не ловит:** доля постоянных на посеве законно пуста —
 * маржинальный доход отрицателен (наш заход задачи 17: −32,33), — и перепутанное имя колонки доли здесь
 * неотличимо от честной пустоты.
 */
test('настоящий путь признаков на посеве: каждое поле читает свою колонку', async () => {
  const прежняя = process.env.NORDIC_PET_DB_TARGET
  process.env.NORDIC_PET_DB_TARGET = 'local'
  try {
    await buildFacts()
    const отчёт = await monthlyReport()
    expect(отчёт.month).toBe('2026-03')
    const { rows } = await pool.query(MONTH_FINDINGS, ['2026-03-01'])
    const строка = rows[0] as Признаки
    expect(строка.ads_verdict, 'на посеве слово рекламы есть').not.toBeNull()
    expect(строка.margin_income, 'на посеве сумма есть').not.toBeNull()
    expect([строка.loss, строка.approximate], 'на посеве оба признака — «да»').toEqual([true, true])
    expect(отчёт.findings).toEqual({
      adsVerdict: строка.ads_verdict,
      marginIncome: строка.margin_income,
      fixedSharePct: строка.fixed_share_pct,
      loss: строка.loss,
      approximate: строка.approximate,
    })
  } finally {
    try {
      await pool.query('truncate fact.orders, fact.refunds, fact.costs, fact.fees, fact.opex, fact.fx, fact.ads')
    } finally {
      if (прежняя === undefined) delete process.env.NORDIC_PET_DB_TARGET
      else process.env.NORDIC_PET_DB_TARGET = прежняя
    }
  }
})
