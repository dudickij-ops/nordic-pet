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
 * Возврат идёт тем же файлом посева, которым пересоздаётся база, — своих вставок здесь
 * нет.
 */
afterAll(async () => {
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
