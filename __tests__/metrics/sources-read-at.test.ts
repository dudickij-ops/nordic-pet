import { Pool, type PoolClient } from 'pg'
import { afterAll, describe, expect, test } from 'vitest'

import { projectDatabaseUrl } from '@/lib/db-url'
import { monthlyReport } from '@/lib/metrics/report'
import { SOURCES_READ_AT } from '@/lib/metrics/sql'

/**
 * Время чтения источников — кусок S11, шаг 6 (задача 5).
 *
 * Запрос отдаёт готовую строку: форматирование даты — тоже счёт, и разметке его не отдают. Каждая
 * проверка идёт в своей транзакции и откатывает её: отметка — одна строка на всю базу, и чужой
 * прогон не должен её увидеть.
 *
 * Пояс сеанса в проверке нарочно не UTC: Токио на девять часов впереди и без перехода на летнее
 * время. Запрос, напечатавший время в поясе сеанса, дал бы здесь другую дату, а не только час.
 */

const pool = new Pool({ connectionString: projectDatabaseUrl() })
afterAll(() => pool.end())

async function сОтметкой(отметка: string | null): Promise<Array<{ read_at: string | null }>> {
  const client: PoolClient = await pool.connect()
  try {
    await client.query('begin')
    await client.query("set local time zone 'Asia/Tokyo'")
    await client.query('delete from meta.fact_freshness')
    if (отметка !== null) {
      await client.query('insert into meta.fact_freshness (raw_seen_at) values ($1::timestamptz)', [отметка])
    }
    const { rows } = await client.query(SOURCES_READ_AT)
    return rows as Array<{ read_at: string | null }>
  } finally {
    await client.query('rollback')
    client.release()
  }
}

describe('время чтения источников', () => {
  test('время чтения печатается по UTC и называет пояс', async () => {
    // В Токио это уже 1 апреля, 07:30. Секунды отброшены, а не округлены: 22:30:45 — это 22:30.
    const строки = await сОтметкой('2026-03-31 22:30:45+00')
    expect(строки).toEqual([{ read_at: '2026-03-31 22:30 UTC' }])
  })

  test('отметки нет — пусто, а строка ответа одна', async () => {
    expect(await сОтметкой(null)).toEqual([{ read_at: null }])
  })

  test('отметка-эпоха — это не чтение: пусто, а не 1970 год', async () => {
    // Эпоху пишет сама запись отметки, когда сырьё пустое: `coalesce(max(updated_at), to_timestamp(0))`.
    expect(await сОтметкой('1970-01-01 00:00:00+00')).toEqual([{ read_at: null }])
  })
})

/**
 * Настоящим путём — через `monthlyReport()` на местной базе, без подставки: запрос, проверенный
 * выше на своей транзакции, не доказывает, что отчёт его читает. Отметка ставится здесь нарочно, а
 * не берётся какой лежит: в местной базе после посева её нет, и сличение пустоты с пустотой не
 * покраснело бы ни при каком дефекте. Прежняя отметка возвращается как была.
 */
describe('время чтения в отчёте — настоящим путём', () => {
  test('отчёт несёт время чтения источников, прочитанное тем же снимком', async () => {
    const { rows: прежние } = await pool.query<{ raw_seen_at: Date }>('select raw_seen_at from meta.fact_freshness')
    const прежняяЦель = process.env.NORDIC_PET_DB_TARGET
    process.env.NORDIC_PET_DB_TARGET = 'local'
    try {
      await pool.query(
        `insert into meta.fact_freshness (raw_seen_at) values ('2026-03-31 22:30:45+00')
         on conflict (only_row) do update set raw_seen_at = excluded.raw_seen_at`,
      )
      const отчёт = await monthlyReport('2026-03')
      expect(отчёт.sourcesReadAt).toBe('2026-03-31 22:30 UTC')
    } finally {
      if (прежняяЦель === undefined) delete process.env.NORDIC_PET_DB_TARGET
      else process.env.NORDIC_PET_DB_TARGET = прежняяЦель
      await pool.query('delete from meta.fact_freshness')
      if (прежние.length > 0) {
        await pool.query('insert into meta.fact_freshness (raw_seen_at) values ($1)', [прежние[0].raw_seen_at])
      }
    }
  })
})
