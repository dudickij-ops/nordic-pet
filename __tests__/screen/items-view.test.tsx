import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import { Dashboard } from '@/app/page'
import type { MonthReport } from '@/lib/metrics/report'
import { ПЕРЕПИСЬ } from './fixture.ts'

/**
 * Вид таблицы товаров — кусок S11, шаг 4.
 *
 * Разметка ничего не считает: маржа строки, доля, признак «в минусе» и строка над таблицей
 * приходят готовыми. Правило владельца: отношение называет свою базу рядом с собой.
 */

function сОтчётом(правка: Partial<MonthReport>): string {
  return renderToStaticMarkup(<Dashboard report={{ ...ПЕРЕПИСЬ, ...правка }} tab="tovary" />)
}

function блок(разметка: string): string {
  const начало = разметка.indexOf('<section class="block items">')
  expect(начало, 'блок товаров на странице').toBeGreaterThanOrEqual(0)
  return разметка.slice(начало, разметка.indexOf('</section>', начало))
}

test('новые колонки и строка над таблицей рисуются только при своих полях', () => {
  const прежняя = блок(сОтчётом({ itemsSummary: undefined }))
  expect(прежняя).not.toContain('Доля в прибыли товаров')
  expect(прежняя).not.toContain('items-summary')
  expect(блок(сОтчётом({}))).toContain('<th>Доля в прибыли товаров</th>')
})

test('заголовок доли называет базу — прибыль товаров, а заголовок маржи — чистую выручку', () => {
  const разметка = блок(сОтчётом({}))
  expect(разметка).toContain('<th>Доля в прибыли товаров</th>')
  expect(разметка).toContain('<th>Маржа от чистой выручки</th>')
})

test('строка над таблицей называет базу долей и её сумму, и прибыль месяца рядом', () => {
  const разметка = блок(сОтчётом({}))
  expect(разметка).toContain('Прибыль товаров — выручка минус себестоимость, 9\u00A0090,90 €')
  expect(разметка).toContain('это не прибыль месяца, 9\u00A0999,99 €')
  expect(разметка).toContain('80 % прибыли товаров дают 2 из 2 артикулов')
})

test('разметка печатает признак «в минусе», который ей дали, а не сравнивает прибыль с нулём', () => {
  // Признак нарочно расходится со знаком прибыли: у NP-101 прибыль положительна, у NP-202 — нет.
  const разметка = блок(
    сОтчётом({
      items: [
        { ...ПЕРЕПИСЬ.items[0], loss: true },
        { ...ПЕРЕПИСЬ.items[1], profit: '-1.00', loss: false },
      ],
    }),
  )
  const строки = [...разметка.matchAll(/<tr( data-loss="true")?><td>(NP-\d+)<\/td>/g)].map((м) => [м[2], м[1] !== undefined])
  expect(Object.fromEntries(строки)).toEqual({ 'NP-101': true, 'NP-202': false })
})

test('у строки в минусе рядом стоит само число маржи — цвет не единственный признак', () => {
  const разметка = блок(
    сОтчётом({
      items: [{ ...ПЕРЕПИСЬ.items[0], profit: '-12.00', marginPct: '-1.2', profitSharePct: null, loss: true }],
    }),
  )
  expect(разметка).toMatch(/<tr data-loss="true">.*<td>−1,2 %<\/td>.*<\/tr>/)
})

test('сумма прибыли товаров не положительна — строка над таблицей говорит словами', () => {
  const разметка = блок(
    сОтчётом({ itemsSummary: { productsProfit: '-20.00', skusTotal: 2, skusFor80: null, negativeCount: 1 } }),
  )
  expect(разметка).toContain('не положительна: считать 80 % не от чего')
})

/**
 * **Две проверки текста таблицы стилей — слабые, и так названы.** Они доказывают наличие правил, а
 * не то, что браузер их применил; вид подсветки виден на снимках, контраст — замером перед сдачей.
 */
function правилоПодсветки(): string {
  const стили = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8')
  const правило = стили.match(/\.items tr\[data-loss='true'\] td \{([^}]*)\}/)?.[1]
  expect(правило, 'правило подсветки строки в минусе есть').toBeDefined()
  return правило ?? ''
}

test('подсветка строки в минусе — свой красный, а не токен отказа', () => {
  const правило = правилоПодсветки()
  expect(правило).toContain('background: var(--colorPaletteRedBackground2)')
  expect(правило).not.toMatch(/--danger|colorPaletteRedBackground1|colorPaletteRedForeground1|colorPaletteRedBorder2/)
})

test('в подсвеченной строке нет приглушённого текста — все ячейки основным цветом', () => {
  expect(правилоПодсветки()).toContain('color: var(--colorNeutralForeground1)')
})
