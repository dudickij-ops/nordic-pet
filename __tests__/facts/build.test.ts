import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { projectDatabaseUrl } from '@/lib/db-url'
import { blockNetwork } from '../commands/network'
import { buildFacts, type FactsClient } from '@/lib/facts/build'

/**
 * Сборка слоя фактов на настоящей базе.
 *
 * Сырьё для проверок кладётся теми же функциями снимка S1, что и живая загрузка: второй
 * способ положить сырую строку разошёлся бы с первым молча. Всё происходит внутри
 * откатываемой транзакции — иначе следующая проверка поехала бы на строках предыдущей.
 *
 * Сборка открывает транзакцию сама. Внутри проверки она уже открыта, поэтому клиент, который
 * ей подсовывают, переводит `begin`/`commit`/`rollback` в точки сохранения: без этого `commit`
 * сборки закрепил бы выдуманные строки в базе по-настоящему.
 */

const pool = new Pool({ connectionString: projectDatabaseUrl() })
afterAll(() => pool.end())

// Среда называется словом, и сборка отказывается работать без неё. Проверкам она нужна
// такой же, как команде, и возвращается на место после набора.
let savedTarget: string | undefined
beforeAll(() => {
  savedTarget = process.env.NORDIC_PET_DB_TARGET
  process.env.NORDIC_PET_DB_TARGET = 'local'
})
afterAll(() => {
  if (savedTarget === undefined) delete process.env.NORDIC_PET_DB_TARGET
  else process.env.NORDIC_PET_DB_TARGET = savedTarget
})

/** Клиент, у которого границы транзакции переведены в точки сохранения. */
function savepointClient(client: PoolClient, log?: string[]): FactsClient {
  let depth = 0
  return {
    async query(sql: string, params?: unknown[]) {
      const command = sql.trim().toLowerCase()
      log?.push(sql.trim())
      if (command.startsWith('begin')) {
        depth += 1
        return client.query(`savepoint сборка_${depth}`)
      }
      if (command === 'commit') {
        const at = depth
        depth -= 1
        return client.query(`release savepoint сборка_${at}`)
      }
      if (command === 'rollback') {
        const at = depth
        depth -= 1
        return client.query(`rollback to savepoint сборка_${at}`)
      }
      return client.query(sql, params)
    },
    async release() {},
  }
}

async function onCraftedRaw(
  craft: (client: PoolClient) => Promise<void>,
  run: (deps: { client: FactsClient; log: string[]; raw: PoolClient }) => Promise<void>,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    // Слой фактов опустошается внутри той же откатываемой транзакции. Без этого проверка
    // зависела бы от того, что оставила в базе предыдущая: боевой путь ниже пишет факты
    // по-настоящему, и «после отказа не появилось ни одной строки» зеленело бы или краснело
    // в зависимости от порядка проверок, а не от поведения кода. Найдено сломом: список
    // сломов краснил не те проверки, которые ломали.
    for (const table of ['orders', 'refunds', 'costs', 'fees', 'opex', 'fx', 'ads']) {
      await client.query(`delete from fact.${table}`)
    }
    await craft(client)
    const log: string[] = []
    await run({ client: savepointClient(client, log), log, raw: client })
  } finally {
    await client.query('rollback')
    client.release()
  }
}

/** Снимок листа целиком: сборка читает то, что положила функция снимка S1. */
function put(client: PoolClient, table: string, rows: unknown[]) {
  return client.query(`select raw.replace_${table}($1::jsonb)`, [JSON.stringify(rows)])
}

/** Чем можно заменить кусок наименьшего сырья в отдельной проверке. */
type Craft = { [table: string]: unknown[] | undefined }

