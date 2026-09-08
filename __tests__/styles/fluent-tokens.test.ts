import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

/**
 * Числа таблицы стилей — те, что выписаны из Fluent 2, а не придуманные. Кусок S10, задача 3.
 *
 * **Чего эта проверка НЕ доказывает.** Сказано здесь, в её собственном тексте, потому что здесь
 * это и прочтут:
 *
 * 1. Она не доказывает, что таблица стилей **подключена**. Проверка, читающая ввоз в исходном
 *    тексте, доказывала бы наличие строки, а не наличие вида.
 * 2. Она не доказывает, что правила **применились**: браузера здесь нет вовсе.
 * 3. Она не доказывает, что вид **хорош**. Правильные числа, собранные в уродливый экран, пройдут
 *    её зелёными. Вид принимает глаз владельца по снимкам.
 *
 * Она доказывает ровно одно: величины в таблице стилей — те самые, что выписаны из документации
 * Fluent 2, и посторонних цветов в файле нет.
 *
 * **Откуда взяты числа.** Имена и значения — из официальной реализации токенов Fluent 2
 * (`microsoft/fluentui`, пакет `packages/tokens/src`): `global/fonts.ts`, `global/spacings.ts`,
 * `global/borderRadius.ts`, `global/strokeWidths.ts`, `global/curves.ts`, `global/durations.ts`,
 * `alias/lightColor.ts`, `alias/darkColor.ts`, `utils/shadows.ts`, красный — через
 * `alias/*ColorPalette.ts` и `global/colors.ts`. Значения перенесены сюда как есть; ни одно не
 * посчитано нами.
 *
 * **Граница разбора.** Проверка делит файл на область светлой темы и тело блока
 * `@media (prefers-color-scheme: dark)`, считая фигурные скобки и не заглядывая внутрь кавычек.
 * Правил языка стилей она не понимает: величина, объявленная не в этих двух областях, ею не
 * видится вовсе.
 */

const СТИЛИ = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8')

/** Цвета, у которых значение своё в каждой теме. Имя токена → [светлая, тёмная]. */
const ЦВЕТА: Record<string, [string, string]> = {
  colorNeutralBackground1: ['#ffffff', '#292929'],
  colorNeutralBackground1Hover: ['#f5f5f5', '#3d3d3d'],
  colorNeutralBackground1Pressed: ['#e0e0e0', '#1f1f1f'],
  colorNeutralBackground2: ['#fafafa', '#1f1f1f'],
  colorNeutralForeground1: ['#242424', '#ffffff'],
  colorNeutralForeground2: ['#424242', '#d6d6d6'],
  colorNeutralForeground3: ['#616161', '#adadad'],
  colorNeutralForegroundDisabled: ['#bdbdbd', '#5c5c5c'],
  colorNeutralForegroundOnBrand: ['#ffffff', '#ffffff'],
  colorNeutralStroke1: ['#d1d1d1', '#666666'],
  colorNeutralStroke2: ['#e0e0e0', '#525252'],
  colorNeutralStrokeAccessible: ['#616161', '#adadad'],
  colorSubtleBackgroundHover: ['#f5f5f5', '#383838'],
  colorBrandBackground: ['#0078d4', '#106ebe'],
  colorBrandBackgroundHover: ['#106ebe', '#0078d4'],
  colorBrandBackgroundPressed: ['#004578', '#004578'],
  colorBrandBackground2: ['#eff6fc', '#002848'],
  colorBrandForeground1: ['#0078d4', '#2899f5'],
  colorBrandStroke1: ['#0078d4', '#2899f5'],
  colorStrokeFocus2: ['#000000', '#ffffff'],
  colorPaletteRedBackground1: ['#fdf6f6', '#3f1011'],
  colorPaletteRedBorder1: ['#f1bbbc', '#d13438'],
  colorPaletteRedForeground1: ['#bc2f32', '#e37d80'],
}

/** Тени: у Fluent своя пара цветов на тему, и потому значение тоже своё в каждой. */
const ТЕНИ: Record<string, [string, string]> = {
  shadow4: [
    '0 0 2px rgba(0, 0, 0, 0.12), 0 2px 4px rgba(0, 0, 0, 0.14)',
    '0 0 2px rgba(0, 0, 0, 0.24), 0 2px 4px rgba(0, 0, 0, 0.28)',
  ],
}

