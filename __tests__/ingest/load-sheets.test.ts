import type { PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SHEETS } from '@/lib/ingest/sheet-rows'
import type { SheetValues } from '@/lib/ingest/sheets-source'
import { ingestSheets, type IngestClient } from '@/lib/ingest/load-sheets'

import { inRollback, pool } from '../db/support'

afterAll(() => pool.end())

let savedTarget: string | undefined
beforeAll(() => {
  savedTarget = process.env.NORDIC_PET_DB_TARGET
  process.env.NORDIC_PET_DB_TARGET = 'local'
})
afterAll(() => {
  if (savedTarget === undefined) delete process.env.NORDIC_PET_DB_TARGET
  else process.env.NORDIC_PET_DB_TARGET = savedTarget
})

/** Значения шести листов, как их отдал бы Google: заголовок и строки данных. */
function spreadsheet(patch: SheetValues = {}): SheetValues {
  const base: SheetValues = {
    orders: [
      ['date', 'order_id', 'sku', 'units', 'gross_eur', 'discount_eur', 'gateway'],
      ['01.03.2026', 'ПРОВЕРКА-1', 'NP-001', '1', '24,90', '', 'stripe'],
      ['2026-03-02', 'ПРОВЕРКА-2', 'np-003 ', '2', '51,80', '5,00', 'paypal'],
    ],
    refunds: [
      ['refund_date', 'order_id', 'sku', 'units', 'amount_eur'],
      ['05.03.2026', 'ПРОВЕРКА-1', 'NP-001', '1', '24,90'],
    ],
    costs: [
      ['sku', 'cost_eur', 'valid_from'],
      ['NP-001', '9,10', '01.01.2026'],
      ['NP‑003', '', '01.02.2026'],
    ],
    fees: [
      ['gateway', 'percent', 'fixed_eur'],
      ['stripe', '1,4', '0,25'],
    ],
    opex: [
      ['month', 'category', 'amount_eur'],
      ['2026-03', 'аренда', '1 234,50'],
    ],
    fx: [
      ['date', 'usd_per_eur'],
      ['01.03.2026', '1,0850'],
    ],
  }
  return { ...base, ...patch }
}

type Run = {
  journal: string[]
  statements: string[]
}

/**
 * Прогоняет загрузчик на живой локальной базе внутри чужой транзакции.
 *
 * Управление транзакцией загрузчика переводится в точки сохранения: сама транзакция
 * снаружи и будет откачена, а `begin`/`commit`/`rollback` внутри неё Postgres не даёт.
 * В журнал при этом записывается то, что загрузчик **попросил**, а не то, во что мы это
 * перевели, — иначе наблюдение за операторами смотрело бы на себя.
 */
async function run(
  client: PoolClient,
  values: SheetValues,
  options: { failOnCall?: number } = {},
): Promise<Run & { report: Awaited<ReturnType<typeof ingestSheets>> }> {
  const journal: string[] = []
  let replaceCalls = 0
  let connected = 0

  const ingestClient: IngestClient = {
    query: async (sql, params) => {
      journal.push(sql)
      const text = sql.trim().toLowerCase()
      if (text.startsWith('select raw.replace_')) {
        replaceCalls += 1
        if (options.failOnCall === replaceCalls) throw new Error('соединение оборвалось')
      }
      if (text === 'begin') return client.query('savepoint sp_ingest')
      if (text === 'commit') return client.query('release savepoint sp_ingest')
      if (text === 'rollback') return client.query('rollback to savepoint sp_ingest')
      return client.query(sql, params)
    },
    release: async () => {},
  }

  const report = await ingestSheets({
    readSpreadsheet: async () => values,
    connect: async () => {
      connected += 1
      journal.push(`соединение №${connected}`)
      return ingestClient
    },
    announce: (line) => journal.push(line),
  })

  return {
    report,
    journal,
    statements: journal.filter((line) => !line.startsWith('цель:') && !line.startsWith('соединение')),
  }
}

/**
 * Что загрузчику позволено посылать в базу: границы транзакции, запись снимка и счётчики.
 * Образец закрыт с обоих концов — иначе к разрешённому началу дописывается что угодно.
 */
const ALLOWED =
  /^(begin|commit|rollback|select raw\.replace_[a-z_]+\(\$1::jsonb\)|select count\(\*\)::int as rows, max\(updated_at\)::text as last_change from raw\.[a-z_]+)$/i

