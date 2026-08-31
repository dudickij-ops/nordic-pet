import { Pool, type PoolClient } from 'pg'

export const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://postgres@127.0.0.1:5432/nordic_pet?sslmode=disable'

export const pool = new Pool({ connectionString: databaseUrl })

/** Выполняет запрос через пул и возвращает строки. */
export async function rows<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query(sql, params)
  return result.rows as T[]
}

/**
 * Выполняет fn в транзакции и всегда откатывает её.
 * Проверки, которые пишут в таблицы, обязаны идти через это:
 * иначе следующая проверка поедет на строках, оставленных предыдущей.
 */
export async function inRollback<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    return await fn(client)
  } finally {
    await client.query('rollback')
    client.release()
  }
}
