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

test('адресные колонки обязательны — адрес не бывает пустым', async () => {
  const nullableAddresses = await rows(
    `select table_name || '.' || column_name as "место"
       from information_schema.columns
      where table_schema = 'raw'
        and column_name in ('row_no', 'file_name')
        and is_nullable = 'YES'
      order by 1`,
  )
  expect(nullableAddresses).toEqual([])
})
