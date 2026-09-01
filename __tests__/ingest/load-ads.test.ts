import type { PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { FolderSnapshot } from '@/lib/ingest/drive-source'
import { ingestAdsFolder, type IngestClient } from '@/lib/ingest/load-ads'

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

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

const HEADER = 'date,campaign,spend_usd'
const DUPLICATE = 'meta_2026-03 (1).csv'

/**
 * Папка `ads-exports`, как её отдаёт чтение Диска: четыре файла, из них два `meta`
 * с одинаковым содержимым и разными концами строк. Ровно то устройство, что на Диске.
 */
function folder(over: Partial<Record<string, string>> = {}): FolderSnapshot {
  const meta = `${HEADER}\r\n2026-03-01,Prospecting DE,30.51\r\n2026-03-02,Broad EU,40.40\r\n`
  const contents: Record<string, string> = {
    'google_2026-03.csv': `${HEADER}\r\n2026-03-01,Brand,19.26\r\n`,
    [DUPLICATE]: meta.replaceAll('\r\n', '\n'),
    'meta_2026-03.csv': meta,
    'pinterest_2026-03.csv': `${HEADER}\r\n2026-03-01,Winter coats,14.61\r\n`,
    ...over,
  }
  return {
    files: Object.entries(contents)
      .filter(([, text]) => text !== undefined)
      .map(([name, text]) => ({ name, bytes: bytes(text as string) })),
    skipped: [],
  }
}

type Run = {
  journal: string[]
  statements: string[]
  report: Awaited<ReturnType<typeof ingestAdsFolder>>
}

/**
 * Прогоняет загрузчик на живой локальной базе внутри чужой транзакции.
 *
 * Управление транзакцией загрузчика переводится в точки сохранения: сама транзакция
 * снаружи и будет откачена, а `begin`/`commit` внутри неё Postgres не даёт. В журнал
 * записывается то, что загрузчик **попросил**, а не то, во что мы это перевели, —
 * иначе наблюдение за операторами смотрело бы на себя.
 */
async function run(
  client: PoolClient,
  snapshot: FolderSnapshot,
  onConnect?: () => void,
): Promise<Run> {
  const journal: string[] = []
  let connected = 0

  const ingestClient: IngestClient = {
    query: async (sql, params) => {
      journal.push(sql)
      const text = sql.trim().toLowerCase()
      if (text === 'begin') return client.query('savepoint sp_ads')
      if (text === 'commit') return client.query('release savepoint sp_ads')
      if (text === 'rollback') return client.query('rollback to savepoint sp_ads')
      return client.query(sql, params)
    },
    release: async () => {},
  }

  const report = await ingestAdsFolder({
    readFolder: async () => snapshot,
    connect: async () => {
      connected += 1
      journal.push(`соединение №${connected}`)
      onConnect?.()
      return ingestClient
    },
    announce: (line) => journal.push(line),
  })

  return {
    report,
    journal,
    statements: journal.filter(
      (line) => !line.startsWith('цель:') && !line.startsWith('соединение'),
    ),
  }
}

/**
 * Что загрузчику позволено посылать в базу: границы транзакции, один вызов записи снимка
 * и счётчики. Образец закрыт с обоих концов — иначе к разрешённому началу дописывается
 * что угодно.
 */
const ALLOWED =
  /^(begin|commit|rollback|select raw\.replace_entire_ads_folder\(\$1::jsonb\)|select count\(\*\)::int as rows, max\(updated_at\)::text as last_change from raw\.ads)$/i

/** Содержимое таблицы целиком, включая updated_at, — сравнимой строкой. */
async function contents(client: PoolClient, table: string): Promise<string> {
  const { rows } = await client.query(
    `select to_jsonb(t) as row from ${table} t order by to_jsonb(t)::text`,
  )
  return JSON.stringify(rows)
}

describe('загрузка папки', () => {
  it('кладёт строки всех четырёх файлов в raw.ads', async () => {
    await inRollback(async (client) => {
      await run(client, folder())

      const { rows } = await client.query(
        'select file_name, count(*)::int as n from raw.ads group by file_name order by file_name',
      )
      expect(rows).toEqual([
        { file_name: 'google_2026-03.csv', n: 1 },
        { file_name: DUPLICATE, n: 2 },
        { file_name: 'meta_2026-03.csv', n: 2 },
        { file_name: 'pinterest_2026-03.csv', n: 1 },
      ])
    })
  })

  /**
   * Обязательство контракта S1: снимок приходит по всей папке разом. Вызов на файл
   * стёр бы строки остальных площадок, и функция была бы права — отличить снимок одного
   * файла от снимка папки ей нечем.
   */
  it('зовёт функцию записи ровно один раз', async () => {
    await inRollback(async (client) => {
      const { statements } = await run(client, folder())
      const calls = statements.filter((sql) => /replace_entire_ads_folder/i.test(sql))
      expect(calls).toHaveLength(1)
    })
  })

  it('посылает в базу только то, что ей положено посылать', async () => {
    await inRollback(async (client) => {
      const { statements } = await run(client, folder())
      expect(statements.filter((sql) => !ALLOWED.test(sql.trim()))).toEqual([])
    })
  })

  it('не трогает сырые таблицы Таблицы', async () => {
    await inRollback(async (client) => {
      const before = await contents(client, 'raw.orders')
      await run(client, folder())
      expect(await contents(client, 'raw.orders')).toBe(before)
    })
  })

  /**
   * Дедупликации в S3 нет. Сырой слой повторяет источник как есть: обе выгрузки `meta`
   * ложатся целиком, и выбор лишней — работа S4.
   */
  it('обе выгрузки meta ложатся целиком, ни одна строка не отброшена', async () => {
    await inRollback(async (client) => {
      await run(client, folder())

      for (const name of ['meta_2026-03.csv', DUPLICATE]) {
        const { rows } = await client.query(
          'select row_no, date, campaign, spend_usd from raw.ads where file_name = $1 order by row_no',
          [name],
        )
        expect(rows, `выгрузка ${name} доехала не целиком`).toEqual([
          { row_no: 2, date: '2026-03-01', campaign: 'Prospecting DE', spend_usd: '30.51' },
          { row_no: 3, date: '2026-03-02', campaign: 'Broad EU', spend_usd: '40.40' },
        ])
      }
    })
  })

  it('имя файла со скобками и пробелом доезжает посимвольно', async () => {
    await inRollback(async (client) => {
      await run(client, folder())
      const { rows } = await client.query('select file_name from raw.ads where file_name = $1', [
        DUPLICATE,
      ])
      expect(rows).toHaveLength(2)
      expect(rows[0].file_name).toBe('meta_2026-03 (1).csv')
    })
  })

  it('адреса строк — номера строк файла, начиная со второй', async () => {
    await inRollback(async (client) => {
      await run(client, folder())
      const { rows } = await client.query(
        'select row_no from raw.ads where file_name = $1 order by row_no',
        ['meta_2026-03.csv'],
      )
      expect(rows.map((row) => row.row_no)).toEqual([2, 3])
    })
  })
})

describe('повторный прогон ничего не меняет', () => {
  it('содержимое raw.ads совпадает целиком, включая updated_at', async () => {
    await inRollback(async (client) => {
      const snapshot = folder()
      await run(client, snapshot)
      const after = await contents(client, 'raw.ads')

      await run(client, folder())

      expect(await contents(client, 'raw.ads')).toBe(after)
    })
  })

  it('исчезнувший из папки файл уносит свои строки', async () => {
    await inRollback(async (client) => {
      await run(client, folder())
      await run(client, folder({ [DUPLICATE]: undefined }))

      const { rows } = await client.query('select distinct file_name from raw.ads order by file_name')
      expect(rows.map((row) => row.file_name)).toEqual([
        'google_2026-03.csv',
        'meta_2026-03.csv',
        'pinterest_2026-03.csv',
      ])
    })
  })
})

describe('отказы случаются до базы', () => {
  it('файл без строк данных останавливает загрузку, и соединение не открывается', async () => {
    await inRollback(async (client) => {
      let connected = false
      await expect(
        run(client, folder({ 'pinterest_2026-03.csv': `${HEADER}\r\n` }), () => {
          connected = true
        }),
      ).rejects.toThrow(/pinterest_2026-03\.csv/)
      expect(connected, 'до базы дошли, хотя разбор не удался').toBe(false)
    })
  })

  it('пропавший столбец останавливает загрузку целиком, а не один файл', async () => {
    await inRollback(async (client) => {
      const before = await contents(client, 'raw.ads')
      await expect(
        run(client, folder({ 'google_2026-03.csv': 'date,campaign\r\n2026-03-01,Brand\r\n' })),
      ).rejects.toThrow(/spend_usd/)
      expect(await contents(client, 'raw.ads')).toBe(before)
    })
  })
})

describe('отчёт', () => {
  it('называет по файлу байты, прочитанное и записанное', async () => {
    await inRollback(async (client) => {
      const { report } = await run(client, folder())

      const meta = report.files.find((file) => file.file === 'meta_2026-03.csv')
      expect(meta).toMatchObject({ rowsRead: 2, rowsWritten: 2, rowsSkipped: 0, extraColumns: [] })
      // Байты — единственное число отчёта, которое сверяют с посчитанным мимо нашего кода.
      expect(meta?.bytes).toBe(
        bytes(`${HEADER}\r\n2026-03-01,Prospecting DE,30.51\r\n2026-03-02,Broad EU,40.40\r\n`).length,
      )
    })
  })

  it('называет пропущенные файлы папки', async () => {
    await inRollback(async (client) => {
      const snapshot = { ...folder(), skipped: ['заметки.txt'] }
      const { report } = await run(client, snapshot)
      expect(report.skipped).toEqual(['заметки.txt'])
    })
  })

  it('называет цель до всякой работы, первой строкой', async () => {
    await inRollback(async (client) => {
      const { journal } = await run(client, folder())
      expect(journal[0]).toMatch(/^цель: local, база nordic_pet/)
    })
  })

  it('отдаёт количество строк и время последнего изменения по raw.ads', async () => {
    await inRollback(async (client) => {
      const { report } = await run(client, folder())
      expect(report.counts).toEqual([
        { table: 'raw.ads', rows: 6, lastChange: expect.any(String) },
      ])
    })
  })
})
