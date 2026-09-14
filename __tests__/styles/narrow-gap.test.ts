import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

/**
 * Зазор между блоками на узком экране — кусок S12, задача 5.
 *
 * **Проверка честно слабая и названа слабой:** она читает текст таблицы стилей, а не то, как
 * браузер развёл блоки. Заменить её механизмом нечем — вид в этом проекте доказывается снимком и
 * глазом. Сторожит она ровно две вещи, и обе — решения владельца, которые легко потерять при
 * следующей правке: зазор на узком экране больше обычного, и берётся он из выписанной шкалы, а не
 * своим числом.
 *
 * Про рамку — отдельное утверждение: владелец запретил разделять блоки рамкой, потому что рамке
 * понадобился бы свой якорь в чужой системе оформления.
 */

const СТИЛИ = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8')
const УЗКИЙ = 'ЗАПРОС_НЕ_НАЙДЕН'

function узкийЗапрос(): string {
  const начало = СТИЛИ.indexOf('@media (max-width: 40rem) {')
  expect(начало, УЗКИЙ).toBeGreaterThan(-1)
  let глубина = 0
  for (let i = СТИЛИ.indexOf('{', начало); i < СТИЛИ.length; i += 1) {
    if (СТИЛИ[i] === '{') глубина += 1
    if (СТИЛИ[i] === '}') {
      глубина -= 1
      if (глубина === 0) return СТИЛИ.slice(начало, i + 1)
    }
  }
  throw new Error('узкий запрос не закрыт')
}

describe('разделение блоков на узком экране', () => {
  test('зазор на узком экране больше обычного', () => {
    const запрос = узкийЗапрос()
    expect(запрос).toContain('margin-bottom: var(--spacingVerticalXXXL);')
    expect(запрос).toContain('gap: var(--spacingVerticalXXXL);')
    // Обычный зазор — `--gap`, то есть `--spacingVerticalL`. Узкий обязан быть другим и большим.
    expect(СТИЛИ).toContain('--gap: var(--spacingVerticalL);')
    expect(СТИЛИ).toContain('--spacingVerticalXXXL: 32px;')
    expect(СТИЛИ).toContain('--spacingVerticalL: 16px;')
  })

  test('зазор взят из выписанной шкалы, а не своим числом', () => {
    const своиЧисла = [...узкийЗапрос().matchAll(/(margin-bottom|gap):\s*([^;]+);/g)]
      .map((м) => м[2].trim())
      .filter((значение) => !значение.startsWith('var(--spacing'))
    expect(своиЧисла).toEqual([])
  })

  test('блоки разделены зазором, а не рамкой', () => {
    expect(узкийЗапрос()).not.toMatch(/\bborder(-[a-z]+)?:\s*(?!none)/)
  })
})
