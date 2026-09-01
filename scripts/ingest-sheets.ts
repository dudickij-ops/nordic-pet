import { ingestSheets } from '../lib/ingest/load-sheets.ts'

/**
 * Команда загрузки Google Таблицы в сырой слой.
 *
 * Обёртка, и только: вся работа живёт в `ingestSheets()`, потому что кнопку
 * «Обновить данные» на S5 позовёт та же функция, а не эта команда.
 */
try {
  const report = await ingestSheets({ announce: (line) => console.log(line) })

  console.log('\nлист       прочитано  записано  пропущено  лишние столбцы')
  for (const sheet of report.sheets) {
    console.log(
      sheet.sheet.padEnd(10) +
        String(sheet.rowsRead).padStart(10) +
        String(sheet.rowsWritten).padStart(10) +
        String(sheet.rowsSkipped).padStart(11) +
        '  ' +
        (sheet.extraColumns.join(', ') || '—'),
    )
  }

  console.log('\nтаблица            строк   последнее изменение')
  for (const count of report.counts) {
    console.log(
      count.table.padEnd(18) +
        String(count.rows).padStart(6) +
        '   ' +
        (count.lastChange ?? '—'),
    )
  }
} catch (error) {
  console.error(`загрузка отменена: ${(error as Error).message}`)
  process.exit(1)
}
