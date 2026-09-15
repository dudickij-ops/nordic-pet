import { describe, expect, test } from 'vitest'

import { подстановкаСтроки } from '@/lib/metrics/report'
import { itemsOn, type CostRow, type OrderRow } from './totals-fixture.ts'

/**
 * Подставленная себестоимость строки товара — кусок S12, задача 2.
 *
 * Якорь снаружи — мартовские числа: у NP-011 и NP-012 цены поставщика нет вовсе, и их
 * себестоимость выходит ровно 40,0 % чистой выручки, а маржа — ровно 60,0 %. Именно эта ровность
 * и есть то, ради чего пометка заводится: она выглядит измеренной величиной.
 *
 * Раскладка ниже даёт все три состояния разом: цена есть у всех продаж, нет ни одной, есть не
 * всем. Третье — главное: без него «часть» нечем отличить от «вся».
 */

const ЗАКАЗЫ: OrderRow[] = [
  // Цена есть всё время — подстановки нет.
  { order: 'O-1', sku: 'NP-ЦЕЛ', date: '2026-03-02', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' },
  { order: 'O-2', sku: 'NP-ЦЕЛ', date: '2026-03-20', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' },
  // Цены нет вовсе — подставлена вся.
  { order: 'O-3', sku: 'NP-НЕТ', date: '2026-03-02', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' },
  { order: 'O-4', sku: 'NP-НЕТ', date: '2026-03-20', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' },
  // Цена появилась в середине месяца — подставлена часть.
  { order: 'O-5', sku: 'NP-ПОЛ', date: '2026-03-02', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' },
  { order: 'O-6', sku: 'NP-ПОЛ', date: '2026-03-20', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' },
]

const ЦЕНЫ: CostRow[] = [
  { sku: 'NP-ЦЕЛ', cost: '40.00', from: '2026-01-01' },
  { sku: 'NP-ПОЛ', cost: '40.00', from: '2026-03-10' },
]

async function словаПодстановки(): Promise<Record<string, string | undefined>> {
  const строки = await itemsOn(ЗАКАЗЫ, [], '2026-03', ЦЕНЫ)
  return Object.fromEntries(
    строки.map((с) => [
      с.sku,
      подстановкаСтроки(с.rows_substituted as unknown as number, с.rows_counted as unknown as number),
    ]),
  )
}

describe('подставленная себестоимость строки', () => {
  test('слово выводится из двух чисел, а не из ровной маржи', () => {
    expect(подстановкаСтроки(0, 3)).toBeUndefined()
    expect(подстановкаСтроки(3, 3)).toBe('вся')
    expect(подстановкаСтроки(1, 3)).toBe('часть')
    expect(подстановкаСтроки(0, 0)).toBeUndefined()
  })

  test('три состояния различаются на настоящих строках продаж', async () => {
    expect(await словаПодстановки()).toEqual({
      'NP-ЦЕЛ': undefined,
      'NP-НЕТ': 'вся',
      'NP-ПОЛ': 'часть',
    })
  })

  test('частичная подстановка не выдаётся за полную: у строки считаются продажи, а не артикулы', async () => {
    const строки = await itemsOn(ЗАКАЗЫ, [], '2026-03', ЦЕНЫ)
    const пол = строки.find((с) => с.sku === 'NP-ПОЛ')
    expect(пол).toBeDefined()
    expect(Number(пол?.rows_substituted)).toBe(1)
    expect(Number(пол?.rows_counted)).toBe(2)
  })
})
