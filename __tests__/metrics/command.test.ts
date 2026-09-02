import { describe, expect, test } from 'vitest'

import { printMetrics } from '@/scripts/print-metrics'
import { monthlyReport, type MetricsDeps, type MonthReport } from '@/lib/metrics/report'

/**
 * Свои проверки задачи 9: печать отчёта и разбор довода командной строки.
 *
 * Обязательства, общие с тремя прежними командами (запуск простым `node`, неназванная
 * среда — отказ, цель названа до первой работы, снятие `PG*`, отсутствие похода наружу),
 * здесь не проверяются: их проверяет `__tests__/commands/obligations.test.ts` сам, тем же
 * набором, что и у остальных, — просто перебирая `DATABASE_COMMANDS`, куда команда вошла
 * обычной записью.
 */

const ОТЧЁТ: MonthReport = {
  target: 'цель: local, база nordic_pet на 127.0.0.1',
  month: '2026-03',
  months: [{ month: '2026-03', hasOrders: true }],
  revenue: { gross: '2000.00', discounts: '10.00', refunds: '755.50', net: '1234.50' },
  costs: { cogs: '300.00', ads: '150.00', fees: '25.00', fixed: '100.00' },
  bottom: { profit: '659.50', marginPct: '53.4', roasByGross: '13.3' },
  items: [{ sku: 'NP-001', units: '10', net: '500.00', cogs: '100.00', profit: '400.00' }],
  honesty: { sharePct: '80.0', skusWithoutPrice: ['NP-011'] },
  gaps: [{ kind: 'строк заказов без скидки', count: 0, at: [] }],
}

/**
 * Подставка вместо `monthlyReport()` — не ходит ни в базу, ни в сеть. Печатает «цель»
 * первой строкой, как это делает настоящая функция через `withFactSnapshot`: иначе
 * проверка `строки[0]` доказывала бы устройство подставки, а не команды.
 */
async function отчётПодставка(month?: string, deps?: Partial<MetricsDeps>): Promise<MonthReport> {
  deps?.announce?.(ОТЧЁТ.target)
  return { ...ОТЧЁТ, month: month ?? ОТЧЁТ.month }
}

/**
 * Подставки для проверки отказа на кривом месяце — настоящая `monthlyReport()`. Форму
 * месяца она проверяет первым делом, до всякого похода в базу, так что довод «март»
 * отказывает раньше, чем понадобился бы `deps.connect`.
 */
const подставки = { announce: () => {}, report: monthlyReport }

describe('команда метрик', () => {
  test('месяц берётся из довода командной строки', async () => {
    const строки: string[] = []
    await printMetrics(['2026-03'], { announce: (l) => строки.push(l), report: отчётПодставка })
    expect(строки[0]).toMatch(/^цель: /)
    expect(строки.join('\n')).toContain('чистая выручка')
    expect(строки.join('\n')).toContain('1 234,50 €')
  })

  test('без довода печатается месяц по умолчанию', async () => {
    const строки: string[] = []
    await printMetrics([], { announce: (l) => строки.push(l), report: отчётПодставка })
    expect(строки.join('\n')).toContain('2026-03')
  })

  test('месяц не в форме ГГГГ-ММ — отказ, называющий, что написать', async () => {
    await expect(printMetrics(['март'], подставки)).rejects.toThrow(/ГГГГ-ММ/)
  })
})
