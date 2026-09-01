import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, expect, test } from 'vitest'

import { ingestSheets } from '@/lib/ingest/load-sheets'
import { SHEETS } from '@/lib/ingest/sheet-rows'

import { pool, rows } from '../db/support'

/**
 * Живая проверка возвращает базу такой, какой её нашла.
 *
 * Она пишет в локальную базу по-настоящему, а обычный набор проверок опирается на
 * демонстрационные строки посева: без возврата `npm test` после неё краснел бы десятком
 * проверок, не имеющих к изменению никакого отношения. Возврат идёт тем же файлом посева,
 * которым пересоздаётся база, и теми же функциями записи снимка — своих вставок здесь нет.
 *
 * Команда `npm run ingest:sheets` ничего не возвращает: оставить в базе настоящие данные —
 * её работа, а не побочное действие.
 */
afterAll(async () => {
  await pool.query(readFileSync(join(process.cwd(), 'supabase', 'seed.sql'), 'utf8'))
  await pool.end()
})

/** Содержимое таблицы целиком, включая updated_at, — сравнимой строкой. */
async function contents(table: string): Promise<string> {
  return JSON.stringify(await rows(`select to_jsonb(t) as row from ${table} t order by to_jsonb(t)::text`))
}

/**
 * Настоящий путь: `ingestSheets()` без единого аргумента, на настоящем окружении.
 *
 * Без этой проверки испытанным оказался бы только путь с подставленными зависимостями,
 * а в бою работает именно этот: живой ключ служебного аккаунта, живая Таблица, живая база.
 *
 * Ключей нет — проверка краснеет. Пропуска нет ни при каком условии: проверка, которая
 * при отсутствии среды молча исчезает, создаёт видимость проверенного там, где не
 * проверено ничего.
 */
test('загрузка настоящей Таблицы в настоящую базу, дважды подряд', async () => {
  const first = await ingestSheets()

  expect(first.sheets.map((s) => s.sheet)).toEqual(SHEETS.map((s) => s.sheet))
  for (const sheet of first.sheets) {
    expect(sheet.rowsWritten, `лист ${sheet.sheet} пуст`).toBeGreaterThan(0)
  }
  for (const count of first.counts) {
    expect(count.rows, `таблица ${count.table} пуста`).toBeGreaterThan(0)
  }

  const after = new Map<string, string>()
  for (const sheet of SHEETS) after.set(sheet.table, await contents(sheet.table))

  const second = await ingestSheets()

  // Повторная загрузка не меняет ни строки, ни байта: сравнивается содержимое целиком,
  // вместе с updated_at, а не количество строк.
  for (const sheet of SHEETS) {
    expect(await contents(sheet.table), `таблица ${sheet.table} изменилась`).toBe(
      after.get(sheet.table),
    )
  }
  expect(second.counts).toEqual(first.counts)

  // Числа видно в выводе: их сверяют с независимым подсчётом по Таблице.
  console.log(
    ['', 'таблица            строк   последнее изменение', ...first.counts.map(
      (c) => `${c.table.padEnd(18)} ${String(c.rows).padStart(5)}   ${c.lastChange ?? '—'}`,
    )].join('\n'),
  )
})
