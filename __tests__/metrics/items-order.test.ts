import { describe, expect, test } from 'vitest'

import { MONTH_ITEMS } from '@/lib/metrics/sql'
import { itemsOn, type CostRow, type OrderRow } from './totals-fixture.ts'

/**
 * Порядок таблицы товаров — кусок S13, задача 4: отмена решения S12 (Ф2). Порядок теперь один —
 * валовая прибыль по убыванию, при равенстве по артикулу, — и живёт в самом запросе, а не в
 * адресе. Шесть порядков и отказ на незнакомый отменены решением владельца Э4.
 */

describe('порядок таблицы товаров', () => {
  test('порядок товаров один — валовая прибыль по убыванию, при равенстве по артикулу', () => {
    expect(MONTH_ITEMS.trimEnd().endsWith('order by sum(net) - sum(cogs) desc, sku')).toBe(true)
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
    const строки = await itemsOn(ровные, [], '2026-03', цены)
    expect(строки.map((с) => с.sku)).toEqual(['NP-А', 'NP-Я'])
  })
})
