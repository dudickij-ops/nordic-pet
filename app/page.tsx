import { count, money, percent, ratio } from '@/lib/metrics/format'
import { monthlyReport, type MonthReport } from '@/lib/metrics/report'
import { RefreshPanel } from './refresh-panel'

/**
 * Разметка экрана — задача 7. Чистый компонент: получает готовый отчёт и только
 * печатает его поля через `money`/`percent`/`count` из `lib/metrics/format.ts`. Ни
 * сложения, ни деления, ни округления здесь нет — это сделано в SQL (`lib/metrics/sql.ts`)
 * и в самом отчёте (`monthlyReport()`); экран посчитанное не проверяет и не трогает.
 *
 * Вынесен из страницы отдельно, чтобы его можно было отрисовать в проверке
 * (`__tests__/metrics/screen.test.tsx`) без базы: подставляется выдуманный `MonthReport`.
 */
export function Dashboard({ report }: { report: MonthReport }) {
  return (
    <main>
      <h1>Nordic Pet — прибыль{report.month === null ? '' : ` за ${report.month}`}</h1>

      {report.months.length > 0 && (
        <nav>
          <ul>
            {report.months.map((m) => (
              <li key={m.month}>
                <a href={`/?m=${m.month}`}>{m.month}</a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <section>
        <h2>Выручка</h2>
        <dl>
          <dt>Оборот</dt>
          <dd>{money(report.revenue.gross)}</dd>
          <dt>Скидки</dt>
          <dd>{money(report.revenue.discounts)}</dd>
          <dt>Возвраты</dt>
          <dd>{money(report.revenue.refunds)}</dd>
          <dt>Чистая выручка</dt>
          <dd>{money(report.revenue.net)}</dd>
        </dl>
      </section>

      <section>
        <h2>Затраты</h2>
        <dl>
          <dt>Себестоимость проданного</dt>
          <dd>{money(report.costs.cogs)}</dd>
          <dt>Реклама</dt>
          <dd>{money(report.costs.ads)}</dd>
          <dt>Комиссии платёжных систем</dt>
          <dd>{money(report.costs.fees)}</dd>
          <dt>Постоянные расходы</dt>
          <dd>{money(report.costs.fixed)}</dd>
        </dl>
      </section>

      <section>
        <h2>Итог</h2>
        <dl>
          <dt>Прибыль</dt>
          <dd>{money(report.bottom.profit)}</dd>
          <dt>Маржа</dt>
          <dd>{percent(report.bottom.marginPct)}</dd>
          <dt>окупаемость рекламы (по обороту)</dt>
          <dd>{ratio(report.bottom.roasByGross)}</dd>
        </dl>
      </section>

      <section>
        <h2>Товары</h2>
        <table>
          <thead>
            <tr>
              <th>Артикул</th>
              <th>Продано за вычетом возвратов</th>
              <th>Чистая выручка</th>
              <th>Себестоимость</th>
              <th>Прибыль</th>
            </tr>
          </thead>
          <tbody>
            {report.items.map((item) => (
              <tr key={item.sku}>
                <td>{item.sku}</td>
                <td>{count(item.units)}</td>
                <td>{money(item.net)}</td>
                <td>{money(item.cogs)}</td>
                <td>{money(item.profit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Честность данных</h2>
        <p>
          Посчитано по настоящей цене поставщика (доля от чистой выручки):{' '}
          {percent(report.honesty.sharePct)}
        </p>
        {report.honesty.skusWithoutPrice.length > 0 && (
          <p>Без цены поставщика (запасные 40%): {report.honesty.skusWithoutPrice.join(', ')}</p>
        )}
      </section>

      <section>
        <h2>Неполнота данных</h2>
        <p>Сколько пустых ячеек и по каким адресам — по каждому виду дыры отдельно.</p>
        <ul>
          {report.gaps.map((gap) => (
            <li key={gap.kind}>
              {gap.kind}: {count(String(gap.count))}
              {gap.at.length > 0 ? ` (${gap.at.join(', ')})` : ''}
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}

/**
 * Страница `/` — серверный компонент. Месяц берётся из адреса (`?m=2026-03`); без него
 * `monthlyReport()` сама берёт последний месяц, за который есть заказы (см. её
 * документацию в `lib/metrics/report.ts`). Один снимок фактов на весь экран, разметка
 * не считает ничего — всё выше уже готовыми строками.
 *
 * Кнопка «Обновить данные» (задача 8) оборачивает отчёт панелью `RefreshPanel`: разметка
 * отчёта приходит ей детьми, поэтому серверный рендер здесь не дублируется.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string | string[] }>
}) {
  const params = await searchParams
  const monthParam = Array.isArray(params.m) ? params.m[0] : params.m

  let report: MonthReport
  try {
    report = await monthlyReport(monthParam)
  } catch (error) {
    // Месяц приходит из адреса — его задаёт кто угодно. `monthlyReport()` уже отказывает
    // читаемым текстом на форме, отличной от ГГГГ-ММ; здесь этот текст просто показывается
    // на экране, а не роняет запрос до страницы ошибки Next.
    return (
      <main>
        <h1>Nordic Pet — прибыль</h1>
        <p role="alert">{(error as Error).message}</p>
      </main>
    )
  }

  return (
    <RefreshPanel>
      <Dashboard report={report} />
    </RefreshPanel>
  )
}
