/**
 * Числа в прозе отчёта, тела заявки и сверок — из источника командой, а не набранные руками.
 *
 * Зачем механика, а не правило. Правило «своё число считается до того, как попадает в текст» было
 * записано и трижды за кусок S11 не сработало: последний раз сверка контраста назвала худшим
 * контрастом текста 4,91 и 4,93, а в той же таблице стояло 4,73. Число, набранное руками, выглядит
 * проверенным и не перепроверяется. Здесь каждое такое число вычисляется из своего источника —
 * таблицы, файла, вывода `git` или вывода прогона, вставленного в тело заявки, — и сверяется с каждым
 * местом прозы, где оно стоит. Расхождение — ненулевой код возврата.
 *
 * Место прозы задаётся якорем: текстом, который стоит в файле ровно один раз и сразу за которым
 * обязано идти число. Якоря нет или он не единственный — тоже отказ: место, которое нельзя найти
 * однозначно, не сверено.
 *
 * **Чего команда не доказывает** — названо здесь, потому что прибор, который берёт число из
 * проверяемого текста, проверяет текст сам собой:
 *
 *   · Она сверяет только зарегистрированные числа. Числа, которого нет в списке ниже, она не видит;
 *     такое число обязано стоять рядом со строкой, откуда оно взято (наш замер в браузере, счёт по
 *     сверенным итогам, решение владельца).
 *   · Число проверок и число сломов берутся **из тела заявки** — из вставленных в него сводки
 *     `npm test` и выводов прогонов. Что вставлено именно то, что вернули команды, она не знает:
 *     она сверяет отчёт с телом заявки, а не с прогоном. Неверная вставка пройдёт зелёной.
 *   · Она читает текст, а не смысл: что число стоит в верной по смыслу фразе, не утверждает никто.
 *   · Разбор таблиц — не глубже, чем нужно списку: строки таблицы Markdown, разделённые `|`, без
 *     экранирования внутри ячеек.
 *
 * Запуск: `node scripts/prose-numbers.ts --pr <файл тела заявки>`. Тело заявки обязательно: из
 * вставленного в него вывода берутся число проверок и число сломов, и без него половина чисел
 * отчёта осталась бы несверенной молча.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ОТЧЁТ = 'docs/ОТЧЁТ.md'
const КОНТРАСТ = 'docs/сверка/контраст.md'
const ОПИСЬ = 'docs/screens/README.md'
const ЗАЯВКА = '<тело заявки>'

/** `after` — искать якорь только после первого вхождения этого текста: там, где та же строка стоит и в исходной таблице. */
type Место = { file: string; anchor: string; after?: string }
type Число = { name: string; value: string; source: string; places: Место[] }

function прочесть(file: string): string {
  return readFileSync(file, 'utf8')
}

function отказ(текст: string): never {
  console.error(`Отказ: ${текст}`)
  process.exit(1)
}

/** 4.73 → «4,73»: запятая, два знака, как в прозе. */
function дробь(n: number): string {
  return n.toFixed(2).replace('.', ',')
}

function ячейкиЧисло(ячейка: string): number | null {
  const m = ячейка.replaceAll('*', '').trim().match(/^(\d+),(\d+)/)
  return m === null ? null : Number(`${m[1]}.${m[2]}`)
}

/** Строки таблицы Markdown, которая начинается строкой `шапка`, до первой пустой строки. */
function таблица(текст: string, шапка: string): string[][] {
  const начало = текст.indexOf(шапка)
  if (начало < 0) отказ(`нет таблицы с шапкой «${шапка}»`)
  const строки: string[][] = []
  for (const line of текст.slice(начало).split('\n').slice(2)) {
    if (!line.startsWith('|')) break
    строки.push(line.slice(1, -1).split('|').map((c) => c.trim()))
  }
  return строки
}

const аргумент = process.argv.indexOf('--pr')
const файлЗаявки = аргумент > 0 ? process.argv[аргумент + 1] : undefined
if (файлЗаявки === undefined) отказ('нужен --pr <файл тела заявки>: из него берутся число проверок и число сломов')
const заявка = прочесть(файлЗаявки)

const числа: Число[] = []

