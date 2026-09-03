import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'

import type { MonthReport } from '@/lib/metrics/report'
import { Dashboard } from '@/app/page'

/**
 * Проверки находок итоговой проверки S5: месяц приходит из адреса, а не только с экрана
 * по умолчанию.
 *
 * `monthlyReport` подставлена своим доводом месяца: странице важно только то, какой
 * месяц она передаст дальше, а не то, как `monthlyReport()` считает числа этого месяца —
 * это уже доказано в `__tests__/metrics/report.test.ts`, отдельными подставками сырья.
 * Довод, которого подставка не узнаёт (пример — «boom»), уходит настоящей функции: её
 * проверка формы месяца срабатывает до всякого похода в базу, и здесь проверяется не она
 * сама, а то, что страница ловит её отказ и показывает его текст, а не падает.
 */

/** Раскладка отчёта с обязательным месяцем и всем прочим по умолчанию — только то, что нужно проверке. */
function раскладка(overrides: Partial<MonthReport> & { month: string }): MonthReport {
  return {
    target: 'проверка',
    month: overrides.month,
    months: overrides.months ?? [{ month: overrides.month, hasOrders: true }],
    revenue: overrides.revenue ?? { gross: '0.00', discounts: '0.00', refunds: '0.00', net: '0.00' },
    costs: overrides.costs ?? { cogs: '0.00', ads: '0.00', fees: '0.00', fixed: '0.00' },
    bottom: overrides.bottom ?? { profit: '0.00', marginPct: null, roasByGross: null },
    items: overrides.items ?? [],
    honesty: overrides.honesty ?? { sharePct: null, skusWithoutPrice: [] },
    gaps: overrides.gaps ?? [],
  }
}

// Два месяца различаются и меткой, и числами: артикул одного никогда не встречается
// у другого, поэтому раскладка различает «дали то, что просили» от «дали то, что всегда».
// Отдельная строковая константа, а не `.month` отчёта: у `MonthReport.month` тип
// `string | null` — честный для настоящего отчёта, но здесь довод адреса всегда есть.
const МЕСЯЦ_Б = '2099-12'

const ОТЧЁТ_ПО_УМОЛЧАНИЮ = раскладка({
  month: '2026-03',
  items: [{ sku: 'NP-001', units: '5', net: '500.00', cogs: '50.00', profit: '450.00' }],
})

const ОТЧЁТ_ДРУГОГО_МЕСЯЦА = раскладка({
  month: МЕСЯЦ_Б,
  items: [{ sku: 'NP-777', units: '42', net: '4400.00', cogs: '900.00', profit: '3500.00' }],
})

vi.mock('@/lib/metrics/report', async (importOriginal) => {
  const настоящий = await importOriginal<typeof import('@/lib/metrics/report')>()
  return {
    ...настоящий,
    monthlyReport: vi.fn(async (month?: string) => {
      if (month === undefined) return ОТЧЁТ_ПО_УМОЛЧАНИЮ
      if (month === МЕСЯЦ_Б) return ОТЧЁТ_ДРУГОГО_МЕСЯЦА
      // Не узнанный подставкой довод — настоящей функции: её собственный отказ на форме
      // месяца доказан отдельно, здесь важно только то, что страница его не глотает.
      return настоящий.monthlyReport(month)
    }),
  }
})

const { default: HomePage } = await import('@/app/page')

test('месяц из адреса определяет, что видно на экране, а не месяц по умолчанию', async () => {
  const сВыбором = renderToStaticMarkup(
    await HomePage({ searchParams: Promise.resolve({ m: МЕСЯЦ_Б }) }),
  )
  expect(сВыбором).toContain('2099-12')
  expect(сВыбором).toContain('NP-777')
  expect(сВыбором).not.toContain('NP-001')

  const поУмолчанию = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({}) }))
  expect(поУмолчанию).toContain('2026-03')
  expect(поУмолчанию).toContain('NP-001')
  expect(поУмолчанию).not.toContain('NP-777')
})

test('ссылки переключателя месяца ведут на /?m=<месяц>, а не на /', () => {
  const отчёт = раскладка({
    month: '2026-02',
    months: [
      { month: '2026-01', hasOrders: true },
      { month: '2026-02', hasOrders: true },
    ],
  })
  const html = renderToStaticMarkup(<Dashboard report={отчёт} />)
  expect(html).toContain('href="/?m=2026-01"')
  expect(html).toContain('href="/?m=2026-02"')
  expect(html).not.toMatch(/href="\/"/)
})

test('кривой месяц в адресе показывает наш текст, а не падает', async () => {
  const html = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({ m: 'boom' }) }))
  expect(html).toMatch(/форме ГГГГ-ММ/)
  expect(html).toContain('boom')
})
