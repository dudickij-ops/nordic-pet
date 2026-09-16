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

test('постоянные ниже порога тревоги — строка без знака; убыток — со знаком', () => {
  expect(с({ loss: false })).toMatch(/data-kind="обычно"[^>]*>[^⚠]*Постоянные расходы/)
  expect(с({ loss: true })).toContain('⚠ Месяц в убытке:')
  expect(с({ loss: true, fixedSharePct: null })).toContain('не положителен.')
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