// ——— Сверка контраста, кусок S11 ———
const контраст = прочесть(КОНТРАСТ)
const s11 = контраст.slice(контраст.indexOf('## Кусок S11'))
const пары = таблица(s11, '| Пара | Светлая | Тёмная | Погашенный, светлая | Погашенный, тёмная | Порог | Где снято |')
const цветКЦвету = таблица(s11, '| Пара | Светлая | Тёмная |\n')

const текстовые: Array<{ v: number; pair: string }> = []
const нижеГрафики: Array<{ pair: string; light: number; dark: number }> = []
for (const [pair, ...rest] of пары) {
  const порог = rest[4]
  const значения = rest.slice(0, 4).map(ячейкиЧисло).filter((v): v is number => v !== null)
  if (порог.startsWith('4,5')) for (const v of значения) текстовые.push({ v, pair })
  else if (!порог.includes('крупный') && значения.some((v) => v < 3)) {
    нижеГрафики.push({ pair, light: ячейкиЧисло(rest[0]) ?? NaN, dark: ячейкиЧисло(rest[1]) ?? NaN })
  }
}
const худшая = Math.min(...текстовые.map((t) => t.v))

числа.push({
  name: 'пар в списке контраста S11',
  value: String(пары.length),
  source: `${КОНТРАСТ}, строки таблицы S11`,
  places: [
    { file: КОНТРАСТ, anchor: '**Полнота списка пар держится на глазе, а не на механизме.** ' },
    { file: ОТЧЁТ, anchor: '`docs/сверка/контраст.md`: ' },
    { file: ОТЧЁТ, anchor: '**Полнота списка пар держится на глазе, а не на механизме:** ' },
    { file: ЗАЯВКА, anchor: 'раздел «Кусок S11»: ' },
  ],
})
числа.push({
  name: 'пар цвета к цвету',
  value: String(цветКЦвету.length),
  source: `${КОНТРАСТ}, таблица «Пары цвета к цвету»`,
  places: [
    { file: ОТЧЁТ, anchor: `${пары.length} пар и ` },
    { file: ЗАЯВКА, anchor: `${пары.length} пар и ` },
  ],
})
числа.push({
  name: 'худшая сторона по тексту',
  value: дробь(худшая),
  source: `${КОНТРАСТ}, минимум по парам с порогом 4,5`,
  places: [
    { file: КОНТРАСТ, anchor: '**Худшая сторона по тексту** — дельта «хуже» в погашенном виде тёмной темы, ' },
    { file: ОТЧЁТ, anchor: 'худшая сторона — ' },
    { file: ЗАЯВКА, anchor: 'худшая сторона текста — ' },
  ],
})
числа.push({
  name: 'графических пар ниже 3 : 1',
  value: String(нижеГрафики.length),
  source: `${КОНТРАСТ}, пары с графическим порогом и значением ниже 3`,
  places: [
    { file: КОНТРАСТ, anchor: '**Ниже порога — ' },
    { file: ОТЧЁТ, anchor: 'Ниже порога — ' },
    { file: ЗАЯВКА, anchor: 'Ниже порога — ' },
  ],
})
for (const г of нижеГрафики) {
  const value = г.light === г.dark ? `${дробь(г.light)} : 1, обе темы` : `${дробь(г.light)} : 1 в светлой, ${дробь(г.dark)} : 1 в тёмной`
  числа.push({
    name: `контраст: ${г.pair}`,
    value,
    source: `${КОНТРАСТ}, строка «${г.pair}»`,
    places: [
      { file: КОНТРАСТ, after: '**Ниже порога — ', anchor: `| ${г.pair} | ` },
      { file: ОТЧЁТ, anchor: `| ${г.pair} | ` },
      { file: ЗАЯВКА, anchor: `| ${г.pair} | ` },
    ],
  })
}
const хужеКОтказу = цветКЦвету.find((r) => r[0].includes('«хуже» к тексту отказа'))
if (хужеКОтказу === undefined) отказ('в таблице цвета к цвету нет строки «хуже» к тексту отказа')
числа.push({
  name: '«хуже» к тексту отказа, светлая',
  value: дробь(ячейкиЧисло(хужеКОтказу[1]) ?? NaN),
  source: `${КОНТРАСТ}, таблица цвета к цвету`,
  places: [{ file: ЗАЯВКА, anchor: '«Хуже» к тексту отказа — ' }],
})
числа.push({
  name: '«хуже» к тексту отказа, тёмная',
  value: дробь(ячейкиЧисло(хужеКОтказу[2]) ?? NaN),
  source: `${КОНТРАСТ}, таблица цвета к цвету`,
  places: [
    { file: ОТЧЁТ, anchor: '#e37d80, наш замер — ' },
    { file: ЗАЯВКА, anchor: '«Хуже» к тексту отказа — 1,19 и **' },
  ],
})