/** Величины, одинаковые в обеих темах: шкалы Fluent от темы не зависят. */
const ШКАЛЫ: Record<string, string> = {
  fontSizeBase200: '12px',
  fontSizeBase300: '14px',
  fontSizeBase400: '16px',
  fontSizeBase600: '24px',
  fontSizeHero700: '28px',
  lineHeightBase200: '16px',
  lineHeightBase300: '20px',
  lineHeightBase400: '22px',
  lineHeightBase600: '32px',
  lineHeightHero700: '36px',
  fontWeightRegular: '400',
  fontWeightSemibold: '600',
  borderRadiusMedium: '4px',
  borderRadiusXLarge: '8px',
  borderRadiusCircular: '10000px',
  strokeWidthThin: '1px',
  strokeWidthThick: '2px',
  spacingHorizontalS: '8px',
  spacingHorizontalM: '12px',
  spacingHorizontalL: '16px',
  spacingHorizontalXXL: '24px',
  spacingVerticalS: '8px',
  spacingVerticalM: '12px',
  spacingVerticalL: '16px',
  spacingVerticalXXL: '24px',
  durationFaster: '100ms',
  curveEasyEase: 'cubic-bezier(0.33, 0, 0.67, 1)',
}

/**
 * Литералы, которым разрешено стоять в блоках величин помимо шкал Fluent, — каждый с доводом.
 *
 * Список держится коротким нарочно: он — список сознательных решений, а не место, куда сметают
 * неудобное. Каждая строка обязана нести довод, иначе закрывающее утверждение теряет смысл.
 */
const ИСКЛЮЧЕНИЯ: Record<string, string> = {
  '72rem': 'предельная ширина содержимого: числа для неё в документации Fluent нет, названо допущением в контракте',
}

/** Конец блока, открытого скобкой на месте `открывающая`. Скобки считаются. */
function конецБлока(текст: string, открывающая: number): number {
  let глубина = 0
  for (let i = открывающая; i < текст.length; i += 1) {
    if (текст[i] === '{') глубина += 1
    if (текст[i] === '}') {
      глубина -= 1
      if (глубина === 0) return i
    }
  }
  throw new Error('блок в таблице стилей не закрыт')
}

/**
 * Три куска таблицы стилей: блок величин светлой темы, блок величин тёмной и всё остальное.
 *
 * «Всё остальное» — правила экрана. Цвету там взяться неоткуда: все цвета приходят токенами, и
 * закрывающее утверждение это требует.
 */
function куски(css: string): { светлая: string; тёмная: string; правила: string } {
  const чистый = css.replace(/\/\*[\s\S]*?\*\//g, (м) => ' '.repeat(м.length))
  const дляСкобок = чистый.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (м) => ' '.repeat(м.length))

  const началоТёмной = дляСкобок.indexOf('@media (prefers-color-scheme: dark)')
  expect(началоТёмной, 'в таблице стилей есть блок тёмной темы').toBeGreaterThan(-1)
  const телоТёмной = дляСкобок.indexOf('{', началоТёмной)
  const конецТёмной = конецБлока(дляСкобок, телоТёмной)

  const светлаяОбласть = чистый.slice(0, началоТёмной) + чистый.slice(конецТёмной + 1)
  const светлаяДляСкобок = дляСкобок.slice(0, началоТёмной) + дляСкобок.slice(конецТёмной + 1)
  const тёмнаяОбласть = чистый.slice(телоТёмной + 1, конецТёмной)
  const тёмнаяДляСкобок = дляСкобок.slice(телоТёмной + 1, конецТёмной)

  const светлыйБлок = блок(светлаяОбласть, светлаяДляСкобок)
  const тёмныйБлок = блок(тёмнаяОбласть, тёмнаяДляСкобок)

  return {
    светлая: светлыйБлок.текст,
    тёмная: тёмныйБлок.текст,
    правила: светлаяОбласть.slice(0, светлыйБлок.от) + светлаяОбласть.slice(светлыйБлок.до),
  }
}

