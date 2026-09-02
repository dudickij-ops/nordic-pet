/**
 * Разбор значений источника: даты, числа, штуки, артикулы.
 *
 * Ни базы, ни сети, ни знания о том, из какой таблицы приехало значение. На вход — текст
 * ячейки и её адрес, на выход — значение либо отказ, называющий место, само значение и то,
 * что человеку делать.
 *
 * Разбор ничего не угадывает. Форм даты в источнике две, и обе названы здесь поимённо;
 * третья — отказ, а не догадка. Молчаливое округление запрещено: округлив, мы записали бы
 * в факты не то число, что стоит в источнике, и след «у каждого числа есть адрес строки»
 * перестал бы быть правдой.
 */

/** Где стоит ячейка. `source` уже в предложном падеже: «в листе orders», «в файле meta.csv». */
export type CellAddress = {
  source: string
  rowNo: number
  column: string
}

/**
 * Отказ разбора одной ячейки.
 *
 * Адрес лежит полем, а не только в тексте: сборка собирает все непонятые места и называет
 * их разом, и ей нужно не сообщение, а то, из чего сообщение складывается.
 */
export class CellError extends Error {
  readonly address: CellAddress

  constructor(address: CellAddress, what: string) {
    super(`${address.source}, строка ${address.rowNo}, столбец ${address.column}: ${what}`)
    this.name = 'CellError'
    this.address = address
  }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const EURO_DATE = /^(\d{2})\.(\d{2})\.(\d{4})$/
const ISO_MONTH = /^(\d{4})-(\d{2})$/
const EURO_MONTH = /^(\d{2})\.(\d{4})$/

/** Пробелы, которыми в источнике разделяют тысячи. Три написания, все три встречаются. */
const THOUSAND_SPACES = /[   ]/g

/**
 * Число с пробелом-разделителем тысяч в правильных местах: группы ровно по три цифры.
 * Без этой проверки «1 2» стало бы двенадцатью — опечатка прочиталась бы как число.
 */
const SPACED_NUMBER = /^-?\d{1,3}(?:[   ]\d{3})*(?:[.,]\d+)?$/

/**
 * Дефисы, которыми в источнике написан артикул. Неразрывный (U+2011) стоит в листе orders
 * живьём; остальные добавлены потому, что все они приезжают из одного места — из правки
 * текста в редакторе, который «улучшает» дефис.
 */
const DASHES = /[‐‑‒–—―−]/g

/** Существует ли такая дата. `31.02` — не дата, а опечатка, и переезжать на март ей нельзя. */
function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false
  const point = new Date(Date.UTC(year, month - 1, day))
  return (
    point.getUTCFullYear() === year &&
    point.getUTCMonth() === month - 1 &&
    point.getUTCDate() === day
  )
}

/**
 * Дата в одной из двух форм источника: `ГГГГ-ММ-ДД` и `ДД.ММ.ГГГГ`.
 *
 * Форма с точками читается как день-месяц-год. Прочитанная наоборот, она молча переносила бы
 * выручку между месяцами: `03.04.2026` — это третье апреля, и в марте его быть не должно.
 */
export function parseDate(text: string | null | undefined, at: CellAddress): string {
  const value = (text ?? '').trim()
  if (value === '') {
    throw new CellError(at, 'дата не заполнена. Впишите её в формате 2026-03-01 или 01.03.2026')
  }

  const iso = ISO_DATE.exec(value)
  const euro = EURO_DATE.exec(value)
  if (iso === null && euro === null) {
    throw new CellError(
      at,
      `«${value}» — дата не разобрана. В источнике две формы: ГГГГ-ММ-ДД (2026-03-01) ` +
        'и ДД.ММ.ГГГГ (01.03.2026); напишите любой из них',
    )
  }

  const [year, month, day] =
    iso !== null
      ? [iso[1], iso[2], iso[3]]
      : [(euro as RegExpExecArray)[3], (euro as RegExpExecArray)[2], (euro as RegExpExecArray)[1]]

  if (!isRealDate(Number(year), Number(month), Number(day))) {
    throw new CellError(
      at,
      `«${value}» — такой даты не существует. Проверьте день и месяц: разбор не переносит ` +
        'лишние дни на следующий месяц',
    )
  }

  return `${year}-${month}-${day}`
}

/**
 * Месяц в одной из двух форм: `ГГГГ-ММ` и `ММ.ГГГГ`. Хранится первым днём месяца —
 * колонка в слое фактов имеет тип даты, и месяц в ней надо чем-то представлять.
 */
export function parseMonth(text: string | null | undefined, at: CellAddress): string {
  const value = (text ?? '').trim()
  if (value === '') {
    throw new CellError(at, 'месяц не заполнен. Впишите его в формате 2026-03 или 03.2026')
  }

  const iso = ISO_MONTH.exec(value)
  const euro = EURO_MONTH.exec(value)
  if (iso === null && euro === null) {
    throw new CellError(
      at,
      `«${value}» — месяц не разобран. В источнике две формы: ГГГГ-ММ (2026-03) ` +
        'и ММ.ГГГГ (03.2026); напишите любой из них',
    )
  }

  const [year, month] =
    iso !== null ? [iso[1], iso[2]] : [(euro as RegExpExecArray)[2], (euro as RegExpExecArray)[1]]

  if (Number(month) < 1 || Number(month) > 12) {
    throw new CellError(at, `«${value}» — такого месяца не существует`)
  }

  return `${year}-${month}-01`
}

/** Сколько раз знак встречается в строке. */
function countOf(value: string, sign: string): number {
  return value.split(sign).length - 1
}