const ORDER = {
  row_no: 1, date: '2026-03-01', order_id: 'NP1001', sku: 'NP-001', units: '1',
  gross_eur: '10.00', discount_eur: '0.00', gateway: 'card',
}
const FEE = { row_no: 1, gateway: 'card', percent: '1.9', fixed_eur: '0.25' }
const RATE = { row_no: 1, date: '2026-03-01', usd_per_eur: '1.05' }
const AD = { file_name: 'meta_2026-03.csv', row_no: 2, date: '2026-03-01', campaign: 'Broad EU', spend_usd: '12.40' }

/** Наименьшее непротиворечивое сырьё: заказ, ставка, курс, одна строка рекламы. */
async function minimalRaw(client: PoolClient, over: Craft = {}) {
  await put(client, 'orders', over.orders ?? [ORDER])
  await put(client, 'refunds', over.refunds ?? [
    { row_no: 1, refund_date: '2026-03-05', order_id: 'NP1001', sku: 'NP-001', units: '1', amount_eur: '10.00' },
  ])
  await put(client, 'costs', over.costs ?? [
    { row_no: 1, sku: 'NP-001', cost_eur: '5.10', valid_from: '2026-01-01' },
  ])
  await put(client, 'fees', over.fees ?? [FEE])
  await put(client, 'opex', over.opex ?? [
    { row_no: 1, month: '2026-03', category: 'rent', amount_eur: '950,00' },
  ])
  await put(client, 'fx', over.fx ?? [RATE])
  await put(client, 'entire_ads_folder', over.ads ?? [AD])
}

async function refusalOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error('отказа не случилось, а он ожидался')
}

describe('разбор посева целиком', () => {
  test('семь таблиц фактов наполняются из семи сырых', async () => {
    await onCraftedRaw(
      async () => {},
      async ({ client, raw }) => {
        await buildFacts({ connect: async () => client, announce: () => {} })

        const counts: Record<string, number> = {}
        for (const table of ['orders', 'refunds', 'costs', 'fees', 'opex', 'fx', 'ads']) {
          const { rows } = await raw.query(`select count(*)::int as n from fact.${table}`)
          counts[table] = rows[0].n
        }

        // Посев: 4 заказа, 2 возврата, 3 цены, 2 ставки, 3 расхода, 3 курса и шесть строк
        // рекламы, из которых два файла meta совпадают содержимым — один сворачивается.
        expect(counts).toEqual({
          orders: 4, refunds: 2, costs: 3, fees: 2, opex: 3, fx: 3, ads: 4,
        })
      },
    )
  })

  test('три написания артикула в посеве сходятся в один товар', async () => {
    await onCraftedRaw(
      async () => {},
      async ({ client, raw }) => {
        await buildFacts({ connect: async () => client, announce: () => {} })
        const { rows } = await raw.query(
          `select sku, count(*)::int as n from fact.orders group by sku order by sku`,
        )
        expect(rows.find((r) => r.sku === 'NP-003')?.n).toBe(2)
        expect(rows.map((r) => r.sku)).not.toContain('np-003')
      },
    )
  })

  test('сумма с пробелом и запятой разобрана, пустая ячейка осталась пустой', async () => {
    await onCraftedRaw(
      async () => {},
      async ({ client, raw }) => {
        await buildFacts({ connect: async () => client, announce: () => {} })

        const { rows: opex } = await raw.query(
          `select amount from fact.opex where category = 'аренда'`,
        )
        expect(opex[0].amount).toBe('1234.50')

        const { rows: missing } = await raw.query(
          `select count(*)::int as n from fact.costs where cost is null`,
        )
        expect(missing[0].n).toBe(1)
      },
    )
  })

  test('валюта проставлена всем: евро листам, доллар рекламе', async () => {
    await onCraftedRaw(
      async () => {},
      async ({ client, raw }) => {
        await buildFacts({ connect: async () => client, announce: () => {} })
        const { rows } = await raw.query(
          `select distinct currency from fact.orders
           union select distinct currency from fact.opex
           union select distinct currency from fact.ads order by 1`,
        )
        expect(rows.map((r) => r.currency)).toEqual(['EUR', 'USD'])
      },
    )
  })

  test('площадка выведена у каждой строки рекламы', async () => {
    await onCraftedRaw(
      async () => {},
      async ({ client, raw }) => {
        await buildFacts({ connect: async () => client, announce: () => {} })
        const { rows } = await raw.query(
          `select platform, count(*)::int as n from fact.ads group by platform order by platform`,
        )
        expect(rows.map((r) => r.platform)).toEqual(['google', 'meta', 'pinterest'])
        expect(rows.every((r) => r.platform !== null)).toBe(true)
      },
    )
  })

  test('копия выгрузки свёрнута и названа в отчёте', async () => {
    await onCraftedRaw(
      async () => {},
      async ({ client }) => {
        const report = await buildFacts({ connect: async () => client, announce: () => {} })
        expect(report.folded).toHaveLength(1)
        expect(report.folded[0].rows).toBe(2)
        expect(report.platforms).toEqual(['google', 'meta', 'pinterest'])
      },
    )
  })
})

