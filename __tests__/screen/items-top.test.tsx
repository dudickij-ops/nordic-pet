import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import { Dashboard } from '@/app/page'
import type { MonthReport } from '@/lib/metrics/report'
import { ПЕРЕПИСЬ } from './fixture.ts'

/**
 * Товары: пятёрка и раскрытие — кусок S13, задача 12 (решение владельца Э4).
 *
 * Пятёрку выбирает слой метрик признаком `inTop`; разметка раскладывает строки по признаку и не
 * сравнивает чисел. Число артикулов в переключателе — поле отчёта, а не счёт строк.
 */

const строки = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    ...ПЕРЕПИСЬ.items[0], sku: `NP-${100 + i}`, inTop: i < 5,
  }))
const с = (items: MonthReport['items'], skusTotal = items.length) =>
  renderToStaticMarkup(<Dashboard report={{ ...ПЕРЕПИСЬ, items, itemsSummary: { ...ПЕРЕПИСЬ.itemsSummary!, skusTotal } }} />)

/**
 * Текст снимается с блока товаров, а не со всей страницы: строка вывода о приблизительной прибыли
 * (задача 10) стоит выше и называет артикулы с подстановкой — счёт по всей странице видел бы их.
 * Без блока — отказ, а не пустота.
 */
const блокТоваров = (html: string) => {
  const начало = html.indexOf('<section class="block items"')
  if (начало < 0) throw new Error('блока товаров в разметке нет')
  return html.slice(начало, html.indexOf('</section>', начало))
}

test('строки с признаком пятёрки — в первой таблице, остальные — под раскрытием', () => {
  const html = блокТоваров(с(строки(7)))
  const [видно, скрыто] = html.split('<details')
  expect((видно.match(/NP-1\d\d/g) ?? []).length).toBe(5)
  expect(скрыто).toContain('NP-105')
  expect(скрыто).toContain('NP-106')
})

test('число в переключателе — из отчёта, а не счётом строк', () => {
  expect(с(строки(7), 12)).toContain('Показать все артикулы месяца — 12')
})

test('шесть строк — переключатель есть, пять — нет', () => {
  // Только в блоке товаров: раскрытие неполноты стоит в другом блоке и сюда не попадает.
  expect(блокТоваров(с(строки(6)))).toContain('<details')
  expect(блокТоваров(с(строки(5)))).not.toContain('<details')
})

test('сумма валовой прибыли товаров не положительна — строка над таблицей называет её валовой', () => {
  const html = renderToStaticMarkup(
    <Dashboard report={{ ...ПЕРЕПИСЬ, itemsSummary: { productsProfit: '-20.00', skusTotal: 2, skusFor80: null, negativeCount: 1 } }} />,
  )
  expect(блокТоваров(html)).toContain('Валовая прибыль товаров — выручка минус себестоимость, −20,00\u00A0€ — не положительна')
})

test('у двух таблиц одно описание колонок', () => {
  const html = с(строки(7))
  const колонки = html.match(/<colgroup>.*?<\/colgroup>/g) ?? []
  expect(колонки).toHaveLength(2)
  expect(колонки[0]).toBe(колонки[1])
})

test('колонка называется «Валовая прибыль», слово «Прибыль» отдельным заголовком не стоит', () => {
  const html = с(строки(6))
  expect(html).toContain('>Валовая прибыль</th>')
  expect(html).not.toContain('>Прибыль</th>')
})

/**
 * Полоска доли — то же условие владельца, что у полосы честности (кусок S9): текст и полоска берут
 * одно значение из одного места, разметка над ним ничего не делает. Долей две разные: с одной
 * постоянная длина, случайно совпавшая с числом, прошла бы зелёной.
 */
test('полоска доли берёт ту же величину, что напечатана в ячейке', () => {
  for (const [доля, текст] of [['37.5', '37,5 %'], ['91.25', '91,25 %']]) {
    const html = renderToStaticMarkup(
      <Dashboard report={{ ...ПЕРЕПИСЬ, items: [{ ...ПЕРЕПИСЬ.items[0], profitSharePct: доля }] }} />,
    )
    const блок = блокТоваров(html)
    expect(блок, 'число печатается').toContain(текст)
    expect(блок.replace(/\s/g, ''), 'полоска получает то же значение').toContain(`--item-share:${доля}%`)
  }
})
