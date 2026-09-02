import { count, money, percent, ratio } from '../lib/metrics/format.ts'
import { monthlyReport, type MetricsDeps, type MonthReport } from '../lib/metrics/report.ts'

/**
 * Команда метрик — задача 9.
 *
 * Печатает отчёт месяца в терминал теми же функциями формата, что и экран
 * (`lib/metrics/format.ts`), чтобы числа на экране и в выводе команды не разошлись.
 * Нужна боевому прогону задачи 12: там нет ни экрана, ни браузера, и пять итогов
 * приёмки берутся из терминала.
 *
 * Обёртка, как у трёх прежних команд: вся работа — в `monthlyReport()`. Она приходит
 * доводом `deps.report`, чтобы проверка могла подставить её без базы, — тем же приёмом,
 * что у `deps.connect` внутри самой `monthlyReport()`.
 */

/** Зацепки, с которыми зовут `printMetrics()` — печать строк и сам отчёт месяца. */
export type PrintMetricsDeps = {
  announce: (line: string) => void
  report: (month?: string, deps?: Partial<MetricsDeps>) => Promise<MonthReport>
}

/**
 * Печатает отчёт целиком той же росписью полей, что и экран (`app/page.tsx`):
 * выручка, затраты, итог, товары, честность данных, неполнота. Разметки для строк
 * здесь нет — это терминал, а не HTML, — но набор полей и функции формата те же.
 */
function printReport(report: MonthReport, announce: (line: string) => void): void {
  announce(`месяц: ${report.month ?? 'нет данных'}`)

  announce('')
  announce('выручка')
  announce(`  оборот: ${money(report.revenue.gross)}`)
  announce(`  скидки: ${money(report.revenue.discounts)}`)
  announce(`  возвраты: ${money(report.revenue.refunds)}`)
  announce(`  чистая выручка: ${money(report.revenue.net)}`)

  announce('')
  announce('затраты')
  announce(`  себестоимость проданного: ${money(report.costs.cogs)}`)
  announce(`  реклама: ${money(report.costs.ads)}`)
  announce(`  комиссии платёжных систем: ${money(report.costs.fees)}`)
  announce(`  постоянные расходы: ${money(report.costs.fixed)}`)

  announce('')
  announce('итог')
  announce(`  прибыль: ${money(report.bottom.profit)}`)
  announce(`  маржа: ${percent(report.bottom.marginPct)}`)
  announce(`  окупаемость рекламы (по обороту): ${ratio(report.bottom.roasByGross)}`)

  announce('')
  announce('товары (артикул: продано за вычетом возвратов, чистая выручка, себестоимость, прибыль)')
  for (const item of report.items) {
    announce(
      `  ${item.sku}: ${count(item.units)} шт, ${money(item.net)}, ${money(item.cogs)}, ` +
        `${money(item.profit)}`,
    )
  }

  announce('')
  announce('честность данных')
  announce(
    `  посчитано по настоящей цене (доля от чистой выручки): ${percent(report.honesty.sharePct)}`,
  )
  if (report.honesty.skusWithoutPrice.length > 0) {
    announce(`  без цены поставщика: ${report.honesty.skusWithoutPrice.join(', ')}`)
  }

  announce('')
  announce('неполнота данных')
  for (const gap of report.gaps) {
    const at = gap.at.length > 0 ? ` (${gap.at.join(', ')})` : ''
    announce(`  ${gap.kind}: ${count(String(gap.count))}${at}`)
  }
}

/**
 * Месяц берётся первым доводом командной строки (`ГГГГ-ММ`); без него `deps.report()`
 * сама берёт последний месяц, за который есть заказы — то же правило, что у экрана.
 * Форму месяца проверяет сама `monthlyReport()`, и отказ уходит наружу как есть: он уже
 * называет, что написать, и второй такой же проверки здесь не заводится.
 */
export async function printMetrics(args: string[], deps: PrintMetricsDeps): Promise<void> {
  const month = args[0]
  const report = await deps.report(month, { announce: deps.announce })
  printReport(report, deps.announce)
}

// Запуск простым `node scripts/print-metrics.ts`. Guard пропускает исполнение, когда
// файл не главный модуль процесса, — так его подключает проверка, не трогая ни базу,
// ни `process.exit`.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await printMetrics(process.argv.slice(2), {
      announce: (line) => console.log(line),
      report: monthlyReport,
    })
  } catch (error) {
    console.error(`команда метрик отменена: ${(error as Error).message}`)
    process.exit(1)
  }
}