describe('повторный прогон и пересчёт изменившегося', () => {
  test('второй прогон подряд не меняет ни одной строки в семи таблицах фактов', async () => {
    // Сравниваются все семь, а не одна: прежде сравнивались только заказы, и подмена
    // содержимого в остальных шести прошла бы незамеченной.
    const FACT_TABLES = ['orders', 'refunds', 'costs', 'fees', 'opex', 'fx', 'ads']
    await onCraftedRaw(
      async () => {},
      async ({ client, raw }) => {
        const contentOf = async () => {
          const all: Record<string, unknown[]> = {}
          for (const table of FACT_TABLES) {
            const { rows } = await raw.query(`select * from fact.${table} order by 1, 2`)
            all[table] = rows
          }
          return all
        }

        await buildFacts({ connect: async () => client, announce: () => {} })
        const first = await contentOf()
        await buildFacts({ connect: async () => client, announce: () => {} })
        const second = await contentOf()

        expect(Object.keys(first)).toHaveLength(7)
        expect(second).toEqual(first)
      },
    )
  })

  test('исправленная человеком ячейка сырья пересчитывается, соседи — нет', async () => {
    // Обязательство контракта S1. Сырая строка не исчезла, а изменилась: каскад тут не
    // сработает, и без пересчёта экран показывал бы старое число, ничем не выдавая, что оно
    // устарело.
    await onCraftedRaw(
      async (client) => {
        await minimalRaw(client, {
          orders: [ORDER, { ...ORDER, row_no: 2, order_id: 'NP1002', gross_eur: '20.00' }],
        })
      },
      async ({ client, raw }) => {
        await buildFacts({ connect: async () => client, announce: () => {} })
        const { rows: before } = await raw.query(
          'select row_no, gross, ctid::text as version from fact.orders order by row_no',
        )

        await put(raw, 'orders', [
          { ...ORDER, gross_eur: '99.90' },
          { ...ORDER, row_no: 2, order_id: 'NP1002', gross_eur: '20.00' },
        ])
        await buildFacts({ connect: async () => client, announce: () => {} })

        const { rows: after } = await raw.query(
          'select row_no, gross, ctid::text as version from fact.orders order by row_no',
        )
        expect(after[0].gross).toBe('99.90')
        expect(after[1].gross).toBe('20.00')
        // Соседняя строка не просто «та же на вид» — она физически не переписана.
        expect(after[1].version).toBe(before[1].version)
      },
    )
  })

  test('исчезнувшая сырая строка уносит свой факт', async () => {
    await onCraftedRaw(
      async (client) => {
        await minimalRaw(client, {
          orders: [ORDER, { ...ORDER, row_no: 2, order_id: 'NP1002' }],
        })
      },
      async ({ client, raw }) => {
        await buildFacts({ connect: async () => client, announce: () => {} })
        await put(raw, 'orders', [ORDER])
        await buildFacts({ connect: async () => client, announce: () => {} })

        const { rows } = await raw.query('select row_no from fact.orders order by row_no')
        expect(rows.map((r) => r.row_no)).toEqual([1])
      },
    )
  })
})

