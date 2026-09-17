import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import { Dashboard } from '@/app/page'
import type { MonthReport } from '@/lib/metrics/report'
import { ОДИННАДЦАТЬ, ПЕРЕПИСЬ } from './fixture.ts'
import { текстПоПорядку } from './census-text.ts'

/**
 * Блок «Качество данных» — кусок S13, задача 13: доля по настоящей цене, артикулы без цены и
 * неполнота одним блоком. На виду — виды с признаком «есть дыры», все одиннадцать — под раскрытием.
 *
 * **Раскладка переписи здесь не годится для первой проверки сама по себе:** у всех её одиннадцати
 * видов признак стоит, скрытых видов в ней нет, и проверка «на виду только с дырами» прошла бы
 * зелёной и при списке без фильтра. Поэтому вариант с признаком у части видов строится здесь же.
 *
 * Текст режется с блока качества, а не со всей страницы: у блока товаров своё раскрытие, и оба
 * `<details>` на странице различаются только классом. Нет блока или раскрытия — отказ, а не пустой
 * текст, в котором «ничего не найдено» читалось бы как успех.
 */

/** Блок качества целиком и две его части: до раскрытия (на виду) и само раскрытие. */
function частиКачества(html: string): { видно: string; раскрыто: string } {
  const начало = html.indexOf('<section id="kachestvo"')
  if (начало === -1) throw new Error('блока качества (id="kachestvo") на экране нет')
  const конец = html.indexOf('</section>', начало)
  if (конец === -1) throw new Error('блок качества не закрыт')
  const блок = html.slice(начало, конец)
  const раскрытие = блок.indexOf('<details class="gaps-more">')
  if (раскрытие === -1) throw new Error('раскрытия неполноты (details.gaps-more) в блоке качества нет')
  return { видно: блок.slice(0, раскрытие), раскрыто: блок.slice(раскрытие) }
}

/** Строки видов неполноты в куске разметки: текст элементов `<li>` по порядку. */
function строкиВидов(кусок: string): string[] {
  return [...кусок.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].flatMap((м) => текстПоПорядку(м[1]))
}

const строка = (вид: MonthReport['gaps'][number]) => `${вид.kind}: ${вид.count}`

test('видны только виды с дырами; все одиннадцать — под раскрытием', () => {
  // Признак у первого, третьего и пятого видов; у прочих счёт ноль и признака нет.
  const сПризнаком = new Set([0, 2, 4])
  const gaps = ПЕРЕПИСЬ.gaps.map((вид, i) =>
    сПризнаком.has(i) ? { ...вид, hasHoles: true } : { ...вид, count: 0, hasHoles: false },
  )
  expect(gaps).toHaveLength(ОДИННАДЦАТЬ.length)
  const { видно, раскрыто } = частиКачества(renderToStaticMarkup(<Dashboard report={{ ...ПЕРЕПИСЬ, gaps }} />))

  expect(строкиВидов(видно), 'на виду ровно виды с признаком').toEqual(['скидки: 1', 'возвраты без суммы: 3', 'возвращено больше, чем куплено: 5'])
  expect(видно).not.toContain('Дыр в данных нет.')
  expect(строкиВидов(раскрыто), 'под раскрытием все одиннадцать').toEqual(gaps.map(строка))
  expect(раскрыто).toContain('<summary>Показать все виды неполноты</summary>')

  // Раскладка переписи: признак у всех одиннадцати — на виду все одиннадцать.
  const перепись = частиКачества(renderToStaticMarkup(<Dashboard report={ПЕРЕПИСЬ} />))
  expect(ПЕРЕПИСЬ.gaps.every((вид) => вид.hasHoles === true)).toBe(true)
  expect(строкиВидов(перепись.видно)).toEqual(ПЕРЕПИСЬ.gaps.map(строка))
  expect(строкиВидов(перепись.раскрыто)).toEqual(ПЕРЕПИСЬ.gaps.map(строка))
})

test('дыр нет — так и написано', () => {
  const gaps = ПЕРЕПИСЬ.gaps.map((в) => ({ ...в, hasHoles: false }))
  const html = renderToStaticMarkup(<Dashboard report={{ ...ПЕРЕПИСЬ, gaps }} />)
  expect(html).toContain('Дыр в данных нет.')
  const { видно, раскрыто } = частиКачества(html)
  expect(строкиВидов(видно), 'на виду ни одного вида').toEqual([])
  expect(строкиВидов(раскрыто), 'под раскрытием по-прежнему все одиннадцать').toEqual(gaps.map(строка))
})

test('ссылка из результата и пометки товаров ведёт на этот блок', () => {
  expect(renderToStaticMarkup(<Dashboard report={ПЕРЕПИСЬ} />)).toContain('id="kachestvo"')
})
