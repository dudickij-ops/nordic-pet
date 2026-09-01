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
 * Пять исходов, и четыре из них — находки:
 *   своё          — покраснела названная проверка. Механизм проверен;
 *   чужое         — красное есть, но названная проверка молчит: сторожит не она,
 *                   а случайная ошибка по дороге. Убери отказ аккуратнее — и зазеленеет;
 *   зелено        — не покраснело ничего. Механизм держится на честном слове;
 *   не применился — образец не найден или найден дважды: слом стоит не в том месте;
 *   ожидание двусмысленно — имя, которое слом обещает покраснить, подходит не к одной
 *                   проверке набора, а к нескольким. Тогда красное у соседки засчиталось
 *                   бы вместо красного у своей: слом одной таблицы «доказывался» бы
 *                   проверкой другой. Найдено рецензентом; своими руками не находилось.
 *
 * ЧТО БУДЕТ, ЕСЛИ ПРОГОН УБИТЬ. В рабочем дереве останется сломанный файл, а в базе —
 * снятое ограничение. Чинится это двумя командами: `git checkout .` и `npm run db:reset`.
 * Обработчиков сигналов здесь нет нарочно: весь прогон синхронен, обработчик всё равно не
 * успел бы сработать, а своим существованием он отменил бы штатное завершение по Ctrl-C —
 * то есть сделал бы хуже. Поэтому прогон **требует чистого дерева на входе**: тогда
 * `git checkout .` заведомо не снесёт ничью работу.
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

/**
 * Прогон правит файлы в рабочем дереве. Если дерево грязное, убитый прогон не отличить
 * от чужой незакоммиченной работы, и `git checkout .` снесёт её вместе со сломом.
 */
function requireCleanTree(): void {
  const status = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
  if (status.status !== 0) {
    console.error('не удалось спросить git о состоянии дерева')
    process.exit(1)
  }
  if (status.stdout.trim() !== '') {
    console.error(
      'рабочее дерево грязное, а прогон правит файлы. Закоммитьте или уберите изменения:\n' +
        status.stdout,
    )
    process.exit(1)
  }
}

function resetDatabase(): void {
  // Код возврата смотрится: пересоздание базы, отработавшее неудачно, оставило бы прогон
  // на непонятно какой базе, и все дальнейшие вердикты были бы о чём угодно.
  const reset = spawnSync('npm', ['run', 'db:reset'], { encoding: 'utf8' })
  if (reset.status !== 0) {
    restoreAll()
    console.error(`пересоздание базы вернуло ${reset.status ?? 'ничего'}. Прогон остановлен`)
    console.error(reset.stderr ?? '')
    process.exit(1)
  }
}

function clearDurationCache(): void {
  // Порядок файлов прогона vitest берёт из кэша длительностей. На чистой машине — в `ci`
  // после `npm ci` — кэша нет, и порядок другой. Слом, зависящий от порядка, обязан
  // показываться именно так.
  rmSync('node_modules/.vite', { recursive: true, force: true })
  rmSync('node_modules/.vitest', { recursive: true, force: true })
}

/** Гоняет проверки и отдаёт код возврата, имена покрасневших и имена всех проверок. */
function runTests(tests: string): { exitCode: number; failed: string[]; all: string[] } {
  const args =
    tests === 'все'
      ? ['vitest', 'run', '--reporter=json', '--outputFile', reportFile]
      : ['vitest', 'run', tests, '--reporter=json', '--outputFile', reportFile]

  const run = spawnSync('npx', args, { encoding: 'utf8' })

  let failed: string[] = []
  let all: string[] = []
  try {
    const report = JSON.parse(readFileSync(reportFile, 'utf8')) as {
      testResults?: Array<{ assertionResults?: Array<{ status: string; fullName: string }> }>
    }
    const results = (report.testResults ?? []).flatMap((file) => file.assertionResults ?? [])
    all = results.map((one) => one.fullName.trim())
    failed = results.filter((one) => one.status === 'failed').map((one) => one.fullName.trim())
  } catch {
    // Отчёта нет — набор не запустился вовсе. Код возврата об этом скажет.
  }
  rmSync(reportFile, { force: true })

  return { exitCode: run.status ?? 1, failed, all }
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

requireCleanTree()

let catalogue: string[] = []

try {
  // Исходное состояние обязано быть зелёным: иначе красное на сломе ничего не значит.
  console.error('проверяю исходное состояние…')
  resetDatabase()
  const before = runTests('все')
  catalogue = before.all
  if (before.exitCode !== 0) {
    restoreAll()
    console.error(`до сломов набор уже красный (код ${before.exitCode}). Прогон отменён:`)
    for (const name of before.failed.slice(0, 10)) console.error(`  · ${name}`)
    process.exit(1)
  }

  for (const one of chosen) {
    console.error(`слом: ${one.claim}`)

    // Имя, которое слом обещает покраснить, обязано подходить ровно к одной проверке
    // набора. Иначе красное у соседки засчиталось бы вместо красного у своей — так слом
    // защиты у одной таблицы «доказывался» бы проверкой другой.
    const matching = catalogue.filter((name) => name.includes(one.mustRedden))
    if (matching.length !== 1) {
      results.push({
        Break: one,
        verdict: 'ожидание двусмысленно',
        exitCode: -1,
        reddened: matching,
      })
      continue
    }

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
  'ожидание двусмысленно': '**ожидание подходит не к одной проверке**',
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
    if (result.verdict === 'ожидание двусмысленно') {
      console.log(`  подходит к ${result.reddened.length} проверкам: ${result.reddened.slice(0, 3).join('; ')}`)
    }
    console.log()
  }
}

process.exit(bad.length > 0 ? 1 : 0)
