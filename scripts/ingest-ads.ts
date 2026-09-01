import { ingestAdsFolder } from '../lib/ingest/load-ads.ts'

/**
 * Команда загрузки папки `ads-exports` в сырой слой.
 *
 * Обёртка, и только: вся работа живёт в `ingestAdsFolder()`, потому что кнопку
 * «Обновить данные» на S5 позовёт та же функция, а не эта команда.
 */
try {
  const report = await ingestAdsFolder({ announce: (line) => console.log(line) })

  console.log('\nфайл                    байт  прочитано  записано  пропущено  лишние столбцы')
  for (const file of report.files) {
    console.log(
      file.file.padEnd(22) +
        String(file.bytes).padStart(6) +
        String(file.rowsRead).padStart(11) +
        String(file.rowsWritten).padStart(10) +
        String(file.rowsSkipped).padStart(11) +
        '  ' +
        (file.extraColumns.join(', ') || '—'),
    )
  }

  // Пропущенное называется вслух всегда, даже когда его нет: молчание не отличить
  // от «не проверяли».
  console.log(`\nне выгрузки, пропущены: ${report.skipped.join(', ') || '—'}`)

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
