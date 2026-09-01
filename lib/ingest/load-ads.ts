import { clearPostgresEnvironment } from '../db-url.ts'
import { rowsFromCsv } from './csv-rows.ts'
import { readAdsFolder, type FolderSnapshot } from './drive-source.ts'
import { connectToDatabase, type IngestClient } from './load-sheets.ts'
import { resolveIngestTarget } from './target.ts'
import { type SnapshotRow } from './table-rows.ts'

/**
 * Загрузка папки `ads-exports` с Google Диска в сырой слой.
 *
 * Это функция, а не команда: команда — обёртка вокруг неё, и кнопка «Обновить данные»
 * на S5 позовёт ту же самую функцию. Печатать она ничего не печатает и процесс не
 * завершает — отдаёт отчёт тому, кто позвал.
 *
 * Порядок работы: определить цель → назвать её вслух → прочитать **всю** папку →
 * разобрать все файлы → **и только теперь** соединиться с базой. Любая ошибка разбора
 * случается до соединения: до базы дело не доходит вовсе.
 *
 * **Функция записи зовётся ровно один раз, снимком всей папки.** Это обязательство
 * контракта S1, а не удобство: её область подчистки — вся папка, и вызов со строками
 * одного файла стёр бы строки остальных площадок. Ни цикла по файлам, ни порций,
 * ни «дозаписать остальное» здесь нет и быть не может.
 */

export type { IngestClient }

/** Таблица, в которую пишет этот загрузчик, и функция записи её снимка. */
const TABLE = 'raw.ads'
const REPLACE = 'raw.replace_entire_ads_folder'

export type FileReport = {
  file: string
  /** Размер файла в байтах — его сверяют с числом, посчитанным мимо нашего кода. */
  bytes: number
  /** Строк данных в файле, считая пустые. */
  rowsRead: number
  /** Строк из этого файла записано в сырую таблицу. */
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

export type AdsReport = {
  /** Куда писали: та самая строка, которая называется вслух. */
  target: string
  files: FileReport[]
  /** Файлы папки, которые выгрузками не являются. Названы, чтобы не пропасть молча. */
  skipped: string[]
  counts: TableCount[]
}

export type AdsDeps = {
  readFolder: () => Promise<FolderSnapshot>
  connect: (connection: Parameters<typeof connectToDatabase>[0]) => Promise<IngestClient>
  /** Куда пишем — говорится до всякой работы, а не после. */
  announce: (line: string) => void
}

export async function ingestAdsFolder(deps: Partial<AdsDeps> = {}): Promise<AdsReport> {
  const readFolder = deps.readFolder ?? (() => readAdsFolder())
  const connect = deps.connect ?? connectToDatabase
  const announce = deps.announce ?? (() => {})

  // Среда названа словом. Неназванная среда — отказ до всякой работы.
  const target = resolveIngestTarget()
  announce(target.label)

  const folder = await readFolder()

  // Разбор всех файлов до соединения: файл, не сошедшийся заголовками, обязан остановить
  // загрузку раньше, чем открыта транзакция. Останавливается вся загрузка, а не один
  // файл: снимок берётся с папки, а не с файла.
  const parsed = folder.files.map((file) => ({
    file,
    snapshot: rowsFromCsv(file.name, file.bytes),
  }))

  // Снимок всей папки — один список строк на все файлы разом.
  const rows: SnapshotRow[] = parsed.flatMap((entry) => entry.snapshot.rows)

  // Незаполненных мест не должно остаться ни в полях соединения, ни в окружении:
  // драйвер читает те же переменные PG*, что и libpq, и любая из них — тот же чужой
  // адрес, только с другой стороны.
  clearPostgresEnvironment()

  const client = await connect(target.connection)
  const counts: TableCount[] = []

  try {
    await client.query('begin')

    // Один вызов на всю папку. Второго вызова здесь нет ни при каких условиях.
    await client.query(`select ${REPLACE}($1::jsonb)`, [JSON.stringify(rows)])

    // Время последнего изменения читается из базы: у одинаковых прогонов оно обязано
    // совпасть до микросекунды. Количество строк этого бы не заметило.
    const { rows: counted } = await client.query(
      `select count(*)::int as rows, max(updated_at)::text as last_change from ${TABLE}`,
    )
    counts.push({
      table: TABLE,
      rows: counted[0].rows as number,
      lastChange: (counted[0].last_change as string | null) ?? null,
    })

    await client.query('commit')
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    // Отказ при закрытии соединения не должен подменять собой настоящую причину:
    // наверх обязана уйти та ошибка, из-за которой всё остановилось.
    await client.release().catch(() => {})
  }

  return {
    target: target.label,
    files: parsed.map(({ file, snapshot }) => ({
      file: file.name,
      bytes: file.bytes.length,
      rowsRead: snapshot.rowsRead,
      rowsWritten: snapshot.rows.length,
      rowsSkipped: snapshot.rowsSkipped,
      extraColumns: snapshot.extraColumns,
    })),
    skipped: folder.skipped,
    counts,
  }
}