describe('отказы разбора', () => {
  test('непонятые ячейки называются все разом, а не первая', async () => {
    await onCraftedRaw(
      async (client) => {
        await minimalRaw(client, {
          orders: [{ ...ORDER, date: '1 марта' }],
          opex: [{ row_no: 1, month: 'март', category: 'rent', amount_eur: '950,00' }],
          fx: [{ ...RATE, usd_per_eur: 'полтора' }],
        })
      },
      async ({ client }) => {
        const message = await refusalOf(() =>
          buildFacts({ connect: async () => client, announce: () => {} }),
        )
        expect(message).toContain('1 марта')
        expect(message).toContain('март')
        expect(message).toContain('полтора')
      },
    )
  })

  test('отказ на четвёртой из семи записей не оставляет первых трёх', async () => {
    // Прежняя проверка атомарности пользовалась отказом разбора, а он случается ДО первой
    // записи — покраснеть она не могла в принципе. Здесь работа обрывается посередине
    // записи: если бы сборка закрепляла каждую таблицу отдельно, первые три остались бы.
    await onCraftedRaw(
      async (client) => {
        await minimalRaw(client)
      },
      async ({ client, raw }) => {
        let writes = 0
        const failing: FactsClient = {
          async query(sql: string, params?: unknown[]) {
            if (/select fact\.replace_/.test(sql)) {
              writes += 1
              if (writes === 4) throw new Error('обрыв посередине записи')
            }
            return client.query(sql, params)
          },
          async release() {},
        }

        await expect(
          buildFacts({ connect: async () => failing, announce: () => {} }),
        ).rejects.toThrow(/обрыв посередине записи/)

        const { rows } = await raw.query(
          `select coalesce(sum(n), 0)::int as total from (
             select count(*) as n from fact.orders union all select count(*) from fact.refunds
             union all select count(*) from fact.costs) as первые_три`,
        )
        expect(rows[0].total).toBe(0)
      },
    )
  })

  test('при отказе в слое фактов не появилось ни одной строки', async () => {
    await onCraftedRaw(
      async (client) => {
        await minimalRaw(client, { orders: [{ ...ORDER, date: '1 марта' }] })
      },
      async ({ client, raw }) => {
        await refusalOf(() => buildFacts({ connect: async () => client, announce: () => {} }))
        const { rows } = await raw.query('select count(*)::int as n from fact.orders')
        expect(rows[0].n).toBe(0)
      },
    )
  })
})

