import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Break, BreakResult, BreakVerdict } from '../breaks/types.ts'

/**
 * Прогон списка сломов.
 *
 * Ломаем механизм — смотрим, покраснела ли **его собственная** проверка — возвращаем файл.
 * Таблица отчёта печатается отсюда: её не набирают руками, и разойтись с прогоном ей негде.
 *
 * Четыре исхода, и три из них — находки:
 *   своё          — покраснела названная проверка. Механизм проверен;
 *   чужое         — красное есть, но названная проверка молчит: сторожит не она,
 *                   а случайная ошибка по дороге. Убери отказ аккуратнее — и зазеленеет;
 *   зелено        — не покраснело ничего. Механизм держится на честном слове;
 *   не применился — образец не найден или найден дважды: слом стоит не в том месте.
 *
 * Файлы возвращаются на место всегда, в том числе при падении и при прерывании.
 */

const list = process.argv[2]
if (list === undefined) {
  console.error('нужно имя списка: npm run breaks -- s4-facts')
  process.exit(1)
}

const { BREAKS } = (await import(`../breaks/${list}.ts`)) as { BREAKS: Break[] }
const only = process.argv[3]
const chosen = only === undefined ? BREAKS : BREAKS.filter((one) => one.id === only)
if (chosen.length === 0) {
  console.error(`в списке ${list} нет слома с именем ${only}`)
  process.exit(1)
}

const reportDir = mkdtempSync(join(tmpdir(), 'breaks-'))
const reportFile = join(reportDir, 'run.json')

/** Что сейчас лежит на диске у каждого затронутого файла — чтобы вернуть в любом исходе. */
const originals = new Map<string, string>()

function remember(file: string): string {
  const saved = originals.get(file)
  if (saved !== undefined) return saved
  const text = readFileSync(file, 'utf8')
  originals.set(file, text)
  return text
}

function restoreAll(): void {
  for (const [file, text] of originals) writeFileSync(file, text)
}

// Возврат файлов не должен зависеть от того, дошло ли выполнение до конца: прерывание
// с оставленным сломанным файлом — это испорченное дерево и потерянный вечер.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    restoreAll()
    process.exit(130)
  })
}
process.on('uncaughtException', (error) => {
  restoreAll()
  throw error
})

function resetDatabase(): void {
  spawnSync('npm', ['run', 'db:reset'], { encoding: 'utf8' })
}

function clearDurationCache(): void {
  // Порядок файлов прогона vitest берёт из кэша длительностей. На чистой машине — в `ci`
  // после `npm ci` — кэша нет, и порядок другой. Слом, зависящий от порядка, обязан
  // показываться именно так.
  rmSync('node_modules/.vite', { recursive: true, force: true })
  rmSync('node_modules/.vitest', { recursive: true, force: true })
}

/** Гоняет проверки и отдаёт код возврата и имена покрасневших проверок. */
function runTests(tests: string): { exitCode: number; failed: string[] } {
  const args =
    tests === 'все'
      ? ['vitest', 'run', '--reporter=json', '--outputFile', reportFile]
      : ['vitest', 'run', tests, '--reporter=json', '--outputFile', reportFile]

  const run = spawnSync('npx', args, { encoding: 'utf8' })

  let failed: string[] = []
  try {
    const report = JSON.parse(readFileSync(reportFile, 'utf8')) as {
      testResults?: Array<{ assertionResults?: Array<{ status: string; fullName: string }> }>
    }
    failed = (report.testResults ?? []).flatMap((file) =>
      (file.assertionResults ?? [])
        .filter((one) => one.status === 'failed')
        .map((one) => one.fullName.trim()),
    )
  } catch {
    // Отчёта нет — набор не запустился вовсе. Код возврата об этом скажет.
  }
  rmSync(reportFile, { force: true })

  return { exitCode: run.status ?? 1, failed }
}

function applyBreak(one: Break): BreakVerdict | null {
  const original = remember(one.file)
  const occurrences = original.split(one.find).length - 1
  if (occurrences === 0) return 'не применился'
  if (occurrences > 1) return 'двусмысленный'
  let patched = original.replace(one.find, one.replace)
  if (one.andThen !== undefined) {
    const secondary = patched.split(one.andThen.find).length - 1
    if (secondary === 0) return 'не применился'
    if (secondary > 1) return 'двусмысленный'
    patched = patched.replace(one.andThen.find, one.andThen.replace)
  }
  writeFileSync(one.file, patched)
  return null
}

const results: BreakResult[] = []

try {
  // Исходное состояние обязано быть зелёным: иначе красное на сломе ничего не значит.
  console.error('проверяю исходное состояние…')
  resetDatabase()
  const before = runTests('все')
  if (before.exitCode !== 0) {
    restoreAll()
    console.error(`до сломов набор уже красный (код ${before.exitCode}). Прогон отменён:`)
    for (const name of before.failed.slice(0, 10)) console.error(`  · ${name}`)
    process.exit(1)
  }

  for (const one of chosen) {
    console.error(`слом: ${one.claim}`)
    const failure = applyBreak(one)
    if (failure !== null) {
      results.push({ Break: one, verdict: failure, exitCode: -1, reddened: [] })
      continue
    }

    if (one.resetDb === true) resetDatabase()
    if (one.clearCache === true) clearDurationCache()

    const { exitCode, failed } = runTests(one.tests)
    writeFileSync(one.file, originals.get(one.file) as string)
    if (one.resetDb === true) resetDatabase()

    const own = failed.filter((name) => name.includes(one.mustRedden))
    const verdict: BreakVerdict =
      exitCode === 0 ? 'зелено' : own.length > 0 ? 'своё' : 'чужое'

    results.push({ Break: one, verdict, exitCode, reddened: failed })
  }
} finally {
  restoreAll()
  rmSync(reportDir, { recursive: true, force: true })
  resetDatabase()
}

const mark: Record<BreakVerdict, string> = {
  'своё': 'покраснела своя',
  'чужое': '**покраснело чужое**',
  'зелено': '**зелено**',
  'не применился': '**слом не применился**',
  'двусмысленный': '**образец найден дважды**',
}

console.log(`# Прогон сломов: ${list}\n`)
console.log('| № | Что ломаем | Что обязано покраснеть | Итог |')
console.log('|---|---|---|---|')
results.forEach((result, index) => {
  console.log(
    `| ${index + 1} | ${result.Break.claim} | ${result.Break.mustRedden} | ${mark[result.verdict]} |`,
  )
})

const bad = results.filter((result) => result.verdict !== 'своё')
console.log(`\nВсего сломов: ${results.length}. Проверено механизмов: ${results.length - bad.length}.`)

if (bad.length > 0) {
  console.log(`\n## Не доказано: ${bad.length}\n`)
  for (const result of bad) {
    console.log(`**${result.Break.claim}** — ${mark[result.verdict]}`)
    console.log(`  обязана была покраснеть: «${result.Break.mustRedden}»`)
    if (result.verdict === 'чужое') {
      console.log(`  вместо неё покраснели: ${result.reddened.slice(0, 3).join('; ')}`)
    }
    console.log()
  }
}

process.exit(bad.length > 0 ? 1 : 0)