// ——— Снимки ———
const снимки = readdirSync('docs/screens')
const картинки = снимки.filter((f) => f.endsWith('.png')).length
const страницы = снимки.filter((f) => f.endsWith('.html'))
числа.push({
  name: 'картинок снимков',
  value: String(картинки),
  source: 'docs/screens/*.png',
  places: [
    { file: ОТЧЁТ, anchor: '| Снимки | ' },
    { file: ЗАЯВКА, anchor: '| Снимки | ' },
  ],
})
числа.push({
  name: 'страниц снимков',
  value: String(страницы.length),
  source: 'docs/screens/*.html',
  places: [
    { file: ОТЧЁТ, anchor: `${картинки} картинок, ` },
    { file: ЗАЯВКА, anchor: `${картинки} картинок, ` },
  ],
})
числа.push({
  name: 'страниц снимков с прежней строкой о трёх крупных числах',
  value: String(страницы.filter((f) => прочесть(join('docs/screens', f)).includes('Крупных чисел на экране ровно три')).length),
  source: 'docs/screens/*.html, поиск строки',
  places: [{ file: ОПИСЬ, anchor: 'Сегодня отстают все ' }],
})

// ——— Сверка «до / после» ———
const до = прочесть('docs/сверка/метрики-2026-03-до-s11.txt')
const после = прочесть('docs/сверка/метрики-2026-03-после-s11.txt')
числа.push({
  name: 'байт в файлах «до» и «после»',
  value: до === после ? String(Buffer.byteLength(до)) : 'ФАЙЛЫ РАЗНЫЕ',
  source: 'docs/сверка/метрики-2026-03-{до,после}-s11.txt',
  places: [
    { file: ОТЧЁТ, anchor: 'побайтно одинаков, ' },
    { file: ЗАЯВКА, anchor: '`cmp` — 0, по ' },
  ],
})

