import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'

import { Dashboard } from '@/app/page'
import { ПЕРЕПИСЬ } from './fixture.ts'

/**
 * Признак скрытых колонок у таблицы товаров — кусок S12, задача 6.
 *
 * На узком экране таблица прокручивается внутри карточки, и колонок за правым краем не видно
 * ничем. Человек с телефона о них не узнавал, и узкий снимок описи повторял ту же слепоту —
 * поэтому опись обещала колонки, которых на ней нет.
 *
 * Сторожится здесь устройство: строка есть в разметке, по умолчанию она скрыта, и показывается
 * тем же запросом, которым таблица становится прокручиваемой. Что браузер вправду её покажет —
 * доказывает снимок.
 */

const СТИЛИ = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8')
const СТРОКА = 'Таблица прокручивается вбок: за правым краем есть ещё колонки.'

describe('признак скрытых колонок', () => {
  test('строка стоит в разметке таблицы товаров', () => {
    expect(renderToStaticMarkup(<Dashboard report={ПЕРЕПИСЬ} tab="tovary" />)).toContain(СТРОКА)
  })

  test('по умолчанию строки не видно: на широком экране колонки видны все', () => {
    expect(СТИЛИ).toMatch(/\.items-scroll \{\s*display: none;\s*\}/)
  })

  test('строка показывается тем же запросом, которым таблица прокручивается', () => {
    const начало = СТИЛИ.indexOf('@media (max-width: 48rem) {')
    expect(начало).toBeGreaterThan(-1)
    const запрос = СТИЛИ.slice(начало, СТИЛИ.indexOf('\n}', начало))
    expect(запрос).toContain('overflow-x: auto;')
    expect(запрос).toContain('.items-scroll {')
    expect(запрос).toContain('display: block;')
  })
})
