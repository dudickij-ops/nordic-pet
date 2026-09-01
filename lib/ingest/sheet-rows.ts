/**
 * Разбор одного листа: из значений, как их отдал Google, — снимок для функции записи.
 *
 * Здесь нет ни сети, ни базы, ни чистки данных. Значения ячеек не трогаются ничем:
 * обе формы даты, хвостовые пробелы, неразрывный дефис и `1 234,50` доезжают в базу
 * посимвольно. Разбор и чистка — работа S4.
 */

export type SheetSpec = {
  /** Имя листа в Таблице. Оно же — имя сырой таблицы и хвост имени функции записи. */
  sheet: string
  /** Ожидаемые столбцы источника, в порядке контракта S1. */
  columns: readonly string[]
  /** Функция записи снимка. */
  fn: string
  /** Сырая таблица, в которую пишет эта функция. */
  table: string
}

/** Строка снимка: адрес в источнике плюс значения ожидаемых столбцов. */
export type SnapshotRow = Record<string, string | number>

export type SheetSnapshot = {
  rows: SnapshotRow[]
  /** Столбцы, которых контракт не ждал. Загрузку не останавливают, но называются вслух. */
  extraColumns: string[]
  /** Сколько строк данных было в листе, считая пустые. */
  rowsRead: number
  /** Сколько из них пропущено как пустые. */
  rowsSkipped: number
}

const spec = (sheet: string, columns: readonly string[]): SheetSpec => ({
  sheet,
  columns,
  fn: `raw.replace_${sheet}`,
  table: `raw.${sheet}`,
})

/**
 * Шесть листов Таблицы «Nordic Pet — operations» с заголовками из контракта S1.
 * Порядок важен: в этом же порядке они запрашиваются и записываются.
 */
export const SHEETS: readonly SheetSpec[] = [
  spec('orders', ['date', 'order_id', 'sku', 'units', 'gross_eur', 'discount_eur', 'gateway']),
  spec('refunds', ['refund_date', 'order_id', 'sku', 'units', 'amount_eur']),
  spec('costs', ['sku', 'cost_eur', 'valid_from']),
  spec('fees', ['gateway', 'percent', 'fixed_eur']),
  spec('opex', ['month', 'category', 'amount_eur']),
  spec('fx', ['date', 'usd_per_eur']),
]

/**
 * Строит снимок листа.
 *
 * Адрес строки — её номер в самом листе: заголовок первый, первая строка данных получает
 * адрес 2. Тогда «строка 7» в базе и строка 7 на экране Google — одно и то же место,
 * и расхождение в числах разбирается глазами, а не пересчётом в уме.
 */
export function snapshotFromValues(sheet: SheetSpec, values: string[][]): SheetSnapshot {
  const header = values[0]
  if (header === undefined) {
    throw new Error(
      `лист ${sheet.sheet} пуст: нет даже строки заголовков. ` +
        'Пустой лист почти всегда означает сбой чтения, а не опустевший источник',
    )
  }

  // Имена обрезаются только для сопоставления. Значения ячеек не обрезаются никогда.
  const names = header.map((name) => (name ?? '').trim())
  const at = new Map<string, number>()
  for (const [index, name] of names.entries()) {
    if (name === '') continue
    if (at.has(name)) {
      throw new Error(
        `в листе ${sheet.sheet} столбец «${name}» назван дважды: сопоставление по имени ` +
          'стало двусмысленным, а угадывать, какой из них нужен, нельзя',
      )
    }
    at.set(name, index)
  }

  const missing = sheet.columns.filter((column) => !at.has(column))
  if (missing.length > 0) {
    throw new Error(
      `в листе ${sheet.sheet} не хватает столбцов: ${missing.join(', ')}. ` +
        'Без них данные неполны, и грузить нечего',
    )
  }

  const data = values.slice(1)
  // Свёрткой, а не раскрытием массива: раскрытие во все строки листа упирается в предел
  // числа доводов и падает отказом движка, а не данных, — молча и не там, где будут искать.
  const width = data.reduce((widest, row) => Math.max(widest, row.length), names.length)

  // Лишний столбец — не повод останавливать дашборд: человек мог дописать колонку с
  // заметками. Но и молчать нельзя: однажды это окажется столбец, который был нужен.
  const expected = new Set(sheet.columns)
  const extraColumns: string[] = []
  for (let index = 0; index < width; index += 1) {
    const name = names[index] ?? ''
    if (name === '') {
      // Столбца без заголовка в Таблице не видно; называем его местом, если в нём есть данные.
      if (data.some((row) => (row[index] ?? '') !== '')) {
        extraColumns.push(`столбец ${index + 1} без заголовка`)
      }
    } else if (!expected.has(name)) {
      extraColumns.push(name)
    }
  }

  const rows: SnapshotRow[] = []
  let rowsSkipped = 0

  for (const [index, source] of data.entries()) {
    // Строка, пустая целиком, пропускается — под данными в листе лежит миллион таких,
    // и Google их даже не присылает. Адреса соседей от этого не сдвигаются: адрес взят
    // из листа, а не из порядка строк.
    if (source.every((cell) => (cell ?? '') === '')) {
      rowsSkipped += 1
      continue
    }

    const row: SnapshotRow = { row_no: index + 2 }
    for (const column of sheet.columns) {
      // Недостающая ячейка добивается пустой строкой — тем же, чем приходит пустая ячейка
      // в середине строки. «Пустая» против «не прислана» — различие транспорта, а не
      // источника, и записав его в базу, мы сказали бы о Таблице неправду.
      row[column] = source[at.get(column) as number] ?? ''
    }
    rows.push(row)
  }

  if (rows.length === 0) {
    throw new Error(
      `в листе ${sheet.sheet} нет ни одной строки данных. ` +
        'Ноль строк почти всегда означает сбой чтения, а не опустевший лист',
    )
  }

  return { rows, extraColumns, rowsRead: data.length, rowsSkipped }
}