/** Единственный блок `:root { … }` в области: его содержимое и его границы. */
function блок(область: string, дляСкобок: string): { текст: string; от: number; до: number } {
  const начала = [...дляСкобок.matchAll(/(?:^|[\s};])(:root)\s*\{/g)]
  expect(начала.length, 'блок величин `:root` в области ровно один').toBe(1)

  const от = начала[0].index + начала[0][0].indexOf(':root')
  const открывающая = дляСкобок.indexOf('{', от)
  const до = конецБлока(дляСкобок, открывающая)
  return { текст: область.slice(открывающая + 1, до), от, до: до + 1 }
}

/** Значение величины в области, без завершающей точки с запятой. */
function величина(область: string, имя: string): string | null {
  const найдено = new RegExp(`--${имя}:\\s*([^;]+);`).exec(область)
  return найдено === null ? null : найдено[1].trim().replace(/\s+/g, ' ')
}

const { светлая, тёмная, правила } = куски(СТИЛИ)

test('цвета таблицы стилей — те же, что у Fluent 2, в обеих темах', () => {
  for (const [имя, [вСветлой, вТёмной]] of Object.entries(ЦВЕТА)) {
    expect(величина(светлая, имя), `${имя} в светлой теме`).toBe(вСветлой)
    expect(величина(тёмная, имя), `${имя} в тёмной теме`).toBe(вТёмной)
  }

  for (const [имя, [вСветлой, вТёмной]] of Object.entries(ТЕНИ)) {
    expect(величина(светлая, имя), `${имя} в светлой теме`).toBe(вСветлой)
    expect(величина(тёмная, имя), `${имя} в тёмной теме`).toBe(вТёмной)
  }
})

test('размеры, скругления, отступы и толщины таблицы стилей — из шкал Fluent 2', () => {
  for (const [имя, значение] of Object.entries(ШКАЛЫ)) {
    expect(величина(светлая, имя), `${имя}`).toBe(значение)
  }
})

/**
 * Закрывающее утверждение: не «сторожим перечисленное», а «постороннего нет».
 *
 * Первые два утверждения сторожат **выписанное**: забытый прежний серый прошёл бы зелёным. Это
 * читает файл с другой стороны — со стороны того, что в нём стоит, — и требует, чтобы каждый
 * литерал был из набора Fluent либо назван исключением с доводом.
 *
 * **Область, которую оно закрывает сегодня, и почему не весь файл.** Цвета — по всему файлу:
 * вне блоков величин цветному литералу взяться неоткуда, и это утверждается. Длины — пока только
 * внутри блоков величин: правила экрана ещё держат прежние числа и переезжают на шкалы Fluent
 * задачами 4–9. Область расширяется на весь файл задачей 9, и расширение видно в диффе отдельной
 * строкой.
 */
test('в таблице стилей нет ни одной величины цвета и ни одного размера вне набора Fluent 2', () => {
  const разрешено = new Set<string>([
    ...Object.values(ЦВЕТА).flat(),
    ...Object.values(ШКАЛЫ),
    ...Object.keys(ИСКЛЮЧЕНИЯ),
  ])

  const цвет = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)/g

  expect(
    правила.match(цвет) ?? [],
    'в правилах экрана не стоит ни одного цвета: все цвета приходят токенами',
  ).toEqual([])

  const литералыЦвета = [...светлая.matchAll(цвет), ...тёмная.matchAll(цвет)].map((м) => м[0])
  for (const литерал of литералыЦвета) {
    const внутриТени = Object.values(ТЕНИ).some(([с, т]) => `${с} ${т}`.includes(литерал))
    expect(
      разрешено.has(литерал) || внутриТени,
      `цвет ${литерал} не из набора Fluent 2 и не назван исключением`,
    ).toBe(true)
  }

  const длины = /(?<![\w-])\d+(?:\.\d+)?(?:px|rem)\b/g
  const литералыДлины = [...светлая.matchAll(длины), ...тёмная.matchAll(длины)].map((м) => м[0])
  for (const литерал of литералыДлины) {
    expect(
      разрешено.has(литерал),
      `длина ${литерал} не из шкал Fluent 2 и не названа исключением`,
    ).toBe(true)
  }
})
