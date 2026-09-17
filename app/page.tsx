import type { CSSProperties, ReactNode } from 'react'
import { redirect } from 'next/navigation'

import { проверитьДоступ } from '@/lib/auth/guard'
import { count, money, moneyMaybe, percent, points, ratio } from '@/lib/metrics/format'
import { monthlyReport, type MonthReport } from '@/lib/metrics/report'
import { LogoutButton } from './logout-button'
import { RefreshPanel } from './refresh-panel'

/**
 * Страница отдаёт числа и потому не отрисовывается заранее: у сборки нет запроса, а значит
 * нет и cookie — отрисованный заранее отчёт лежал бы готовым файлом мимо всякого сторожа.
 */
export const dynamic = 'force-dynamic'

/**
 * Подписи ступеней водопада — кусок S11. Те же слова, что у строк блоков «Выручка», «Затраты» и
 * «Итог», полностью: метрики не переименовываются и не сокращаются. Ради полных подписей водопад
 * лежит горизонтально — решение владельца по развилке Ж1.
 *
 * Кусок S13, задача 1: каскад начинается с чистой выручки — ступеней «Оборот», «Скидки» и
 * «Возвраты» больше нет, добавлен «Маржинальный доход». Кусок S13, задача 8: блоков «Выручка»,
 * «Затраты» и «Итог» на экране больше нет; первый абзац выше — история S11. Подписи остаются полными.
 */
const ПОДПИСИ_СТУПЕНЕЙ: Record<string, string> = {
  net: 'Чистая выручка',
  cogs: 'Себестоимость проданного',
  ads: 'Реклама',
  fees: 'Комиссии платёжных систем',
  margin_income: 'Маржинальный доход',
  fixed: 'Постоянные расходы',
  profit: 'Прибыль',
}

/**
 * Число со знаком единицы внутри предложения — неразрывно (кусок S11). Общий формат денег ставит перед
 * знаком обычный пробел — отложенная задача S5, общая починка тронула бы ожидаемые строки принятых
 * проверок нескольких кусков. Поэтому по отдельности: в ячейках значений перенос запрещён таблицей
 * стилей, в предложениях этого куска — здесь, заменой пробела перед знаком на неразрывный. Это обход,
 * а не починка, и он сторожится проверкой «денежное значение внутри предложения не бывает без защиты
 * от переноса» — решение владельца.
 */
function вместе(значение: string): string {
  return значение.replace(/ ([€%])$/, '\u00A0$1')
}

type Полоса = NonNullable<MonthReport['kpis']>

/**
 * Дельта одного числа результата — кусок S13. Без базы строки у числа нет: о том, что сравнить не с
 * чем, говорит одна строка на весь блок. Текст дельты — прежний, куска S11. Обёртка `kpi` с признаком
 * и строка `kpi-delta` — прежние: на них стоят правила цвета дельты, а граница зелёного прибита к ним.
 */
function строкаПоказателя(полоса: Полоса | undefined, ключ: string): ReactNode {
  if (полоса === undefined || !полоса.hasBase) return null
  const п = полоса.items.find((показатель) => показатель.key === ключ)
  if (п === undefined) return null
  const текст =
    п.delta === null
      ? `к ${полоса.prevMonth}: нет данных`
      : `${п.unit === 'eur' ? вместе(money(п.delta)) : points(п.delta)} к ${полоса.prevMonth} · ${п.verdict}`
  return (
    <span className="kpi" data-verdict={п.verdict ?? undefined}>
      <span className="kpi-delta">{текст}</span>
    </span>
  )
}

/**
 * Выводы — кусок S13, задача 10. До трёх строк в порядке договора: реклама → постоянные →
 * приблизительная. Слово, знак и вид строки выбираются по готовым признакам отчёта (`findings`);
 * разметка ничего не сравнивает. Тексты — из таблицы задачи буквально. Доля по настоящей цене
 * приходит из единственного чтения в `Dashboard`, а не читается здесь второй раз.
 *
 * Знак процента в постоянных частях текста («100 %», «40 %») стоит за неразрывным пробелом: сторож
 * переноса требует защиты у каждого числа со знаком внутри предложения.
 */
