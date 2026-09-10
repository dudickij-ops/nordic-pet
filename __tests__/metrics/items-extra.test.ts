import { Pool } from 'pg'
import { afterAll, describe, expect, test } from 'vitest'

import { projectDatabaseUrl } from '@/lib/db-url'
import { ITEMS_FROM_ROWS } from '@/lib/metrics/sql'

/**
 * Товары — кусок S11, шаг 4.
 *
 * Запрос не считает денег сам: он берёт готовые строки таблицы товаров и считает от их показанных
 * сумм. Проверки подставляют выдуманные строки. Якорь снаружи — мартовские строки, сверенные
 * владельцем: сумма прибыли строк 11 248,93 €, 80 % дают 8 артикулов из 12, в минусе ни одного, —
 * утверждается живой проверкой марта.
 */

const pool = new Pool({ connectionString: projectDatabaseUrl() })
afterAll(() => pool.end())

type Строка = { sku: string; net: string; profit: string }
type Колонки = {
  sku: string
  margin_pct: string | null
  profit_share_pct: string | null
  loss: boolean
  products_profit: string
  skus_total: number
  skus_for_80: number | null
  negative_count: number
}

async function колонки(строки: Строка[]): Promise<Колонки[]> {
  const значения = строки
    .map((с) => `('${с.sku}', '1'::text, '${с.net}'::text, '0.00'::text, '${с.profit}'::text)`)
    .join(', ')
  const { rows } = await pool.query(
    `with items_row as (select * from (values ${значения}) as v(sku, units, net, cogs, profit)),\n${ITEMS_FROM_ROWS}`,
  )
  return rows as Колонки[]
}

function строка(все: Колонки[], sku: string): Колонки {
  const найдена = все.find((к) => к.sku === sku)
  if (найдена === undefined) throw new Error(`строки ${sku} нет`)
  return найдена
}

/** Прибыль 50, 30, 15, 5 — сумма ровно 100: доли читаются глазом. */
const ЧЕТЫРЕ: Строка[] = [
  { sku: 'NP-A', net: '200.00', profit: '50.00' },
  { sku: 'NP-B', net: '120.00', profit: '30.00' },
  { sku: 'NP-C', net: '60.00', profit: '15.00' },
  { sku: 'NP-D', net: '40.00', profit: '5.00' },
]

describe('товары: новые колонки и строка над таблицей', () => {
  test('маржа строки — прибыль строки ÷ её чистая выручка', async () => {
    const все = await колонки(ЧЕТЫРЕ)
    expect(строка(все, 'NP-A').margin_pct).toBe('25.0')
    expect(строка(все, 'NP-D').margin_pct).toBe('12.5')
  })

  test('доли строк — от суммы прибыли строк, и в сумме дают ровно 100 %', async () => {
    const все = await колонки(ЧЕТЫРЕ)
    expect(Object.fromEntries(все.map((к) => [к.sku, к.profit_share_pct]))).toEqual({
      'NP-A': '50.0',
      'NP-B': '30.0',
      'NP-C': '15.0',
      'NP-D': '5.0',
    })
    expect(все[0].products_profit).toBe('100.00')
  })

  test('80 % считаются от суммы прибыли строк, по убыванию прибыли', async () => {
    // По убыванию: 50 — до неё 0; 30 — до неё 50; 15 — до неё 80, уже не меньше 80. Два артикула.
    // По возрастанию вышло бы четыре.
    const все = await колонки([ЧЕТЫРЕ[3], ЧЕТЫРЕ[1], ЧЕТЫРЕ[2], ЧЕТЫРЕ[0]])
    expect(все[0].skus_for_80).toBe(2)
    expect(все[0].skus_total).toBe(4)
  })

  test('в минусе — прибыль строго меньше нуля, и счётчик берёт тот же признак', async () => {
    const все = await колонки([
      { sku: 'NP-A', net: '100.00', profit: '60.00' },
      { sku: 'NP-Z', net: '10.00', profit: '0.00' },
      { sku: 'NP-M', net: '10.00', profit: '-1.00' },
    ])
    expect(все.filter((к) => к.loss).map((к) => к.sku)).toEqual(['NP-M'])
    expect(все[0].negative_count).toBe(1)
  })

  test('сумма прибыли строк не положительна — доли и 80 % пусты у всех строк разом', async () => {
    const все = await колонки([
      { sku: 'NP-A', net: '100.00', profit: '10.00' },
      { sku: 'NP-M', net: '100.00', profit: '-30.00' },
    ])
    expect(все.map((к) => к.profit_share_pct)).toEqual([null, null])
    expect(все[0].skus_for_80).toBeNull()
    expect(все[0].products_profit).toBe('-20.00')
  })

  test('чистая выручка строки ноль — маржа строки пустая', async () => {
    const все = await колонки([{ sku: 'NP-A', net: '0.00', profit: '-4.00' }])
    expect(строка(все, 'NP-A').margin_pct).toBeNull()
  })
})
