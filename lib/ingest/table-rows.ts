/**
 * Общий разбор «заголовок и строки» — один на лист Таблицы и на файл с Диска.
 *
 * Правила у них совпадают дословно: столбцы сопоставляются по имени, пропавший столбец —
 * отказ, повторившийся — отказ, лишний называется вслух, короткая строка добивается
 * пустыми значениями, пустая строка пропускается. Второй экземпляр этих правил разошёлся
 * бы с первым молча, поэтому экземпляр один.
 *
 * Чего здесь нет. Ни сети, ни базы, ни чистки данных: значения не трогаются ничем.
 * И нет решения о том, пуст ли источник, — это решение принимает тот, кто его читал:
 * пустому листу и пустому файлу человеку говорят разное, и советы у них тоже разные.
 *
 * Адрес строки сюда приезжает готовым. Лист считает его от начала листа, файл — от начала
 * файла; общего правила тут нет, а вот право сдвигать чужие адреса не имеет ни тот, ни
 * другой.
 */

/** Чем источник называют человеку. Падежи разные, поэтому оба написаны, а не склеены. */
const SUBJECT = {
  sheet: { nominative: 'лист', prepositional: 'в листе' },
  file: { nominative: 'файл', prepositional: 'в файле' },
} as const

export type SourceKind = keyof typeof SUBJECT

/** Источник: чем его называть, как он зовётся и какие столбцы в нём ожидаются. */
export type TableSpec = {
  kind: SourceKind
  name: string
  columns: readonly string[]
}

/** Строка источника вместе со своим адресом в нём. */
export type TableRow = {
  values: string[]
  rowNo: number
}

/** Строка снимка: адрес в источнике плюс значения ожидаемых столбцов. */
export type SnapshotRow = Record<string, string | number>

export type TableSnapshot = {
  rows: SnapshotRow[]
  /** Столбцы, которых контракт не ждал. Загрузку не останавливают, но называются вслух. */
  extraColumns: string[]
  /** Сколько строк данных было в источнике, считая пустые. */
  rowsRead: number
  /** Сколько из них пропущено как пустые. */
  rowsSkipped: number
}

/** Как назвать источник в начале фразы: «лист orders», «файл meta_2026-03.csv». */
export function subjectOf(spec: TableSpec): string {
  return `${SUBJECT[spec.kind].nominative} ${spec.name}`
}

/** Как назвать его в середине фразы: «в листе orders», «в файле meta_2026-03.csv». */
export function inSubjectOf(spec: TableSpec): string {
  return `${SUBJECT[spec.kind].prepositional} ${spec.name}`
}

export function snapshotFromTable(
  spec: TableSpec,
  header: readonly string[],
  data: readonly TableRow[],
): TableSnapshot {
  const where = inSubjectOf(spec)

  // Имена обрезаются только для сопоставления. Значения ячеек не обрезаются никогда.
  const names = header.map((name) => (name ?? '').trim())
  const at = new Map<string, number>()
  for (const [index, name] of names.entries()) {
    if (name === '') continue
    if (at.has(name)) {
      throw new Error(
        `${where} столбец «${name}» назван дважды: сопоставление по имени стало ` +
          'двусмысленным, а угадывать, какой из них нужен, нельзя',
      )
    }
    at.set(name, index)
  }

  const missing = spec.columns.filter((column) => !at.has(column))
  if (missing.length > 0) {
    throw new Error(
      `${where} не хватает столбцов: ${missing.join(', ')}. ` +
        'Без них данные неполны, и грузить нечего',
    )
  }

  // Свёрткой, а не раскрытием массива: раскрытие во все строки источника упирается в предел
  // числа доводов и падает отказом движка, а не данных, — молча и не там, где будут искать.
  const width = data.reduce((widest, row) => Math.max(widest, row.values.length), names.length)

  // Лишний столбец — не повод останавливать дашборд: человек мог дописать колонку с
  // заметками. Но и молчать нельзя: однажды это окажется столбец, который был нужен.
  const expected = new Set(spec.columns)
  const extraColumns: string[] = []
  for (let index = 0; index < width; index += 1) {
    const name = names[index] ?? ''
    if (name === '') {
      // Столбца без заголовка в источнике не видно; называем его местом, если в нём есть данные.
      if (data.some((row) => (row.values[index] ?? '') !== '')) {
        extraColumns.push(`столбец ${index + 1} без заголовка`)
      }
    } else if (!expected.has(name)) {
      extraColumns.push(name)
    }
  }

  const rows: SnapshotRow[] = []
  let rowsSkipped = 0

  for (const source of data) {
    // Строка, пустая целиком, пропускается — под данными в листе лежит миллион таких,
    // и Google их даже не присылает. Адреса соседей от этого не сдвигаются: адрес взят
    // из источника, а не из порядка строк.
    if (source.values.every((cell) => (cell ?? '') === '')) {
      rowsSkipped += 1
      continue
    }

    const row: SnapshotRow = { row_no: source.rowNo }
    for (const column of spec.columns) {
      // Недостающее значение добивается пустой строкой — тем же, чем приходит пустая ячейка
      // в середине строки. «Пустое» против «не прислано» — различие транспорта, а не
      // источника, и записав его в базу, мы сказали бы о источнике неправду.
      row[column] = source.values[at.get(column) as number] ?? ''
    }
    rows.push(row)
  }

  return { rows, extraColumns, rowsRead: data.length, rowsSkipped }
}
