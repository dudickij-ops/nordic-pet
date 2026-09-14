import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'

import { Dashboard, ОтказПорядка, адресПорядка } from '@/app/page'
import { ПОРЯДКИ_ТОВАРОВ } from '@/lib/metrics/sql'
import { ПЕРЕПИСЬ } from './fixture.ts'
import { текстПоПорядку } from './census-text.ts'

/**
 * Выбор порядка таблицы товаров — кусок S12, задача 1.
 *
 * Главное утверждение здесь одно: **разметка не сортирует**. Строки приходят из слоя метрик уже
 * упорядоченными, и порядок в адресе нужен разметке только для ссылок заголовков. Проверяется это
 * раскладкой, где строки заведомо не упорядочены ни по одному столбцу: разметка, взявшаяся
 * сортировать, переставит их и покраснеет.
 */

const ВРАЗБРОС = {
  ...ПЕРЕПИСЬ,
  items: [
    { sku: 'NP-303', units: '1', net: '100.00', cogs: '10.00', profit: '90.00' },
    { sku: 'NP-101', units: '1', net: '300.00', cogs: '100.00', profit: '200.00' },
    { sku: 'NP-202', units: '1', net: '200.00', cogs: '150.00', profit: '50.00' },
  ],
  itemsSummary: undefined,
}

function артикулыИзРазметки(html: string): string[] {
  return текстПоПорядку(html).filter((строка) => строка.startsWith('NP-'))
}

describe('порядок таблицы товаров на экране', () => {
  test('разметка отдаёт строки в том порядке, в каком получила', () => {
    for (const порядок of Object.keys(ПОРЯДКИ_ТОВАРОВ) as Array<keyof typeof ПОРЯДКИ_ТОВАРОВ>) {
      const html = renderToStaticMarkup(<Dashboard report={ВРАЗБРОС} tab="tovary" sort={порядок} />)
      expect(артикулыИзРазметки(html)).toEqual(['NP-303', 'NP-101', 'NP-202'])
    }
  })

  test('заголовки трёх столбцов — ссылки, и каждая ведёт на свой порядок', () => {
    const html = renderToStaticMarkup(<Dashboard report={ВРАЗБРОС} tab="tovary" />)
    expect(html).toContain('href="/?m=2026-03&amp;tab=tovary&amp;sort=net-desc"')
    expect(html).toContain('href="/?m=2026-03&amp;tab=tovary&amp;sort=cogs-desc"')
    // Прибыль — нынешний столбец по умолчанию, поэтому её ссылка разворачивает направление.
    expect(html).toContain('href="/?m=2026-03&amp;tab=tovary&amp;sort=profit-asc"')
  })

  test('нынешний столбец назван признаком, а не только видом', () => {
    const поПрибыли = renderToStaticMarkup(<Dashboard report={ВРАЗБРОС} tab="tovary" />)
    expect(поПрибыли).toContain('aria-sort="descending"')
    const поВыручке = renderToStaticMarkup(
      <Dashboard report={ВРАЗБРОС} tab="tovary" sort="net-asc" />,
    )
    expect(поВыручке).toContain('aria-sort="ascending"')
    // Признак ровно один: чужие столбцы его не несут.
    expect(поВыручке.match(/aria-sort/g)).toHaveLength(1)
  })

  test('адрес порядка по умолчанию хвоста не несёт: одно состояние — одно написание', () => {
    expect(адресПорядка('2026-03', 'profit-desc')).toBe('/?m=2026-03&tab=tovary')
    expect(адресПорядка(null, 'profit-desc')).toBe('/?tab=tovary')
    expect(адресПорядка('2026-03', 'cogs-asc')).toBe('/?m=2026-03&tab=tovary&sort=cogs-asc')
  })

  test('отказ на незнакомый порядок называет имя и перечисляет все шесть', () => {
    const html = renderToStaticMarkup(<ОтказПорядка имя="по-цвету" месяц="2026-03" />)
    expect(html).toContain('по-цвету')
    expect(html).toContain('role="alert"')
    for (const порядок of Object.keys(ПОРЯДКИ_ТОВАРОВ)) {
      const хвост = порядок === 'profit-desc' ? '' : `&amp;sort=${порядок}`
      expect(html).toContain(`href="/?m=2026-03&amp;tab=tovary${хвост}"`)
    }
  })
})
