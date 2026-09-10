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
  expect(разметка.match(/<span class="waterfall-share">[^<]* % оборота<\/span>/g)?.length).toBe(9)
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
  // Только в блоке водопада: слово «оборота» законно стоит в соседних блоках.
  const водопад = разметка.slice(разметка.indexOf('<section class="block waterfall">'), разметка.indexOf('</section>', разметка.indexOf('<section class="block waterfall">')))
  expect(водопад).not.toContain('waterfall-bar')
  expect(водопад).not.toContain('оборота')
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

test('строка о расхождении — только когда оно есть, и с тем числом, что дал отчёт', () => {
  const сПрибылью = сВодопадом({ ...ОДНА, netGap: null, profitGap: '0.07' })
  expect(сПрибылью).toContain('расходятся с прибылью на 0,07 €.')
  expect(сПрибылью).not.toContain('расходятся с чистой выручкой')

  const безРасхождений = сВодопадом({ ...ОДНА, netGap: null, profitGap: null })
  expect(безРасхождений).not.toContain('waterfall-gap')
})

/** Две ступени, из которых самой большой помечена вторая: подпись и доля обязаны прийти от неё. */
const ДВЕ: Водопад = {
  steps: [
    { key: 'cogs', kind: 'вычитание', amount: '6028.11', sharePct: '32.1', basePct: '60.0', largest: true },
    { key: 'ads', kind: 'вычитание', amount: '4431.37', sharePct: '23.6', basePct: '36.4' },
  ],
  scaleLowPct: '0.0',
  scaleHighPct: '100.0',
}

test('строка «съедает больше всего» называет помеченную ступень и берёт её же долю', () => {
  const разметка = сВодопадом({ ...ДВЕ, steps: [ДВЕ.steps[1], ДВЕ.steps[0]] })
  expect(разметка).toContain('Съедает больше всего: себестоимость проданного · 32,1 % оборота')
})

test('при равенстве строка называет обе ступени поровну', () => {
  const разметка = сВодопадом({
    ...ДВЕ,
    steps: [
      { ...ДВЕ.steps[0], amount: '4431.37', sharePct: '23.6' },
      { ...ДВЕ.steps[1], largest: true },
    ],
  })
  expect(разметка).toContain(
    'Съедает больше всего поровну: себестоимость проданного и реклама · по 23,6 % оборота',
  )
})

test('без доли строки «съедает больше всего» нет', () => {
  const разметка = сВодопадом({
    ...ДВЕ,
    steps: ДВЕ.steps.map((с) => ({ ...с, sharePct: null, basePct: null })),
    scaleLowPct: null,
    scaleHighPct: null,
  })
  expect(разметка).not.toContain('Съедает')
})

/**
 * **Проверка текста таблицы стилей — слабая, и так названа.** Правило строки не несёт ни цвета, ни
 * фона: строка — подпись, а не тревога. Что браузер красит её обычным цветом текста, видно на снимках.
 */
test('у строки «съедает больше всего» нет своего цвета — это подпись, а не тревога', () => {
  const стили = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8')
  const правило = стили.match(/\.waterfall-largest \{([^}]*)\}/)?.[1]
  expect(правило, 'правило строки есть').toBeDefined()
  expect(правило).not.toMatch(/color|background/)
})

/**
 * Пределы шкалы — поле водопада, а не общее: в раскладке переписи они совпадают с пределами ряда по
 * дням, и проверка на ней не отличила бы свои пределы от чужих. Здесь они нарочно ни с чем не совпадают.
 */
test('водопад передаёт шкале свои пределы — ровно те, что дал отчёт', () => {
  const разметка = сВодопадом({ ...ОДНА, scaleLowPct: '-7.5', scaleHighPct: '107.5' })
  const список = разметка.match(/<ol class="waterfall-steps" style="([^"]*)"/)?.[1].replace(/\s/g, '')
  expect(список).toBe('--scale-from:-7.5;--scale-to:107.5')
})
