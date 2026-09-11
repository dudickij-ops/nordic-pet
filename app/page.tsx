import type { CSSProperties } from 'react'
import { redirect } from 'next/navigation'

import { проверитьДоступ } from '@/lib/auth/guard'
import { count, money, percent, points, ratio } from '@/lib/metrics/format'
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
 */
const ПОДПИСИ_СТУПЕНЕЙ: Record<string, string> = {
  gross: 'Оборот',
  discounts: 'Скидки',
  refunds: 'Возвраты',
  net: 'Чистая выручка',
  cogs: 'Себестоимость проданного',
  ads: 'Реклама',
  fees: 'Комиссии платёжных систем',
  fixed: 'Постоянные расходы',
  profit: 'Прибыль',
}

/**
 * Подписи полосы показателей — кусок S11, шаг 7. У отношений база названа в самой подписи (правило
 * владельца: отношение называет свою базу рядом с собой) — маржа от чистой выручки, доля рекламы от
 * оборота; дельты этих двух — в процентных пунктах, и это говорит единица дельты.
 */
const ПОДПИСИ_ПОКАЗАТЕЛЕЙ: Record<string, string> = {
  profit: 'Прибыль',
  margin: 'Маржа от чистой выручки',
  net: 'Чистая выручка',
  ad_share: 'Доля рекламы от оборота',
}

type Полоса = NonNullable<MonthReport['kpis']>
type Показатель = Полоса['items'][number]

/** Значение карточки — всегда: деньгами или процентами, `null` — словами «нет данных». */
function значениеПоказателя(п: Показатель): string {
  if (п.unit === 'pp') return percent(п.value)
  return п.value === null ? 'нет данных' : money(п.value)
}

/**
 * Строка дельты карточки — одна короткая строка. Базы нет — так и сказано, с месяцем, у которого нет
 * заказов; база есть, а дельты нет (у прошлого месяца нет рекламы или маржи) — «нет данных».
 */
function строкаДельты(полоса: Полоса, п: Показатель): string {
  if (!полоса.hasBase) {
    return полоса.prevMonth === null
      ? 'нет базы для сравнения'
      : `нет базы: в ${полоса.prevMonth} заказов нет`
  }
  if (п.delta === null) return `к ${полоса.prevMonth}: нет данных`
  return `${п.unit === 'eur' ? money(п.delta) : points(п.delta)} к ${полоса.prevMonth} · ${п.verdict}`
}

/**
 * Доля статьи затрат в обороте — кусок S11, шаг 5. Это та же готовая доля, что у ступени водопада
 * (решение: одна база — оборот, одно поле): статья берёт её по своему ключу, своего счёта нет. Текст
 * и длина полоски — одно значение, как у полосы доли честности. Нет водопада в отчёте — нет и доли:
 * у прежних раскладок блок «Затраты» не меняется ни на байт.
 */
