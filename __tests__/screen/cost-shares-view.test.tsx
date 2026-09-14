import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import { Dashboard } from '@/app/page'
import type { MonthReport } from '@/lib/metrics/report'
import { ПЕРЕПИСЬ } from './fixture.ts'

/**
 * Доли статей затрат в обороте — кусок S11, шаг 5.
 *
 * Доля статьи — та же готовая доля, что у ступени водопада: одно поле, одна база — оборот. Разметка
 * берёт её по ключу статьи и печатает; текст и длина полоски — одно значение.
 */

type Водопад = NonNullable<MonthReport['waterfall']>

function сВодопадом(водопад: Водопад | undefined): string {
  return renderToStaticMarkup(<Dashboard report={{ ...ПЕРЕПИСЬ, waterfall: водопад }} tab="dengi" />)
}

/** Кусок разметки блока «Затраты». */
function затраты(разметка: string): string {
  const заголовок = разметка.indexOf('<h2>Затраты</h2>')
  expect(заголовок, 'блок «Затраты» на странице').toBeGreaterThanOrEqual(0)
  return разметка.slice(заголовок, разметка.indexOf('</section>', заголовок))
}

test('доли статей рисуются только тогда, когда в отчёте есть водопад', () => {
  expect(затраты(сВодопадом(undefined))).not.toContain('cost-share')
  expect(затраты(сВодопадом(ПЕРЕПИСЬ.waterfall))).toContain('cost-share')
})

test('у каждой статьи затрат доля названа от оборота', () => {
  const разметка = затраты(сВодопадом(ПЕРЕПИСЬ.waterfall))
  expect(разметка.match(/<span class="cost-share"><span>[^<]* % оборота<\/span>/g)?.length).toBe(4)
})

test('доля статьи — та же, что у её ступени водопада', () => {
  const разметка = затраты(сВодопадом(ПЕРЕПИСЬ.waterfall))
  // В раскладке ступени себестоимости, рекламы, комиссий и постоянных — 15,5; 16,6; 17,7; 18,8.
  const доли = [...разметка.matchAll(/<span class="cost-share"><span>([^<]*) % оборота<\/span>/g)].map((м) => м[1])
  expect(доли).toEqual(['15,5', '16,6', '17,7', '18,8'])
})

test('полоска статьи берёт ту же долю, что напечатана', () => {
  const разметка = затраты(сВодопадом(ПЕРЕПИСЬ.waterfall)).replace(/\s/g, '')
  expect(разметка).toContain('--cost-share:15.5')
  expect(разметка).toContain('--cost-share:18.8')
})

test('оборот ноль — у статей слова, полосок нет', () => {
  const разметка = затраты(
    сВодопадом({
      ...(ПЕРЕПИСЬ.waterfall as Водопад),
      steps: (ПЕРЕПИСЬ.waterfall as Водопад).steps.map((с) => ({ ...с, sharePct: null, basePct: null })),
    }),
  )
  expect(разметка).not.toContain('cost-bar-fill')
  expect(разметка.match(/<span class="cost-share"><span>нет данных<\/span><\/span>/g)?.length).toBe(4)
})

/**
 * Круг проверки кода 3. Четвёртое место, где жила сумма рекламы, печатало «0,00 €», пока доля
 * рядом и ступень водопада говорили «нет данных»: одна величина, два ответа на одном экране.
 * Проверка прибита именно к этому случаю — месяц без единой строки выгрузки, — и краснеет,
 * если сумма снова станет обычными деньгами.
 */
function суммаСтатьи(разметка: string, статья: string): string {
  const подпись = разметка.indexOf(`<dt>${статья}</dt>`)
  expect(подпись, `статья «${статья}» в блоке «Затраты»`).toBeGreaterThanOrEqual(0)
  const начало = разметка.indexOf('<dd>', подпись)
  return разметка.slice(начало, разметка.indexOf('</dd>', начало))
}

test('месяц без выгрузки рекламы: сумма рекламы — слова, а не ноль', () => {
  // Круг проверки кода 4: раскладка теперь изображает настоящий месяц без выгрузки целиком —
  // пусты и сумма статьи, и сумма со своей долей у ступени разбора расходов. Прежде гасилась одна
  // сумма, а ступень рядом оставалась с числом и долей: такой картины в настоящих данных не бывает,
  // и проверка стояла на раскладке, где разбираемый случай не возникает.
  const водопад = ПЕРЕПИСЬ.waterfall as Водопад
  const безРекламы: MonthReport = {
    ...ПЕРЕПИСЬ,
    costs: { ...ПЕРЕПИСЬ.costs, ads: null },
    waterfall: {
      ...водопад,
      steps: водопад.steps.map((с) => (с.key === 'ads' ? { ...с, amount: null, sharePct: null, basePct: null } : с)),
    },
  }
  const разметка = затраты(renderToStaticMarkup(<Dashboard report={безРекламы} tab="dengi" />))

  const реклама = суммаСтатьи(разметка, 'Реклама')
  expect(реклама).toContain('нет данных')
  expect(реклама).not.toContain('€')
  // И доля рядом с ней тоже словами, и полоски нет: одна величина — один ответ.
  expect(реклама).not.toContain('% оборота')
  expect(реклама).not.toContain('cost-bar-fill')

  // Соседние статьи остаются деньгами: пусто здесь — про рекламу, а не про весь блок.
  for (const статья of ['Себестоимость проданного', 'Комиссии платёжных систем', 'Постоянные расходы']) {
    expect(суммаСтатьи(разметка, статья)).toContain('€')
  }
})