function Выводы({ report, доля }: { report: MonthReport; доля: MonthReport['honesty']['sharePct'] }) {
  if (report.findings === undefined) return null
  const порог = report.payback?.breakevenRoas ?? null
  const вклад = report.payback?.contributionPct ?? null

  const строкаРекламы = report.findings.adsVerdict !== null && (
    <li className="finding" data-kind={report.findings.adsVerdict === 'окупается' ? 'хорошо' : 'тревога'}>
      {report.findings.adsVerdict === 'порога нет' ? (
        <>
          <p>{`⚠ Порога окупаемости нет: вклад с евро оборота не положителен, ${вместе(percent(вклад))}.`}</p>
          <p className="finding-why">Вклад — наш счёт: (чистая выручка − себестоимость − комиссии) ÷ оборот.</p>
        </>
      ) : (
        <>
          <p>
            {report.findings.adsVerdict === 'окупается'
              ? `✓ Реклама окупается: ${ratio(report.bottom.roasByGross)} при пороге ${ratio(порог)}.`
              : `⚠ Реклама не окупается: ${ratio(report.bottom.roasByGross)} при пороге ${ratio(порог)}.`}
          </p>
          <p className="finding-why">
            {`Порог — наш счёт: 100 ÷ вклад с евро оборота, ${вместе(percent(вклад))}. Это итог по всей рекламе месяца, а не отдача от следующего вложенного евро.`}
          </p>
        </>
      )}
    </li>
  )

  const строкаПостоянных = (
    <li className="finding" data-kind={report.findings.loss ? 'тревога' : 'обычно'}>
      <p>
        {report.findings.loss
          ? report.findings.fixedSharePct !== null
            ? `⚠ Месяц в убытке: постоянные расходы ${вместе(money(report.costs.fixed))} — ${вместе(percent(report.findings.fixedSharePct))} маржинального дохода.`
            : `⚠ Месяц в убытке: маржинальный доход ${вместе(moneyMaybe(report.findings.marginIncome))} не положителен.`
          : `Постоянные расходы ${вместе(money(report.costs.fixed))} съедают ${вместе(percent(report.findings.fixedSharePct))} маржинального дохода.`}
      </p>
      <p className="finding-why">
        {`Маржинальный доход — наш счёт: чистая выручка − себестоимость − реклама − комиссии, ${вместе(moneyMaybe(report.findings.marginIncome))}. Тревога — когда месяц в убытке: прибыль меньше нуля.`}
      </p>
    </li>
  )

  const строкаПриблизительной = report.findings.approximate && (
    <li className="finding" data-kind="тревога">
      <p>{`⚠ Прибыль приблизительная: у ${report.honesty.skusWithoutPrice.join(', ')} нет цены поставщика.`}</p>
      <p className="finding-why">
        {`Их себестоимость подставлена запасными 40\u00A0%; по настоящей цене посчитано ${вместе(percent(доля))} чистой выручки.`}
      </p>
    </li>
  )

  return (
    <section className="block findings">
      <h2>Выводы</h2>
      <ul>{строкаРекламы}{строкаПостоянных}{строкаПриблизительной}</ul>
    </section>
  )
}

/** Ширины колонок таблицы товаров — одни на обе таблицы: видимую пятёрку и раскрытую часть. */
const КОЛОНКИ_ТОВАРОВ = ['13%', '10%', '15%', '15%', '16%', '10%', '21%']

type СтрокаОтчёта = MonthReport['items'][number]
type ИтогиТоваров = MonthReport['itemsSummary']

/**
 * Строка товара — кусок S13, задача 12. Тело — прежняя строка таблицы; пометка подстановки короткая
 * и ведёт на блок качества. Колонки маржи и доли рисуются только при итогах — у прежних раскладок
 * их нет (кусок S11).
 *
 * Полоска доли — то же условие владельца, что у полосы честности (кусок S9): она получает то самое
 * значение, что напечатано текстом, и разметка над ним ничего не делает; длину ограничивает `clamp`
 * в таблице стилей. Нет доли — нет полоски: полоска нулевой длины сказала бы «ноль».
 */
