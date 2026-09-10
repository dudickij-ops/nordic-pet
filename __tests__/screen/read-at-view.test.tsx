import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import { Dashboard } from '@/app/page'
import type { MonthReport } from '@/lib/metrics/report'
import { ПЕРЕПИСЬ } from './fixture.ts'

/**
 * Строка времени чтения источников — кусок S11, шаг 6 (задача 12).
 *
 * Разметка время не форматирует и не разбирает: строка приходит готовой из SQL и печатается как
 * есть. Отметки нет — слова, а не пустая строка и не эпоха.
 */

function сВременем(время: MonthReport['sourcesReadAt']): string {
  return renderToStaticMarkup(<Dashboard report={{ ...ПЕРЕПИСЬ, sourcesReadAt: время }} />)
}

/** Кусок разметки шапки — чтобы слова соседних блоков не попадали в утверждения о ней. */
function шапка(разметка: string): string {
  const начало = разметка.indexOf('<header class="report-head">')
  expect(начало, 'шапка на странице').toBeGreaterThanOrEqual(0)
  return разметка.slice(начало, разметка.indexOf('</header>', начало))
}

test('строка времени рисуется только тогда, когда в отчёте есть её поле', () => {
  expect(сВременем(undefined)).not.toContain('report-read-at')
  expect(шапка(сВременем('2026-04-02 07:15 UTC'))).toContain('report-read-at')
})

test('разметка получает время готовой строкой и печатает его как есть', () => {
  // Нарочно не дата: разметка, разбирающая или переводящая время, напечатала бы здесь другое.
  expect(шапка(сВременем('ГОТОВАЯ СТРОКА ИЗ SQL'))).toContain(
    '<p class="report-read-at">Источники прочитаны по состоянию на ГОТОВАЯ СТРОКА ИЗ SQL</p>',
  )
})

test('отметки нет — на экране слова, а не пустая строка и не эпоха', () => {
  const разметка = шапка(сВременем(null))
  expect(разметка).toContain('<p class="report-read-at">Время чтения источников неизвестно: отметки о чтении нет.</p>')
  expect(разметка).not.toContain('1970')
})
