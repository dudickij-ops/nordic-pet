import type { PoolClient } from 'pg'
import { afterAll, expect, test } from 'vitest'

import { inRollback, pool } from './support'

afterAll(() => pool.end())

const RAW_TABLES = ['orders', 'refunds', 'costs', 'fees', 'opex', 'fx', 'ads'] as const

/** Имя дубликата: пробел и скобки внутри. Ровно так его назвал человек, кладя файл руками. */
const DUPLICATE_FILE = 'meta_2026-03 (1).csv'

/**
 * Папка ads-exports целиком. Два файла meta совпадают содержимым посимвольно
 * и различаются только именем: на этом S3 будет опознавать дубликат, поэтому
 * сырой слой обязан довезти оба, не потеряв ни строки.
 */
const wholeFolder = [
  { file_name: 'meta_2026-03.csv', row_no: 1, date: '2026-03-01', campaign: 'spring', spend_usd: '10.00' },
  { file_name: 'meta_2026-03.csv', row_no: 2, date: '2026-03-02', campaign: 'spring', spend_usd: '12.50' },
  { file_name: DUPLICATE_FILE, row_no: 1, date: '2026-03-01', campaign: 'spring', spend_usd: '10.00' },
  { file_name: DUPLICATE_FILE, row_no: 2, date: '2026-03-02', campaign: 'spring', spend_usd: '12.50' },
  { file_name: 'google_2026-03.csv', row_no: 1, date: '2026-03-01', campaign: 'search', spend_usd: '20.00' },
  { file_name: 'pinterest_2026-03.csv', row_no: 1, date: '2026-03-01', campaign: 'pins', spend_usd: '3.10' },
]

const snapshot = (rows: unknown[]) => JSON.stringify(rows)

async function rawCounts(client: PoolClient): Promise<Record<string, number>> {
  const { rows } = await client.query(
    RAW_TABLES.map((t) => `select '${t}' as name, count(*)::int as n from raw.${t}`).join(
      ' union all ',
    ),
  )
  return Object.fromEntries(rows.map((r) => [r.name, r.n]))
}

async function fillEveryRawTable(client: PoolClient): Promise<void> {
  await client.query(`
    insert into raw.orders  (row_no, order_id) values (91, 'сосед'), (92, 'сосед');
    insert into raw.refunds (row_no, order_id) values (91, 'сосед'), (92, 'сосед');
    insert into raw.costs   (row_no, sku)      values (91, 'сосед'), (92, 'сосед');
    insert into raw.fees    (row_no, gateway)  values (91, 'сосед'), (92, 'сосед');
    insert into raw.opex    (row_no, category) values (91, 'сосед'), (92, 'сосед');
    insert into raw.fx      (row_no, date)     values (91, 'сосед'), (92, 'сосед');
  `)
}

test('вся папка записывается: шесть строк из четырёх файлов', async () => {
  await inRollback(async (client) => {
    await client.query('select raw.replace_entire_ads_folder($1::jsonb)', [snapshot(wholeFolder)])

    const { rows } = await client.query(
      'select file_name, count(*)::int as n from raw.ads group by file_name order by file_name',
    )
    expect(rows).toEqual([
      { file_name: 'google_2026-03.csv', n: 1 },
      { file_name: DUPLICATE_FILE, n: 2 },
      { file_name: 'meta_2026-03.csv', n: 2 },
      { file_name: 'pinterest_2026-03.csv', n: 1 },
    ])
  })
})

// Дубликат опознаётся по содержимому, а не по имени: имя со скобкой — совпадение.
// Значит сырой слой обязан довезти обе выгрузки целиком, чтобы S3 было что сравнивать.
test('оба файла meta доезжают целиком, ни одна строка не потеряна', async () => {
  await inRollback(async (client) => {
    await client.query('select raw.replace_entire_ads_folder($1::jsonb)', [snapshot(wholeFolder)])

    const { rows: difference } = await client.query(
      `select date, campaign, spend_usd, row_no from raw.ads where file_name = $1
       except
       select date, campaign, spend_usd, row_no from raw.ads where file_name = $2`,
      ['meta_2026-03.csv', DUPLICATE_FILE],
    )
    // содержимое обеих выгрузок совпадает построчно — различаются только имена файлов
    expect(difference).toEqual([])

    const { rows: counts } = await client.query(
      `select count(*)::int as n from raw.ads where file_name in ($1, $2)`,
      ['meta_2026-03.csv', DUPLICATE_FILE],
    )
    expect(counts[0].n).toBe(4)
  })
})