// ——— Живой набор и живая проверка марта ———
const живые = readdirSync('__tests__/live').filter((f) => f.endsWith('.live.ts'))
const проверокВ = (f: string) => (прочесть(join('__tests__/live', f)).match(/^test\(/gm) ?? []).length
const живыхПроверок = String(живые.reduce((n, f) => n + проверокВ(f), 0))
числа.push({
  name: 'живых проверок',
  value: живыхПроверок,
  source: '__tests__/live/*.live.ts, строки test(',
  places: [{ file: ОТЧЁТ, anchor: '| Живой набор | ' }],
})
числа.push({
  name: 'живых файлов',
  value: String(живые.length),
  source: '__tests__/live/*.live.ts',
  places: [{ file: ОТЧЁТ, anchor: `| Живой набор | ${живыхПроверок} проверок в ` }],
})
числа.push({
  name: 'проверок в живом файле марта',
  value: String(проверокВ('march-screen.live.ts')),
  source: '__tests__/live/march-screen.live.ts',
  places: [{ file: ОТЧЁТ, anchor: 'экран марта на настоящих данных, ' }],
})
const март = прочесть('__tests__/live/march-screen.live.ts')
const изМарта = (re: RegExp, что: string): string => {
  const m = март.match(re)
  if (m === null) отказ(`в живой проверке марта нет утверждения «${что}»`)
  return m[1]
}
const всегоАртикулов = изМарта(/skusTotal: (\d+)/, 'skusTotal')
const дают80 = изМарта(/skusFor80: (\d+)/, 'skusFor80')
const вМинусе = изМарта(/negativeCount: (\d+)/, 'negativeCount')
числа.push({
  name: 'артикулов дают 80 % прибыли товаров',
  value: дают80,
  source: 'живая проверка марта, skusFor80',
  places: [{ file: ОТЧЁТ, anchor: '80 % прибыли товаров дают ' }],
})
числа.push({
  name: 'артикулов всего',
  value: всегоАртикулов,
  source: 'живая проверка марта, skusTotal',
  places: [
    { file: ОТЧЁТ, anchor: `прибыли товаров дают ${дают80} из ` },
    { file: ОТЧЁТ, anchor: `убыточных артикулов ${вМинусе} из ` },
  ],
})
числа.push({
  name: 'артикулов в минусе',
  value: вМинусе,
  source: 'живая проверка марта, negativeCount',
  places: [
    { file: ОТЧЁТ, anchor: 'артикулов, в минусе ' },
    { file: ОТЧЁТ, anchor: 'В марте убыточных артикулов ' },
  ],
})
числа.push({
  name: 'расхождение цепочки водопада с прибылью, €',
  value: изМарта(/profitGap, '[^']*'\)\.toBe\('([\d.]+)'\)/, 'profitGap').replace('.', ','),
  source: 'живая проверка марта, profitGap',
  places: [{ file: ОТЧЁТ, anchor: 'печатается строкой — ровно фактической разницей. На марте ' }],
})

// ——— git: что кусок сделал с принятым ———
/**
 * Счёт строк — между `origin/main` и **головой**, а не рабочим деревом: числа заявки говорят о том,
 * что оценивают, а грязное дерево или недоделанная правка не должны их двигать. Поправлено в круге
 * проверки кода 1, прежде сравнение шло с рабочим деревом.
 */
function numstat(...пути: string[]): Array<{ added: number; removed: number; path: string }> {
  const r = spawnSync('git', ['diff', '--numstat', 'origin/main', 'HEAD', '--', ...пути], { encoding: 'utf8' })
  if (r.status !== 0) отказ(`git diff --numstat вернул ${r.status}: ${r.stderr}`)
  return r.stdout.trim().split('\n').filter((l) => l !== '').map((l) => {
    const [a, d, path] = l.split('\t')
    return { added: Number(a), removed: Number(d), path }
  })
}
const [sql] = numstat('lib/metrics/sql.ts')
числа.push({ name: 'строк добавлено в sql.ts', value: String(sql.added), source: 'git diff --numstat origin/main', places: [{ file: ЗАЯВКА, anchor: '`lib/metrics/sql.ts`: ' }] })
числа.push({ name: 'строк удалено в sql.ts', value: String(sql.removed), source: 'git diff --numstat origin/main', places: [{ file: ЗАЯВКА, anchor: `${sql.added} строки добавлено, ` }] })
const проверкиДифф = numstat('__tests__/')
const правленые = проверкиДифф.filter((f) => f.removed > 0)
числа.push({ name: 'файлов проверок только с добавленными строками', value: String(проверкиДифф.length - правленые.length), source: 'git diff --numstat origin/main -- __tests__/', places: [{ file: ЗАЯВКА, anchor: 'Дифф `__tests__/` с main: ' }] })
числа.push({ name: 'файлов проверок с изменёнными строками', value: String(правленые.length), source: 'git diff --numstat origin/main -- __tests__/', places: [{ file: ЗАЯВКА, anchor: 'только добавленные строки; ' }] })
for (const f of правленые) {
  числа.push({ name: `добавлено / удалено: ${f.path}`, value: `${f.added} / ${f.removed}`, source: 'git diff --numstat origin/main', places: [{ file: ЗАЯВКА, anchor: `| \`${f.path}\` | ` }] })
}
const [s9, s10] = [numstat('breaks/s9-screen.ts')[0], numstat('breaks/s10-fluent.ts')[0]]
числа.push({ name: 'строк прежних списков с переведённым именем', value: String(s9.removed + s10.removed), source: 'git diff --numstat origin/main -- breaks/s9-screen.ts breaks/s10-fluent.ts', places: [{ file: ЗАЯВКА, anchor: 'Имя проверки генератора переведено в ' }] })
числа.push({ name: 'из них в s9-screen', value: String(s9.removed), source: 'git diff --numstat', places: [{ file: ЗАЯВКА, anchor: 'строках прежних списков: ' }] })
числа.push({ name: 'из них в s10-fluent', value: String(s10.removed), source: 'git diff --numstat', places: [{ file: ЗАЯВКА, anchor: '`breaks/s9-screen.ts`, ' }] })

// ——— Вывод прогонов, вставленный в тело заявки ———
const сумма = (re: RegExp) => [...заявка.matchAll(re)].reduce((n, m) => n + Number(m[1]), 0)
const списков = [...заявка.matchAll(/^Всего сломов: \d+\./gm)].length
const тесты = заявка.match(/^ +Tests +(\d+) passed \((\d+)\)$/m)
const файлы = заявка.match(/^ +Test Files +(\d+) passed \((\d+)\)$/m)
if (тесты === null || файлы === null) отказ('в теле заявки нет вставленной сводки npm test')
числа.push({ name: 'списков сломов в теле заявки', value: String(списков), source: 'тело заявки, строки «Всего сломов»', places: [{ file: ОТЧЁТ, anchor: '| Приборы сломов, ' }] })
числа.push({
  name: 'сломов всего',
  value: String(сумма(/^Всего сломов: (\d+)\./gm)),
  source: 'тело заявки, сумма «Всего сломов»',
  places: [
    { file: ОТЧЁТ, anchor: `| Приборы сломов, ${списков} списков | ` },
    { file: ЗАЯВКА, anchor: 'Итог прогона: ' },
  ],
})
числа.push({
  name: 'механизмов проверено',
  value: String(сумма(/Проверено механизмов: (\d+)\./g)),
  source: 'тело заявки, сумма «Проверено механизмов»',
  places: [{ file: ОТЧЁТ, anchor: `| Приборы сломов, ${списков} списков | ${сумма(/^Всего сломов: (\d+)\./gm)} сломов, ` }],
})
числа.push({ name: 'проверок в наборе', value: тесты[2], source: 'тело заявки, сводка npm test', places: [{ file: ОТЧЁТ, anchor: '| Набор проверок | ' }] })
числа.push({ name: 'файлов проверок', value: файлы[2], source: 'тело заявки, сводка npm test', places: [{ file: ОТЧЁТ, anchor: `${тесты[2]} проверок в ` }] })

// ——— Сверка с прозой ———
const тексты = new Map<string, string>([[ЗАЯВКА, заявка]])
let расхождений = 0
console.log('| Число | Из источника | Источник | Место | Итог |')
console.log('|---|---|---|---|---|')
for (const ч of числа) {
  for (const м of ч.places) {
    if (!тексты.has(м.file)) тексты.set(м.file, прочесть(м.file))
    const весь = тексты.get(м.file) ?? ''
    const текст = м.after === undefined ? весь : весь.slice(Math.max(0, весь.indexOf(м.after)))
    if (м.after !== undefined && !весь.includes(м.after)) {
      расхождений++
      console.log(`| ${ч.name} | ${ч.value} | ${ч.source} | ${м.file}: после «${м.after.trim()}» | НЕТ ТЕКСТА, ПОСЛЕ КОТОРОГО ИСКАТЬ |`)
      continue
    }
    const раз = текст.split(м.anchor).length - 1
    let итог: string
    if (раз !== 1) итог = раз === 0 ? 'ЯКОРЯ НЕТ' : `ЯКОРЬ НЕ ЕДИНСТВЕННЫЙ (${раз})`
    else {
      const за = текст.slice(текст.indexOf(м.anchor) + м.anchor.length)
      итог = за.startsWith(ч.value) && !/^\d/.test(за.slice(ч.value.length)) ? 'сходится' : `РАСХОДИТСЯ: «${за.slice(0, ч.value.length + 8)}»`
    }
    if (итог !== 'сходится') расхождений++
    console.log(`| ${ч.name} | ${ч.value} | ${ч.source} | ${м.file}: «${м.anchor.trim()}» | ${итог} |`)
  }
}
console.log(`\nЧисел: ${числа.length}. Мест: ${числа.reduce((n, ч) => n + ч.places.length, 0)}. Расхождений: ${расхождений}.`)
process.exit(расхождений === 0 ? 0 : 1)
