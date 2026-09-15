import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'

import { Dashboard } from '@/app/page'
import { ПЕРЕПИСЬ } from './fixture.ts'

/**
 * Ряд из «Выручки» и «Затрат» — кусок S12, задача 4.
 *
 * **Что здесь сторожится и что нет.** Равенство высот — свойство флексбокса в браузере, и его
 * доказательство — снимок и замер, как у всего вида в этом проекте. Здесь сторожится устройство,
 * из-за которого прошлый кусок отказался от сетки у `main`: блок со своим потоком форматирования,
 * стоящий **вровень** с плавающей полосой действия, не заходит под неё и сжимается.
 *
 * Ряд от этого защищён не обещанием, а положением: перед ним стоит шапка отчёта и полоса вкладок,
 * и до него плавающая полоса уже кончилась. Проверка утверждает именно это положение — ряд не
 * первый элемент отчёта. Слом переносит ряд в начало, и она краснеет.
 */

const разметка = (tab: 'dengi' | 'glavnoe' | 'tovary' | 'kachestvo') =>
  renderToStaticMarkup(<Dashboard report={ПЕРЕПИСЬ} tab={tab} />)

describe('ряд из двух карточек', () => {
  test('«Выручка» и «Затраты» лежат в одном ряду, и в нём только они', () => {
    const html = разметка('dengi')
    const начало = html.indexOf('<div class="row-two">')
    expect(начало).toBeGreaterThan(-1)
    const ряд = html.slice(начало, html.indexOf('</div>', начало))
    expect([...ряд.matchAll(/<section class="block ([a-z-]+)"/g)].map((м) => м[1])).toEqual([
      'revenue',
      'costs',
    ])
  })

  test('ряд стоит после шапки и полосы вкладок, а не вровень с плавающей полосой действия', () => {
    const html = разметка('dengi')
    const шапка = html.indexOf('<header class="report-head">')
    const вкладки = html.indexOf('<nav class="tabs"')
    const ряд = html.indexOf('<div class="row-two">')
    expect(шапка).toBeGreaterThan(-1)
    expect(вкладки).toBeGreaterThan(шапка)
    expect(ряд).toBeGreaterThan(вкладки)
  })

  test('на чужой вкладке пустой обёртки в разметке не остаётся', () => {
    for (const вкладка of ['glavnoe', 'tovary', 'kachestvo'] as const) {
      expect(разметка(вкладка)).not.toContain('row-two')
    }
  })
})
