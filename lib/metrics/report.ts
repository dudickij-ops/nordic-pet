import { Client } from 'pg'

import { clearPostgresEnvironment } from '../db-url.ts'
import { resolveIngestTarget, type ProductionConnection } from '../ingest/target.ts'
import { MONTH_TOTALS } from './sql.ts'

/**
 * Дверь слоя метрик в базу — один снимок фактов на весь экран.
 *
 * Задача узкая: не общая обёртка на вырост, а три обязательства разом.
 *
 * 1. Снимок один на весь экран: одна транзакция `repeatable read`, а не запрос на блок.
 *    Между двумя запросами не может лечь чужая запись — например, чужой прогон кнопки, —
 *    и экран не сложится из двух разных состояний фактов.
 * 2. Слой метрик в базу не пишет никогда, и это обязательство заперто самой транзакцией
 *    (`read only`), а не обещанием в прозе.
 * 3. Именованный запрос — объект с полем `name` — в дверь не пролезает по устройству:
 *    единственная форма входа — `query(sql: string, params?: unknown[])`. Объединитель
 *    соединений Supabase в режиме транзакций именованные запросы не держит, и это
 *    сторожится проверкой первого довода во время исполнения: тип стирается при сборке.
 *
 * Транзакция всегда откатывается — даже когда работа, переданная снаружи, ничего не
 * записывала: `read only` этого и так не позволил бы, а `rollback` не оставляет открытых
 * транзакций на соединении, которое тут же освобождается.
 */

export type MetricsClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
  release: () => Promise<void>
}

export type MetricsDeps = {
  connect: (connection: string | ProductionConnection) => Promise<MetricsClient>
  /** Куда пошли — говорится до всякой работы, а не после. */
  announce: (line: string) => void
}

/** Настоящее соединение — то же устройство, что у сборки фактов в S4. */
async function connectToDatabase(connection: string | ProductionConnection): Promise<MetricsClient> {
  const client = new Client(
    typeof connection === 'string' ? { connectionString: connection } : connection,
  )
  await client.connect()
  return {
    query: (sql, params) => client.query(sql, params),
    release: () => client.end(),
  }
}

/**
 * Единственная дверь, через которую запрос уходит в снимок.
 *
 * Первый довод обязан быть строкой. Объект-запрос с полем `name` — это ровно тот приём,
 * которым node-postgres кеширует план на стороне сервера по соединению, а объединитель
 * соединений Supabase в режиме транзакций такие соединения не держит: план, закешированный
 * на одном соединении пула, окажется как будто ничей на следующем запросе того же клиента.
 * Тип стирается при сборке, и один сторож в виде подписи типа — не сторож.
 */
function guardedClient(client: MetricsClient): MetricsClient {
  return {
    query: (sql, params) => {
      if (typeof sql !== 'string') {
        throw new Error(
          'именованный запрос: объединитель соединений в режиме транзакций их не держит; ' +
            'запрос передаётся строкой',
        )
      }
      return client.query(sql, params)
    },
    release: client.release,
  }
}

/**
 * Открывает снимок фактов и отдаёт его функции.
 *
 * Цель называется словом до соединения — тем же приёмом, что у загрузчиков и у сборки
 * фактов: неназванная среда — отказ до всякой работы, а не запись не в ту базу молча.
 */
export async function withFactSnapshot<T>(
  run: (client: MetricsClient) => Promise<T>,
  deps: Partial<MetricsDeps> = {},
): Promise<T> {
  const connect = deps.connect ?? connectToDatabase
  const announce = deps.announce ?? (() => {})

  const target = resolveIngestTarget()
  announce(target.label)

  clearPostgresEnvironment()

  const client = await connect(target.connection)
  const guarded = guardedClient(client)

  try {
    // Уровень изоляции и `read only` — словом, в самой транзакции, а не обещанием.
    await guarded.query('begin isolation level repeatable read read only')
    return await run(guarded)
  } finally {
    // Снимок откатывается всегда: слой метрик в базу не пишет ни при удаче, ни при отказе.
    await client.query('rollback').catch(() => {})
    await client.release().catch(() => {})
  }
}

/**
 * Итоги месяца — правила 1 и 2 задания.
 *
 * Довод `month` — `YYYY-MM` (например, `'2026-03'`), без числа дня: тем же форматом, что
 * приходит с адреса экрана. Функция сама дописывает первое число перед тем, как отдать
 * дату запросу — `MONTH_TOTALS` берёт границу до первого числа следующего месяца, второй
 * довод ему не нужен.
 *
 * Деньги приходят из базы строкой (`numeric`, приведённый к `text` в самом запросе) и
 * строкой уходят наружу: слой метрик не переводит их в `number` ни разу, чтобы не потерять
 * точность в двоичной дроби.
 */
export async function monthTotals(
  client: MetricsClient,
  month: string,
): Promise<Record<string, string | null>> {
  const { rows } = await client.query(MONTH_TOTALS, [`${month}-01`])
  return rows[0] as Record<string, string | null>
}
