import { Client } from 'pg'

import { resolveIngestTarget } from './target.ts'
import { SHEETS, snapshotFromValues } from './sheet-rows.ts'
import { readOperationsSpreadsheet, type SheetValues } from './sheets-source.ts'

/**
 * Загрузка Google Таблицы в сырой слой.
 *
 * Это функция, а не команда: команда — обёртка вокруг неё, и кнопка «Обновить данные»
 * на S5 позовёт ту же самую функцию. Печатать она ничего не печатает и процесс не
 * завершает — отдаёт отчёт тому, кто позвал.
 *
 * Порядок работы: определить цель → назвать её вслух → прочитать все шесть листов →
 * разобрать их → **и только теперь** соединиться с базой. Любая ошибка разбора случается
 * до соединения: до базы дело не доходит вовсе.
 */

/** Соединение с базой в том виде, в каком его использует загрузчик. */
export type IngestClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
  release: () => Promise<void>
}

export type SheetReport = {
  sheet: string
  /** Строк данных в листе, считая пустые. */
  rowsRead: number
  /** Строк записано в сырую таблицу. */
  rowsWritten: number
  /** Пустых строк пропущено. */
  rowsSkipped: number
  /** Столбцы, которых контракт не ждал. Загрузку не останавливают, но названы вслух. */
  extraColumns: string[]
}

export type TableCount = {
  table: string
  rows: number
  /** Время последнего изменения строки. Совпало у двух прогонов — значит ничего не изменилось. */
  lastChange: string | null
}

export type IngestReport = {
  /** Куда писали: та самая строка, которая называется вслух. */
  target: string
  sheets: SheetReport[]
  counts: TableCount[]
}

export type IngestDeps = {
  readSpreadsheet: () => Promise<SheetValues>
  connect: (url: string) => Promise<IngestClient>
  /** Куда пишем — говорится до всякой работы, а не после. */
  announce: (line: string) => void
}

/** Настоящее соединение: обычный клиент `pg` по проверенному адресу. */
async function connectToDatabase(url: string): Promise<IngestClient> {
  const client = new Client({ connectionString: url })
  await client.connect()
  return {
    query: (sql, params) => client.query(sql, params),
    release: () => client.end(),
  }
}

export async function ingestSheets(deps: Partial<IngestDeps> = {}): Promise<IngestReport> {
  const readSpreadsheet = deps.readSpreadsheet ?? readOperationsSpreadsheet
  const connect = deps.connect ?? connectToDatabase
  const announce = deps.announce ?? (() => {})

  // Среда названа словом. Неназванная среда — отказ до всякой работы.
  const target = resolveIngestTarget()
  announce(target.label)

  const values = await readSpreadsheet()

  // Разбор всех шести листов до соединения: лист, не сошедшийся заголовками, обязан
  // остановить загрузку раньше, чем открыта транзакция.
  const snapshots = SHEETS.map((sheet) => ({
    sheet,
    snapshot: snapshotFromValues(sheet, values[sheet.sheet] ?? []),
  }))

  const client = await connect(target.url)
  const sheets: SheetReport[] = []
  const counts: TableCount[] = []

  try {
    // Одна транзакция на все шесть листов. Каждая функция S1 атомарна и сама по себе,
    // но полузагруженная Таблица — это шесть листов, из которых три новых, а три
    // вчерашних, и на экране такое не разглядеть.
    await client.query('begin')

    for (const { sheet, snapshot } of snapshots) {
      // Снимок листа целиком, одним куском: функция записи сама вставит новое, обновит
      // изменившееся и удалит адреса, которых в снимке больше нет.
      await client.query(`select ${sheet.fn}($1::jsonb)`, [JSON.stringify(snapshot.rows)])
      sheets.push({
        sheet: sheet.sheet,
        rowsRead: snapshot.rowsRead,
        rowsWritten: snapshot.rows.length,
        rowsSkipped: snapshot.rowsSkipped,
        extraColumns: snapshot.extraColumns,
      })
    }

    for (const sheet of SHEETS) {
      // Время последнего изменения читается из базы: у одинаковых прогонов оно обязано
      // совпасть до микросекунды. Количество строк этого бы не заметило.
      const { rows } = await client.query(
        `select count(*)::int as rows, max(updated_at)::text as last_change from ${sheet.table}`,
      )
      counts.push({
        table: sheet.table,
        rows: rows[0].rows as number,
        lastChange: (rows[0].last_change as string | null) ?? null,
      })
    }

    await client.query('commit')
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    // Отказ при закрытии соединения не должен подменять собой настоящую причину:
    // наверх обязана уйти та ошибка, из-за которой всё остановилось.
    await client.release().catch(() => {})
  }

  return { target: target.label, sheets, counts }
}
