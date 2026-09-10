import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import { Dashboard } from '@/app/page'
import type { MonthReport } from '@/lib/metrics/report'
import { ПЕРЕПИСЬ } from './fixture.ts'

/**
 * Вид водопада — кусок S11, шаг 1.
 *
 * Разметка водопада ничего не считает: сумма, доля и края приходят готовыми. Проверки ниже
 * утверждают, что она печатает ровно их — и что одно значение уходит и в текст, и в геометрию.
 */

type Водопад = NonNullable<MonthReport['waterfall']>

function сВодопадом(водопад: Водопад | undefined): string {
  return renderToStaticMarkup(<Dashboard report={{ ...ПЕРЕПИСЬ, waterfall: водопад }} />)
}

/** Одна ступень с долей и краем, которые нарочно не совпадают друг с другом. */
const ОДНА: Водопад = {
  steps: [{ key: 'ads', kind: 'вычитание', amount: '4431.37', sharePct: '37.5', basePct: '12.5' }],
  scaleLowPct: '0.0',
  scaleHighPct: '100.0',
}

test('водопад рисуется только тогда, когда в отчёте есть его поле', () => {
  expect(сВодопадом(undefined)).not.toContain('Куда ушли деньги')
  expect(сВодопадом(ОДНА)).toContain('Куда ушли деньги')
})

test('столбик ступени берёт ту же долю и тот же край, что напечатаны', () => {
  const разметка = сВодопадом(ОДНА)
  expect(разметка, 'доля печатается текстом').toContain('37,5 % оборота')
  const сжатая = разметка.replace(/\s/g, '')
  expect(сжатая, 'длина столбика — та же доля').toContain('--step-size:37.5')
  expect(сжатая, 'начало столбика — тот же край').toContain('--step-from:12.5')
})

test('у каждой ступени названа база доли — оборот', () => {
  const разметка = сВодопадом(ПЕРЕПИСЬ.waterfall)
  expect(разметка.match(/ % оборота/g)?.length).toBe(9)
})

test('итог и вычитание различены признаком в разметке, а не только цветом', () => {
  const разметка = сВодопадом(ПЕРЕПИСЬ.waterfall)
  expect(разметка.match(/data-kind="итог"/g)?.length).toBe(3)
  expect(разметка.match(/data-kind="вычитание"/g)?.length).toBe(6)
})

/**
 * **Проверка текста таблицы стилей — слабая, и так названа.** Она доказывает наличие правила, а не
 * то, что браузер его применил. Что подпись итога полужирная, видно на снимках.
 */
test('у итога водопада признак формы: полужирные подпись и сумма', () => {
  const стили = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8')
  expect(стили).toMatch(
    /li\[data-kind='итог'\] \.waterfall-label,\s*\.waterfall-steps li\[data-kind='итог'\] \.waterfall-amount \{\s*font-weight: var\(--fontWeightSemibold\);/,
  )
})

test('оборот ноль — у ступеней слова, столбиков нет', () => {
  const разметка = сВодопадом({
    steps: ПЕРЕПИСЬ.waterfall!.steps.map((с) => ({ ...с, sharePct: null, basePct: null })),
    scaleLowPct: null,
    scaleHighPct: null,
  })
  expect(разметка).not.toContain('waterfall-bar')
  expect(разметка).not.toContain('оборота')
  expect(разметка.match(/<span class="waterfall-share">нет данных<\/span>/g)?.length).toBe(9)
})

/**
 * **Проверка устройства разметки — слабая, и так названа.** Она утверждает, что внутри дорожки нет
 * ничего, кроме столбика, — значит подпись и число стоят в своих ячейках и наехать на столбик им
 * негде. Что они не наезжают на экране, видно на снимках.
 */
test('подписи ступеней водопада — отдельной ячейкой вне дорожки столбика', () => {
  const разметка = сВодопадом(ПЕРЕПИСЬ.waterfall)
  const дорожки = разметка.match(/<span class="waterfall-track"[^>]*>.*?<\/span><\/span>|<span class="waterfall-track"[^>]*><\/span>/g) ?? []
  expect(дорожки).toHaveLength(9)
  for (const дорожка of дорожки) {
    expect(дорожка.replace(/<span class="waterfall-bar"[^>]*><\/span>/, '')).toMatch(
      /^<span class="waterfall-track"[^>]*><\/span>$/,
    )
  }
})
