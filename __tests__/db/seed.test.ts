import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, expect, test } from 'vitest'

import { pool, rows } from './support'

afterAll(() => pool.end())

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const SEED = join(process.cwd(), 'supabase', 'seed.sql')

/**
 * Точные количества, а не «больше нуля». Посев применяется дважды при каждом пересоздании
 * базы — это делает `npm run db:reset`, — и неидемпотентный посев либо ломает саму команду,
 * либо удваивает эти числа. Оба исхода видны здесь.
 */
test('посев положил в сырой слой ровно столько строк, сколько в нём заложено', async () => {
  const counts = await rows<{ name: string; n: number }>(
    `select 'orders' as name, count(*)::int as n from raw.orders
     union all select 'refunds', count(*)::int from raw.refunds
     union all select 'costs',   count(*)::int from raw.costs
     union all select 'fees',    count(*)::int from raw.fees
     union all select 'opex',    count(*)::int from raw.opex
     union all select 'fx',      count(*)::int from raw.fx
     union all select 'ads',     count(*)::int from raw.ads
     order by 1`,
  )
  expect(Object.fromEntries(counts.map((r) => [r.name, r.n]))).toEqual({
    ads: 6,
    costs: 3,
    fees: 2,
    fx: 3,
    opex: 3,
    orders: 4,
    refunds: 2,
  })
})

// Разбора в S1 нет, значит выводить факты некому. Вписанные руками факты были бы неотличимы
// от настоящих, а цепочка «источник → сырьё → факты» перепрыгнула бы шаг.
test('слой фактов после посева пуст — цепочка не перепрыгивается', async () => {
  const counts = await rows<{ name: string; n: number }>(
    `select 'orders' as name, count(*)::int as n from fact.orders
     union all select 'refunds', count(*)::int from fact.refunds
     union all select 'costs',   count(*)::int from fact.costs
     union all select 'fees',    count(*)::int from fact.fees
     union all select 'opex',    count(*)::int from fact.opex
     union all select 'fx',      count(*)::int from fact.fx
     union all select 'ads',     count(*)::int from fact.ads
     order by 1`,
  )
  expect(counts.filter((r) => r.n !== 0)).toEqual([])
})

test('кривизна источника доехала до сырого слоя нетронутой', async () => {
  const skus = await rows<{ sku: string }>('select sku from raw.orders order by row_no')
  // хвостовой пробел и неразрывный дефис U+2011 — ровно так, как их написал человек
  expect(skus.map((r) => r.sku)).toContain('np-003 ')
  expect(skus.map((r) => r.sku)).toContain('NP‑003')

  const dates = await rows<{ date: string }>('select date from raw.orders order by row_no')
  expect(dates.map((r) => r.date)).toContain('01.03.2026')
  expect(dates.map((r) => r.date)).toContain('2026-03-01')

  const rent = await rows<{ amount_eur: string }>(
    `select amount_eur from raw.opex where category = 'аренда'`,
  )
  // сумма по-европейски и с неразрывным пробелом U+00A0
  expect(rent[0].amount_eur).toBe('1 234,50')
})

test('обе выгрузки meta на месте: различаются именем, а не содержимым', async () => {
  const files = await rows<{ file_name: string; n: number }>(
    `select file_name, count(*)::int as n from raw.ads
      where file_name like 'meta%' group by file_name order by file_name`,
  )
  expect(files).toEqual([
    { file_name: 'meta_2026-03 (1).csv', n: 2 },
    { file_name: 'meta_2026-03.csv', n: 2 },
  ])

  // Сверка с ожидаемым содержимым, а не одной выгрузки с другой: обе положены одним
  // вызовом, и сравнение их между собой прошло бы и при общем искажении.
  const expected = [
    { row_no: 1, date: '2026-03-01', campaign: 'spring', spend_usd: '12.40' },
    { row_no: 2, date: '2026-03-02', campaign: 'spring', spend_usd: '9.80' },
  ]
  for (const file of ['meta_2026-03.csv', 'meta_2026-03 (1).csv']) {
    const stored = await rows(
      `select row_no, date, campaign, spend_usd from raw.ads
        where file_name = $1 order by row_no`,
      [file],
    )
    expect(stored).toEqual(expected)
  }
})

test('посев пишет сырьё функциями записи снимка, а не своими вставками', () => {
  const seed = readFileSync(SEED, 'utf8')
  expect(seed).toMatch(/raw\.replace_/)
  // прямая вставка в сырую таблицу завела бы второй механизм идемпотентности,
  // и однажды два механизма разошлись бы молча
  expect(seed).not.toMatch(/insert\s+into\s+raw\./i)
})

test('демонстрационных строк нет там, куда уезжают миграции', () => {
  const guilty = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .filter((name) => {
      const text = readFileSync(join(MIGRATIONS, name), 'utf8')
      // тела функций записи снимка тоже содержат insert into, но вставляют не литералы,
      // а разобранный снимок: insert … select. Вставка данных — это insert … values.
      return /insert\s+into\s+[^;]*\bvalues\s*\(/i.test(text) || /\bschema\s+dev\b/i.test(text)
    })
  expect(guilty).toEqual([])
})
