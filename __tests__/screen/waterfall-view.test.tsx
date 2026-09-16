import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import { Dashboard } from '@/app/page'
import { money } from '@/lib/metrics/format'
import type { MonthReport } from '@/lib/metrics/report'
import { ПЕРЕПИСЬ } from './fixture.ts'

/**
 * Вид водопада — кусок S11, шаг 1; кусок S13, задача 1 — семь ступеней от чистой выручки,
 * «% чистой выручки» вместо «% оборота», строки «Съедает больше всего» больше нет.
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
  expect(разметка, 'доля печатается текстом').toContain('37,5 % чистой выручки')
  const сжатая = разметка.replace(/\s/g, '')
  expect(сжатая, 'длина столбика — та же доля').toContain('--step-size:37.5')
  expect(сжатая, 'начало столбика — тот же край').toContain('--step-from:12.5')
})

test('у каждой ступени названа база доли — чистая выручка', () => {
  const разметка = сВодопадом(ПЕРЕПИСЬ.waterfall)
  expect(
    разметка.match(/<span class="waterfall-share">[^<]* % чистой выручки<\/span>/g)?.length,
  ).toBe(7)
  expect(разметка).not.toContain('% оборота')
})

test('итог и вычитание различены признаком в разметке, а не только цветом', () => {
  const разметка = сВодопадом(ПЕРЕПИСЬ.waterfall)
  expect(разметка.match(/data-kind="итог"/g)?.length).toBe(3)
  expect(разметка.match(/data-kind="вычитание"/g)?.length).toBe(4)
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

test('чистая выручка не положительна — у ступеней слова, столбиков нет', () => {
  const разметка = сВодопадом({
    steps: ПЕРЕПИСЬ.waterfall!.steps.map((с) => ({ ...с, sharePct: null, basePct: null })),
    scaleLowPct: null,
    scaleHighPct: null,
  })
  // Только в блоке водопада: слово «чистой выручки» законно стоит в соседних блоках, а пояснение
  // про скидки и возвраты под каскадом само законно называет «оборот» — оно не про доли ступеней.
  const водопад = разметка.slice(разметка.indexOf('<section class="block waterfall">'), разметка.indexOf('</section>', разметка.indexOf('<section class="block waterfall">')))
  expect(водопад).not.toContain('waterfall-bar')
  expect(водопад).not.toContain('% чистой выручки')
  expect(разметка.match(/<span class="waterfall-share">нет данных<\/span>/g)?.length).toBe(7)
})

/**
 * Месяц без единой строки рекламы — круг проверки кода 2: у ступени «Реклама» на экране слова в обеих
 * ячейках, и столбика у неё нет, а прочие ступени печатаются как обычно. Прежде здесь стояло
 * «0,00 € · 0,0 % оборота» рядом с карточкой полосы, которая уже говорила «нет данных».
 */
test('нет строк рекламы — у ступени «Реклама» слова и в сумме, и в доле, а столбика нет', () => {
  const разметка = сВодопадом({
    ...ПЕРЕПИСЬ.waterfall!,
    steps: ПЕРЕПИСЬ.waterfall!.steps.map((с) => (с.key === 'ads' ? { ...с, amount: null, sharePct: null } : с)),
  })
  const строки = разметка.split('<li ')
  const реклама = строки.find((строка) => строка.includes('Реклама')) ?? ''
  expect(реклама).toContain('<span class="waterfall-amount">нет данных</span>')
  expect(реклама).toContain('<span class="waterfall-share">нет данных</span>')
  expect(реклама).not.toContain('waterfall-bar')
  expect(разметка.match(/<span class="waterfall-amount">нет данных<\/span>/g)?.length, 'слова — только у ступени рекламы').toBe(1)
})

/**
 * **Проверка устройства разметки — слабая, и так названа.** Она утверждает, что внутри дорожки нет
 * ничего, кроме столбика, — значит подпись и число стоят в своих ячейках и наехать на столбик им
 * негде. Что они не наезжают на экране, видно на снимках.
 */
test('подписи ступеней водопада — отдельной ячейкой вне дорожки столбика', () => {
  const разметка = сВодопадом(ПЕРЕПИСЬ.waterfall)
  const дорожки = разметка.match(/<span class="waterfall-track"[^>]*>.*?<\/span><\/span>|<span class="waterfall-track"[^>]*><\/span>/g) ?? []
  expect(дорожки).toHaveLength(7)
  for (const дорожка of дорожки) {
    expect(дорожка.replace(/<span class="waterfall-bar"[^>]*><\/span>/, '')).toMatch(
      /^<span class="waterfall-track"[^>]*><\/span>$/,
    )
  }
})

test('строка о расхождении — только когда оно есть, и с тем числом, что дал отчёт', () => {
  const сПрибылью = сВодопадом({ ...ОДНА, netGap: null, profitGap: '0.07' })
  expect(сПрибылью).toContain('расходятся с прибылью на 0,07 €.')
  expect(сПрибылью).not.toContain('расходятся с чистой выручкой')

  // Пояснение под каскадом про скидки и возвраты стоит всегда (своя проверка ниже) — здесь
  // проверяется отсутствие именно строк о центах округления, а не всего класса «waterfall-gap».
  const безРасхождений = сВодопадом({ ...ОДНА, netGap: null, profitGap: null })
  expect(безРасхождений).not.toContain('округлены до цента')
})

/** Деньги внутри предложения стоят с неразрывным пробелом перед знаком — так их печатает экран. */
const вСтроке = (сумма: string) => money(сумма).replace(/ €$/, ' €')

test('под каскадом — скидки и возвраты, снятые с оборота, тремя суммами отчёта', () => {
  const разметка = сВодопадом(ПЕРЕПИСЬ.waterfall)
  expect(разметка).toContain(
    `Скидки ${вСтроке(ПЕРЕПИСЬ.revenue.discounts)} и возвраты ${вСтроке(ПЕРЕПИСЬ.revenue.refunds)} сняты с оборота ${вСтроке(ПЕРЕПИСЬ.revenue.gross)} до этой шкалы.`,
  )
})

test('строки «съедает больше всего» нет', () => {
  expect(сВодопадом(ПЕРЕПИСЬ.waterfall)).not.toContain('Съедает больше всего')
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
