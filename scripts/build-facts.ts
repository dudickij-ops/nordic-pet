import { buildFacts } from '../lib/facts/build.ts'

/**
 * Команда разбора сырых строк в слой фактов.
 *
 * Обёртка, и только: вся работа живёт в `buildFacts()`, потому что кнопку «Обновить данные»
 * на S5 позовёт та же функция, а не эта команда.
 */
try {
  const report = await buildFacts({ announce: (line) => console.log(line) })

  console.log('\nтаблица        прочитано  записано  пустых денежных ячеек')
  for (const table of report.tables) {
    console.log(
      table.table.padEnd(13) +
        String(table.read).padStart(10) +
        String(table.written).padStart(10) +
        String(table.emptyMoney).padStart(23),
    )
  }

  // Каждая часть отчёта называется вслух всегда, даже когда называть нечего: молчание
  // не отличить от «не проверяли».
  console.log(
    `\nблизнецов: ${report.twins.map((twin) => `${twin.table} — ${twin.rows}`).join(', ')}`,
  )
  for (const twin of report.twins) {
    for (const group of twin.groups) {
      console.log(`  ${twin.table}: строки ${group.addresses.join(', ')} совпали целиком`)
    }
  }

  console.log(
    `\nсвёрнуто копий: ${
      report.folded
        .map((file) => `${file.fileName} — копия ${file.copyOf}, ${file.rows} строк`)
        .join('; ') || '—'
    }`,
  )
  console.log(`площадки: ${report.platforms.join(', ') || '—'}`)
} catch (error) {
  console.error(`разбор отменён: ${(error as Error).message}`)
  process.exit(1)
}