describe('противоречия на деловой ключ', () => {
  const cases = [
    {
      name: 'два курса на одну дату',
      craft: { fx: [RATE, { ...RATE, row_no: 2, usd_per_eur: '1.09' }] },
      expect: /2026-03-01/,
    },
    {
      name: 'две цены на артикул и дату',
      craft: {
        costs: [
          { row_no: 1, sku: 'NP-001', cost_eur: '5.10', valid_from: '2026-01-01' },
          { row_no: 2, sku: 'np-001 ', cost_eur: '6.10', valid_from: '01.01.2026' },
        ],
      },
      expect: /NP-001/,
    },
    {
      name: 'две ставки на один способ оплаты',
      craft: { fees: [FEE, { ...FEE, row_no: 2, percent: '2.9' }] },
      expect: /card/,
    },
    {
      name: 'разные способы оплаты в заказе',
      craft: {
        orders: [ORDER, { ...ORDER, row_no: 2, sku: 'NP-002', gateway: 'paypal' }],
        fees: [FEE, { row_no: 2, gateway: 'paypal', percent: '3.4', fixed_eur: '0.35' }],
      },
      expect: /NP1001/,
    },
    {
      name: 'разные даты в заказе',
      craft: {
        orders: [ORDER, { ...ORDER, row_no: 2, sku: 'NP-002', date: '2026-03-02' }],
        fx: [RATE, { row_no: 2, date: '2026-03-02', usd_per_eur: '1.06' }],
      },
      expect: /NP1001/,
    },
  ]

  test.each(cases)('$name — отказ, называющий ключ', async ({ craft, expect: pattern }) => {
    await onCraftedRaw(
      async (client) => {
        await minimalRaw(client, craft)
      },
      async ({ client, raw }) => {
        const message = await refusalOf(() =>
          buildFacts({ connect: async () => client, announce: () => {} }),
        )
        expect(message).toMatch(pattern)
        const { rows } = await raw.query('select count(*)::int as n from fact.orders')
        expect(rows[0].n).toBe(0)
      },
    )
  })

  test('противоречие ищется после приведения артикулов', async () => {
    // До приведения `np-001 ` и `NP-001` — разные строки, и противоречие невидимо.
    await onCraftedRaw(
      async (client) => {
        await minimalRaw(client, {
          costs: [
            { row_no: 1, sku: 'NP-001', cost_eur: '5.10', valid_from: '2026-01-01' },
            { row_no: 2, sku: 'NP‑001', cost_eur: '6.10', valid_from: '2026-01-01' },
          ],
        })
      },
      async ({ client }) => {
        const message = await refusalOf(() =>
          buildFacts({ connect: async () => client, announce: () => {} }),
        )
        expect(message).toMatch(/NP-001/)
      },
    )
  })

  test('две строки расходов на месяц и категорию противоречием не считаются', async () => {
    await onCraftedRaw(
      async (client) => {
        await minimalRaw(client, {
          opex: [
            { row_no: 1, month: '2026-03', category: 'rent', amount_eur: '950,00' },
            { row_no: 2, month: '2026-03', category: 'rent', amount_eur: '50,00' },
          ],
        })
      },
      async ({ client, raw }) => {
        await buildFacts({ connect: async () => client, announce: () => {} })
        const { rows } = await raw.query('select count(*)::int as n from fact.opex')
        expect(rows[0].n).toBe(2)
      },
    )
  })
})

describe('столкновение по площадке, дню и кампании', () => {
  test('строки из разных файлов: отказ называет оба имени и лишнюю выгрузку', async () => {
    await onCraftedRaw(
      async (client) => {
        await minimalRaw(client, {
          ads: [
            AD,
            { ...AD, file_name: 'meta_другая.csv', row_no: 2, spend_usd: '9.80' },
          ],
        })
      },
      async ({ client }) => {
        const message = await refusalOf(() =>
          buildFacts({ connect: async () => client, announce: () => {} }),
        )
        expect(message).toContain('meta_2026-03.csv')
        expect(message).toContain('meta_другая.csv')
        expect(message).toMatch(/лишн|убрать из папки/i)
      },
    )
  })

  test('строки из одного файла: отказ называет файл, день и кампанию, и текст другой', async () => {
    // Две беды с разными действиями человека: убрать файл из папки — или свести строки в
    // выгрузке. Один текст на оба смысла отправил бы человека делать не то.
    const sameFile = await (async () => {
      let message = ''
      await onCraftedRaw(
        async (client) => {
          await minimalRaw(client, { ads: [AD, { ...AD, row_no: 3, spend_usd: '9.80' }] })
        },
        async ({ client }) => {
          message = await refusalOf(() =>
            buildFacts({ connect: async () => client, announce: () => {} }),
          )
        },
      )
      return message
    })()

    expect(sameFile).toContain('meta_2026-03.csv')
    expect(sameFile).toContain('2026-03-01')
    expect(sameFile).toContain('Broad EU')
    expect(sameFile).not.toMatch(/убрать из папки/i)
    expect(sameFile).toMatch(/в одной выгрузке|свести строки/i)
  })
})

