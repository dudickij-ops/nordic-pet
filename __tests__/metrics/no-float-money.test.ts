import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, test } from 'vitest'

/**
 * Слой метрик не превращает деньги в число.
 *
 * Деньги приходят из базы строкой (`numeric` отдаётся драйвером как `string`) и остаются
 * строкой до самого экрана — арифметика над ними идёт через точную десятичную библиотеку.
 * `parseFloat` и `Number(...)` — два способа тайно вернуть двоичную дробь в эту цепочку:
 * оба читаются как безобидное приведение типа, а на деле теряют то, что не укладывается
 * в двоичное представление.
 *
 * Эта проверка честно слабая: она читает исходный текст, а не поведение программы. Ничем
 * сильнее её не заменить — не потому что лень, а потому что настоящий механизм здесь не
 * проверка, а система типов. Деньги типизированы как строка (см. `lib/metrics/format.ts`),
 * и арифметика над строкой не пройдёт проверку типов без явного превращения в число —
 * `parseFloat`/`Number(...)` и есть то место, где это превращение обязано было бы
 * появиться в тексте. Раз тип уже запрещает молчаливое превращение, единственное, что
 * остаётся сторожить текстом, — что никто не обошёл тип нарочно этими двумя вызовами.
 * Слабая проверка, названная слабой, лучше сильной на вид и слабой на деле.
 */
describe('слой метрик не превращает деньги в число', () => {
  test('parseFloat и Number(...) не встречаются в тексте слоя метрик и экрана', () => {
    const files: string[] = []
    const walk = (directory: string) => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name)
        if (statSync(path).isDirectory()) walk(path)
        else files.push(relative('.', path))
      }
    }
    walk('lib/metrics')
    files.push('app/page.tsx', 'app/refresh-panel.tsx', 'scripts/print-metrics.ts')

    const offenders: Array<{ file: string; line: number; text: string }> = []
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (line.includes('parseFloat') || line.includes('Number(')) {
          offenders.push({ file, line: index + 1, text: line.trim() })
        }
      })
    }

    expect(offenders).toEqual([])
  })
})
