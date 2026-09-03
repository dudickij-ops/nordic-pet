import { Client } from 'pg'

import { clearPostgresEnvironment } from '../db-url.ts'
import { resolveIngestTarget, type ProductionConnection } from '../ingest/target.ts'
import { ALL_MONTHS, MONTH_GAPS, MONTH_ITEMS, MONTH_TOTALS } from './sql.ts'

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

/**
 * Деньги — строка, округленная в SQL: «1234.50». Никогда не число, ни разу за весь путь
 * от базы до экрана — двоичная дробь не проходит через слой метрик.
 */
export type Money = string

/** `null` значит «нет данных», а не ноль: деление на ноль в SQL даёт `null` через `nullif`. */
export type Maybe = string | null

export type MonthReport = {
  /** Куда ходили за отчётом — `target.label` из `resolveIngestTarget()`, без пароля. */
  target: string
  month: string | null
  months: Array<{ month: string; hasOrders: boolean }>
  revenue: { gross: Money; discounts: Money; refunds: Money; net: Money }
  costs: { cogs: Money; ads: Money; fees: Money; fixed: Money }
  bottom: { profit: Money; marginPct: Maybe; roasByGross: Maybe }
  items: Array<{ sku: string; units: string; net: Money; cogs: Money; profit: Money }>
  honesty: { sharePct: Maybe; skusWithoutPrice: string[] }
  gaps: Array<{ kind: string; count: number; at: string[] }>
}

/** Вид дыры, чьи адреса переиспользует «доля честности» — своего запроса ей не нужно. */
const NO_PRICE_GAP = 'строки продаж без цены поставщика'

/**
 * Форма месяца — ровно `ГГГГ-ММ`, месяц от 01 до 12. Проверяется до похода в базу и до
 * `withFactSnapshot`: на S6 месяц придёт из адреса страницы (`?m=...`), и без этой
 * проверки любой посетитель погасил бы экран сырой ошибкой Postgres (`invalid input
 * syntax for type date`) вместо читаемого отказа. Инъекции здесь нет — довод уходит
 * только параметром `$1`, — но нечитаемый отказ настолько же плохая защита от кривого
 * адреса, насколько плохая её отсутствие.
 */
const MONTH_SHAPE = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * Отчёт месяца целиком — задача 5. Один снимок фактов (`withFactSnapshot`) на весь экран:
 * список месяцев, итоги, таблицу товаров и блок неполноты запрашивает одна и та же
 * транзакция `repeatable read read only`, а не пять разных, — иначе экран мог бы сложиться
 * из двух разных состояний фактов.
 *
 * Довод `month` — `YYYY-MM`, как и у `monthTotals`. Когда его нет, берётся последний
 * месяц из списка месяцев, у которого `hasOrders` истинно (контракт: «месяц по умолчанию
 * — последний, за который есть заказы»), а если заказов нет вовсе — `null`: пустой слой
 * фактов не роняет отчёт, а показывает его пустым.
 *
 * `null`-месяц уходит в SQL как есть, не строкой `'null-01'`: `$1::date` из `null`
 * становится SQL `NULL`, и каждое условие вида `дата >= NULL` не находит ни одной строки
 * — тот же результат, что и у месяца, за который данных нет, без отдельной ветки кода.
 */
export async function monthlyReport(
  month?: string,
  deps: Partial<MetricsDeps> = {},
): Promise<MonthReport> {
  if (month !== undefined && !MONTH_SHAPE.test(month)) {
    throw new Error(
      `месяц обязан быть в форме ГГГГ-ММ (пример: «2026-03»), а пришло «${month}»`,
    )
  }

  let target = ''
  const announce = (line: string) => {
    target = line
    deps.announce?.(line)
  }

  return withFactSnapshot(async (client) => {
    const { rows: monthRows } = await client.query(ALL_MONTHS)
    const months = monthRows.map((row) => ({
      month: row.month as string,
      hasOrders: row.has_orders as boolean,
    }))

    const resolvedMonth = month ?? months.find((m) => m.hasOrders)?.month ?? null
    const dayParam = resolvedMonth === null ? null : `${resolvedMonth}-01`

    const totalsResult = await client.query(MONTH_TOTALS, [dayParam])
    const itemsResult = await client.query(MONTH_ITEMS, [dayParam])
    const gapsResult = await client.query(MONTH_GAPS, [dayParam])

    const totals = totalsResult.rows[0] as Record<string, string | null>
    const items = itemsResult.rows.map((row) => ({
      sku: row.sku as string,
      units: row.units as string,
      net: row.net as string,
      cogs: row.cogs as string,
      profit: row.profit as string,
    }))
    const gaps = gapsResult.rows.map((row) => ({
      kind: row.kind as string,
      count: row.count as number,
      at: row.at as string[],
    }))
    const skusWithoutPrice = gaps.find((g) => g.kind === NO_PRICE_GAP)?.at ?? []

    return {
      target,
      month: resolvedMonth,
      months,
      revenue: {
        gross: totals.gross as string,
        discounts: totals.discounts as string,
        refunds: totals.refunds as string,
        net: totals.net as string,
      },
      costs: {
        cogs: totals.cogs as string,
        ads: totals.ads as string,
        fees: totals.fees as string,
        fixed: totals.fixed as string,
      },
      bottom: {
        profit: totals.profit as string,
        marginPct: totals.margin_pct,
        roasByGross: totals.roas_by_gross,
      },
      items,
      honesty: { sharePct: totals.honest_pct, skusWithoutPrice },
      gaps,
    }
  }, { ...deps, announce })
}
