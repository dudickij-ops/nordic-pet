import { describe, expect, test } from 'vitest'

import { totalsOn } from './totals-fixture'

/**
 * Выручка, скидки, возвраты — правила 1 и 2 задания.
 *
 * Подставка `totalsOn` и вся обвязка вокруг неё живут в `./totals-fixture` — задача 3
 * пользуется тем же способом класть факты для проверок себестоимости, и второй способ
 * разошёлся бы с этим молча. Перенос не тронул ни одного утверждения ниже.
 */

describe('выручка, скидки и возвраты', () => {
  test('чистая выручка = оборот − скидки − возвраты', async () => {
    const totals = await totalsOn([
      { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 2, gross: '100.00', discount: '10.00', gateway: 'card' },
    ], [
      { order: 'A-1', sku: 'NP-001', date: '2026-03-05', units: 1, amount: '30.00' },
    ], '2026-03')
    expect(totals.gross).toBe('100.00')
    expect(totals.discounts).toBe('10.00')
    expect(totals.refunds).toBe('30.00')
    expect(totals.net).toBe('60.00')
  })

  test('возврат уменьшает месяц заказа, а не месяц возврата', async () => {
    const totals = await totalsOn([
      { order: 'A-1', sku: 'NP-001', date: '2026-03-31', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' },
    ], [
      { order: 'A-1', sku: 'NP-001', date: '2026-04-07', units: 1, amount: '100.00' },
    ], '2026-03')
    expect(totals.net).toBe('0.00')
  })

  test('сдвиг даты возврата на месяц вперёд не меняет ни один итог марта', async () => {
    const orders = [
      { order: 'A-1', sku: 'NP-001', date: '2026-03-31', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' },
    ]
    const близко = await totalsOn(orders, [{ order: 'A-1', sku: 'NP-001', date: '2026-03-31', units: 1, amount: '40.00' }], '2026-03')
    const далеко = await totalsOn(orders, [{ order: 'A-1', sku: 'NP-001', date: '2026-04-30', units: 1, amount: '40.00' }], '2026-03')
    // Сравнение двух итогов друг с другом зелено и на сплошных нулях; число закрепляется отдельно.
    expect(близко.net).toBe('60.00')
    expect(далеко).toEqual(близко)
  })

  test('пустая скидка вычитает ноль', async () => {
    const totals = await totalsOn([
      { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '50.00', discount: null, gateway: 'card' },
    ], [], '2026-03')
    expect(totals.discounts).toBe('0.00')
    expect(totals.net).toBe('50.00')
  })

  test('возврат без суммы выручку не уменьшает', async () => {
    const totals = await totalsOn([
      { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 2, gross: '50.00', discount: '0.00', gateway: 'card' },
    ], [{ order: 'A-1', sku: 'NP-001', date: '2026-03-09', units: 1, amount: null }], '2026-03')
    expect(totals.refunds).toBe('0.00')
    expect(totals.net).toBe('50.00')
  })

  test('две строки одной пары «заказ + артикул» складываются, а не теряются', async () => {
    const totals = await totalsOn([
      { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '30.00', discount: '0.00', gateway: 'card' },
      { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '20.00', discount: '0.00', gateway: 'card' },
    ], [], '2026-03')
    expect(totals.gross).toBe('50.00')
  })

  test('строка без суммы не даёт ни оборота, ни скидки', async () => {
    const totals = await totalsOn([
      { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: null, discount: '5.00', gateway: 'card' },
      { order: 'A-2', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '10.00', discount: '0.00', gateway: 'card' },
    ], [], '2026-03')
    expect(totals.gross).toBe('10.00')
    expect(totals.discounts).toBe('0.00')
  })

  test('заказ с разошедшимися датами строк идёт в один месяц, и возврат вычитается один раз', async () => {
    const заказ = [
      { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' },
      { order: 'A-1', sku: 'NP-001', date: '2026-04-02', units: 1, gross: '100.00', discount: '0.00', gateway: 'card' },
    ]
    const возврат = [{ order: 'A-1', sku: 'NP-001', date: '2026-03-09', units: 1, amount: '40.00' }]
    const март = await totalsOn(заказ, возврат, '2026-03')
    const апрель = await totalsOn(заказ, возврат, '2026-04')
    expect(март.net).toBe('160.00')   // 200 − 40, а не 60
    expect(апрель.net).toBe('0.00')   // а не вторые 60
  })

  test('в паре с пустой суммой пустая строка уносит свою скидку, а сосед остаётся', async () => {
    const totals = await totalsOn([
      { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: null, discount: '5.00', gateway: 'card' },
      { order: 'A-1', sku: 'NP-001', date: '2026-03-02', units: 1, gross: '10.00', discount: '0.00', gateway: 'card' },
    ], [], '2026-03')
    expect(totals.gross).toBe('10.00')
    expect(totals.discounts).toBe('0.00')  // не 5.00: вычет неизвестного происхождения
    expect(totals.net).toBe('10.00')
  })

  test('заказ соседнего месяца в счёт не попадает', async () => {
    const totals = await totalsOn([
      { order: 'A-1', sku: 'NP-001', date: '2026-04-01', units: 1, gross: '99.00', discount: '0.00', gateway: 'card' },
    ], [], '2026-03')
    expect(totals.gross).toBe('0.00')
  })
})