describe('ссылки, без которых правила счёта врут молча', () => {
  test('день рекламы без курса — отказ, называющий дату и лист', async () => {
    await onCraftedRaw(
      async (client) => {
        await minimalRaw(client, { ads: [{ ...AD, date: '2026-03-09' }] })
      },
      async ({ client }) => {
        const message = await refusalOf(() =>
          buildFacts({ connect: async () => client, announce: () => {} }),
        )
        expect(message).toContain('2026-03-09')
        expect(message).toContain('fx')
      },
    )
  })

  test('способ оплаты без ставки комиссии — отказ, называющий шлюз и лист', async () => {
    await onCraftedRaw(
      async (client) => {
        await minimalRaw(client, { fees: [{ row_no: 1, gateway: 'paypal', percent: '3.4', fixed_eur: '0.35' }] })
      },
      async ({ client }) => {
        const message = await refusalOf(() =>
          buildFacts({ connect: async () => client, announce: () => {} }),
        )
        expect(message).toContain('card')
        expect(message).toContain('fees')
      },
    )
  })

  test('товар без цены поставщика — не отказ: у неполноты своё правило счёта', async () => {
    await onCraftedRaw(
      async (client) => {
        await minimalRaw(client, {
          orders: [ORDER, { ...ORDER, row_no: 2, sku: 'NP-011' }],
        })
      },
      async ({ client, raw }) => {
        await buildFacts({ connect: async () => client, announce: () => {} })
        const { rows } = await raw.query('select count(*)::int as n from fact.orders')
        expect(rows[0].n).toBe(2)
      },
    )
  })
})

describe('строки-близнецы', () => {
  test('задвоенная до последней колонки строка заказа названа числом и адресом', async () => {
    await onCraftedRaw(
      async (client) => {
        await minimalRaw(client, { orders: [ORDER, { ...ORDER, row_no: 2 }] })
      },
      async ({ client, raw }) => {
        const report = await buildFacts({ connect: async () => client, announce: () => {} })
        const twins = report.twins.find((t) => t.table === 'orders')
        expect(twins?.rows).toBe(2)
        expect(twins?.groups[0].addresses).toEqual([1, 2])

        // Отказа нет: законный случай вообразить можно, и решение остаётся за человеком.
        const { rows } = await raw.query('select count(*)::int as n from fact.orders')
        expect(rows[0].n).toBe(2)
      },
    )
  })

  test('задвоенный возврат назван так же', async () => {
    await onCraftedRaw(
      async (client) => {
        await minimalRaw(client, {
          refunds: [
            { row_no: 1, refund_date: '2026-03-05', order_id: 'NP1001', sku: 'NP-001', units: '1', amount_eur: '10.00' },
            { row_no: 2, refund_date: '05.03.2026', order_id: 'NP1001', sku: 'np-001 ', units: '1', amount_eur: '10,00' },
          ],
        })
      },
      async ({ client }) => {
        const report = await buildFacts({ connect: async () => client, announce: () => {} })
        expect(report.twins.find((t) => t.table === 'refunds')?.rows).toBe(2)
      },
    )
  })

  test('строка, отличающаяся хоть одной колонкой, близнецом не считается', async () => {
    await onCraftedRaw(
      async (client) => {
        await minimalRaw(client, {
          orders: [ORDER, { ...ORDER, row_no: 2, units: '2' }],
        })
      },
      async ({ client }) => {
        const report = await buildFacts({ connect: async () => client, announce: () => {} })
        expect(report.twins.find((t) => t.table === 'orders')?.rows).toBe(0)
      },
    )
  })

  test('ноль близнецов сообщается числом, а не пустым местом', async () => {
    await onCraftedRaw(
      async (client) => {
        await minimalRaw(client)
      },
      async ({ client }) => {
        const report = await buildFacts({ connect: async () => client, announce: () => {} })
        expect(report.twins.map((t) => t.table).sort()).toEqual(['orders', 'refunds'])
        expect(report.twins.every((t) => t.rows === 0)).toBe(true)
      },
    )
  })
})

