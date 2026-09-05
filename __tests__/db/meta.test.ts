import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, expect, test } from 'vitest'

import { inRollback, pool, rows } from './support'

/**
 * Схема `meta` — служебные отметки самого приложения: счёт неудачных попыток входа и отметка
 * того сырья, по которому собраны факты.
 *
 * Проверки пишущих функций идут в транзакции с откатом: они кладут строки в настоящую таблицу,
 * и без отката следующая проверка поехала бы на строках предыдущей.
 */

afterAll(() => pool.end())

const ОКНО = '15 minutes'

test('схема meta существует, и в ней ровно три таблицы', async () => {
  const found = await rows<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'meta' order by tablename`,
  )
  expect(found.map((r) => r.tablename)).toEqual([
    'fact_freshness',
    'login_attempts',
    'refresh_lock',
  ])
})

/**
 * Тот же сторож, что у схем `raw` и `fact` в проверках S1, и по той же причине: PostgREST
 * локально не запускается, живым запросом это не проверить, — значит сторожить надо сам
 * список. В `meta` лежат адреса посетителей, и наружу им нельзя.
 */
test('схема meta наружу через API не выставлена', () => {
  const config = readFileSync(join(process.cwd(), 'supabase', 'config.toml'), 'utf8')
  const line = config.split('\n').find((l) => l.trim().startsWith('schemas ='))
  expect(line).toBeDefined()
  expect(line).not.toMatch(/["']meta["']/)
})

/**
 * Правило удаления: записи старше окна запирания не остаются. Чистка идёт тем же обращением,
 * что и запись очередной попытки, — отдельного расписания нет нарочно.
 */
test('запись неудачи прибирает записи старше окна', async () => {
  await inRollback(async (client) => {
    await client.query(
      `insert into meta.login_attempts (address, failed_at)
       values ('1.2.3.4', clock_timestamp() - interval '1 hour')`,
    )

    await client.query('select meta.record_failure($1, $2::interval)', ['5.6.7.8', ОКНО])

    const остались = await client.query<{ address: string }>(
      'select address from meta.login_attempts order by address',
    )
    expect(остались.rows.map((r) => r.address)).toEqual(['5.6.7.8'])
  })
})

test('счёт неудач идёт по адресу и только в пределах окна', async () => {
  await inRollback(async (client) => {
    await client.query(
      `insert into meta.login_attempts (address, failed_at) values
         ('1.2.3.4', clock_timestamp()),
         ('1.2.3.4', clock_timestamp()),
         ('1.2.3.4', clock_timestamp() - interval '1 hour'),
         ('9.9.9.9', clock_timestamp())`,
    )

    const свой = await client.query<{ n: number }>('select n from meta.failures($1, $2::interval)', [
      '1.2.3.4',
      ОКНО,
    ])
    expect(свой.rows[0].n).toBe(2)

    const чужой = await client.query<{ n: number }>(
      'select n from meta.failures($1, $2::interval)',
      ['7.7.7.7', ОКНО],
    )
    expect(чужой.rows[0].n).toBe(0)
  })
})

test('обнуление счёта убирает записи своего адреса и не трогает чужие', async () => {
  await inRollback(async (client) => {
    await client.query(
      `insert into meta.login_attempts (address) values ('1.2.3.4'), ('1.2.3.4'), ('9.9.9.9')`,
    )

    await client.query('select meta.clear_failures($1)', ['1.2.3.4'])

    const остались = await client.query<{ address: string }>(
      'select address from meta.login_attempts order by address',
    )
    expect(остались.rows.map((r) => r.address)).toEqual(['9.9.9.9'])
  })
})

/**
 * Отметка свежести — состояние базы, а не запись о событии: строка одна на всю базу, и вторую
 * сюда не вставить даже нарочно.
 */
test('в отметку свежести нельзя положить вторую строку', async () => {
  await inRollback(async (client) => {
    await client.query(
      `insert into meta.fact_freshness (raw_seen_at) values (clock_timestamp())
       on conflict (only_row) do update set raw_seen_at = excluded.raw_seen_at`,
    )

    let текст = ''
    try {
      await client.query(
        `insert into meta.fact_freshness (only_row, raw_seen_at) values (false, clock_timestamp())`,
      )
    } catch (отказ) {
      текст = String(отказ)
    }
    expect(текст).toMatch(/check|constraint/i)
  })
})
