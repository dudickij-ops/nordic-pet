import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import { Dashboard } from '@/app/page'
import type { MonthReport } from '@/lib/metrics/report'
import { ПЕРЕПИСЬ } from './fixture.ts'

/**
 * Выводы — кусок S13, задача 10. До трёх строк по признакам отчёта в порядке договора: реклама →
 * постоянные → приблизительная. Экран выбирает слова по признаку и ничего не сравнивает.
 */

const с = (f: Partial<NonNullable<MonthReport['findings']>>) =>
  renderToStaticMarkup(<Dashboard report={{ ...ПЕРЕПИСЬ, findings: { ...ПЕРЕПИСЬ.findings!, ...f } }} />)

test('строк выводов столько, сколько признаков, и в порядке договора', () => {
  const html = с({ adsVerdict: 'окупается', loss: false, approximate: true })
  const виды = [...html.matchAll(/<li class="finding" data-kind="([^"]+)"/g)].map((m) => m[1])
  expect(виды).toEqual(['хорошо', 'обычно', 'тревога'])
  expect([...с({ adsVerdict: null, approximate: false }).matchAll(/class="finding"/g)]).toHaveLength(1)
})

test('реклама: каждое из трёх слов — по своему признаку', () => {
  expect(с({ adsVerdict: 'окупается' })).toContain('Реклама окупается:')
  expect(с({ adsVerdict: 'не окупается' })).toContain('Реклама не окупается:')
  expect(с({ adsVerdict: 'порога нет' })).toContain('Порога окупаемости нет:')
})

// Кусок S13, задача 17, решение владельца по И6 (17.09.2026): тревога — по знаку прибыли, а не от 100 % доли; имя и
// последнее утверждение переписаны (учёт).
test('без убытка — строка постоянных без знака; убыток — со знаком; тревога названа по прибыли', () => {
  expect(с({ loss: false })).toMatch(/data-kind="обычно"[^>]*>[^⚠]*Постоянные расходы/)
  expect(с({ loss: true })).toContain('⚠ Месяц в убытке:')
  expect(с({ loss: true, fixedSharePct: null })).toContain('не положителен.')
  const html = с({ loss: false })
  expect(html).toContain('Тревога — когда месяц в убытке: прибыль меньше нуля.')
  expect(html).not.toContain('от 100\u00A0%.')
})

test('вклад, порог и маржинальный доход помечены «наш счёт»', () => {
  const html = с({ adsVerdict: 'окупается' })
  expect(html.match(/наш счёт/g)?.length).toBeGreaterThanOrEqual(2)
})

test('совета «масштабировать» и слов о следующем евро как отдаче нет', () => {
  const html = с({ adsVerdict: 'окупается' })
  expect(html).not.toContain('масштаб')
  expect(html).toContain('а не отдача от следующего вложенного евро')
})

test('выводов нет, когда отчёт без признаков', () => {
  const html = renderToStaticMarkup(<Dashboard report={{ ...ПЕРЕПИСЬ, findings: undefined }} />)
  expect(html).not.toContain('>Выводы</h2>')
})

/**
 * Кусок S13, задача 17, правка по проверке правок (М-2, экранная половина): сумма маржинального дохода пуста — на
 * экране «нет данных» словами, а не «undefined», «NaN» или ноль. Обе строки, где сумма стоит: вывод об убытке при
 * пустой доле и пояснение.
 */
test('маржинальный доход пуст — на экране «нет данных», а не ноль', () => {
  // Текст снимается с блока выводов: «NaN» и «undefined» ищутся в нём, а не на всей странице, где за маржу
  // результата отвечает своя проверка. Без блока — отказ, а не пустота.
  const страница = с({ marginIncome: null, loss: true, fixedSharePct: null })
  const начало = страница.indexOf('<section class="block findings"')
  if (начало < 0) throw new Error('блока выводов в разметке нет')
  const html = страница.slice(начало, страница.indexOf('</section>', начало))
  expect(html).toContain('маржинальный доход нет данных не положителен.')
  expect(html).toContain('реклама − комиссии, нет данных. Тревога')
  expect(html).not.toMatch(/undefined|NaN|комиссии, 0,00/)
})
