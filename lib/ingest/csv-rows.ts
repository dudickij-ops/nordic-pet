import {
  snapshotFromTable,
  subjectOf,
  inSubjectOf,
  type TableRow,
  type TableSnapshot,
  type TableSpec,
} from './table-rows.ts'

/**
 * Разбор одного файла выгрузки: байты → строки снимка для `raw.replace_entire_ads_folder`.
 *
 * Ни сети, ни базы, ни чистки данных. Значения полей не трогаются ничем: суммы вида
 * `1 234,50`, обе формы даты и хвостовые пробелы доезжают в базу посимвольно. Площадка
 * из имени файла не выводится — это разбор, и живёт он в S4.
 *
 * Разбор пишется здесь, а не берётся библиотекой, нарочно: правил всего несколько, и все
 * они наши — что считать пустой строкой, чем добивать короткую, откуда брать адрес.
 * Чужие умолчания об этом же пролезли бы в сырой слой мимо наших правил.
 */

/** Столбцы файла выгрузки — те же, что записаны контрактом S1. */
export const ADS_COLUMNS = ['date', 'campaign', 'spend_usd'] as const

/** Что человеку делать, если файл оказался без строк данных. */
const WHAT_TO_DO =
  'Если у площадки не было расхода, её файл в папку не кладут вовсе — снимок папки уберёт ' +
  'её строки сам. Файл с одним заголовком означает, что выгрузка сорвалась: повторите её'

/** Запись файла вместе с номером строки, на которой она началась. */
type Record = { values: string[]; line: number }

/**
 * Делит текст на записи по правилам RFC 4180.
 *
 * Поле в кавычках может содержать запятую, перевод строки и удвоенную кавычку. Концом
 * строки считается любой из трёх: CRLF, LF, одиночный CR — в папке лежат файлы и с CRLF,
 * и с LF, и различать их по происхождению нам нечем и незачем.
 *
 * Адресом записи служит номер строки, на которой она началась: перевод строки внутри
 * кавычек съедает строку файла, но не сдвигает адреса — они по-прежнему указывают в файл.
 */
function recordsOf(text: string): Record[] {
  const records: Record[] = []
  let values: string[] = []
  let field = ''
  let quoted = false
  let line = 1
  let startedAt = 1
  let index = 0

  const endField = (): void => {
    values.push(field)
    field = ''
  }
  const endRecord = (): void => {
    endField()
    records.push({ values, line: startedAt })
    values = []
    startedAt = line
  }

  while (index < text.length) {
    const char = text[index]

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }
        quoted = false
        index += 1
        continue
      }
      // Перевод строки внутри кавычек — часть значения, но строку файла он всё равно
      // переводит: следующая запись начнётся ниже, и её адрес обязан это учесть.
      if (char === '\r') {
        field += text[index + 1] === '\n' ? '\r\n' : '\r'
        index += text[index + 1] === '\n' ? 2 : 1
        line += 1
        continue
      }
      if (char === '\n') {
        field += '\n'
        index += 1
        line += 1
        continue
      }
      field += char
      index += 1
      continue
    }

    if (char === '"' && field === '') {
      quoted = true
      index += 1
      continue
    }
    if (char === ',') {
      endField()
      index += 1
      continue
    }
    if (char === '\r' || char === '\n') {
      const width = char === '\r' && text[index + 1] === '\n' ? 2 : 1
      line += 1
      endRecord()
      index += width
      continue
    }

    field += char
    index += 1
  }

  // Последняя запись без перевода строки в конце — обычная запись. Перевод строки в конце
  // файла — обычная запись файла, а не пустая строка под данными: пустых записей от него
  // не остаётся.
  if (field !== '' || values.length > 0) endRecord()

  return records
}

/**
 * Строит снимок файла выгрузки.
 *
 * Байты раскодируются как UTF-8, и метка порядка байтов срезается явно. Явно — потому что
 * два очевидных способа раскодировать в Node ведут себя по-разному: один метку убирает,
 * другой оставляет. Правило не должно зависеть от того, каким из них воспользовались.
 */
export function rowsFromCsv(fileName: string, bytes: Uint8Array): TableSnapshot {
  const source: TableSpec = { kind: 'file', name: fileName, columns: ADS_COLUMNS }

  const decoded = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
  const text = decoded.startsWith('﻿') ? decoded.slice(1) : decoded

  const records = recordsOf(text)
  const header = records[0]
  if (header === undefined) {
    throw new Error(`${subjectOf(source)} пуст: нет даже строки заголовков. ${WHAT_TO_DO}`)
  }

  const data: TableRow[] = records.slice(1).map((record) => ({
    values: record.values,
    rowNo: record.line,
  }))

  const snapshot = snapshotFromTable(source, header.values, data)

  if (snapshot.rows.length === 0) {
    throw new Error(`${inSubjectOf(source)} нет ни одной строки данных. ${WHAT_TO_DO}`)
  }

  // Адрес строки в raw.ads составной: имя файла плюс номер строки в нём. Площадку из
  // имени не выводим — это разбор, и он в S4.
  return {
    ...snapshot,
    rows: snapshot.rows.map((row) => ({ file_name: fileName, ...row })),
  }
}
