import { describe, expect, test } from 'vitest'

import { ПОРЯДКИ_ТОВАРОВ, ПОРЯДОК_ТОВАРОВ_ПО_УМОЛЧАНИЮ } from '@/lib/metrics/sql'
import { itemsOn, type CostRow, type OrderRow } from './totals-fixture.ts'

/**
 * Порядок таблицы товаров — кусок S12, задача 1.
 *
 * Раскладка подобрана так, что три столбца дают три разных порядка: иначе проверка «упорядочено
 * по прибыли» проходила бы и на запросе, упорядоченном по выручке, — ровно та ошибка, ради
 * которой кусок и заведён.
 *
 *   NP-A — выручка 300, себестоимость 100, прибыль 200
 *   NP-B — выручка 200, себестоимость 150, прибыль  50
 *   NP-C — выручка 100, себестоимость  10, прибыль  90
 *
 * По выручке: A, B, C. По себестоимости: B, A, C. По прибыли: A, C, B.
 */

const ЗАКАЗЫ: OrderRow[] = [
  { order: 'O-1', sku: 'NP-A', date: '2026-03-02', units: 1, gross: '300.00', discount: '0.00', gateway: 'card' },
  { order: 'O-2', sku: 'NP-B', date: '2026-03-03', units: 1, gross: '200.00', discount: '0.00', gateway: 'card' },
  { order: 'O-3', sku: 'NP-C', date: '2026-03-04', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' },
]

const ЦЕНЫ: CostRow[] = [
  { sku: 'NP-A', cost: '100.00', from: '2026-01-01' },
  { sku: 'NP-B', cost: '150.00', from: '2026-01-01' },
  { sku: 'NP-C', cost: '10.00', from: '2026-01-01' },
]

const артикулы = (строки: Array<Record<string, string>>) => строки.map((с) => с.sku)

describe('порядок таблицы товаров', () => {
  test('порядок по умолчанию — прибыль по убыванию', async () => {
    expect(ПОРЯДОК_ТОВАРОВ_ПО_УМОЛЧАНИЮ).toBe('profit-desc')
    const строки = await itemsOn(ЗАКАЗЫ, [], '2026-03', ЦЕНЫ)
    expect(артикулы(строки)).toEqual(['NP-A', 'NP-C', 'NP-B'])
  })

  test('шесть порядков дают шесть таблиц, и каждая упорядочена своим столбцом', async () => {
    const собрано: Record<string, string[]> = {}
    for (const порядок of Object.keys(ПОРЯДКИ_ТОВАРОВ) as Array<keyof typeof ПОРЯДКИ_ТОВАРОВ>) {
      собрано[порядок] = артикулы(await itemsOn(ЗАКАЗЫ, [], '2026-03', ЦЕНЫ, порядок))
    }
    expect(собрано).toEqual({
      'profit-desc': ['NP-A', 'NP-C', 'NP-B'],
      'profit-asc': ['NP-B', 'NP-C', 'NP-A'],
      'net-desc': ['NP-A', 'NP-B', 'NP-C'],
      'net-asc': ['NP-C', 'NP-B', 'NP-A'],
      'cogs-desc': ['NP-B', 'NP-A', 'NP-C'],
      'cogs-asc': ['NP-C', 'NP-A', 'NP-B'],
    })
  })

  test('порядков ровно шесть, и другого текста в запрос не попадает', () => {
    expect(Object.keys(ПОРЯДКИ_ТОВАРОВ)).toHaveLength(6)
    for (const хвост of Object.values(ПОРЯДКИ_ТОВАРОВ)) {
      expect(хвост).toMatch(/^order by [a-z(), \-+*]+ (asc|desc), sku$/)
    }
  })

  test('при равных значениях столбца порядок решается артикулом, а не случаем', async () => {
    const ровные: OrderRow[] = [
      { order: 'O-1', sku: 'NP-Я', date: '2026-03-02', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' },
      { order: 'O-2', sku: 'NP-А', date: '2026-03-03', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' },
    ]
    const цены: CostRow[] = [
      { sku: 'NP-Я', cost: '40.00', from: '2026-01-01' },
      { sku: 'NP-А', cost: '40.00', from: '2026-01-01' },
    ]
    const строки = await itemsOn(ровные, [], '2026-03', цены, 'profit-desc')
    expect(артикулы(строки)).toEqual(['NP-А', 'NP-Я'])
  })
})