function ДоляСтатьи({ report, ключ }: { report: MonthReport; ключ: string }) {
  if (report.waterfall === undefined) return null
  const доля = report.waterfall.steps.find((с) => с.key === ключ)?.sharePct ?? null
  return (
    <span className="cost-share">
      <span>{доля === null ? percent(null) : `${percent(доля)} оборота`}</span>
      {доля !== null && (
        <span className="cost-bar" aria-hidden="true">
          <span className="cost-bar-fill" style={{ '--cost-share': доля } as CSSProperties} />
        </span>
      )}
    </span>
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
  // Доля честности читается **один раз, в одну величину**, и дальше её берут оба показа:
  // напечатанное число и длина полосы. Это условие владельца, а не удобство: пока значение
  // одно, полоса не может разойтись с числом. Второе чтение того же поля рядом с первым
  // было бы вторым источником правды, и однажды они разъехались бы молча.
  const доля = report.honesty.sharePct
  const полоса = report.kpis

  // «Съедает больше всего» — ступени, помеченные запросом; своего «самого большого» разметка не
  // ищет. Без доли (нулевой оборот) строки нет: сказать «… % оборота» не о чем.
  const съедает = report.waterfall?.steps.filter((с) => с.largest === true && с.sharePct !== null) ?? []
  const подписьСтроки = (с: { key: string }) =>
    (ПОДПИСИ_СТУПЕНЕЙ[с.key] ?? с.key).toLocaleLowerCase('ru')

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
        Полоса показателей — кусок S11, шаг 7. Значение стоит всегда; пустой бывает только дельта, и
        тогда на её месте одна короткая строка. Дельта, её знак и её смысл («лучше», «хуже», «без
        изменений») приходят готовыми из SQL: разметка знак с нулём не сравнивает, а прошлых значений,
        из которых дельту можно было бы посчитать, в отчёте нет вовсе. Смысл назван словом, а не
        только цветом: признак на карточке нужен таблице стилей, слово — человеку.
      */}
      {полоса !== undefined && (
        <section className="block kpis" aria-label="Показатели месяца">
          <ul className="kpi-list">
            {полоса.items.map((п) => (
              <li key={п.key} className="kpi" data-verdict={п.verdict ?? undefined}>
                <span className="kpi-label">{ПОДПИСИ_ПОКАЗАТЕЛЕЙ[п.key] ?? п.key}</span>
                <span className="kpi-value">{значениеПоказателя(п)}</span>
                <span className="kpi-delta">{строкаДельты(полоса, п)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.waterfall !== undefined && (
        <section className="block waterfall">
          <h2>Куда ушли деньги</h2>
          {/*
            Подпись, а не тревога: обычный текст, без сигнального цвета — решение владельца. Второй
            канал того же смысла, что длина светлых ступеней: словом, а не сравнением полос на глаз.
          */}
          {съедает.length === 1 && (
            <p className="waterfall-largest">
              {`Съедает больше всего: ${подписьСтроки(съедает[0])} · ${percent(съедает[0].sharePct)} оборота`}
            </p>
          )}
          {съедает.length > 1 && (
            <p className="waterfall-largest">
              {`Съедает больше всего поровну: ${съедает.map(подписьСтроки).join(' и ')} · по ${percent(съедает[0].sharePct)} оборота`}
            </p>
          )}
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
                // Пределов нет только при нулевом обороте — тогда нет и ни одного столбика.
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
                <span className="waterfall-amount">{money(ступень.amount)}</span>
                <span className="waterfall-share">
                  {ступень.sharePct === null
                    ? percent(null)
                    : `${percent(ступень.sharePct)} оборота`}
                </span>
              </li>
            ))}
          </ol>
          {/*
            Расхождение цепочки с итогом — центы округления, решение владельца по развилке Ж2.
            Число готовое из SQL: ровно разница показанных сумм. Строка есть, только когда оно есть.
          */}
          {typeof report.waterfall.netGap === 'string' && (
            <p className="waterfall-gap">
              {`Суммы ступеней округлены до цента по отдельности; сложенные, они расходятся с чистой выручкой на ${money(report.waterfall.netGap)}.`}
            </p>
          )}
          {typeof report.waterfall.profitGap === 'string' && (
            <p className="waterfall-gap">
              {`Суммы ступеней округлены до цента по отдельности; сложенные, они расходятся с прибылью на ${money(report.waterfall.profitGap)}.`}
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
            <ol className="daily-ticks" aria-hidden="true">
              {report.daily.days.map((день) => (
                <li key={день.day}>{день.tick}</li>
              ))}
            </ol>
          </div>
        </section>
      )}

      <section className="block">
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

      <section className="block">
        <h2>Затраты</h2>
        <dl>
          <dt>Себестоимость проданного</dt>
          <dd>
            {money(report.costs.cogs)}
            <ДоляСтатьи report={report} ключ="cogs" />
          </dd>
          <dt>Реклама</dt>
          <dd>
            {money(report.costs.ads)}
            <ДоляСтатьи report={report} ключ="ads" />
          </dd>
          <dt>Комиссии платёжных систем</dt>
          <dd>
            {money(report.costs.fees)}
            <ДоляСтатьи report={report} ключ="fees" />
          </dd>
          <dt>Постоянные расходы</dt>
          <dd>
            {money(report.costs.fixed)}
            <ДоляСтатьи report={report} ключ="fixed" />
          </dd>
        </dl>
      </section>

      <section className="block bottom-line">
        <h2>Итог</h2>
        <dl>
          <dt>Прибыль</dt>
          <dd>{money(report.bottom.profit)}</dd>
          <dt>Маржа</dt>
          <dd>{percent(report.bottom.marginPct)}</dd>
          <dt>Окупаемость рекламы (по обороту)</dt>
          <dd>{ratio(report.bottom.roasByGross)}</dd>
        </dl>
      </section>

      {report.payback !== undefined && (
        <section className="block payback">
          <h2>Окупаемость рекламы</h2>
          {/*
            Кусок S11, шаг 3. Окупаемость по обороту до шага вкладок стоит в «Итоге» выше и переезжает
            сюда на шаге вкладок — решение владельца по В7. Условия владельца к этому блоку: порог и
            вклад стоят числами; подпись порога называет его базу — вклад, а не маржу экрана; рядом
            сказано, что определения наши. Все числа готовые из SQL.
          */}
          <dl>
            <dt>Окупаемость рекламы (по прибыли)</dt>
            <dd>
              {ratio(report.payback.roasByProfit)}
              {/*
                Правило владельца: отношение называет свою базу рядом с числом. Это число читается
                противоположно порогу, хотя противоречия нет, — фраза стоит в той же ячейке.
              */}
              <span className="payback-why">
                После постоянных расходов — они от рекламы не зависят, поэтому окупается ли реклама,
                говорит порог, а не это число.
              </span>
            </dd>
            <dt>Вклад с евро оборота</dt>
            <dd>{percent(report.payback.contributionPct)}</dd>
            <dt>Порог окупаемости — от вклада, а не от маржи</dt>
            <dd>
              {report.payback.breakevenNote !== null
                ? `порога нет: ${report.payback.breakevenNote}`
                : ratio(report.payback.breakevenRoas)}
            </dd>
          </dl>
          <p className="payback-note">
            Вклад и порог — наши определения. Вклад — (чистая выручка − себестоимость − комиссии) ÷
            оборот: сколько с евро оборота остаётся на рекламу и постоянные расходы. Порог — 100 ÷
            вклад: реклама окупается, когда окупаемость по обороту выше порога.
          </p>
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
              ? `80 % прибыли товаров дают ${count(String(report.itemsSummary.skusFor80))} из ${count(String(report.itemsSummary.skusTotal))} артикулов; в минусе — ${count(String(report.itemsSummary.negativeCount))}. Прибыль товаров — выручка минус себестоимость, ${money(report.itemsSummary.productsProfit)}; это не прибыль месяца, ${money(report.bottom.profit)}.`
              : `Прибыль товаров — выручка минус себестоимость, ${money(report.itemsSummary.productsProfit)} — не положительна: считать 80 % не от чего; в минусе — ${count(String(report.itemsSummary.negativeCount))}. Это не прибыль месяца, ${money(report.bottom.profit)}.`}
          </p>
        )}
        <table>
          <thead>
            <tr>
              <th>Артикул</th>
              <th>Продано за вычетом возвратов</th>
              <th>Чистая выручка</th>
              <th>Себестоимость</th>
              <th>Прибыль</th>
              {report.itemsSummary !== undefined && <th>Маржа от чистой выручки</th>}
              {report.itemsSummary !== undefined && <th>Доля в прибыли товаров</th>}
            </tr>
          </thead>
          <tbody>
            {report.items.map((item) => (
              <tr key={item.sku} data-loss={item.loss === true ? 'true' : undefined}>
                <td>{item.sku}</td>
                <td>{count(item.units)}</td>
                <td>{money(item.net)}</td>
                <td>{money(item.cogs)}</td>
                <td>{money(item.profit)}</td>
                {report.itemsSummary !== undefined && <td>{percent(item.marginPct ?? null)}</td>}
                {report.itemsSummary !== undefined && (
                  <td>{percent(item.profitSharePct ?? null)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="block honesty">
        <h2>Честность данных</h2>
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
      </section>

      <section className="block gaps">
        <h2>Неполнота данных</h2>
        <p>Сколько пустых ячеек и по каким адресам — по каждому виду дыры отдельно.</p>
        <ul>
          {report.gaps.map((gap) => (
            <li key={gap.kind} data-zero={gap.count === 0 ? 'true' : undefined}>
              {gap.kind}: {count(String(gap.count))}
              {gap.at.length > 0 ? ` (${gap.at.join(', ')})` : ''}
            </li>
          ))}
        </ul>
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