describe('как сборка обращается с базой', () => {
  test('в сырьё не посылается ни одного оператора записи', async () => {
    await onCraftedRaw(
      async () => {},
      async ({ client, log }) => {
        await buildFacts({ connect: async () => client, announce: () => {} })
        const writes = log.filter((sql) => /^(insert|update|delete|truncate)/i.test(sql))
        expect(writes).toEqual([])
        expect(log.filter((sql) => /raw\.replace_/i.test(sql))).toEqual([])
      },
    )
  })

  test('сырьё читается после открытия транзакции, а не до него', async () => {
    // Проверка читает журнал запросов и потому доказывает только порядок: чтение идёт
    // после открытия транзакции. Того, что все семь чтений видят один и тот же снимок,
    // она не доказывает — это свойство уровня изоляции, и оно проверяется отдельно,
    // вопросом к самой базе («сборка работает на уровне повторяемого чтения»).
    await onCraftedRaw(
      async () => {},
      async ({ client, log }) => {
        await buildFacts({ connect: async () => client, announce: () => {} })
        const begin = log.findIndex((sql) => sql.toLowerCase().startsWith('begin'))
        const firstRead = log.findIndex((sql) => /from raw\./i.test(sql))
        expect(begin).toBeGreaterThanOrEqual(0)
        expect(firstRead).toBeGreaterThan(begin)
      },
    )
  })

  test('деловые ключи проверяются до конца работы, а не в момент фиксации', async () => {
    await onCraftedRaw(
      async () => {},
      async ({ client, log }) => {
        await buildFacts({ connect: async () => client, announce: () => {} })
        expect(log.some((sql) => /set constraints all immediate/i.test(sql))).toBe(true)
      },
    )
  })

  test('цель называется первой строкой, до всякой работы', async () => {
    await onCraftedRaw(
      async () => {},
      async ({ client, log }) => {
        const said: string[] = []
        await buildFacts({ connect: async () => client, announce: (line) => said.push(line) })
        expect(said[0]).toMatch(/цель: local/)
        expect(log).not.toHaveLength(0)
      },
    )
  })
})

describe('снимок сырья', () => {
  test('сборка работает на уровне повторяемого чтения, а не на умолчании', async () => {
    // Проверяется состояние сеанса, а не текст запроса: `show transaction_isolation`
    // спрашивают у самой базы сразу после того, как сборка открыла транзакцию.
    //
    // Зачем это нужно. На уровне по умолчанию каждый оператор видит своё состояние базы,
    // и семь чтений сырья дали бы семь снимков. Загрузка, зафиксированная между первым и
    // седьмым, попала бы в часть таблиц и не попала в остальные — слой фактов собрался бы
    // из двух состояний источника, и по фактам этого не увидеть.
    const client = await pool.connect()
    let level = ''
    try {
      const watching: FactsClient = {
        async query(sql: string, params?: unknown[]) {
          const result = await client.query(sql, params)
          if (sql.trim().toLowerCase().startsWith('begin')) {
            const { rows } = await client.query('show transaction_isolation')
            level = rows[0].transaction_isolation as string
          }
          return result
        },
        async release() {},
      }

      await buildFacts({ connect: async () => watching, announce: () => {} })
      expect(level).toBe('repeatable read')
    } finally {
      for (const table of ['orders', 'refunds', 'costs', 'fees', 'opex', 'fx', 'ads']) {
        await client.query(`delete from fact.${table}`)
      }
      client.release()
    }
  })
})

