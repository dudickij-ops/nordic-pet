import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import { Dashboard } from '@/app/page'
import type { MonthReport } from '@/lib/metrics/report'
import { ПЕРЕПИСЬ } from './fixture.ts'

/**
 * Вид ряда чистой выручки по дням — кусок S11, шаг 2.
 *
 * Разметка ряда ничего не считает: доли, края, подписи оси и шаг видимых подписей дней приходят
 * готовыми. Проверки ниже утверждают, что она печатает ровно их, что у каждого дня есть доступная
 * подпись и что день без заказов отличается от нуля словами и формой.
 */

type Ряд = NonNullable<MonthReport['daily']>

function сРядом(ряд: Ряд | undefined): string {
  return renderToStaticMarkup(<Dashboard report={{ ...ПЕРЕПИСЬ, daily: ряд }} />)
}

const РЯД = ПЕРЕПИСЬ.daily as Ряд

/** Кусок разметки блока ряда — чтобы слова соседних блоков не попадали в утверждения о нём. */
function блок(разметка: string): string {
  const начало = разметка.indexOf('<section class="block daily">')
  expect(начало, 'блок ряда на странице').toBeGreaterThanOrEqual(0)
  return разметка.slice(начало, разметка.indexOf('</section>', начало))
}

test('ряд рисуется только тогда, когда в отчёте есть его поле', () => {
  expect(сРядом(undefined)).not.toContain('Чистая выручка по дням')
  expect(сРядом(РЯД)).toContain('Чистая выручка по дням')
})

test('у каждого дня доступная подпись с готовой строкой', () => {
  const подписи = [...блок(сРядом(РЯД)).matchAll(/<li[^>]*aria-label="([^"]*)"/g)].map((м) => м[1])
  expect(подписи).toHaveLength(7)
  expect(подписи[0]).toBe('1 марта: 313,13 €')
  expect(подписи[6]).toBe('7 марта: 868,68 €')
})

test('день без заказов — подпись словами, столбика нет, линия отсчёта помечена', () => {
  const разметка = блок(сРядом(РЯД))
  const второй = разметка.match(/<li[^>]*aria-label="2 марта[^"]*"[^>]*>(.*?)<\/li>/)
  expect(второй?.[0]).toContain('aria-label="2 марта: заказов не было"')
  expect(второй?.[0]).toContain('data-empty="true"')
  expect(второй?.[1], 'столбика у дня без заказов нет').toBe('')
  expect(разметка).not.toContain('2 марта: 0,00 €')
})

test('столбик дня берёт ту же долю и тот же край, что в отчёте', () => {
  const разметка = сРядом({
    ...РЯД,
    days: [{ day: '2026-03-01', label: '1 марта', net: '10.00', sharePct: '37.5', basePct: '-12.5', tick: '1' }],
  }).replace(/\s/g, '')
  expect(разметка, 'высота столбика — та же доля').toContain('--day-size:37.5')
  expect(разметка, 'начало столбика — тот же край').toContain('--day-from:-12.5')
})

test('видимые подписи дней — ровно те, что дал отчёт', () => {
  const подписи = [...блок(сРядом(РЯД)).matchAll(/<ol class="daily-ticks"[^>]*>(.*?)<\/ol>/g)][0]?.[1]
  const тексты = [...(подписи ?? '').matchAll(/<li>([^<]*)<\/li>/g)].map((м) => м[1])
  expect(тексты).toEqual(['1', '', '', '', '', '6', ''])
})

test('месяц без заказов — слова «нет данных за месяц», а не пустой график', () => {
  const разметка = сРядом({ ...РЯД, days: [], hasOrders: false, topNet: null, bottomNet: null })
  expect(разметка).toContain('Чистая выручка по дням: нет данных за месяц')
  expect(разметка).not.toContain('daily-chart')
})

test('в блоке ряда слово «выручка» есть, а слова «прибыль» нет', () => {
  const разметка = блок(сРядом(РЯД)).toLowerCase()
  expect(разметка).toContain('выручка')
  expect(разметка).not.toContain('прибыл')
})

/**
 * **Проверка текста таблицы стилей — слабая, и так названа.** Она доказывает наличие правила
 * пунктира, а не то, что браузер его нарисовал. Что пунктир виден под 9 марта, видно на снимках.
 */
test('у дня без заказов линия отсчёта — пунктиром: разрыв отличается от нуля формой', () => {
  const стили = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8')
  expect(стили).toMatch(/\.daily-bars li\[data-empty='true'\]::after \{\s*border-top-style: dashed;/)
})
