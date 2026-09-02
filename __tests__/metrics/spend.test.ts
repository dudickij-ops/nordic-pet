import { describe, expect, test } from 'vitest'

import { totalsOn } from './totals-fixture'

/**
 * Реклама, комиссии и постоянные расходы — правила 6 и 7 задания.
 *
 * Подставка `totalsOn` — общая с `revenue.test.ts` и `cogs.test.ts`, живёт в
 * `./totals-fixture`.
 */

describe('реклама, комиссии, постоянные расходы', () => {
  test('реклама переводится делением на курс своего дня', async () => {
    const totals = await totalsOn([], [], '2026-03', [], {
      ads: [{ file: 'meta.csv', row: 1, date: '2026-03-01', campaign: 'spring', platform: 'meta', spend: '108.50' }],
      fx: [{ date: '2026-03-01', rate: '1.0850' }, { date: '2026-03-02', rate: '2.0000' }],
    })
    expect(totals.ads).toBe('100.00')
  })

  test('у каждого дня свой курс, а не курс конца месяца', async () => {
    const totals = await totalsOn([], [], '2026-03', [], {
      ads: [
        { file: 'meta.csv', row: 1, date: '2026-03-01', campaign: 'a', platform: 'meta', spend: '100.00' },
        { file: 'meta.csv', row: 2, date: '2026-03-02', campaign: 'b', platform: 'meta', spend: '100.00' },
      ],
      fx: [{ date: '2026-03-01', rate: '1.0000' }, { date: '2026-03-02', rate: '2.0000' }],
    })
    expect(totals.ads).toBe('150.00') // 100 + 50, а не 100 и не 200
  })

  test('комиссия: процент от суммы после скидок плюс фиксированная один раз на заказ', async () => {
    const totals = await totalsOn([
      { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '600.00', discount: '100.00', gateway: 'card' },
      { order: 'A-1', sku: 'NP-002', date: '2026-03-02', units: 1, gross: '500.00', discount: '0.00', gateway: 'card' },
    ], [], '2026-03', [], { fees: [{ gateway: 'card', percent: '1.9000', fixed: '0.25' }] })
    // (1100 − 100) × 1.9 / 100 + 0.25 = 19.25
    expect(totals.fees).toBe('19.25')
  })

  test('процент хранится пунктами и делится на сто', async () => {
    const totals = await totalsOn([
      { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' },
    ], [], '2026-03', [], { fees: [{ gateway: 'card', percent: '1.9000', fixed: '0.00' }] })
    expect(totals.fees).toBe('1.90') // не 190.00
  })

  test('возврат комиссию не пересчитывает', async () => {
    const заказ = [{ order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 2, gross: '100.00', discount: '0.00', gateway: 'card' }]
    const ставки = { fees: [{ gateway: 'card', percent: '2.0000', fixed: '0.00' }] }
    const без = await totalsOn(заказ, [], '2026-03', [], ставки)
    const с = await totalsOn(заказ, [{ order: 'A-1', sku: 'NP-001', date: '2026-03-09', units: 1, amount: '50.00' }], '2026-03', [], ставки)
    expect(с.fees).toBe(без.fees)
    expect(с.fees).toBe('2.00')
  })

  test('фиксированная часть берётся по разу на заказ, а не на строку', async () => {
    const ставки = { fees: [{ gateway: 'card', percent: '1.0000', fixed: '0.25' }] }
    // Один заказ двумя строками: 20.00 × 1% + 0.25 = 0.45
    const один = await totalsOn([
      { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '10.00', discount: '0.00', gateway: 'card' },
      { order: 'A-1', sku: 'NP-002', date: '2026-03-02', units: 1, gross: '10.00', discount: '0.00', gateway: 'card' },
    ], [], '2026-03', [], ставки)
    expect(один.fees).toBe('0.45')
    // Два заказа теми же суммами: (10 × 1% + 0.25) × 2 = 0.70
    const два = await totalsOn([
      { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '10.00', discount: '0.00', gateway: 'card' },
      { order: 'A-2', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '10.00', discount: '0.00', gateway: 'card' },
    ], [], '2026-03', [], ставки)
    expect(два.fees).toBe('0.70')
  })

  test('постоянные расходы берутся за свой месяц, пустая сумма не считается нулём молча', async () => {
    const totals = await totalsOn([], [], '2026-03', [], {
      opex: [
        { month: '2026-03-01', category: 'аренда', amount: '950.00' },
        { month: '2026-03-01', category: 'бухгалтерия', amount: null },
        { month: '2026-04-01', category: 'аренда', amount: '950.00' },
      ],
    })
    expect(totals.fixed).toBe('950.00')
  })
})
