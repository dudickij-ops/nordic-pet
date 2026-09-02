import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, expect, test } from 'vitest'

import { refreshEverything } from '@/lib/metrics/refresh'
import { monthlyReport } from '@/lib/metrics/report'
import { resolveIngestTarget } from '@/lib/ingest/target'

import { pool } from '../db/support'

/**
 * Живая проверка кнопки «Обновить данные» — задача 8.
 *
 * Единственное, чего не доказать подставками: боевой путь целиком, дважды подряд,
 * вправду ходит в Google и вправду пишет в местную базу — и второе нажатие ничего не
 * меняет. Идемпотентность каждого отдельного шага уже доказана его собственной живой
 * проверкой (S2, S3, S4); здесь проверяется, что три шага подряд, зовомые кнопкой,
 * этого свойства не теряют.
 *
 * Возврат — не только посев: он наполняет сырой слой, а слой фактов не трогает вовсе.
 * После настоящего разбора в фактах остались бы настоящие данные Google, и посев в
 * одиночку вернул бы базу не такой, какой её нашла проверка. Тот же приём, что у боевых
 * проверок S5 (`__tests__/metrics/report.test.ts`, `__tests__/facts/build.test.ts`): один
 * `truncate` семи таблиц фактов, а не семь отдельных `delete`, — отказ третьего из семи
 * оставлял бы базу наполовину прибранной и заслонял бы исходную ошибку своей собственной.
 * Посев следом возвращает сырой слой.
 */
afterAll(async () => {
  await pool.query(
    'truncate fact.orders, fact.refunds, fact.costs, fact.fees, fact.opex, fact.fx, fact.ads',
  )
  await pool.query(readFileSync(join(process.cwd(), 'supabase', 'seed.sql'), 'utf8'))
  await pool.end()
})

test('второе нажатие подряд ничего не меняет', async () => {
  expect(
    resolveIngestTarget().where,
    'живая проверка идёт только на локальной базе: NORDIC_PET_DB_TARGET=local',
  ).toBe('local')

  const первый = await refreshEverything()
  expect(первый).toEqual({ ok: true })

  const отчётПосле1 = await monthlyReport()

  const второй = await refreshEverything()
  expect(второй).toEqual({ ok: true })

  expect(await monthlyReport()).toEqual(отчётПосле1)
})
