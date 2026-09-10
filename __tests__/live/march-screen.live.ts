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

  // Решение Ж2: цепочка показанных сумм до прибыли даёт 1 738,54 при прибыли 1 738,53 — наш счёт по
  // сверенным числам. Цепочка до чистой выручки сходится точно: 18 764,00 − 427,50 − 1 059,46.
  expect(отчёт.waterfall?.profitGap, 'расхождение с прибылью — цент').toBe('0.01')
  expect(отчёт.waterfall?.netGap, 'с чистой выручкой расхождения нет').toBeNull()

  // Ряд по дням (шаг 2): все дни марта, и сумма ряда — чистая выручка месяца по счёту владельца,
  // точно до цента: суммы строк хранятся с двумя знаками, округлению тут взяться неоткуда.
  const дни = отчёт.daily?.days ?? []
  expect(дни, 'в ряду все дни марта').toHaveLength(31)
  const сумма = дни.reduce((в, д) => в + (д.net === null ? 0 : центы(д.net)), 0)
  expect(сумма, 'сумма ряда — 17 277,04 €').toBe(центы('17277.04'))

  // Дни без заказов — наблюдение для списка путей, а не утверждение: числа снаружи для них нет.
  const безЗаказов = дни.filter((д) => д.net === null).map((д) => д.label)
  console.log(`дни марта без заказов: ${безЗаказов.length}${безЗаказов.length > 0 ? ' — ' + безЗаказов.join(', ') : ''}`)
})

/** Деньги строкой → целые центы. Счёт в проверке, а не на экране. */
function центы(деньги: string): number {
  const [целые, дробь = ''] = деньги.replace('-', '').split('.')
  const знак = деньги.startsWith('-') ? -1 : 1
  return знак * (Number(целые) * 100 + Number(дробь.padEnd(2, '0')))
}