/**
 * Денежная сумма, курс или процент — нормализованным десятичным **текстом**.
 *
 * Текстом, а не числом, нарочно. Число в JavaScript — двоичная дробь: `0.1 + 0.2` не равно
 * `0.3`, и вернув число, разбор отдал бы драйверу уже испорченное значение, а починить его
 * было бы негде. Форму проверяем мы, в `numeric` текст превращает сама база.
 *
 * `scale` — сколько знаков после запятой вмещает колонка: 2 у денег, 6 у курса, 4 у процента.
 * Больше — отказ: округлить молча значит записать в факты не то, что в источнике.
 *
 * Пустая ячейка — это `null`, «источник промолчал». Ноль вместо неё не пишется никогда:
 * отсутствующая цена поставщика имеет своё правило счёта, а превращённая в ноль она сделала
 * бы прибыль красивее ровно на ту сумму, которой мы не знаем.
 */
export function parseAmount(
  text: string | null | undefined,
  at: CellAddress,
  scale: number,
): string | null {
  const raw = (text ?? '').trim()
  if (raw === '') return null

  // Пробел допустим только там, где он разделяет тысячи: группами ровно по три цифры.
  if (THOUSAND_SPACES.test(raw)) {
    THOUSAND_SPACES.lastIndex = 0
    if (!SPACED_NUMBER.test(raw)) {
      throw new CellError(
        at,
        `«${raw}» — пробел стоит не там, где разделяют тысячи. Напишите число без пробелов ` +
          'или группами по три цифры: 1 234,50',
      )
    }
  }
  THOUSAND_SPACES.lastIndex = 0

  const value = raw.replace(THOUSAND_SPACES, '')
  const dots = countOf(value, '.')
  const commas = countOf(value, ',')

  let normalized: string
  if (dots > 0 && commas > 0) {
    // Оба разделителя на месте — значит десятичный тот, что стоит последним, а первый
    // разделяет тысячи. `1.234,50` и `1,234.50` — одно и то же число, записанное по-разному.
    const decimal = value.lastIndexOf('.') > value.lastIndexOf(',') ? '.' : ','
    const thousands = decimal === '.' ? ',' : '.'
    if (countOf(value, decimal) !== 1) {
      throw new CellError(
        at,
        `«${raw}» — разделители расставлены так, что число не читается однозначно. ` +
          'Напишите его с одним разделителем: 1234.56',
      )
    }
    normalized = value.split(thousands).join('').replace(decimal, '.')
  } else if (dots + commas > 1) {
    // Один вид разделителя, но повторённый: где тут тысячи, а где копейки, знает только
    // человек. Угадав, мы ошиблись бы в тысячу раз и выглядели бы при этом правдоподобно.
    throw new CellError(
      at,
      `«${raw}» — разделитель повторяется, и что здесь тысячи, а что знаки после запятой, ` +
        'разбор не угадывает. Напишите число с одним разделителем: 1234.56',
    )
  } else {
    normalized = value.replace(',', '.')
  }

  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    throw new CellError(at, `«${raw}» — не похоже на число. Напишите его цифрами: 1234,56`)
  }

  const fraction = normalized.split('.')[1] ?? ''
  if (fraction.length > scale) {
    throw new CellError(
      at,
      `«${raw}» — знаков после запятой ${fraction.length}, а колонка хранит ${scale}. ` +
        'Округлить молча нельзя: напишите число так, чтобы оно влезало без округления',
    )
  }

  return normalized
}

/** Количество штук: целое и больше нуля. Строка с нулём штук — не продажа. */
export function parseUnits(text: string | null | undefined, at: CellAddress): number {
  const value = (text ?? '').trim()
  if (value === '') {
    throw new CellError(at, 'количество не заполнено. Впишите целое число штук')
  }
  if (!/^-?\d+$/.test(value)) {
    throw new CellError(at, `«${value}» — количество должно быть целым числом штук`)
  }

  const units = Number(value)
  if (units <= 0) {
    throw new CellError(
      at,
      `«${value}» — штук должно быть больше нуля: строка с нулём или отрицательным ` +
        'количеством не продажа. Исправьте её или уберите',
    )
  }

  return units
}

/**
 * Артикул в одном написании: все пробелы сняты, любой дефис-не-дефис заменён обычным,
 * буквы подняты в верхний регистр.
 *
 * Пробелы снимаются **все**, а не только крайние. Цена решения: артикул, в котором пробел
 * значащий, слился бы с соседним. В этом магазине двенадцать артикулов вида `NP-0NN`,
 * пробела нет ни в одном, а в источнике пробел — это грязь.
 *
 * Приведение живёт только в слое фактов. Сырьё остаётся кривым, и адрес строки ведёт
 * к исходному написанию.
 */
export function normalizeSku(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/\s/g, '')
    .replace(DASHES, '-')
    .toUpperCase()
}

/** Артикул, без которого строка не ложится ни в один столбец экрана. Пустой — отказ. */
export function parseSku(text: string | null | undefined, at: CellAddress): string {
  const value = normalizeSku(text)
  if (value === '') {
    throw new CellError(at, 'артикул не заполнен. Без него строку не отнести ни к одному товару')
  }
  return value
}

/**
 * Обязательное текстовое значение: номер заказа, способ оплаты, кампания, категория.
 *
 * Крайние пробелы снимаются: иначе «card » и «card» стали бы разными способами оплаты, а
 * заказ с пробелом в номере распался бы надвое. Регистр не трогается — это не артикул,
 * и придумывать ему правило приведения не на чем.
 */
export function requireText(text: string | null | undefined, at: CellAddress): string {
  const value = (text ?? '').trim()
  if (value === '') {
    throw new CellError(at, 'значение не заполнено, а без него строка не опознаётся')
  }
  return value
}
