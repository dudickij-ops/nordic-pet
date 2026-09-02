import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'

import { Dashboard } from '@/app/page'
import type { MonthReport } from '@/lib/metrics/report'

/**
 * Проверки задачи 7: экран печатает поля отчёта и ничего не считает сам.
 *
 * `Dashboard` — чистый компонент, отчёт в него передаётся готовым: ни базы, ни сети
 * здесь нет. Отчёт для каждой проверки собирается из `baseReport()`, чтобы менять
 * ровно то поле, которое проверяется, а не переписывать всю форму заново.
 */

/** Один вид дыры со всеми полями формы `gaps` — используется, чтобы собрать все 11. */
function gap(kind: string, count = 0, at: string[] = []) {
  return { kind, count, at }
}

const ALL_GAP_KINDS = [
  'скидки',
  'оборот',
  'возвраты без суммы',
  'возвраты, не попавшие в счёт',
  'возвращено больше, чем куплено',
  'строки продаж без цены поставщика',
  'ставки без процента или без фиксированной части',
  'заказы с разными способами оплаты',
  'постоянные расходы без суммы',
  'реклама без суммы',
  'дни рекламы без курса',
]

function baseReport(overrides: Partial<MonthReport> = {}): MonthReport {
  return {
    target: 'локальная база',
    month: '2026-03',
    months: [
      { month: '2026-02', hasOrders: true },
      { month: '2026-03', hasOrders: true },
    ],
    revenue: { gross: '18764.00', discounts: '427.50', refunds: '1059.46', net: '1234.50' },
    costs: { cogs: '6028.11', ads: '4431.37', fees: '526.12', fixed: '4552.90' },
    bottom: { profit: '1738.53', marginPct: null, roasByGross: '423.5' },
    items: [
      { sku: 'NP-001', units: '12', net: '345.00', cogs: '120.00', profit: '225.00' },
      { sku: 'NP-012', units: '3', net: '45.00', cogs: '18.00', profit: '27.00' },
    ],
    honesty: { sharePct: '80.3', skusWithoutPrice: ['NP-011', 'NP-012'] },
    gaps: ALL_GAP_KINDS.map((kind) => gap(kind)),
    ...overrides,
  }
}

describe('экран /', () => {
  test('экран печатает поля отчёта, а не свои числа', () => {
    const отчёт = baseReport()
    const html = renderToStaticMarkup(<Dashboard report={отчёт} />)
    expect(html).toContain('1 234,50 €')
  })

  test('окупаемость подписана словом «по обороту»', () => {
    const отчёт = baseReport()
    const html = renderToStaticMarkup(<Dashboard report={отчёт} />)
    expect(html).toMatch(/окупаемость рекламы[^<]*по обороту/i)
  })

  test('доля подписана словами «от чистой выручки»', () => {
    const отчёт = baseReport()
    const html = renderToStaticMarkup(<Dashboard report={отчёт} />)
    expect(html).toMatch(/от чистой выручки/i)
  })

  test('блок неполноты виден, даже когда все нули', () => {
    const отчёт = baseReport()
    const html = renderToStaticMarkup(<Dashboard report={отчёт} />)
    expect(html).toContain('пустых ячеек')
    expect(html).toContain('скидки: 0')
  })

  test('нет данных печатается словами, а не как 0 и не как NaN', () => {
    const отчёт = baseReport()
    const html = renderToStaticMarkup(<Dashboard report={отчёт} />)
    expect(html).toContain('нет данных')
    expect(html).not.toContain('NaN')
  })

  test('таблица товаров идёт в порядке отчёта', () => {
    const отчёт = baseReport()
    const html = renderToStaticMarkup(<Dashboard report={отчёт} />)
    expect(html.indexOf('NP-001')).toBeLessThan(html.indexOf('NP-012'))
  })

  test('блок неполноты называет адрес у каждой ненулевой дыры', () => {
    const отчёт = baseReport({
      gaps: ALL_GAP_KINDS.map((kind, i) =>
        i === 0 ? gap(kind, 2, ['3', '7']) : gap(kind),
      ),
    })
    const html = renderToStaticMarkup(<Dashboard report={отчёт} />)
    expect(html).toContain('скидки: 2')
    expect(html).toContain('3, 7')
  })

  test('экран называет товары без цены поставщика', () => {
    const отчёт = baseReport()
    const html = renderToStaticMarkup(<Dashboard report={отчёт} />)
    expect(html).toContain('NP-011')
    expect(html).toContain('NP-012')
  })
})
