import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, expect, test } from 'vitest'

import { buildFacts } from '@/lib/facts/build'
import { ingestAdsFolder } from '@/lib/ingest/load-ads'
import { ingestSheets } from '@/lib/ingest/load-sheets'
import { resolveIngestTarget } from '@/lib/ingest/target'
import { monthlyReport } from '@/lib/metrics/report'

import { pool } from '../db/support'

/**
 * Экран марта на настоящих данных — кусок S11. Якорь снаружи у этих утверждений один: независимый
 * счёт владельца по сверенным мартовским числам. Сравнение нашего кода с самим собой здесь ничего
 * бы не доказало.
 *
 * Живая проверка грузит настоящие Таблицу и папку рекламы в **местную** базу и в конце возвращает
 * посев — тем же приёмом, что прочие живые проверки. Цель проверяется первым действием.
 */

afterAll(async () => {
  await pool.query(readFileSync(join(process.cwd(), 'supabase', 'seed.sql'), 'utf8'))
  await pool.end()
})

test('водопад марта на настоящих данных: итоги ступеней — числа счёта владельца', async () => {
  expect(
    resolveIngestTarget().where,
    'живая проверка идёт только на локальной базе: NORDIC_PET_DB_TARGET=local',
  ).toBe('local')

  await ingestSheets()
  await ingestAdsFolder()
  await buildFacts()

  const отчёт = await monthlyReport('2026-03')
  const ступени = Object.fromEntries((отчёт.waterfall?.steps ?? []).map((с) => [с.key, с.amount]))

  // Три итога водопада — числа, которые владелец посчитал сам, мимо нашего кода.
  expect(ступени.gross, 'оборот').toBe('18764.00')
  expect(ступени.net, 'чистая выручка').toBe('17277.04')
  expect(ступени.profit, 'прибыль — последняя ступень').toBe('1738.53')
  // И то же число, что в «Итоге»: ступень берёт колонку прибыли итога, а не пересчитывает её.
  expect(ступени.profit).toBe(отчёт.bottom.profit)
})
