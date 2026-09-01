import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, expect, test } from 'vitest'

import { ingestAdsFolder } from '@/lib/ingest/load-ads'
import { resolveIngestTarget } from '@/lib/ingest/target'

import { pool, rows } from '../db/support'

/**
 * Живая проверка возвращает базу такой, какой её нашла.
 *
 * Она пишет в локальную базу по-настоящему, а обычный набор проверок опирается на
 * демонстрационные строки посева. Возврат идёт тем же файлом посева, которым
 * пересоздаётся база, и теми же функциями записи снимка — своих вставок здесь нет.
 */
afterAll(async () => {
  await pool.query(readFileSync(join(process.cwd(), 'supabase', 'seed.sql'), 'utf8'))
  await pool.end()
})

/**
 * Эталон владельца: числа посчитаны по исходным файлам, независимо от Диска и от нашего
 * кода. Сверяться надо с ними, а не с тем, что насчитал сам загрузчик, — иначе проверка
 * сравнивает код сам с собой. Расхождение показывается владельцу, а не сглаживается.
 */
const EXPECTED = [
  { file: 'google_2026-03.csv', rows: 62, bytes: 1699 },
  { file: 'meta_2026-03 (1).csv', rows: 93, bytes: 2814 },
  { file: 'meta_2026-03.csv', rows: 93, bytes: 2908 },
  { file: 'pinterest_2026-03.csv', rows: 31, bytes: 986 },
]
const TOTAL = 279

/** Содержимое таблицы целиком, включая updated_at, — сравнимой строкой. */
async function contents(table: string): Promise<string> {
  return JSON.stringify(
    await rows(`select to_jsonb(t) as row from ${table} t order by to_jsonb(t)::text`),
  )
}

/**
 * Настоящий путь: `ingestAdsFolder()` без единого аргумента, на настоящем окружении.
 *
 * Ключей нет — проверка краснеет. Пропуска нет ни при каком условии: проверка, которая
 * при отсутствии среды молча исчезает, создаёт видимость проверенного там, где не
 * проверено ничего.
 */
test('загрузка настоящей папки в настоящую базу, дважды подряд', async () => {
  /**
   * При боевой цели проверка записала бы настоящие данные в бой, сравнила бы при этом
   * нетронутую локальную базу и отчиталась зелёным — то есть соврала бы дважды.
   * Поэтому цель проверяется первым действием, до всякой работы.
   */
  expect(
    resolveIngestTarget().where,
    'живая проверка идёт только на локальной базе: NORDIC_PET_DB_TARGET=local',
  ).toBe('local')

  const first = await ingestAdsFolder()

  // Сверка с эталоном владельца — по файлу, а не итогом: итог сошёлся бы и при том,
  // что одна выгрузка потеряла строки, а другая приобрела.
  expect(
    first.files.map((file) => ({ file: file.file, rows: file.rowsWritten, bytes: file.bytes })),
  ).toEqual(EXPECTED)

  expect(first.counts).toEqual([
    { table: 'raw.ads', rows: TOTAL, lastChange: expect.any(String) },
  ])

  // Обе выгрузки meta легли целиком: дедупликации в сыром слое нет.
  const perFile = await rows<{ file_name: string; n: number }>(
    'select file_name, count(*)::int as n from raw.ads group by file_name order by file_name',
  )
  expect(perFile).toEqual(EXPECTED.map((file) => ({ file_name: file.file, n: file.rows })))

  const after = await contents('raw.ads')

  const second = await ingestAdsFolder()

  // Повторная загрузка не меняет ни строки, ни байта: сравнивается содержимое целиком,
  // вместе с updated_at, а не количество строк.
  expect(await contents('raw.ads'), 'таблица raw.ads изменилась').toBe(after)
  expect(second.counts).toEqual(first.counts)

  console.log(
    [
      '',
      'файл                    байт  строк',
      ...first.files.map(
        (file) => `${file.file.padEnd(22)}${String(file.bytes).padStart(6)}${String(file.rowsWritten).padStart(7)}`,
      ),
      `всего в raw.ads: ${first.counts[0].rows}, последнее изменение ${first.counts[0].lastChange}`,
    ].join('\n'),
  )
})
