import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import { Dashboard } from '@/app/page'
import { ПЕРЕПИСЬ } from './fixture.ts'

/**
 * Один экран — кусок S13, решение владельца Э2. Все блоки стоят на одной странице в порядке
 * договора, и полосы вкладок нет.
 */

const разметка = () => renderToStaticMarkup(<Dashboard report={ПЕРЕПИСЬ} />)

test('все блоки на одной странице, в порядке договора', () => {
  const html = разметка()
  const места = ['Куда ушли деньги', 'Чистая выручка по дням', 'Товары', 'Качество данных'].map(
    (заголовок) => html.indexOf(`>${заголовок}</h2>`),
  )
  expect(места.every((место) => место > 0)).toBe(true)
  expect([...места].sort((а, б) => а - б)).toEqual(места)
})

test('полосы вкладок и ссылок на вкладки нет', () => {
  const html = разметка()
  expect(html).not.toContain('Разделы отчёта')
  expect(html).not.toContain('tab=')
})

test('карточек «Выручка», «Затраты», «Итог» и блока окупаемости нет', () => {
  const html = разметка()
  for (const заголовок of ['Выручка', 'Затраты', 'Итог', 'Окупаемость рекламы']) {
    expect(html).not.toContain(`>${заголовок}</h2>`)
  }
})
