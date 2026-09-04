import { Client, type ClientConfig } from 'pg'

import { clearPostgresEnvironment } from '../db-url.ts'
import { resolveIngestTarget, type ProductionConnection } from '../ingest/target.ts'
import { foldCopies, platformOf, type AdsFile } from './ads.ts'
import {
  CellError,
  parseAmount,
  parseDate,
  parseMonth,
  parseSku,
  parseUnits,
  requireText,
  type CellAddress,
} from './parse.ts'

/**
 * Сборка слоя фактов: сырые строки → разобранные строки.
 *
 * Это функция, а не команда: команда — обёртка вокруг неё, и кнопка «Обновить данные» на S5
 * позовёт её же. Печатать она ничего не печатает и процесс не завершает — отдаёт отчёт тому,
 * кто позвал.
 *
 * Сети здесь нет вовсе: вход целиком лежит в схеме `raw`, выход целиком в схеме `fact`.
 * Ни одного оператора записи в сырьё сборка не посылает.
 *
 * Слой фактов пересобирается целиком при каждом прогоне, а не по признаку «что изменилось».
 * Причина названа в контракте: отметка «до какого места разобрано» имеет гонку, которая
 * теряет строку молча и навсегда — загрузка, начавшаяся раньше разбора и зафиксированная
 * позже, оставит строку с отметкой меньше запомненной, и такая строка не попадёт ни в один
 * пересчёт. Полная пересборка исполняет обязательство S1 по построению: изменившаяся сырая
 * строка не может остаться неразобранной, потому что разбирается каждая.
 */

/** Соединение с базой в том малом, что от него нужно сборке. */
export type FactsClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
  release: () => Promise<void>
}

/** Сколько строк прочитано, сколько записано и сколько денежных ячеек оказалось пустыми. */
export type TableReport = {
  table: string
  read: number
  written: number
  emptyMoney: number
}

/** Строки, совпавшие между собой по всем колонкам источника. Отказом не делаются, а называются. */
export type TwinReport = {
  table: string
  /** Сколько строк участвует в задвоениях. Ноль — тоже число, и оно печатается. */
  rows: number
  groups: Array<{ addresses: number[] }>
}

export type FactsReport = {
  target: string
  tables: TableReport[]
  twins: TwinReport[]
  folded: Array<{ fileName: string; copyOf: string; rows: number }>
  platforms: string[]
}

export type FactsDeps = {
  connect: (connection: string | ProductionConnection) => Promise<FactsClient>
  /** Куда пишем — говорится до всякой работы, а не после. */
  announce: (line: string) => void
}

/** Клиент базы в том малом, что от него нужно. */
type DatabaseClient = {
  connect: () => Promise<unknown>
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
  end: () => Promise<void>
}

/**
 * Настоящее соединение.
 *
 * Отдельное от того, что живёт в загрузчике Таблицы, и это выбор, а не забывчивость: тот
 * файл тянет за собой клиента Google, а этой команде сеть не нужна ни для чего. Утверждение
 * «сборка не ходит наружу» держалось бы на честном слове, если бы она загружала клиента,
 * умеющего наружу ходить.
 */
export async function connectToDatabase(
  connection: string | ProductionConnection,
  makeClient: (config: ClientConfig) => DatabaseClient = (config) => new Client(config),
): Promise<FactsClient> {
  const client = makeClient(
    typeof connection === 'string' ? { connectionString: connection } : connection,
  )
  await client.connect()
  return {
    query: (sql, params) => client.query(sql, params),
    release: () => client.end(),
  }
}

/** Валюта, в которой выставлены деньги источника. В самом источнике её нет ни в одной колонке. */
const EUR = 'EUR'
const USD = 'USD'

/** Знаков после запятой, которые вмещает колонка слоя фактов. */
const MONEY = 2
const RATE = 6
const PERCENT = 4

