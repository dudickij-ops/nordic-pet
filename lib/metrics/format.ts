/**
 * Формат чисел для экрана — задача 6.
 *
 * Ни одна функция здесь не считает. `round(x, 2)` и `round(x, 1)` уже сделаны в SQL —
 * последнем выражении запроса; второе округление здесь означало бы два места, которые
 * однажды разойдутся молча. Функции ниже только переставляют символы в уже готовой
 * строке: расставляют разряды пробелом, меняют точку на запятую, дописывают знак евро
 * или процента и превращают `null` в слова «нет данных».
 */

/** Знак минуса — не дефис: типографский минус, тот же символ, что в проверках. */
const MINUS = '−'

/**
 * Расставляет разряды целой части пробелом и меняет точку на запятую в дробной.
 * Сама по себе ничего не округляет и не достраивает дробную часть — сколько цифр
 * пришло из SQL, столько и остаётся.
 */
function groupDigits(v: string): string {
  const negative = v.startsWith('-')
  const unsigned = negative ? v.slice(1) : v
  const [intPart, decPart] = unsigned.split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const withDecimal = decPart === undefined ? grouped : `${grouped},${decPart}`
  return negative ? `${MINUS}${withDecimal}` : withDecimal
}

/** Деньги: разряды пробелом, запятая вместо точки, знак евро. Арифметики нет. */
export function money(v: string): string {
  return `${groupDigits(v)} €`
}

/**
 * Проценты: запятая вместо точки, знак процента. `null` значит «нет данных» — деление
 * на ноль в SQL уже отдало `null` через `nullif`, и здесь это не ноль, а честная надпись.
 */
export function percent(v: string | null): string {
  if (v === null) return 'нет данных'
  return `${groupDigits(v)} %`
}

/** Штуки: те же разряды пробелом, без знака валюты — штуки на экране не бывают отрицательными. */
export function count(v: string): string {
  return groupDigits(v)
}