const isAllowed = (sql: string) => ALLOWED.test(sql.trim())

/** Содержимое таблицы целиком, включая updated_at, — сравнимой строкой. */
async function contents(client: PoolClient, table: string): Promise<string> {
  const { rows } = await client.query(
    `select to_jsonb(t) as row from ${table} t order by to_jsonb(t)::text`,
  )
  return JSON.stringify(rows)
}

describe('загрузка шести листов', () => {
  it('кладёт каждый лист в свою сырую таблицу, не тронув значений', async () => {
    await inRollback(async (client) => {
      await run(client, spreadsheet())

      const { rows } = await client.query('select * from raw.orders order by row_no')
      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({
        row_no: 2,
        date: '01.03.2026',
        order_id: 'ПРОВЕРКА-1',
        sku: 'NP-001',
        discount_eur: '',
      })
      // Кривизна доехала посимвольно: хвостовой пробел и неразрывный дефис на месте.
      expect(rows[1].sku).toBe('np-003 ')
      const costs = await client.query('select sku from raw.costs order by row_no')
      expect(costs.rows[1].sku).toBe('NP‑003')
      const opex = await client.query('select amount_eur from raw.opex order by row_no')
      expect(opex.rows[0].amount_eur).toBe('1 234,50')
    })
  })

  it('адреса строк — номера строк листа, начиная со второй', async () => {
    await inRollback(async (client) => {
      await run(client, spreadsheet())
      const { rows } = await client.query('select row_no from raw.orders order by row_no')
      expect(rows.map((r) => r.row_no)).toEqual([2, 3])
    })
  })

  it('не трогает соседнюю таблицу, которую не грузит', async () => {
    await inRollback(async (client) => {
      const before = await contents(client, 'raw.ads')
      await run(client, spreadsheet())
      expect(await contents(client, 'raw.ads')).toBe(before)
    })
  })
})

describe('повторный прогон ничего не меняет', () => {
  it('содержимое таблиц совпадает целиком, включая updated_at', async () => {
    await inRollback(async (client) => {
      const values = spreadsheet()
      await run(client, values)

      const after = new Map<string, string>()
      for (const sheet of SHEETS) after.set(sheet.table, await contents(client, sheet.table))

      await run(client, values)

      for (const sheet of SHEETS) {
        expect(await contents(client, sheet.table), `таблица ${sheet.table}`).toBe(
          after.get(sheet.table),
        )
      }
    })
  })

  it('исчезнувшая из листа строка исчезает и из таблицы', async () => {
    await inRollback(async (client) => {
      await run(client, spreadsheet())
      expect((await client.query('select * from raw.orders')).rowCount).toBe(2)

      const shorter = spreadsheet({
        orders: [
          ['date', 'order_id', 'sku', 'units', 'gross_eur', 'discount_eur', 'gateway'],
          ['01.03.2026', 'ПРОВЕРКА-1', 'NP-001', '1', '24,90', '', 'stripe'],
        ],
      })
      await run(client, shorter)

      const { rows } = await client.query('select order_id from raw.orders')
      expect(rows.map((r) => r.order_id)).toEqual(['ПРОВЕРКА-1'])
    })
  })
})

describe('снимок применяется целиком или никак', () => {
  it('обрыв на четвёртом листе не оставляет в базе первых трёх', async () => {
    await inRollback(async (client) => {
      const before = new Map<string, string>()
      for (const sheet of SHEETS) before.set(sheet.table, await contents(client, sheet.table))

      await expect(run(client, spreadsheet(), { failOnCall: 4 })).rejects.toThrow()

      for (const sheet of SHEETS) {
        expect(await contents(client, sheet.table), `таблица ${sheet.table}`).toBe(
          before.get(sheet.table),
        )
      }
    })
  })

  it('ошибка разбора случается до базы: соединение не открывается', async () => {
    const broken = spreadsheet({
      costs: [['sku', 'valid_from'], ['NP-001', '01.01.2026']],
    })
    let connected = false
    await expect(
      ingestSheets({
        readSpreadsheet: async () => broken,
        connect: async () => {
          connected = true
          throw new Error('соединяться было незачем')
        },
        announce: () => {},
      }),
    ).rejects.toThrow(/costs/)
    expect(connected).toBe(false)
  })
})