/**
 * Копилка непонятых мест.
 *
 * Отказ собирает **все** места разом, а не первое: человек правит лист один раз, а не семь
 * раз подряд, каждый раз узнавая про следующую ячейку.
 */
class Problems {
  private readonly found: string[] = []

  get count(): number {
    return this.found.length
  }

  add(message: string): void {
    this.found.push(message)
  }

  /** Выполняет разбор ячейки; при отказе запоминает его и отдаёт `undefined`. */
  cell<T>(run: () => T): T | undefined {
    try {
      return run()
    } catch (error) {
      this.found.push(error instanceof CellError ? error.message : (error as Error).message)
      return undefined
    }
  }

  refuseIfAny(what: string): void {
    if (this.found.length === 0) return
    throw new Error(`${what}:\n  · ${this.found.join('\n  · ')}`)
  }
}

/** Адрес ячейки листа. */
const inSheet = (sheet: string, rowNo: number) => (column: string): CellAddress => ({
  source: `в листе ${sheet}`,
  rowNo,
  column,
})

/** Адрес ячейки файла выгрузки. */
const inFile = (fileName: string, rowNo: number) => (column: string): CellAddress => ({
  source: `в файле ${fileName}`,
  rowNo,
  column,
})

type Row = Record<string, unknown>
const text = (row: Row, column: string): string | null => (row[column] as string | null) ?? null

/** Сколько денежных значений в снимке осталось пустыми. */
function emptyMoneyIn(rows: Array<Record<string, unknown>>, columns: string[]): number {
  let empty = 0
  for (const row of rows) {
    for (const column of columns) {
      if (row[column] === null) empty += 1
    }
  }
  return empty
}

/**
 * Находит строки, совпавшие между собой по всем колонкам источника.
 *
 * Сравнение идёт после приведения: артикул уже в одном написании, дата уже дата. Иначе
 * близнец, у которого артикул написан иначе, остался бы незамеченным — а он и есть самый
 * вероятный, потому что строку копировали руками.
 *
 * Адрес в сравнении не участвует: он у близнецов заведомо разный, в нём вся их разница.
 */
function twinsOf(table: string, rows: Array<Record<string, unknown>>): TwinReport {
  const seen = new Map<string, number[]>()
  for (const row of rows) {
    const { row_no: address, ...content } = row
    const key = JSON.stringify(Object.entries(content).sort(([a], [b]) => (a < b ? -1 : 1)))
    const group = seen.get(key)
    if (group === undefined) seen.set(key, [address as number])
    else group.push(address as number)
  }

  const groups = [...seen.values()]
    .filter((addresses) => addresses.length > 1)
    .map((addresses) => ({ addresses: [...addresses].sort((a, b) => a - b) }))
    .sort((a, b) => a.addresses[0] - b.addresses[0])

  return { table, rows: groups.reduce((sum, group) => sum + group.addresses.length, 0), groups }
}

/** Строки, у которых совпал деловой ключ. Ключ — свойство, а не сумма: две штуки — противоречие. */
function collisionsOf<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const byKey = new Map<string, T[]>()
  for (const row of rows) {
    const key = keyOf(row)
    const group = byKey.get(key)
    if (group === undefined) byKey.set(key, [row])
    else group.push(row)
  }
  return new Map([...byKey].filter(([, group]) => group.length > 1))
}

/**
 * Переводит отказы базы, которые человек может исправить сам, на человеческий язык.
 *
 * Повторяемое чтение не ставит соперников в очередь: если во время сборки источник
 * изменился, база рвёт транзакцию ошибкой сериализации. Это правильнее тихой порчи, но её
 * текст — «could not serialize access due to concurrent update» — не говорит человеку ни
 * что случилось, ни что делать. Контракт требует, чтобы всякий исправимый отказ называл
 * беду и следующее действие.
 */
