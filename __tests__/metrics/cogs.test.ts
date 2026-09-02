import { describe, expect, test } from 'vitest'

import { totalsOn } from './totals-fixture'

/**
 * Себестоимость — правила 3, 4 и 5 задания.
 *
 * Подставка `totalsOn` — общая с `revenue.test.ts`, живёт в `./totals-fixture`.
 */

describe('себестоимость', () => {
  test('цена берётся действовавшая на дату продажи, а не последняя', async () => {
    const цены = [
      { sku: 'NP-004', cost: '16.50', from: '2026-01-01' },
      { sku: 'NP-004', cost: '21.90', from: '2026-03-15' },
    ]
    const до = await totalsOn([{ order: 'A-1', sku: 'NP-004', date: '2026-03-10', units: 1, gross: '49.00', discount: '0.00', gateway: 'card' }], [], '2026-03', цены)
    const после = await totalsOn([{ order: 'A-2', sku: 'NP-004', date: '2026-03-20', units: 1, gross: '49.00', discount: '0.00', gateway: 'card' }], [], '2026-03', цены)
    expect(до.cogs).toBe('16.50')
    expect(после.cogs).toBe('21.90')
  })

  test('возврат снимает себестоимость возвращённых штук', async () => {
    const totals = await totalsOn(
      [{ order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 3, gross: '90.00', discount: '0.00', gateway: 'card' }],
      [{ order: 'A-1', sku: 'NP-001', date: '2026-03-09', units: 1, amount: '30.00' }],
      '2026-03',
      [{ sku: 'NP-001', cost: '10.00', from: '2026-01-01' }],
    )
    expect(totals.cogs).toBe('20.00')
  })

  test('возврат без суммы штуки снимает, хотя выручку не уменьшает', async () => {
    const totals = await totalsOn(
      [{ order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 3, gross: '90.00', discount: '0.00', gateway: 'card' }],
      [{ order: 'A-1', sku: 'NP-001', date: '2026-03-09', units: 1, amount: null }],
      '2026-03',
      [{ sku: 'NP-001', cost: '10.00', from: '2026-01-01' }],
    )
    expect(totals.net).toBe('90.00')
    expect(totals.cogs).toBe('20.00')
  })

  test('товар без цены поставщика считается по 40% чистой выручки строки', async () => {
    const totals = await totalsOn(
      [{ order: 'A-1', sku: 'NP-012', date: '2026-03-02', units: 2, gross: '100.00', discount: '20.00', gateway: 'card' }],
      [], '2026-03', [],
    )
    expect(totals.cogs).toBe('32.00')
  })

  test('правило 5 не применяется второй раз к товару без цены', async () => {
    // 100 − 0 − 40 = 60 чистой выручки; 40% = 24.00. Второе прочтение дало бы 0.40×(60−40)=8.00
    const totals = await totalsOn(
      [{ order: 'A-1', sku: 'NP-012', date: '2026-03-02', units: 2, gross: '100.00', discount: '0.00', gateway: 'card' }],
      [{ order: 'A-1', sku: 'NP-012', date: '2026-03-09', units: 1, amount: '40.00' }],
      '2026-03', [],
    )
    expect(totals.cogs).toBe('24.00')
  })

  test('запасной процент берётся от строки, а не от чистой выручки всего месяца', async () => {
    const totals = await totalsOn([
      { order: 'A-1', sku: 'NP-012', date: '2026-03-02', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' },
      { order: 'A-2', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '900.00', discount: '0.00', gateway: 'card' },
    ], [], '2026-03', [{ sku: 'NP-001', cost: '10.00', from: '2026-01-01' }])
    expect(totals.cogs).toBe('50.00') // 40.00 запасных + 10.00 настоящих, а не 400.00
  })

  test('пустая цена у действующей строки не откатывается к отменённой', async () => {
    const totals = await totalsOn(
      [{ order: 'A-1', sku: 'NP-003', date: '2026-03-02', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' }],
      [], '2026-03',
      [
        { sku: 'NP-003', cost: '6.80', from: '2026-01-01' },
        { sku: 'NP-003', cost: null, from: '2026-02-01' },
      ],
    )
    expect(totals.cogs).toBe('40.00') // запасные 40%, а не 6.80
  })

  test('цена, начинающая действовать после продажи, не берётся', async () => {
    const totals = await totalsOn(
      [{ order: 'A-1', sku: 'NP-005', date: '2026-03-02', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' }],
      [], '2026-03', [{ sku: 'NP-005', cost: '3.05', from: '2026-03-20' }],
    )
    expect(totals.cogs).toBe('40.00')
  })
})