function СтрокаТовара({ item, итоги }: { item: СтрокаОтчёта; итоги: ИтогиТоваров }) {
  return (
    <tr data-loss={item.loss === true ? 'true' : undefined}>
      <td>{item.sku}</td>
      <td>{count(item.units)}</td>
      <td>{money(item.net)}</td>
      <td>
        {money(item.cogs)}
        {item.подстановка !== undefined && (
          <a className="substituted" href="#kachestvo">
            {item.подстановка === 'вся' ? '⚠ подставлена' : '⚠ подставлена частью'}
          </a>
        )}
      </td>
      <td>{money(item.profit)}</td>
      {итоги !== undefined && <td>{percent(item.marginPct ?? null)}</td>}
      {итоги !== undefined && (
        <td>
          {percent(item.profitSharePct ?? null)}
          {item.profitSharePct != null && (
            <span className="items-bar" aria-hidden="true">
              <span className="items-bar-fill" style={{ '--item-share': `${item.profitSharePct}%` } as CSSProperties} />
            </span>
          )}
        </td>
      )}
    </tr>
  )
}

/** Таблица товаров — одна на видимую пятёрку и на раскрытую часть, с одним описанием колонок. */
function ТаблицаТоваров({ строки, итоги }: { строки: СтрокаОтчёта[]; итоги: ИтогиТоваров }) {
  return (
    <table>
      <colgroup>{КОЛОНКИ_ТОВАРОВ.map((ширина, i) => <col key={i} style={{ width: ширина }} />)}</colgroup>
      <thead>
        <tr>
          <th scope="col">Артикул</th>
          <th scope="col">Продано за вычетом возвратов</th>
          <th scope="col">Чистая выручка</th>
          <th scope="col">Себестоимость</th>
          <th scope="col">Валовая прибыль</th>
          {итоги !== undefined && <th>Маржа от чистой выручки</th>}
          {итоги !== undefined && <th>Доля в валовой прибыли товаров</th>}
        </tr>
      </thead>
      <tbody>
        {строки.map((item) => (
          <СтрокаТовара key={item.sku} item={item} итоги={итоги} />
        ))}
      </tbody>
    </table>
  )
}

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
  // Доля честности читается **один раз, в одну величину**, и дальше её берут все показы: строка
  // доли под прибылью в блоке результата (кусок S13), напечатанное число и длина полосы в блоке
  // качества, пояснение строки о приблизительной прибыли в выводах (задача 10). Это условие владельца, а не удобство: пока значение одно, ни полоса, ни строка под
  // прибылью не могут разойтись с числом. Второе чтение того же поля рядом с первым
  // было бы вторым источником правды, и однажды они разъехались бы молча.
  const доля = report.honesty.sharePct
  const полоса = report.kpis

  return (
    <main className="report">
      <header className="report-head">
        <h1>Nordic Pet — прибыль{report.month === null ? '' : ` за ${report.month}`}</h1>

        {report.months.length > 0 && (
          <nav className="months">
            <ul>
              {report.months.map((m) => (
                <li key={m.month}>
                  <a
                    href={`/?m=${m.month}`}
                    aria-current={m.month === report.month ? 'page' : undefined}
                    data-empty={m.hasOrders ? undefined : 'true'}
                  >
                    {m.month}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {/*
          Время чтения источников — кусок S11, шаг 6. Строка готовая из SQL: дата, время и пояс;
          разметка её не разбирает и не переводит. Стоит последней в шапке и во всю её ширину — под
          названием и месяцами: название ничем не оборачивается, и порядок чтения совпадает с видом.
        */}
        {report.sourcesReadAt !== undefined && (
          <p className="report-read-at">
            {report.sourcesReadAt === null
              ? 'Время чтения источников неизвестно: отметки о чтении нет.'
              : `Источники прочитаны по состоянию на ${report.sourcesReadAt}`}
          </p>
        )}
      </header>

      {/*
        Результат месяца — кусок S13, задача 9. Прибыль — единственное крупное число; соседи мельче.
        Дельта, её знак и смысл, признак базы, слово окупаемости и признак приблизительности приходят
        готовыми: разметка ничего не сравнивает.
      */}
      <section className="block result" aria-label="Результат месяца">
        <div className="result-main">
          <h2>Прибыль</h2>
          <p className="result-profit">{money(report.bottom.profit)}</p>
          {строкаПоказателя(полоса, 'profit')}
          <p className="result-accuracy">
            {report.findings?.approximate === true && <span className="result-approx">приблизительно</span>}
            {`Посчитано по настоящей цене поставщика: ${вместе(percent(доля))} · `}
            <a href="#kachestvo">что подставлено</a>
          </p>
        </div>
        <dl className="result-stats">
          <dt>Чистая выручка</dt>
          <dd>{money(report.revenue.net)}{строкаПоказателя(полоса, 'net')}</dd>
          <dt>Маржа от чистой выручки</dt>
          <dd>{percent(report.bottom.marginPct)}{строкаПоказателя(полоса, 'margin')}</dd>
          <dt>Окупаемость рекламы по обороту</dt>
          <dd>
            {ratio(report.bottom.roasByGross)}
            {report.findings?.adsVerdict != null && report.payback !== undefined && (
              <span className="result-verdict" data-verdict={report.findings.adsVerdict}>
                {report.findings.adsVerdict === 'порога нет'
                  ? 'порога нет'
                  : `${report.findings.adsVerdict} · порог ${ratio(report.payback.breakevenRoas)}`}
              </span>
            )}
          </dd>
        </dl>
        {полоса !== undefined && !полоса.hasBase && (
          <p className="result-base">
            {полоса.prevMonth === null
              ? 'Сравнить не с чем: прошлого месяца в данных нет.'
              : `Сравнить с ${полоса.prevMonth} нельзя: в ${полоса.prevMonth} заказов нет.`}
          </p>
        )}
      </section>

      <Выводы report={report} доля={доля} />

      {report.waterfall !== undefined && (
        <section className="block waterfall">
          <h2>Куда ушли деньги</h2>
          {/*
            Водопад — кусок S11. Разметка ничего не считает: сумма, доля и края столбика приходят
            готовыми строками из SQL. Доля печатается текстом и **та же строка** уходит величиной
            в длину столбика, край — в его начало; где стоит столбик на дорожке, решает таблица
            стилей по пределам шкалы. Подпись, сумма и доля — отдельные ячейки вне дорожки: наехать
            на столбик им негде по устройству.
          */}
          <ol
            className="waterfall-steps"
            style={
              {
                // Пределов нет только при чистой выручке не больше нуля (кусок S13, задача 1) — тогда
                // нет и ни одного столбика.
                '--scale-from': report.waterfall.scaleLowPct ?? undefined,
                '--scale-to': report.waterfall.scaleHighPct ?? undefined,
              } as CSSProperties
            }
          >
            {report.waterfall.steps.map((ступень) => (
              <li key={ступень.key} data-kind={ступень.kind}>
                <span className="waterfall-label">
                  {ПОДПИСИ_СТУПЕНЕЙ[ступень.key] ?? ступень.key}
                </span>
                <span className="waterfall-track" aria-hidden="true">
                  {ступень.sharePct !== null && ступень.basePct !== null && (
                    <span
                      className="waterfall-bar"
                      style={
                        {
                          '--step-from': ступень.basePct,
                          '--step-size': ступень.sharePct,
                        } as CSSProperties
                      }
                    />
                  )}
                </span>
                {/*
                  Нет ни одной строки рекламы за месяц — у ступени пусто и здесь, и в доле: признак
                  `ЕСТЬ_РЕКЛАМА` слоя метрик. Доли рекламы в полосе показателей, у которой было то же
                  правило, с куска S13 (задача 6) нет. Формат денег не тронут: словами отвечает
                  разметка.
                */}
                <span className="waterfall-amount">
                  {ступень.amount === null ? 'нет данных' : money(ступень.amount)}
                </span>
                <span className="waterfall-share">
                  {ступень.sharePct === null
                    ? percent(null)
                    : `${percent(ступень.sharePct)} чистой выручки`}
                </span>
              </li>
            ))}
          </ol>
          <p className="waterfall-gap">
            {`Скидки ${вместе(money(report.revenue.discounts))} и возвраты ${вместе(money(report.revenue.refunds))} сняты с оборота ${вместе(money(report.revenue.gross))} до этой шкалы.`}
          </p>
          {/*
            Расхождение цепочки с итогом — центы округления, решение владельца по развилке Ж2.
            Число готовое из SQL: ровно разница показанных сумм. Строка есть, только когда оно есть.
          */}
          {typeof report.waterfall.netGap === 'string' && (
            <p className="waterfall-gap">
              {`Суммы ступеней округлены до цента по отдельности; сложенные, они расходятся с чистой выручкой на ${вместе(money(report.waterfall.netGap))}.`}
            </p>
          )}
          {typeof report.waterfall.profitGap === 'string' && (
            <p className="waterfall-gap">
              {`Суммы ступеней округлены до цента по отдельности; сложенные, они расходятся с прибылью на ${вместе(money(report.waterfall.profitGap))}.`}
            </p>
          )}
        </section>
      )}

      {report.daily !== undefined && !report.daily.hasOrders && (
        // Решение владельца по Д3: у месяца без заказов блока нет вовсе — на его месте слова, а не
        // пустая рамка.
        <p className="daily-empty">Чистая выручка по дням: нет данных за месяц</p>
      )}

      {report.daily !== undefined && report.daily.hasOrders && (
        <section className="block daily">
          <h2>Чистая выручка по дням</h2>
          {/*
            Ряд — кусок S11, шаг 2. Блок называется выручкой и только выручкой: прибыль по дням не
            считается (постоянные расходы лежат помесячно). Разметка ничего не считает: доля и край
            столбика, подписи оси и шаг видимых подписей дней приходят готовыми из SQL. Доступная
            подпись есть у каждого дня без исключения — ею ряд читает тот, кто не читает глазом.
          */}
          <div className="daily-chart">
            <div className="daily-axis" aria-hidden="true">
              {report.daily.topNet !== null && <span>{money(report.daily.topNet)}</span>}
              {report.daily.bottomNet !== null && <span>{money(report.daily.bottomNet)}</span>}
            </div>
            {/*
              Кусок S13, задача 11: столбики и пунктир средней — в одной области. Пунктир не может жить
              внутри `ol` (`div` в `ol`), поэтому он сосед списка; пределы шкалы у него те же поля отчёта,
              что у списка столбиков, а место — готовая доля средней.
            */}
            <div className="daily-plot">
              <ol
                className="daily-bars"
                style={
                  {
                    '--scale-from': report.daily.scaleLowPct ?? undefined,
                    '--scale-to': report.daily.scaleHighPct ?? undefined,
                  } as CSSProperties
                }
              >
                {report.daily.days.map((день) => (
                  <li
                    key={день.day}
                    data-empty={день.net === null ? 'true' : undefined}
                    aria-label={
                      день.net === null
                        ? `${день.label}: заказов не было`
                        : `${день.label}: ${money(день.net)}`
                    }
                  >
                    {день.sharePct !== null && день.basePct !== null && (
                      <span
                        className="daily-bar"
                        style={
                          { '--day-from': день.basePct, '--day-size': день.sharePct } as CSSProperties
                        }
                      />
                    )}
                  </li>
                ))}
              </ol>
              {report.daily.avgPct != null && report.daily.avgNet != null && (
                <div
                  className="daily-mean"
                  style={
                    {
                      '--mean-at': report.daily.avgPct,
                      '--scale-from': report.daily.scaleLowPct ?? undefined,
                      '--scale-to': report.daily.scaleHighPct ?? undefined,
                    } as CSSProperties
                  }
                >
                  <span className="daily-mean-label">{`средняя ${вместе(moneyMaybe(report.daily.avgNet))} ${report.daily.avgBase}`}</span>
                </div>
              )}
            </div>
            <ol className="daily-ticks" aria-hidden="true">
              {report.daily.days.map((день) => (
                <li key={день.day}>{день.tick}</li>
              ))}
            </ol>
          </div>
          {report.daily.hasEmptyDays === true && (
            <p className="daily-note">Пунктир у дня — заказов в этот день не было; в среднюю такой день входит нулём.</p>
          )}
        </section>
      )}

      <section className="block items">
        <h2>Товары</h2>
        {/*
          Кусок S11, шаг 4. Строка над таблицей и две колонки рисуются только при своих полях — у
          прежних раскладок разметка таблицы не меняется ни на байт. Правило владельца: отношение
          называет свою базу рядом с собой, — база долей названа здесь числом, и отличие её от
          прибыли месяца тоже. Все числа готовые из SQL.
        */}
        {report.itemsSummary !== undefined && (
          <p className="items-summary">
            {report.itemsSummary.skusFor80 !== null
              ? `80\u00A0% валовой прибыли товаров дают ${count(String(report.itemsSummary.skusFor80))} из ${count(String(report.itemsSummary.skusTotal))} артикулов; в минусе — ${count(String(report.itemsSummary.negativeCount))}. Валовая прибыль товаров — выручка минус себестоимость, ${вместе(money(report.itemsSummary.productsProfit))}; это не прибыль месяца, ${вместе(money(report.bottom.profit))}.`
              : `Валовая прибыль товаров — выручка минус себестоимость, ${вместе(money(report.itemsSummary.productsProfit))} — не положительна: считать 80\u00A0% не от чего; в минусе — ${count(String(report.itemsSummary.negativeCount))}. Это не прибыль месяца, ${вместе(money(report.bottom.profit))}.`}
          </p>
        )}
        {/*
          Кусок S12, задача 6. На узком экране таблица прокручивается внутри карточки, и колонки за
          правым краем не видно ничем — ни полосой, ни обрывом. Строка говорит об этом словами.
          Показывается она только на узком: на широком колонки видны все, и строка соврала бы.

          Условие на строках и колонках — круг проверки кода 1: у месяца без единого товара тело
          таблицы пусто, колонок пять, и прокручиваться нечему. Строка, сказавшая там про «ещё
          колонки», была бы утверждением, не выведенным из состояния.

          **Чего это условие не закрывает и что названо слабым:** строка привязана к ширине окна, а
          не к тому, вправду ли содержимое не помещается. На ширине чуть меньше порога таблица
          укладывается целиком, а строка всё равно стоит. Признак переполнения знает только браузер,
          а клиентского кода на этой странице нет вовсе.
        */}
        {report.items.length > 0 && report.itemsSummary !== undefined && (
          <p className="items-scroll">
            Таблица прокручивается вбок: за правым краем есть ещё колонки.
          </p>
        )}
        <ТаблицаТоваров строки={report.items.filter((item) => item.inTop !== false)} итоги={report.itemsSummary} />
        {/*
          Кусок S13, задача 12 (решение владельца Э4). Пятёрку выбирает слой метрик признаком; разметка
          раскладывает по признаку и не сравнивает чисел. Прежние раскладки без поля остаются целиком в
          первой таблице. Число в переключателе — поле отчёта, а не счёт строк. Родной элемент страницы,
          без клиентского кода.
        */}
        {report.items.some((item) => item.inTop === false) && report.itemsSummary !== undefined && (
          <details className="items-more">
            <summary>{`Показать все артикулы месяца — ${count(String(report.itemsSummary.skusTotal))}`}</summary>
            <ТаблицаТоваров строки={report.items.filter((item) => item.inTop === false)} итоги={report.itemsSummary} />
          </details>
        )}
      </section>

      <section id="kachestvo" className="block quality">
        <h2>Качество данных</h2>
        <p>
          Посчитано по настоящей цене поставщика (доля от чистой выручки):{' '}
          <strong className="share-value">{percent(доля)}</strong>
        </p>
        {доля !== null && (
          <div className="share" aria-hidden="true">
            {/*
              Значение уходит в таблицу стилей величиной, а длину из неё делает `clamp` — и это
              не украшение, а починка настоящей лжи. Прежде значение подставлялось прямо в
              ширину, и при отрицательной доле объявление становилось негодным: браузер
              откатывался к ширине по умолчанию и рисовал полосу **во всю дорожку**. Замерено:
              при доле −12,3 % заполнение занимало 328,8 из 328,8 пикселей, то есть полоса
              говорила «посчитано всё» там, где текст рядом говорил «минус двенадцать».
              Найдено проверкой кода, подтверждено замером.

              Разметка при этом по-прежнему ничего не считает: она отдаёт то же самое значение,
              что печатает текстом, и не делает над ним ни одного действия.
            */}
            <div className="share-fill" style={{ '--share': `${доля}%` } as CSSProperties} />
          </div>
        )}
        {report.honesty.skusWithoutPrice.length > 0 && (
          <p>Без цены поставщика (запасные 40%): {report.honesty.skusWithoutPrice.join(', ')}</p>
        )}
        <h3>Неполнота данных</h3>
        <p>Сколько пустых ячеек и по каким адресам — по каждому виду дыры отдельно.</p>
        {report.gaps.some((gap) => gap.hasHoles === true) ? (
          <ul className="gaps-holes">
            {report.gaps
              .filter((gap) => gap.hasHoles === true)
              .map((gap) => (
                <li key={gap.kind}>
                  {gap.kind}: {count(String(gap.count))}
                  {gap.at.length > 0 ? ` (${gap.at.join(', ')})` : ''}
                </li>
              ))}
          </ul>
        ) : (
          <p>Дыр в данных нет.</p>
        )}
        <details className="gaps-more">
          <summary>Показать все виды неполноты</summary>
          <ul>
            {report.gaps.map((gap) => (
              <li key={gap.kind} data-zero={gap.hasHoles === true ? undefined : 'true'}>
                {gap.kind}: {count(String(gap.count))}
                {gap.at.length > 0 ? ` (${gap.at.join(', ')})` : ''}
              </li>
            ))}
          </ul>
        </details>
      </section>
    </main>
  )
}

/** Форма месяца из адреса: ровно `ГГГГ-ММ`, месяц от 01 до 12. */
const ФОРМА_МЕСЯЦА = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * Текст для экрана при отказе «данные не читаются». Повторён здесь строкой нарочно: страница
 * не берёт на экран **ничего** из сообщения отказа, и это единственный способ сделать утечку
 * адреса базы невозможной по построению, а не по бдительности. Что строка та же самая,
 * сторожит своя проверка.
 */
export const ТЕКСТ_ДАННЫЕ_НЕ_ЧИТАЮТСЯ =
  'Данные сейчас не читаются: база не ответила. Числа не показаны нарочно — показывать ' +
  'старые как свежие хуже, чем не показать никаких. Обновите страницу через минуту; если ' +
  'повторится, скажите разработчику.'

/**
 * Отказ отчёта узнаётся по своему виду, а не по вводу.
 *
 * Проверка идёт по признакам самого значения, а не через `instanceof`, и это не небрежность:
 * принятые проверки S6 подставляют слой метрик целиком, без класса отказа, и `instanceof` по
 * несуществующему ввозу уронил бы страницу там, где она обязана работать.
 */
function видОтказа(error: unknown): 'кривой месяц' | 'данные не читаются' | null {
  if (!(error instanceof Error)) return null
  const вид = (error as { вид?: unknown }).вид
  return вид === 'кривой месяц' || вид === 'данные не читаются' ? вид : null
}

/**
 * Страница `/` — серверный компонент. Месяц берётся из адреса (`?m=2026-03`); без него
 * `monthlyReport()` сама берёт последний месяц, за который есть заказы (см. её
 * документацию в `lib/metrics/report.ts`). Один снимок фактов на весь экран, разметка
 * не считает ничего — всё выше уже готовыми строками.
 *
 * Кнопка «Обновить данные» (задача 8) оборачивает отчёт панелью `RefreshPanel`: разметка
 * отчёта приходит ей детьми, поэтому серверный рендер здесь не дублируется.
 *
 * **Свой сторож — первой строкой, до всякой работы** (S6). Общий слой закрытия
 * (`proxy.ts`) стоит перед этой страницей, но один он не считается: перенос пути или
 * правка образца молча вывели бы страницу из-под него, а числа отсюда уходят в чужой
 * браузер. Сторож зовётся до `monthlyReport()`, то есть до похода в базу: не вошедший не
 * должен стоить нам ни одного запроса.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string | string[] }>
}) {
  if ((await проверитьДоступ()) === 'отказать') redirect('/login')

  const params = await searchParams
  const monthParam = Array.isArray(params.m) ? params.m[0] : params.m

  let report: MonthReport
  try {
    report = await monthlyReport(monthParam)
  } catch (error) {
    // S8: различаем по **самому отказу**, а не по вводу. Отказ отчёта теперь называет свой вид
    // сам (`ОтказОтчёта`), и оба вида показываются человеку страницей: кривой месяц он
    // поправит в адресе, а «данные не читаются» ему не починить — но он обязан знать, что
    // числа не показаны нарочно, а не потерялись.
    //
    // Текст отказа «данные не читаются» составлен нами и адреса базы не содержит по
    // построению: подлинная причина остаётся в `cause`, то есть в журнале, а не на экране.
    const вид = видОтказа(error)
    if (вид !== null) {
      // Подлинная причина — в журнал сервера, а не на экран. Прежде она не доезжала никуда:
      // на экран не идёт нарочно, а в журнал её никто не писал, и боевой сбой базы не оставлял
      // следа вовсе. Найдено проверкой кода.
      if (вид === 'данные не читаются') console.error('отказ отчёта:', error)

      // «Данные не читаются» показывается **нашим** постоянным текстом: сообщение отказа несёт
      // подлинную причину вместе с адресом базы, и на экран оно не идёт вовсе. Кривой месяц —
      // наоборот: его текст составлен нами и говорит человеку, что поправить в адресе.
      const текст =
        вид === 'данные не читаются' ? ТЕКСТ_ДАННЫЕ_НЕ_ЧИТАЮТСЯ : (error as Error).message
      return (
        <main>
          <h1>Nordic Pet — прибыль</h1>
          <p role="alert">{текст}</p>
          <LogoutButton />
        </main>
      )
    }

    // Наследство S6: принятая проверка того куска подставляет вместо отчёта **обычную**
    // ошибку с текстом про форму месяца и ждёт, что страница её покажет. Ветка оставлена
    // ради неё и только ради неё; настоящий отчёт сюда не попадает — он называет свой вид.
    // Убрать её значит покрасить принятую проверку прошлого куска, а это находка к владельцу,
    // а не мелочь по дороге: названа в теле pull request.
    if (monthParam !== undefined && !ФОРМА_МЕСЯЦА.test(monthParam)) {
      return (
        <main>
          <h1>Nordic Pet — прибыль</h1>
          <p role="alert">{(error as Error).message}</p>
        </main>
      )
    }

    throw error
  }

  // Кнопка выхода стоит рядом с отчётом, а не внутри `Dashboard`: `Dashboard` — чистая
  // разметка чисел, её рисуют проверки экрана без всякого серверного действия.
  return (
    <>
      <LogoutButton />
      {/*
        Пометка холодного открытия — задача 5 куска S8. Человек, открывший страницу заново,
        прежде видел устаревшие числа без всякого предупреждения: пометка приходила только от
        неудачного нажатия кнопки, то есть только тому, кто нажимал. Это разные механизмы, и
        оба нужны.
      */}
      {report.устарели === true && (
        <p role="status">
          Числа отстали от источников: сырьё менялось после последнего разбора. Нажмите
          «Обновить данные».
        </p>
      )}
      <RefreshPanel>
        <Dashboard report={report} />
      </RefreshPanel>
    </>
  )
}
