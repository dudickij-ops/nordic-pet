import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { projectDatabaseUrl } from '@/lib/db-url'
import { buildFacts } from '@/lib/facts/build'
import { monthlyReport } from '@/lib/metrics/report'

/**
 * Отметка свежести фактов — задача 5 куска S8.
 *
 * Проверки идут на настоящей базе в откатываемой транзакции: отметка — это состояние базы, и
 * подставкой её не проверить. Тот же приём, что у принятых проверок сборки фактов.
 *
 * Проход целиком в обе стороны: сразу после разбора числа свежие, а стоит сырью измениться —
 * отчёт говорит, что они отстали.
 */

const pool = new Pool({ connectionString: projectDatabaseUrl() })

/**
 * Среда называется словом до всякой работы (S2), и разбор с отчётом спрашивают её даже тогда,
 * когда соединение им подставлено. Тем же приёмом, что и принятые проверки сборки фактов.
 */
let прежняяЦель: string | undefined
beforeAll(() => {
  прежняяЦель = process.env.NORDIC_PET_DB_TARGET
  process.env.NORDIC_PET_DB_TARGET = 'local'
})
afterAll(async () => {
  if (прежняяЦель === undefined) delete process.env.NORDIC_PET_DB_TARGET
  else process.env.NORDIC_PET_DB_TARGET = прежняяЦель
  await pool.end()
})

/** Клиент, у которого фиксация и откат подменены точками сохранения: настоящие сорвали бы откат. */
function savepointClient(client: PoolClient) {
  return {
    query: async (sql: string, params?: unknown[]) => {
      if (sql === 'begin isolation level repeatable read') {
        return client.query('savepoint разбор')
      }
      if (sql === 'commit') return client.query('release savepoint разбор')
      if (sql === 'rollback') return client.query('rollback to savepoint разбор')
      if (sql.startsWith('begin')) return client.query('savepoint отчёт')
      return client.query(sql, params)
    },
    async release() {},
  }
}

async function наБазе(проверка: (client: PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await проверка(client)
  } finally {
    await client.query('rollback')
    client.release()
  }
}

const разбор = (client: PoolClient) =>
  buildFacts({ connect: async () => savepointClient(client), announce: () => {} })

const отчёт = (client: PoolClient) =>
  monthlyReport(undefined, { connect: async () => savepointClient(client), announce: () => {} })

test('после разбора числа не помечены устаревшими', async () => {
  await наБазе(async (client) => {
    await разбор(client)

    const итог = await отчёт(client)

    expect(итог.устарели).toBe(false)
  })
})

/**
 * Главная половина: сырьё изменилось, разбора не было — и человек, открывший страницу на
 * холодную, обязан об этом узнать. Прежде он видел устаревшие числа без всякой пометки.
 */
test('сырьё новее фактов — отчёт говорит, что числа отстали', async () => {
  await наБазе(async (client) => {
    await разбор(client)

    // Настоящее изменение сырья, той же функцией снимка, что и у загрузчика: `updated_at`
    // двигается тогда и только тогда, когда содержимое строки стало другим.
    await client.query(
      `select raw.replace_fees($json$[
         {"row_no": 1, "gateway": "stripe", "fee_pct": "2,9"},
         {"row_no": 2, "gateway": "paypal", "fee_pct": "3,4"},
         {"row_no": 3, "gateway": "klarna", "fee_pct": "1,1"}
       ]$json$::jsonb)`,
    )

    const итог = await отчёт(client)

    expect(итог.устарели).toBe(true)
  })
})

/**
 * Отметка живёт и умирает вместе с фактами: разбор, отказавший на середине, откатывает и то и
 * другое. Иначе отметка сказала бы «свежо» про факты, которых нет.
 */
test('отказавший разбор отметку не сдвигает', async () => {
  await наБазе(async (client) => {
    await разбор(client)
    const до = await client.query<{ raw_seen_at: Date }>('select raw_seen_at from meta.fact_freshness')

    await client.query(
      `select raw.replace_fees($json$[
         {"row_no": 1, "gateway": "stripe", "fee_pct": "нечисло"}
       ]$json$::jsonb)`,
    )

    let отказал = false
    try {
      await разбор(client)
    } catch {
      отказал = true
    }
    expect(отказал, 'разбор обязан был отказать на непонятной ячейке').toBe(true)

    const после = await client.query<{ raw_seen_at: Date }>(
      'select raw_seen_at from meta.fact_freshness',
    )
    expect(после.rows[0].raw_seen_at).toEqual(до.rows[0].raw_seen_at)
  })
})
