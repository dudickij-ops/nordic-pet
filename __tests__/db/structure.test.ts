import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, expect, test } from 'vitest'
import { pool, rows } from './support'

afterAll(() => pool.end())

test('роли Supabase заведены — без них на S6 нечем закрыть доступ', async () => {
  const found = await rows<{ rolname: string }>(
    `select rolname from pg_roles
      where rolname in ('anon', 'authenticated', 'service_role')
      order by rolname`,
  )
  expect(found.map((r) => r.rolname)).toEqual(['anon', 'authenticated', 'service_role'])
})

test('схемы raw и fact существуют, схемы dev не существует', async () => {
  const found = await rows<{ nspname: string }>(
    `select nspname from pg_namespace
      where nspname in ('raw', 'fact', 'dev') order by nspname`,
  )
  expect(found.map((r) => r.nspname)).toEqual(['fact', 'raw'])
})

test('в схеме raw ровно семь таблиц источника', async () => {
  const found = await rows<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'raw' order by tablename`,
  )
  expect(found.map((r) => r.tablename)).toEqual([
    'ads',
    'costs',
    'fees',
    'fx',
    'opex',
    'orders',
    'refunds',
  ])
})

test('сырой слой не чинит источник: все его колонки — текст', async () => {
  const wrongTypes = await rows(
    `select table_name || '.' || column_name as "место", data_type as "тип"
       from information_schema.columns
      where table_schema = 'raw'
        and column_name not in ('row_no', 'file_name', 'updated_at')
        and data_type <> 'text'
      order by 1`,
  )
  expect(wrongTypes).toEqual([])
})

/**
 * Заголовки листов и файлов рекламы, прочитанные из источника. Закреплены здесь потому,
 * что без этого согласованное переименование колонки — в миграции, функции, посеве и
 * проверке разом — остаётся незамеченным: проверка и проверяемый код повторили бы одну
 * ошибку. Всплыло бы это на S2, когда загрузчик пойдёт по настоящим заголовкам.
 */
const SOURCE_COLUMNS: Record<string, string[]> = {
  orders: ['date', 'order_id', 'sku', 'units', 'gross_eur', 'discount_eur', 'gateway'],
  refunds: ['refund_date', 'order_id', 'sku', 'units', 'amount_eur'],
  costs: ['sku', 'cost_eur', 'valid_from'],
  fees: ['gateway', 'percent', 'fixed_eur'],
  opex: ['month', 'category', 'amount_eur'],
  fx: ['date', 'usd_per_eur'],
  ads: ['date', 'campaign', 'spend_usd'],
}

test.each(Object.entries(SOURCE_COLUMNS))(
  'raw.%s повторяет заголовки источника колонка в колонку',
  async (table, expected) => {
    const found = await rows<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'raw' and table_name = $1
          and column_name not in ('row_no', 'file_name', 'updated_at')
        order by ordinal_position`,
      [table],
    )
    expect(found.map((r) => r.column_name)).toEqual(expected)
  },
)

test('адрес строки — это первичный ключ, а не соглашение', async () => {
  const keys = await rows<{ table_name: string; columns: string }>(
    `select c.relname as table_name,
            string_agg(a.attname, ',' order by k.ord) as columns
       from pg_constraint con
       join pg_class c on c.oid = con.conrelid
       join pg_namespace n on n.oid = c.relnamespace
       cross join lateral unnest(con.conkey) with ordinality as k(attnum, ord)
       join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
      where n.nspname = 'raw' and con.contype = 'p'
      group by c.relname
      order by c.relname`,
  )
  expect(Object.fromEntries(keys.map((r) => [r.table_name, r.columns]))).toEqual({
    ads: 'file_name,row_no',
    costs: 'row_no',
    fees: 'row_no',
    fx: 'row_no',
    opex: 'row_no',
    orders: 'row_no',
    refunds: 'row_no',
  })
})

/**
 * Роли живут в кластере, а не в базе, и пересоздание базы их не сносит. Значит на машине,
 * где они однажды завелись, вырезание их из миграции осталось бы незамеченным, а покраснело
 * бы только на чистом кластере — то есть в ci. Поэтому здесь сторожится сама миграция.
 */
test('заведение ролей стоит в миграции, а не только в кластере', () => {
  const migrations = join(process.cwd(), 'supabase', 'migrations')
  const text = readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(join(migrations, name), 'utf8'))
    .join('\n')
    // закомментированная строка — не код: без этого заведение ролей можно было бы
    // отключить, оставив проверку зелёной
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  for (const role of ['anon', 'authenticated', 'service_role']) {
    expect(text).toMatch(new RegExp(`create role ${role}\\b`, 'i'))
  }
})

/**
 * Утверждение «схемы raw и fact наружу не выставлены» держится на составе [api] schemas:
 * PostgREST локально не запускается, живым запросом это не проверить. Значит сторожить
 * надо сам список — иначе допиши в него "raw", и не покраснеет никто.
 */
test('схемы данных не выставлены наружу через API', () => {
  const config = readFileSync(join(process.cwd(), 'supabase', 'config.toml'), 'utf8')
  const line = config.split('\n').find((l) => l.trim().startsWith('schemas ='))
  expect(line).toBeDefined()
  for (const schema of ['raw', 'fact', 'dev']) {
    expect(line).not.toMatch(new RegExp(`["']${schema}["']`))
  }
})
