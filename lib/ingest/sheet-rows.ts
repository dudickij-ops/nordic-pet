import {
  snapshotFromTable,
  subjectOf,
  inSubjectOf,
  type SnapshotRow,
  type TableSnapshot,
  type TableSpec,
} from './table-rows.ts'

/**
 * Шесть листов Таблицы «Nordic Pet — operations» и разбор одного листа.
 *
 * Сам разбор — общий с файлами Диска и живёт в `table-rows.ts`. Здесь остаётся то, что
 * у листа своё: какие листы читаются, куда они пишутся, как считается адрес строки и
 * что человеку говорят про пустой лист.
 *
 * Значения ячеек не трогаются ничем: обе формы даты, хвостовые пробелы, неразрывный
 * дефис и `1 234,50` доезжают в базу посимвольно. Разбор и чистка — работа S4.
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

export type { SnapshotRow }
export type SheetSnapshot = TableSnapshot

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

/** Лист как источник для общего разбора. */
const sourceOf = (sheet: SheetSpec): TableSpec => ({
  kind: 'sheet',
  name: sheet.sheet,
  columns: sheet.columns,
})

/**
 * Строит снимок листа.
 *
 * Адрес строки — её номер в самом листе: заголовок первый, первая строка данных получает
 * адрес 2. Тогда «строка 7» в базе и строка 7 на экране Google — одно и то же место,
 * и расхождение в числах разбирается глазами, а не пересчётом в уме.
 */
export function snapshotFromValues(sheet: SheetSpec, values: string[][]): SheetSnapshot {
  const source = sourceOf(sheet)
  const header = values[0]
  if (header === undefined) {
    throw new Error(
      `${subjectOf(source)} пуст: нет даже строки заголовков. ` +
        'Пустой лист почти всегда означает сбой чтения, а не опустевший источник',
    )
  }

  const snapshot = snapshotFromTable(
    source,
    header,
    values.slice(1).map((cells, index) => ({ values: cells, rowNo: index + 2 })),
  )

  if (snapshot.rows.length === 0) {
    throw new Error(
      `${inSubjectOf(source)} нет ни одной строки данных. ` +
        'Ноль строк почти всегда означает сбой чтения, а не опустевший лист',
    )
  }

  return snapshot
}