test('имя файла с пробелом и скобками доезжает посимвольно и читается обратно', async () => {
  await inRollback(async (client) => {
    await client.query('select raw.replace_entire_ads_folder($1::jsonb)', [snapshot(wholeFolder)])

    const { rows } = await client.query('select file_name from raw.ads where file_name = $1', [
      DUPLICATE_FILE,
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0].file_name).toBe(DUPLICATE_FILE)
    // ни обрезки, ни схлопывания пробела, ни потери скобок
    expect(rows[0].file_name).toHaveLength(DUPLICATE_FILE.length)
  })
})

test('тот же снимок папки дважды подряд не меняет ни одного байта', async () => {
  await inRollback(async (client) => {
    await client.query('select raw.replace_entire_ads_folder($1::jsonb)', [snapshot(wholeFolder)])
    await client.query('create temporary table before_state on commit drop as table raw.ads')

    await client.query('select raw.replace_entire_ads_folder($1::jsonb)', [snapshot(wholeFolder)])

    const { rows: difference } = await client.query(
      `select 'пропало' as side, file_name, row_no from (table before_state except table raw.ads) a
       union all
       select 'появилось', file_name, row_no from (table raw.ads except table before_state) b
       order by 1, 2, 3`,
    )
    expect(difference).toEqual([])
  })
})

// Область подчистки — вся папка. Иначе исчезнувший из папки файл остался бы в базе
// навсегда: его строк нет ни в одном снимке, и удалить их было бы некому.
test('исчезнувший из папки файл уносит с собой все свои строки', async () => {
  await inRollback(async (client) => {
    await client.query('select raw.replace_entire_ads_folder($1::jsonb)', [snapshot(wholeFolder)])

    const withoutDuplicate = wholeFolder.filter((r) => r.file_name !== DUPLICATE_FILE)
    await client.query('select raw.replace_entire_ads_folder($1::jsonb)', [
      snapshot(withoutDuplicate),
    ])

    const { rows } = await client.query(
      'select distinct file_name from raw.ads order by file_name',
    )
    expect(rows.map((r) => r.file_name)).toEqual([
      'google_2026-03.csv',
      'meta_2026-03.csv',
      'pinterest_2026-03.csv',
    ])
  })
})

test('строка, исчезнувшая внутри файла, исчезает из таблицы', async () => {
  await inRollback(async (client) => {
    await client.query('select raw.replace_entire_ads_folder($1::jsonb)', [snapshot(wholeFolder)])

    const shorter = wholeFolder.filter(
      (r) => !(r.file_name === 'meta_2026-03.csv' && r.row_no === 2),
    )
    await client.query('select raw.replace_entire_ads_folder($1::jsonb)', [snapshot(shorter)])

    const { rows } = await client.query(
      'select row_no from raw.ads where file_name = $1 order by row_no',
      ['meta_2026-03.csv'],
    )
    expect(rows.map((r) => r.row_no)).toEqual([1])
  })
})

test('пишет в свою таблицу и не трогает соседние', async () => {
  await inRollback(async (client) => {
    await fillEveryRawTable(client)
    const before = await rawCounts(client)

    await client.query('select raw.replace_entire_ads_folder($1::jsonb)', [snapshot(wholeFolder)])

    const after = await rawCounts(client)
    expect(after).toEqual({ ...before, ads: wholeFolder.length })
  })
})

test('пустой снимок отвергается, и отказ предупреждает про папку целиком', async () => {
  // Один отказ, два утверждения о нём: упавший оператор рвёт транзакцию целиком,
  // и второй запрос в ней получил бы «транзакция прервана» вместо своего сообщения.
  const error = await inRollback(async (client) => {
    try {
      await client.query(`select raw.replace_entire_ads_folder('[]'::jsonb)`)
    } catch (caught) {
      return caught as Error & { hint?: string }
    }
    return null
  })

  expect(error).not.toBeNull()
  expect(error?.message).toMatch(/пустой снимок источника для raw\.ads/)
  // читающий S3 наткнётся на предупреждение раньше, чем на ошибку
  expect(`${error?.message} ${error?.hint ?? ''}`).toMatch(/папк/)
})