describe('загрузчик посылает только то, что должен', () => {
  it('ни одного оператора, кроме записи снимка, счётчиков и границ транзакции', async () => {
    await inRollback(async (client) => {
      const { statements } = await run(client, spreadsheet())
      expect(statements.filter((sql) => !isAllowed(sql))).toEqual([])
    })
  })

  /**
   * Сам образец тоже проверяется, и вот почему. Сначала он был закрыт только с начала
   * строки — и дописанный через точку с запятой второй оператор проходил насквозь.
   * Проверено запуском: один вызов query исполняет оба оператора, если параметров нет.
   */
  it.each([
    ['дописанный через точку с запятой', 'select count(*) from raw.orders; drop table raw.orders'],
    ['дописанный к записи снимка', 'select raw.replace_orders($1::jsonb); delete from raw.fx'],
    ['спрятанный за переносом строки', 'begin;\ndrop schema raw cascade'],
    ['посторонний', 'delete from raw.orders'],
  ])('образец не пропускает оператор, %s', (_name, sql) => {
    expect(isAllowed(sql)).toBe(false)
  })

  it('в базу уходит шесть вызовов записи снимка — по одному на лист', async () => {
    await inRollback(async (client) => {
      const { statements } = await run(client, spreadsheet())
      const calls = statements.filter((sql) => sql.trim().toLowerCase().startsWith('select raw.'))
      expect(calls).toHaveLength(6)
      for (const sheet of SHEETS) {
        expect(calls.some((sql) => sql.includes(sheet.fn)), sheet.fn).toBe(true)
      }
    })
  })

  it('снимок листа передаётся одним куском, а не порциями', async () => {
    await inRollback(async (client) => {
      const { statements } = await run(client, spreadsheet())
      const orders = statements.filter((sql) => sql.includes('replace_orders'))
      expect(orders).toHaveLength(1)
    })
  })

  it('границы транзакции стоят вокруг всех шести листов', async () => {
    await inRollback(async (client) => {
      const { statements } = await run(client, spreadsheet())
      expect(statements[0].trim().toLowerCase()).toBe('begin')
      expect(statements.at(-1)?.trim().toLowerCase()).toBe('commit')
    })
  })
})

describe('отчёт загрузчика', () => {
  it('первой строкой называет, куда пишет, — до соединения с базой', async () => {
    await inRollback(async (client) => {
      const { journal } = await run(client, spreadsheet())
      expect(journal[0]).toContain('цель: local')
      expect(journal[0]).toContain('nordic_pet')
      expect(journal[1]).toContain('соединение')
    })
  })

  it('по каждому листу — сколько прочитано, записано и пропущено', async () => {
    await inRollback(async (client) => {
      const values = spreadsheet({
        orders: [
          ['date', 'order_id', 'sku', 'units', 'gross_eur', 'discount_eur', 'gateway'],
          ['01.03.2026', 'ПРОВЕРКА-1', 'NP-001', '1', '24,90', '', 'stripe'],
          [],
          ['02.03.2026', 'ПРОВЕРКА-3', 'NP-002', '1', '10,00', '', 'stripe'],
        ],
      })
      const { report } = await run(client, values)
      const orders = report.sheets.find((s) => s.sheet === 'orders')
      expect(orders).toMatchObject({ rowsRead: 3, rowsWritten: 2, rowsSkipped: 1 })
    })
  })

  it('лишний столбец назван вслух, а загрузка не остановлена', async () => {
    await inRollback(async (client) => {
      const values = spreadsheet({
        opex: [
          ['month', 'category', 'amount_eur', 'заметка'],
          ['2026-03', 'аренда', '1 234,50', 'перезвонить'],
        ],
      })
      const { report } = await run(client, values)
      expect(report.sheets.find((s) => s.sheet === 'opex')?.extraColumns).toEqual(['заметка'])
      expect((await client.query('select * from raw.opex')).rowCount).toBe(1)
    })
  })

  it('по каждой таблице — количество строк и время последнего изменения', async () => {
    await inRollback(async (client) => {
      const { report } = await run(client, spreadsheet())
      const orders = report.counts.find((c) => c.table === 'raw.orders')
      expect(orders?.rows).toBe(2)
      expect(orders?.lastChange).toBeTruthy()
      expect(report.counts.map((c) => c.table)).toEqual(SHEETS.map((s) => s.table))
    })
  })
})