function humanReadable(error: unknown): unknown {
  const code = (error as { code?: string } | null)?.code
  if (code === '40001') {
    return new Error(
      'источник менялся во время сборки: загрузка успела записать сырьё, пока разбор его ' +
        'читал. Ничего не записано — повторите разбор',
    )
  }
  if (code === '40P01') {
    return new Error(
      'разбор и загрузка встали в замок друг против друга, и база разорвала один из них. ' +
        'Ничего не записано — повторите разбор, когда загрузка закончится',
    )
  }
  return error
}

export async function buildFacts(deps: Partial<FactsDeps> = {}): Promise<FactsReport> {
  const connect = deps.connect ?? connectToDatabase
  const announce = deps.announce ?? (() => {})

  // Среда названа словом. Неназванная среда — отказ до всякой работы.
  const target = resolveIngestTarget()
  announce(target.label)

  // Незаполненных мест не должно остаться ни в полях соединения, ни в окружении: драйвер
  // читает те же переменные PG*, что и libpq. Так же поступают обе загрузки.
  clearPostgresEnvironment()

  const client = await connect(target.connection)

  try {
    // Чтение сырья и запись фактов — одна транзакция, и уровень назван словом.
    //
    // Одной транзакции мало. На уровне по умолчанию каждый оператор видит своё состояние
    // базы: семь чтений сырья дали бы семь снимков, и загрузка, зафиксированная между
    // первым и седьмым, попала бы в часть таблиц и не попала в остальные. Слой фактов
    // вышел бы собранным из двух состояний источника — заказы вчерашние, курс сегодняшний,
    // — и проверка «нет курса на день рекламы» промолчала бы, потому что по фактам это
    // не видно. Повторяемое чтение даёт всем семи чтениям один снимок.
    await client.query('begin isolation level repeatable read')

    const raw = {
      orders: (await client.query('select * from raw.orders order by row_no')).rows,
      refunds: (await client.query('select * from raw.refunds order by row_no')).rows,
      costs: (await client.query('select * from raw.costs order by row_no')).rows,
      fees: (await client.query('select * from raw.fees order by row_no')).rows,
      opex: (await client.query('select * from raw.opex order by row_no')).rows,
      fx: (await client.query('select * from raw.fx order by row_no')).rows,
      ads: (await client.query('select * from raw.ads order by file_name, row_no')).rows,
    }

    const problems = new Problems()

    // --- разбор ячейка за ячейкой -------------------------------------------------------

    const orders = []
    for (const row of raw.orders) {
      const at = inSheet('orders', row.row_no as number)
      const before = problems.count
      const parsed = {
        row_no: row.row_no,
        date: problems.cell(() => parseDate(text(row, 'date'), at('date'))),
        order_id: problems.cell(() => requireText(text(row, 'order_id'), at('order_id'))),
        sku: problems.cell(() => parseSku(text(row, 'sku'), at('sku'))),
        units: problems.cell(() => parseUnits(text(row, 'units'), at('units'))),
        gross: problems.cell(() => parseAmount(text(row, 'gross_eur'), at('gross_eur'), MONEY)),
        discount: problems.cell(() =>
          parseAmount(text(row, 'discount_eur'), at('discount_eur'), MONEY),
        ),
        currency: EUR,
        gateway: problems.cell(() => requireText(text(row, 'gateway'), at('gateway'))),
      }
      if (problems.count === before) orders.push(parsed)
    }

    const refunds = []
    for (const row of raw.refunds) {
      const at = inSheet('refunds', row.row_no as number)
      const before = problems.count
      const parsed = {
        row_no: row.row_no,
        refund_date: problems.cell(() => parseDate(text(row, 'refund_date'), at('refund_date'))),
        order_id: problems.cell(() => requireText(text(row, 'order_id'), at('order_id'))),
        sku: problems.cell(() => parseSku(text(row, 'sku'), at('sku'))),
        units: problems.cell(() => parseUnits(text(row, 'units'), at('units'))),
        amount: problems.cell(() => parseAmount(text(row, 'amount_eur'), at('amount_eur'), MONEY)),
        currency: EUR,
      }
      if (problems.count === before) refunds.push(parsed)
    }

    const costs = []
    for (const row of raw.costs) {
      const at = inSheet('costs', row.row_no as number)
      const before = problems.count
      const parsed = {
        row_no: row.row_no,
        sku: problems.cell(() => parseSku(text(row, 'sku'), at('sku'))),
        cost: problems.cell(() => parseAmount(text(row, 'cost_eur'), at('cost_eur'), MONEY)),
        currency: EUR,
        valid_from: problems.cell(() => parseDate(text(row, 'valid_from'), at('valid_from'))),
      }
      if (problems.count === before) costs.push(parsed)
    }

    const fees = []
    for (const row of raw.fees) {
      const at = inSheet('fees', row.row_no as number)
      const before = problems.count
      const parsed = {
        row_no: row.row_no,
        gateway: problems.cell(() => requireText(text(row, 'gateway'), at('gateway'))),
        // Процент хранится в процентных пунктах, как в источнике: 1.9000, а не 0.0190.
        // Делить на сто — работа метрик, и там же стоит ловушка, названная в контракте.
        percent: problems.cell(() => parseAmount(text(row, 'percent'), at('percent'), PERCENT)),
        fixed: problems.cell(() => parseAmount(text(row, 'fixed_eur'), at('fixed_eur'), MONEY)),
        currency: EUR,
      }
      if (problems.count === before) fees.push(parsed)
    }

    const opex = []
    for (const row of raw.opex) {
      const at = inSheet('opex', row.row_no as number)
      const before = problems.count
      const parsed = {
        row_no: row.row_no,
        month: problems.cell(() => parseMonth(text(row, 'month'), at('month'))),
        category: problems.cell(() => requireText(text(row, 'category'), at('category'))),
        amount: problems.cell(() => parseAmount(text(row, 'amount_eur'), at('amount_eur'), MONEY)),
        currency: EUR,
      }
      if (problems.count === before) opex.push(parsed)
    }

    const fx = []
    for (const row of raw.fx) {
      const at = inSheet('fx', row.row_no as number)
      const before = problems.count
      const parsed = {
        row_no: row.row_no,
        date: problems.cell(() => parseDate(text(row, 'date'), at('date'))),
        usd_per_eur: problems.cell(() =>
          parseAmount(text(row, 'usd_per_eur'), at('usd_per_eur'), RATE),
        ),
      }
      if (problems.count === before) fx.push(parsed)
    }

    // Реклама разбирается по файлам: площадка у файла одна, и свёртка копий идёт целыми
    // файлами, а не строками.
    const byFile = new Map<string, AdsFile>()
    for (const row of raw.ads) {
      const fileName = row.file_name as string
      const at = inFile(fileName, row.row_no as number)
      const before = problems.count

      let file = byFile.get(fileName)
      if (file === undefined) {
        const platform = problems.cell(() => platformOf(fileName))
        if (platform === undefined) continue
        file = { fileName, platform, rows: [] }
        byFile.set(fileName, file)
      }

      const parsed = {
        rowNo: row.row_no as number,
        date: problems.cell(() => parseDate(text(row, 'date'), at('date'))) as string,
        campaign: problems.cell(() => requireText(text(row, 'campaign'), at('campaign'))) as string,
        spend: problems.cell(() => parseAmount(text(row, 'spend_usd'), at('spend_usd'), MONEY)) as
          | string
          | null,
      }
      if (problems.count === before) file.rows.push(parsed)
    }

    problems.refuseIfAny('разбор остановлен, эти значения источника не разобраны')

    // --- свёртка копий выгрузки ---------------------------------------------------------

    const { kept, folded } = foldCopies([...byFile.values()])
    const ads = kept.flatMap((file) =>
      file.rows.map((row) => ({
        file_name: file.fileName,
        row_no: row.rowNo,
        date: row.date,
        campaign: row.campaign,
        platform: file.platform,
        spend: row.spend,
        currency: USD,
      })),
    )

    // --- противоречия на деловой ключ ---------------------------------------------------

    const contradictions = new Problems()

    for (const [date] of collisionsOf(fx, (row) => String(row.date))) {
      contradictions.add(
        `в листе fx на дату ${date} стоит больше одного курса. Курс — свойство дня: ` +
          'оставьте одну строку, иначе расход рекламы этого дня удвоится',
      )
    }

    for (const [key] of collisionsOf(costs, (row) => `${row.sku}|${row.valid_from}`)) {
      const [sku, from] = key.split('|')
      contradictions.add(
        `в листе costs у артикула ${sku} на дату ${from} стоит больше одной цены поставщика. ` +
          'Оставьте одну строку: цена — свойство товара на дату',
      )
    }

    for (const [gateway] of collisionsOf(fees, (row) => String(row.gateway))) {
      contradictions.add(
        `в листе fees у способа оплаты ${gateway} стоит больше одной ставки. ` +
          'Оставьте одну строку: ставка — свойство способа оплаты',
      )
    }

    const byOrder = new Map<string, Array<{ gateway: unknown; date: unknown }>>()
    for (const row of orders) {
      const key = String(row.order_id)
      const group = byOrder.get(key) ?? []
      group.push({ gateway: row.gateway, date: row.date })
      byOrder.set(key, group)
    }
    for (const [orderId, lines] of byOrder) {
      const gateways = new Set(lines.map((line) => String(line.gateway)))
      const dates = new Set(lines.map((line) => String(line.date)))
      if (gateways.size > 1) {
        contradictions.add(
          `в листе orders у заказа ${orderId} строки разошлись способом оплаты: ` +
            `${[...gateways].join(', ')}. У одного заказа он один, и от него считается комиссия`,
        )
      }
      if (dates.size > 1) {
        contradictions.add(
          `в листе orders у заказа ${orderId} строки разошлись датой: ${[...dates].join(', ')}. ` +
            'Заказ целиком принадлежит одному дню, иначе он попадёт в два месяца сразу',
        )
      }
    }

    // Столкновение по площадке, дню и кампании — две разные беды с разными действиями
    // человека. Отказ обязан их различать, иначе он отправит чинить не то.
    for (const [key, rows] of collisionsOf(
      ads,
      (row) => `${row.platform}|${row.date}|${row.campaign}`,
    )) {
      const [platform, date, campaign] = key.split('|')
      const files = [...new Set(rows.map((row) => row.file_name))].sort()
      if (files.length > 1) {
        contradictions.add(
          `в папке рекламы две выгрузки площадки ${platform} совпали частично: ` +
            `${files.join(' и ')} обе содержат ${date}, кампанию «${campaign}». ` +
            'Копиями они не являются, свёрнуты не были — уберите из папки лишнюю выгрузку',
        )
      } else {
        contradictions.add(
          `в одной выгрузке ${files[0]} на ${date} у кампании «${campaign}» больше одной ` +
            'строки. Разбор ждёт по строке на кампанию в день — свести строки в выгрузке ' +
            'или менять правило',
        )
      }
    }

    // --- ссылки, без которых правила счёта врут молча ------------------------------------

    const ratesByDate = new Set(fx.map((row) => String(row.date)))
    const daysWithoutRate = [...new Set(ads.map((row) => row.date))]
      .filter((date) => !ratesByDate.has(String(date)))
      .sort()
    if (daysWithoutRate.length > 0) {
      contradictions.add(
        `в листе fx нет курса на дни, за которые есть расход рекламы: ` +
          `${daysWithoutRate.join(', ')}. Без курса расход этих дней не перевести в евро, ` +
          'и он выпал бы из счёта, занизив рекламу и завысив прибыль',
      )
    }

    const ratedGateways = new Set(fees.map((row) => String(row.gateway)))
    const gatewaysWithoutFee = [...new Set(orders.map((row) => String(row.gateway)))]
      .filter((gateway) => !ratedGateways.has(gateway))
      .sort()
    if (gatewaysWithoutFee.length > 0) {
      contradictions.add(
        `в листе fees нет ставки для способов оплаты, которые встретились в заказах: ` +
          `${gatewaysWithoutFee.join(', ')}. Без ставки комиссия по этим заказам вышла бы ` +
          'нулевой, и прибыль оказалась бы выше настоящей',
      )
    }

    contradictions.refuseIfAny('разбор остановлен, источник противоречит сам себе')

    // --- строки-близнецы: не отказ, а называние ------------------------------------------

    const twins = [
      twinsOf('orders', orders as Array<Record<string, unknown>>),
      twinsOf('refunds', refunds as Array<Record<string, unknown>>),
    ]

    // --- запись -------------------------------------------------------------------------

    const written: Array<[string, string, unknown[], string[]]> = [
      ['fact.orders', 'replace_orders', orders, ['gross', 'discount']],
      ['fact.refunds', 'replace_refunds', refunds, ['amount']],
      ['fact.costs', 'replace_costs', costs, ['cost']],
      ['fact.fees', 'replace_fees', fees, ['percent', 'fixed']],
      ['fact.opex', 'replace_opex', opex, ['amount']],
      ['fact.fx', 'replace_fx', fx, ['usd_per_eur']],
      ['fact.ads', 'replace_ads', ads, ['spend']],
    ]

    const tables: TableReport[] = []
    const readCount: Record<string, number> = {
      'fact.orders': raw.orders.length,
      'fact.refunds': raw.refunds.length,
      'fact.costs': raw.costs.length,
      'fact.fees': raw.fees.length,
      'fact.opex': raw.opex.length,
      'fact.fx': raw.fx.length,
      'fact.ads': raw.ads.length,
    }

    for (const [table, fn, rows, moneyColumns] of written) {
      await client.query(`select fact.${fn}($1::jsonb)`, [JSON.stringify(rows)])
      tables.push({
        table,
        read: readCount[table],
        written: rows.length,
        emptyMoney: emptyMoneyIn(rows as Array<Record<string, unknown>>, moneyColumns),
      })
    }

    // Деловые ключи объявлены отложенными: внутри записи они законно нарушаются, пока строки
    // меняются местами. Проверить их надо здесь, а не в момент фиксации: иначе отказ пришёл
    // бы после того, как вся наша работа закончена, и сказать над ним было бы нечего.
    await client.query('set constraints all immediate')

    // Отметка того сырья, по которому собраны эти факты — задача 5 куска S8.
    //
    // Стоит здесь, **внутри той же транзакции**, и это главное в ней: отметка, записанная
    // отдельно, разошлась бы с фактами ровно тогда, когда разбор отказал на середине, — то
    // есть именно тогда, когда она нужна. Отказ откатывает и факты, и отметку разом.
    //
    // Читается тот же снимок `repeatable read`, из которого взяты сами факты: значит отметка
    // говорит о том сырье, которое вправду разобрано, а не о том, что успело приехать, пока
    // разбор работал.
    // Функцией, а не оператором записи: сборка фактов не посылает в базу ни одного оператора
    // записи — так устроен весь проект, и это сторожит принятая проверка S4.
    await client.query('select meta.mark_fact_freshness()')

    await client.query('commit')

    return {
      target: target.label,
      tables,
      twins,
      folded,
      platforms: [...new Set(kept.map((file) => file.platform))].sort(),
    }
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw humanReadable(error)
  } finally {
    // Отказ при закрытии соединения не должен подменять собой настоящую причину.
    await client.release().catch(() => {})
  }
}
