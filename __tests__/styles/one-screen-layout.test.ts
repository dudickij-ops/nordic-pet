import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

/**
 * Раскладка одного экрана — кусок S13, задача 16b.
 *
 * Снимки после задачи 16 показали пять поломок вида, которые кусок внёс сам: столбики ряда сжаты в
 * правую половину, подпись средней закрывает столбики, доля водопада уезжает за край карточки, числа
 * узкой таблицы товаров наезжают друг на друга, подзаголовок неполноты крупнее заголовка блока.
 *
 * **Все проверки здесь — текстовые и потому слабые, и так названы.** Они читают текст таблицы стилей,
 * а не то, как браузер разложил экран. Что поломки ушли, доказывает только снимок и глаз; здесь
 * сторожится, чтобы при следующей правке не вернулось именно то правило, которое их вызывало.
 */

const СТИЛИ = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

/** Таблица стилей без медиазапросов: правила широкого экрана. */
function безЗапросов(текст: string): string {
  let итог = ''
  let i = 0
  while (i < текст.length) {
    const начало = текст.indexOf('@media', i)
    if (начало === -1) return итог + текст.slice(i)
    итог += текст.slice(i, начало)
    let глубина = 0
    let j = текст.indexOf('{', начало)
    for (; j < текст.length; j += 1) {
      if (текст[j] === '{') глубина += 1
      if (текст[j] === '}') {
        глубина -= 1
        if (глубина === 0) break
      }
    }
    i = j + 1
  }
  return итог
}

const ШИРОКИЙ = безЗапросов(СТИЛИ)

/** Тела всех правил, у которых список селекторов — ровно `селектор` (или содержит его отдельным пунктом). */
function правила(селектор: string, текст = ШИРОКИЙ): string[] {
  const найдено: string[] = []
  for (const кусок of текст.split('}')) {
    const скобка = кусок.lastIndexOf('{')
    if (скобка === -1) continue
    const пункты = кусок.slice(0, скобка).split(/[{;]/).at(-1)!.split(',').map((п) => п.trim())
    if (пункты.includes(селектор)) найдено.push(кусок.slice(скобка + 1))
  }
  return найдено
}

function одноПравило(селектор: string, текст = ШИРОКИЙ): string {
  const найдено = правила(селектор, текст).filter((тело) => !/^\s*$/.test(тело))
  expect(найдено.length, `правило «${селектор}» ровно одно`).toBe(1)
  return найдено[0]
}

function запрос(условие: string): string {
  const начало = СТИЛИ.indexOf(`@media (${условие}) {`)
  expect(начало, `запрос ${условие} есть`).toBeGreaterThan(-1)
  let глубина = 0
  for (let i = СТИЛИ.indexOf('{', начало); i < СТИЛИ.length; i += 1) {
    if (СТИЛИ[i] === '{') глубина += 1
    if (СТИЛИ[i] === '}') {
      глубина -= 1
      if (глубина === 0) return СТИЛИ.slice(СТИЛИ.indexOf('{', начало) + 1, i)
    }
  }
  throw new Error(`запрос ${условие} не закрыт`)
}

/** Размер токена в пикселях из блока величин светлой темы. */
function пиксели(значение: string): number {
  const ссылка = /^var\(--([\w-]+)\)$/.exec(значение.trim())
  expect(ссылка, `«${значение}» — ссылка на токен`).not.toBeNull()
  const объявление = new RegExp(`--${ссылка![1]}:\\s*(\\d+(?:\\.\\d+)?)px;`).exec(СТИЛИ)
  expect(объявление, `токен --${ссылка![1]} объявлен в пикселях`).not.toBeNull()
  return Number(объявление![1])
}

describe('раскладка одного экрана', () => {
  test('место в сетке ряда у области столбиков, а у списка столбиков своей колонки нет', () => {
    const область = одноПравило('.daily-plot')
    expect(область).toContain('grid-column: 2;')
    expect(область).toContain('grid-row: 1;')
    for (const тело of правила('.daily-bars')) expect(тело).not.toMatch(/grid-(column|row|area)/)
  })

  test('подпись средней стоит над областью столбиков, а не у линии поверх них', () => {
    expect(одноПравило('.daily-mean')).toContain('inset: 0;')
    const подпись = одноПравило('.daily-mean-label')
    expect(подпись).toContain('bottom: 100%;')
    expect(подпись).toContain('background: var(--colorNeutralBackground1);')
  })

  test('у ступеней водопада одна сетка на все строки, сумма и доля шириной по своему тексту', () => {
    expect(одноПравило('.waterfall-steps')).toMatch(/grid-template-columns: [^;]* auto auto;/)
    expect(одноПравило('.waterfall-steps li')).toContain('grid-template-columns: subgrid;')
  })

  /*
   * Отступление, названное: на узком экране раскладка таблиц — по содержимому, и колонки двух таблиц
   * могут не стоять друг под другом. Числа не переносятся — `td` с `white-space: nowrap`.
   */
  test('на узком экране таблицы товаров раскладываются по своим числам и прокручиваются в карточке', () => {
    const узкий = запрос('max-width: 48rem')
    expect(одноПравило('.items', узкий)).toContain('overflow-x: auto;')
    expect(одноПравило('.items table', узкий)).toContain('table-layout: auto;')
    expect(правила('td').some((тело) => тело.includes('white-space: nowrap;')), 'у td запрет переноса').toBe(true)
  })

  test('подзаголовок в блоке не крупнее заголовка блока', () => {
    const h2 = /font-size: ([^;]+);/.exec(одноПравило('h2'))
    const h3 = /font-size: ([^;]+);/.exec(одноПравило('h3'))
    expect(h2, 'у h2 есть кегль').not.toBeNull()
    expect(h3, 'у h3 есть кегль').not.toBeNull()
    expect(пиксели(h3![1])).toBeLessThanOrEqual(пиксели(h2![1]))
  })
})