describe('отказы базы, которые человек может исправить', () => {
  test.each([
    { code: '40001', беда: /источник менялся во время сборки/, что: /повторите разбор/ },
    { code: '40P01', беда: /встали в замок/, что: /повторите разбор/ },
  ])('отказ базы $code переведён на человеческий язык', async ({ code, беда, что }) => {
    // Повторяемое чтение не ставит соперников в очередь: столкнувшись с загрузкой, сборка
    // рвётся ошибкой сериализации. Текст базы человеку не говорит ни что случилось, ни
    // что делать, а контракт этого требует.
    await onCraftedRaw(
      async () => {},
      async ({ client }) => {
        const conflicting: FactsClient = {
          async query(sql: string, params?: unknown[]) {
            if (/select fact\.replace_/.test(sql)) {
              throw Object.assign(new Error('could not serialize access'), { code })
            }
            return client.query(sql, params)
          },
          async release() {},
        }

        const message = await refusalOf(() =>
          buildFacts({ connect: async () => conflicting, announce: () => {} }),
        )
        expect(message).toMatch(беда)
        expect(message).toMatch(что)
        expect(message).not.toMatch(/could not serialize/)
      },
    )
  })
})

describe('боевой путь', () => {
  test('за настоящий прогон сборка не стучится наружу ни разу', async () => {
    // Наблюдение на боевом прогоне: выход наружу перекрыт весь, кроме местной базы.
    // Разбор списка импортов этого не доказывал — реэкспорт, динамический импорт и голый
    // `fetch` он не видел.
    const blocked = blockNetwork({ allowLocalDatabase: true })
    try {
      blocked.proveTrapWorks()
      await buildFacts()
      expect(blocked.knocks).toEqual([])
    } finally {
      blocked.restore()
      for (const table of ['orders', 'refunds', 'costs', 'fees', 'opex', 'fx', 'ads']) {
        await pool.query(`delete from fact.${table}`)
      }
    }
  })

  test('buildFacts() без единого довода работает на настоящей местной базе', async () => {
    // Шов подставляемого соединения нужен проверкам. Если бы его не звали и без доводов,
    // проверялся бы шов, а не то, чем пользуется команда и кнопка на S5.
    //
    // Эта проверка пишет в базу по-настоящему и по-настоящему фиксирует запись — иначе она
    // проверяла бы не боевой путь. Поэтому она же возвращает базу такой, какой её нашла:
    // после посева слой фактов пуст, и три проверки S1 на это опираются. Без возврата они
    // краснели бы — не потому, что S4 сломал поведение, а потому, что проверка S4 оставила
    // за собой строки. Тот же приём и по той же причине, что у живых проверок S2 и S3.
    try {
      const report = await buildFacts()
      expect(report.target).toMatch(/цель: local/)
      expect(report.tables.find((t) => t.table === 'fact.orders')?.written).toBe(4)

      const { rows } = await pool.query('select count(*)::int as n from fact.ads')
      expect(rows[0].n).toBe(4)
    } finally {
      for (const table of ['orders', 'refunds', 'costs', 'fees', 'opex', 'fx', 'ads']) {
        await pool.query(`delete from fact.${table}`)
      }
    }
  })

  // Здесь стояла проверка «после проверок слой фактов оставлен пустым». Она удалена, а не
  // починена, и вот почему. Сперва она читала общее состояние базы и потому зависела от
  // того, какой файл прогона отработал раньше. Переписанная, она стала самоисполнимой:
  // сама звала сборку, сама удаляла все строки слоя фактов и потом утверждала, что их нет.
  // Покраснеть такая проверка может только если сломается `delete`.
  //
  // Проверка, которая не может покраснеть, хуже отсутствующей: она занимает место
  // настоящей и создаёт вид, что место закрыто.
  //
  // Что осталось от утверждения, ради которого она писалась — «боевая проверка возвращает
  // базу такой, какой нашла». Снятая уборка ловится, но **через раз**: две проверки S1
  // спотыкаются о чужие строки в слое фактов, только если их файл отработает после этого.
  // Порядок файлов vitest берёт из кэша длительностей, и он меняется. Проверено обоими
  // исходами: в одном прогоне набор остался зелёным, в двух других покраснели те самые две
  // проверки S1 — и покраснели чужим красным, по которому причину не найти.
  //
  // То есть сторож есть, но случайный. Это записано отложенной задачей в теле pull request.
})
