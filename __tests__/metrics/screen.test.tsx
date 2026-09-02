import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'

import { Dashboard } from '@/app/page'
import type { MonthReport } from '@/lib/metrics/report'

/**
 * Проверки задачи 7: экран печатает поля отчёта и ничего не считает сам.
 *
 * `Dashboard` — чистый компонент, отчёт в него передаётся готовым: ни базы, ни сети
 * здесь нет.
 *
 * Круг правок 1 нашёл дыру в главной проверке. Первая редакция собирала подставной отчёт
 * согласованным (прибыль совпадала с разностью выручки и затрат), и подмена печати
 * `net − cogs` вместо поля `profit` в разметке проходила проверку зелёной — досчитанное
 * число случайно совпадало с полем. `ОТЧЁТ` ниже выписан по заданию: числа нарочно **не
 * сходятся между собой** — прибыль не равна разности выручки и затрат, доля не выводится
 * из выручек, штуки не выводятся из денег. Подмена любого поля на вычисление из соседей
 * теперь печатает число, которого в отчёте нет, и проверка красна.
 */
const ОТЧЁТ: MonthReport = {
  target: 'цель: local, база nordic_pet на 127.0.0.1',
  month: '2026-03',
  months: [{ month: '2026-03', hasOrders: true }],
  revenue: { gross: '1234.50', discounts: '11.11', refunds: '22.22', net: '3333.33' },
  costs: { cogs: '444.44', ads: '55.55', fees: '6.66', fixed: '77.77' },
  bottom: { profit: '8888.88', marginPct: '9.9', roasByGross: '1.23' },
  items: [
    { sku: 'NP-012', units: '101', net: '202.02', cogs: '303.03', profit: '404.04' },
    { sku: 'NP-001', units: '5', net: '50.50', cogs: '60.60', profit: '70.70' },
  ],
  honesty: { sharePct: '80.3', skusWithoutPrice: ['NP-011', 'NP-012'] },
  gaps: [
    { kind: 'скидки', count: 0, at: [] },
    { kind: 'оборот', count: 2, at: ['7', '9'] },
  ],
}

/** Один вид дыры со всеми полями формы `gaps` — для проверок, которым нужны все 11. */
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

/**
 * Отдельный от `ОТЧЁТ` отчёт — для проверок, которым важна не сама несогласованность
 * чисел, а другое свойство: порядок товаров, слова вместо `null`, все 11 видов дыры разом.
 * `ОТЧЁТ` для этого не подходит: в нём товары нарочно переставлены (см. выше), а `null`-х
 * полей и полного списка дыр нет вовсе.
 */
function baseReport(overrides: Partial<MonthReport> = {}): MonthReport {
  return {
    target: 'локальная база',
    month: '2026-03',
    months: [
      { month: '2026-02', hasOrders: true },
      { month: '2026-03', hasOrders: true },
    ],
    revenue: { gross: '18764.00', discounts: '427.50', refunds: '1059.46', net: '17277.04' },
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
    const html = renderToStaticMarkup(<Dashboard report={ОТЧЁТ} />)
    // Каждое денежное поле отчёта обязано появиться на экране своим числом. Ни одно из них
    // не выводится из соседей, поэтому досчитанное в разметке число сюда не подойдёт.
    for (const ожидание of [
      '1 234,50 €', '11,11 €', '22,22 €', '3 333,33 €',
      '444,44 €', '55,55 €', '6,66 €', '77,77 €', '8 888,88 €',
      '202,02 €', '303,03 €', '404,04 €', '50,50 €', '60,60 €', '70,70 €',
    ]) expect(html).toContain(ожидание)
    expect(html).toContain('9,9 %')
    // Окупаемость — отношение, знак «×», а не «%»: подстрока '1,23' совпала бы и со
    // старым дефектом ('1,23 %'), поэтому здесь утверждается число вместе со знаком.
    expect(html).toContain('1,23 ×')
    expect(html).toContain('80,3 %')
    expect(html).toContain('101')
  })

  test('окупаемость печатается отношением, а не процентами', () => {
    // Найдено на приёмке: экран печатал окупаемость через тот же формат, что и маржу, и
    // «оборот больше рекламы в 4,23 раза» превращалось в «реклама вернула 4,23 %» — смысл,
    // противоположный настоящему. Проверка точная, а не подстрочная: знак процента рядом
    // с тем же числом эту проверку не пройдёт.
    const html = renderToStaticMarkup(<Dashboard report={ОТЧЁТ} />)
    expect(html).toContain('1,23 ×')
    expect(html).not.toContain('1,23 %')
  })

  test('окупаемость подписана словом «по обороту»', () => {
    const html = renderToStaticMarkup(<Dashboard report={baseReport()} />)
    expect(html).toMatch(/окупаемость рекламы[^<]*по обороту/i)
  })

  test('доля подписана словами «от чистой выручки»', () => {
    const html = renderToStaticMarkup(<Dashboard report={baseReport()} />)
    expect(html).toMatch(/от чистой выручки/i)
  })

  test('блок неполноты виден, даже когда все нули', () => {
    const html = renderToStaticMarkup(<Dashboard report={baseReport()} />)
    expect(html).toContain('пустых ячеек')
    expect(html).toContain('скидки: 0')
  })

  test('нет данных печатается словами, а не как 0 и не как NaN', () => {
    const html = renderToStaticMarkup(<Dashboard report={baseReport()} />)
    expect(html).toContain('нет данных')
    expect(html).not.toContain('NaN')
  })

  test('таблица товаров идёт в порядке отчёта', () => {
    const html = renderToStaticMarkup(<Dashboard report={baseReport()} />)
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
    const html = renderToStaticMarkup(<Dashboard report={baseReport()} />)
    expect(html).toContain('NP-011')
    expect(html).toContain('NP-012')
  })
})
