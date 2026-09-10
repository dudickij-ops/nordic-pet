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
 * 4. **Закрывающее утверждение ниже уже своего имени, и границы названы здесь.** Длина сверяется с
 *    объединением всех шкал **без учёта роли**: `font-size: 34px` пройдёт, потому что 34 есть в
 *    шкале высот строк таблицы. Числа **без единиц** и проценты не проверяются вовсе:
 *    `opacity: 0.55` или `font-weight: 700` пройдут. Цвет ловится **только в перечисленных
 *    свойствах** (`ЦВЕТОВЫЕ` ниже): `border-inline-start` с посторонним цветом пройдёт. **Условия
 *    медиазапросов** не читаются. У расширения про длины нет своего слома — сломы доказывают
 *    цвет, размер шрифта и блоки величин.
 * 5. **Она не доказывает, что числа — из Fluent 2.** Она доказывает совпадение таблицы стилей с
 *    **нашей выпиской** ниже. Совпадение выписки с источником доказывают якорь у каждой величины
 *    и человек, который по нему сходит. Это не оговорка на всякий случай, а след настоящей ошибки:
 *    первая редакция выписки взяла двенадцать значений смыслового цвета из **комментария** в
 *    `alias/lightColor.ts` и `alias/darkColor.ts` (`// #0078d4 Global.Color.Brand.80`), а не из
 *    значения — палитры `brandWeb`, по которой строится веб-тема. Проверка была зелёной, потому
 *    что сверяла выписку с выпиской. Нашёл рецензент без контекста автора.
 *
 * **Внешний якорь.** Источник всех величин — `microsoft/fluentui`, коммит
 * `43665d5fb41408837ad1e85eb662575da9e0c4d0`. У каждой строки таблиц ниже стоит цепочка звеньев
 * «файл:строка» от имени токена до значения: для цвета — строка в `alias/*Color.ts`, где токен
 * получает ступень, затем тема (`themes/web/*Theme.ts` строит тему из `brandWeb`), затем строка
 * палитры с самим значением. Цепочки построены разбором исходного текста на этом коммите и
 * просмотрены глазом; при смене коммита они обязаны быть построены заново, а не поправлены.
 *
 * **Как она устроена после проверки кода.** Первая редакция искала в файле литералы по их виду —
 * `#hex` и `rgb()` — и потому не видела ни `rebeccapurple`, ни `hsl()`, ни величины, объявленной
 * второй раз ниже первой, ни правил внутри блока тёмной темы. Проверка литералов по образцу
 * закрывает ровно те записи, которые перечислил её автор.
 *
 * Теперь она смотрит не на **виды записи**, а на **устройство файла**:
 *
 * - величины объявляются ровно в двух местах — блок светлой темы и блок тёмной; больше нигде;
 * - каждое объявление в этих блоках имеет либо значение из документации Fluent, либо ссылку на
 *   другую величину, либо стоит в коротком списке названных исключений;
 * - в правилах экрана у **цветовых свойств** значение состоит только из ссылок на величины и
 *   безопасных слов языка. Посторонний цвет не пройдёт независимо от того, как он записан;
 * - **любая длина в правилах** — из шкал Fluent либо из короткого списка названных исключений.
 *
 * **Откуда взяты числа.** Имена и значения — из официальной реализации токенов Fluent 2
 * (`microsoft/fluentui`, пакет `packages/tokens/src`): `global/fonts.ts`, `global/spacings.ts`,
 * `global/borderRadius.ts`, `global/strokeWidths.ts`, `global/curves.ts`, `global/durations.ts`,
 * `alias/lightColor.ts`, `alias/darkColor.ts`, `utils/shadows.ts`, величины кнопки и высота строки
 * таблицы — `react-components/react-button/…` и `react-components/react-table/…` (там они стоят числами рядом с
 * правилами, а не в шкале), красный — через
 * `alias/*ColorPalette.ts` и `global/colors.ts`. Значения перенесены без изменения смысла;
 * пробелы в записи (`rgba(0, 0, 0, 0.12)` вместо `rgba(0,0,0,0.12)`) наши, и проверка зашивает
 * нашу запись, а не строку источника.
 *
 * **Граница разбора.** Проверка выбрасывает комментарии, не заглядывает внутрь кавычек и считает
 * фигурные скобки. Правил языка стилей она не понимает: ни вложенности, ни условий, ни того, что
 * одно правило перебивает другое по весомости.
 */

const СТИЛИ = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8')

/** Цвета, у которых значение своё в каждой теме. Имя токена → [светлая, тёмная]. */
const ЦВЕТА: Record<string, [string, string]> = {
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:67 `white` → packages/tokens/src/global/colors.ts:124 white
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:67 `grey[16]` → packages/tokens/src/global/colors.ts:14 grey[16]
  colorNeutralBackground1: ['#ffffff', '#292929'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:68 `grey[96]` → packages/tokens/src/global/colors.ts:54 grey[96]
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:68 `grey[24]` → packages/tokens/src/global/colors.ts:18 grey[24]
  colorNeutralBackground1Hover: ['#f5f5f5', '#3d3d3d'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:69 `grey[88]` → packages/tokens/src/global/colors.ts:50 grey[88]
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:69 `grey[12]` → packages/tokens/src/global/colors.ts:12 grey[12]
  colorNeutralBackground1Pressed: ['#e0e0e0', '#1f1f1f'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:79 `grey[94]` → packages/tokens/src/global/colors.ts:53 grey[94]
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:79 `grey[4]` → packages/tokens/src/global/colors.ts:8 grey[4]
  colorNeutralBackground4: ['#f0f0f0', '#0a0a0a'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:8 `grey[14]` → packages/tokens/src/global/colors.ts:13 grey[14]
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:8 `white` → packages/tokens/src/global/colors.ts:124 white
  colorNeutralForeground1: ['#242424', '#ffffff'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:12 `grey[26]` → packages/tokens/src/global/colors.ts:19 grey[26]
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:12 `grey[84]` → packages/tokens/src/global/colors.ts:48 grey[84]
  colorNeutralForeground2: ['#424242', '#d6d6d6'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:19 `grey[38]` → packages/tokens/src/global/colors.ts:25 grey[38]
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:19 `grey[68]` → packages/tokens/src/global/colors.ts:40 grey[68]
  colorNeutralForeground3: ['#616161', '#adadad'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:31 `grey[74]` → packages/tokens/src/global/colors.ts:43 grey[74]
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:31 `grey[36]` → packages/tokens/src/global/colors.ts:24 grey[36]
  colorNeutralForegroundDisabled: ['#bdbdbd', '#5c5c5c'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:115 `grey[94]` → packages/tokens/src/global/colors.ts:53 grey[94]
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:115 `grey[8]` → packages/tokens/src/global/colors.ts:10 grey[8]
  colorNeutralBackgroundDisabled: ['#f0f0f0', '#141414'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:174 `grey[88]` → packages/tokens/src/global/colors.ts:50 grey[88]
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:174 `grey[26]` → packages/tokens/src/global/colors.ts:19 grey[26]
  colorNeutralStrokeDisabled: ['#e0e0e0', '#424242'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:55 `white` → packages/tokens/src/global/colors.ts:124 white
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:55 `white` → packages/tokens/src/global/colors.ts:124 white
  colorNeutralForegroundOnBrand: ['#ffffff', '#ffffff'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:150 `grey[82]` → packages/tokens/src/global/colors.ts:47 grey[82]
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:150 `grey[40]` → packages/tokens/src/global/colors.ts:26 grey[40]
  colorNeutralStroke1: ['#d1d1d1', '#666666'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:154 `grey[88]` → packages/tokens/src/global/colors.ts:50 grey[88]
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:154 `grey[32]` → packages/tokens/src/global/colors.ts:22 grey[32]
  colorNeutralStroke2: ['#e0e0e0', '#525252'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:146 `grey[38]` → packages/tokens/src/global/colors.ts:25 grey[38]
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:146 `grey[68]` → packages/tokens/src/global/colors.ts:40 grey[68]
  colorNeutralStrokeAccessible: ['#616161', '#adadad'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:101 `grey[96]` → packages/tokens/src/global/colors.ts:54 grey[96]
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:101 `grey[22]` → packages/tokens/src/global/colors.ts:17 grey[22]
  colorSubtleBackgroundHover: ['#f5f5f5', '#383838'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:124 `brand[80]` → packages/tokens/src/themes/web/lightTheme.ts:5 brand = brandWeb → packages/tokens/src/global/brandColors.ts:11 brandWeb[80]
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:124 `brand[70]` → packages/tokens/src/themes/web/darkTheme.ts:5 brand = brandWeb → packages/tokens/src/global/brandColors.ts:10 brandWeb[70]
  colorBrandBackground: ['#0f6cbd', '#115ea3'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:125 `brand[70]` → packages/tokens/src/themes/web/lightTheme.ts:5 brand = brandWeb → packages/tokens/src/global/brandColors.ts:10 brandWeb[70]
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:125 `brand[80]` → packages/tokens/src/themes/web/darkTheme.ts:5 brand = brandWeb → packages/tokens/src/global/brandColors.ts:11 brandWeb[80]
  colorBrandBackgroundHover: ['#115ea3', '#0f6cbd'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:126 `brand[40]` → packages/tokens/src/themes/web/lightTheme.ts:5 brand = brandWeb → packages/tokens/src/global/brandColors.ts:7 brandWeb[40]
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:126 `brand[40]` → packages/tokens/src/themes/web/darkTheme.ts:5 brand = brandWeb → packages/tokens/src/global/brandColors.ts:7 brandWeb[40]
  colorBrandBackgroundPressed: ['#0c3b5e', '#0c3b5e'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:132 `brand[160]` → packages/tokens/src/themes/web/lightTheme.ts:5 brand = brandWeb → packages/tokens/src/global/brandColors.ts:19 brandWeb[160]
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:132 `brand[20]` → packages/tokens/src/themes/web/darkTheme.ts:5 brand = brandWeb → packages/tokens/src/global/brandColors.ts:5 brandWeb[20]
  colorBrandBackground2: ['#ebf3fc', '#082338'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:44 `brand[80]` → packages/tokens/src/themes/web/lightTheme.ts:5 brand = brandWeb → packages/tokens/src/global/brandColors.ts:11 brandWeb[80]
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:44 `brand[100]` → packages/tokens/src/themes/web/darkTheme.ts:5 brand = brandWeb → packages/tokens/src/global/brandColors.ts:13 brandWeb[100]
  colorBrandForeground1: ['#0f6cbd', '#479ef5'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:166 `brand[80]` → packages/tokens/src/themes/web/lightTheme.ts:5 brand = brandWeb → packages/tokens/src/global/brandColors.ts:11 brandWeb[80]
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:166 `brand[100]` → packages/tokens/src/themes/web/darkTheme.ts:5 brand = brandWeb → packages/tokens/src/global/brandColors.ts:13 brandWeb[100]
  colorBrandStroke1: ['#0f6cbd', '#479ef5'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:87 `grey[90]` → packages/tokens/src/global/colors.ts:51 grey[90]
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:87 `grey[20]` → packages/tokens/src/global/colors.ts:16 grey[20]
  colorNeutralBackground6: ['#e6e6e6', '#333333'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:128 `brand[80]` → packages/tokens/src/themes/web/lightTheme.ts:5 brand = brandWeb → packages/tokens/src/global/brandColors.ts:11 brandWeb[80]
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:128 `brand[100]` → packages/tokens/src/themes/web/darkTheme.ts:5 brand = brandWeb → packages/tokens/src/global/brandColors.ts:13 brandWeb[100]
  colorCompoundBrandBackground: ['#0f6cbd', '#479ef5'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColor.ts:183 `black` → packages/tokens/src/global/colors.ts:126 black
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColor.ts:183 `white` → packages/tokens/src/global/colors.ts:124 white
  colorStrokeFocus2: ['#000000', '#ffffff'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColorPalette.ts:14 формула Background1 → .tint60 → packages/tokens/src/global/colors.ts:201 red.tint60
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColorPalette.ts:16 формула Background1 → .shade40 → packages/tokens/src/global/colors.ts:191 red.shade40
  colorPaletteRedBackground1: ['#fdf6f6', '#3f1011'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColorPalette.ts:22 формула Border2 → .primary → packages/tokens/src/global/colors.ts:195 red.primary
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColorPalette.ts:32 заплатка red.tint30 → packages/tokens/src/global/colors.ts:198 red.tint30
  colorPaletteRedBorder2: ['#d13438', '#e37d80'],
  // fluentui@43665d5 светлая: packages/tokens/src/alias/lightColorPalette.ts:17 формула Foreground1 → .shade10 → packages/tokens/src/global/colors.ts:194 red.shade10
  // fluentui@43665d5 тёмная: packages/tokens/src/alias/darkColorPalette.ts:19 формула Foreground1 → .tint30 → packages/tokens/src/global/colors.ts:198 red.tint30
  colorPaletteRedForeground1: ['#bc2f32', '#e37d80'],
  // fluentui@43665d5 светлая: packages/tokens/src/utils/shadows.ts:10 shadow8 → packages/tokens/src/alias/lightColor.ts:184 ambient → packages/tokens/src/alias/lightColor.ts:185 key
  // fluentui@43665d5 тёмная: packages/tokens/src/utils/shadows.ts:10 shadow8 → packages/tokens/src/alias/darkColor.ts:184 ambient → packages/tokens/src/alias/darkColor.ts:185 key
  shadow8: [
    '0 0 2px rgba(0, 0, 0, 0.12), 0 4px 8px rgba(0, 0, 0, 0.14)',
    '0 0 2px rgba(0, 0, 0, 0.24), 0 4px 8px rgba(0, 0, 0, 0.28)',
  ],
}

/** Величины, одинаковые в обеих темах: шкалы Fluent от темы не зависят. */
const ШКАЛЫ: Record<string, string> = {
  // fluentui@43665d5: packages/tokens/src/global/fonts.ts:5 fontSizeBase200
  fontSizeBase200: '12px',
  // fluentui@43665d5: packages/tokens/src/global/fonts.ts:6 fontSizeBase300
  fontSizeBase300: '14px',
  // fluentui@43665d5: packages/tokens/src/global/fonts.ts:7 fontSizeBase400
  fontSizeBase400: '16px',
  // fluentui@43665d5: packages/tokens/src/global/fonts.ts:9 fontSizeBase600
  fontSizeBase600: '24px',
  // fluentui@43665d5: packages/tokens/src/global/fonts.ts:11 fontSizeHero700
  fontSizeHero700: '28px',
  // fluentui@43665d5: packages/tokens/src/global/fonts.ts:19 lineHeightBase200
  lineHeightBase200: '16px',
  // fluentui@43665d5: packages/tokens/src/global/fonts.ts:20 lineHeightBase300
  lineHeightBase300: '20px',
  // fluentui@43665d5: packages/tokens/src/global/fonts.ts:21 lineHeightBase400
  lineHeightBase400: '22px',
  // fluentui@43665d5: packages/tokens/src/global/fonts.ts:23 lineHeightBase600
  lineHeightBase600: '32px',
  // fluentui@43665d5: packages/tokens/src/global/fonts.ts:25 lineHeightHero700
  lineHeightHero700: '36px',
  // fluentui@43665d5: packages/tokens/src/global/fonts.ts:32 fontWeightRegular
  fontWeightRegular: '400',
  // fluentui@43665d5: packages/tokens/src/global/fonts.ts:34 fontWeightSemibold
  fontWeightSemibold: '600',
  // fluentui@43665d5: packages/tokens/src/global/borderRadius.ts:6 borderRadiusMedium
  borderRadiusMedium: '4px',
  // fluentui@43665d5: packages/tokens/src/global/borderRadius.ts:9 borderRadius2XLarge
  borderRadius2XLarge: '12px',
  // fluentui@43665d5: packages/tokens/src/global/borderRadius.ts:14 borderRadiusCircular
  borderRadiusCircular: '10000px',
  // fluentui@43665d5: packages/tokens/src/global/strokeWidths.ts:4 strokeWidthThin
  strokeWidthThin: '1px',
  // fluentui@43665d5: packages/tokens/src/global/strokeWidths.ts:5 strokeWidthThick
  strokeWidthThick: '2px',
  // fluentui@43665d5: packages/tokens/src/global/spacings.ts:21 → spacings.xs → packages/tokens/src/global/spacings.ts:7 xs
  spacingHorizontalXS: '4px',
  // fluentui@43665d5: packages/tokens/src/global/spacings.ts:23 → spacings.s → packages/tokens/src/global/spacings.ts:9 s
  spacingHorizontalS: '8px',
  // fluentui@43665d5: packages/tokens/src/global/spacings.ts:25 → spacings.m → packages/tokens/src/global/spacings.ts:11 m
  spacingHorizontalM: '12px',
  // fluentui@43665d5: packages/tokens/src/global/spacings.ts:26 → spacings.l → packages/tokens/src/global/spacings.ts:12 l
  spacingHorizontalL: '16px',
  // fluentui@43665d5: packages/tokens/src/global/spacings.ts:27 → spacings.xl → packages/tokens/src/global/spacings.ts:13 xl
  spacingHorizontalXL: '20px',
  // fluentui@43665d5: packages/tokens/src/global/spacings.ts:28 → spacings.xxl → packages/tokens/src/global/spacings.ts:14 xxl
  spacingHorizontalXXL: '24px',
  // fluentui@43665d5: packages/tokens/src/global/spacings.ts:35 → spacings.xs → packages/tokens/src/global/spacings.ts:7 xs
  spacingVerticalXS: '4px',
  // fluentui@43665d5: packages/tokens/src/global/spacings.ts:37 → spacings.s → packages/tokens/src/global/spacings.ts:9 s
  spacingVerticalS: '8px',
  // fluentui@43665d5: packages/tokens/src/global/spacings.ts:39 → spacings.m → packages/tokens/src/global/spacings.ts:11 m
  spacingVerticalM: '12px',
  // fluentui@43665d5: packages/tokens/src/global/spacings.ts:40 → spacings.l → packages/tokens/src/global/spacings.ts:12 l
  spacingVerticalL: '16px',
  // fluentui@43665d5: packages/tokens/src/global/spacings.ts:41 → spacings.xl → packages/tokens/src/global/spacings.ts:13 xl
  spacingVerticalXL: '20px',
  // fluentui@43665d5: packages/tokens/src/global/spacings.ts:42 → spacings.xxl → packages/tokens/src/global/spacings.ts:14 xxl
  spacingVerticalXXL: '24px',
  // fluentui@43665d5: packages/tokens/src/global/spacings.ts:43 → spacings.xxxl → packages/tokens/src/global/spacings.ts:15 xxxl
  spacingVerticalXXXL: '32px',
  // fluentui@43665d5: packages/react-components/react-table/library/src/components/TableCell/useTableCellStyles.styles.ts:25 размер small, height
  tableRowHeightSmall: '34px',
  // fluentui@43665d5: packages/react-components/react-button/library/src/components/Button/useButtonStyles.styles.ts:17 buttonSpacingSmall
  buttonSpacingSmall: '3px',
  // fluentui@43665d5: packages/react-components/react-button/library/src/components/Button/useButtonStyles.styles.ts:19 buttonSpacingMedium
  buttonSpacingMedium: '5px',
  // fluentui@43665d5: packages/react-components/react-button/library/src/components/Button/useButtonStyles.styles.ts:292 размер small, minWidth
  buttonMinWidthSmall: '64px',
  // fluentui@43665d5: packages/react-components/react-button/library/src/components/Button/useButtonStyles.styles.ts:64 основной вид кнопки, minWidth
  buttonMinWidthMedium: '96px',
  // fluentui@43665d5: packages/tokens/src/global/durations.ts:5 durationFaster
  durationFaster: '100ms',
  // fluentui@43665d5: packages/tokens/src/global/curves.ts:11 curveEasyEase
  curveEasyEase: 'cubic-bezier(0.33, 0, 0.67, 1)',
}

/**
 * Величины, которым разрешено стоять в блоках помимо шкал Fluent, — каждая с доводом.
 *
 * Список — перечень сознательных решений, а не место, куда сметают неудобное. Пустой довод
 * запрещён проверкой ниже: строка без довода делает закрывающее утверждение бессмысленным.
 */
const ИСКЛЮЧЕНИЯ: Record<string, { значение: string; довод: string }> = {
  fontFamilyBase: {
    значение:
      "'Segoe UI', 'Segoe UI Web (West European)', -apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', sans-serif",
    довод:
      'шрифтовой стек Fluent целиком; в проверке он лежит отдельной строкой, потому что это не ' +
      'число из шкалы, а перечень имён',
  },
  page: {
    значение: '72rem',
    довод:
      'предельная ширина содержимого: числа для неё в документации Fluent нет вовсе, названо ' +
      'допущением в контракте',
  },
}

/**
 * Длины в правилах экрана, которых нет ни в одной шкале Fluent, — каждая с доводом.
 *
 * Их четыре, и список закрыт: всё, что не здесь и не в шкалах, красит закрывающее утверждение.
 * Каждая строка — сознательное решение, а не место, куда сметают неудобное.
 *
 * **Три строки удалены как мёртвые, и это делает проверку строже.** `8px` уже есть в шкале
 * отступов — исключение ничего не разрешало. `48rem` и `40rem` стоят только в условиях
 * медиазапросов, а условий эта проверка не читает вовсе — исключения ни на что не влияли. Это не
 * значит, что условия медиазапросов проверены: они не проверяются ничем, и это названо здесь.
 */
const ИСКЛЮЧЕНИЯ_ПРАВИЛ: Record<string, string> = {
  '26rem':
    'предел ширины полосы доли: во всю строку 80 % и 100 % почти неразличимы, глазу нужен видимый остаток',
  '19rem':
    'наименьшая ширина колонки списка неполноты: при ней самая длинная строка умещается в одну',
  '22rem': 'ширина карточки входа: форма из двух полей не должна растягиваться на весь монитор',
  '12vh': 'отступ карточки входа сверху: она стоит чуть выше середины',
}

/** Свойства, у которых значение способно нести цвет. Всё прочее проверка не читает. */
const ЦВЕТОВЫЕ = new Set([
  'color',
  'background',
  'background-color',
  'background-image',
  'border',
  'border-color',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline',
  'outline-color',
  'box-shadow',
  'text-shadow',
  'fill',
  'stroke',
  'text-decoration-color',
  'caret-color',
  'accent-color',
])

/** Слова языка, которые цвета не несут и потому в цветовом значении законны. */
const БЕЗОПАСНЫЕ = new Set([
  'transparent',
  'inherit',
  'initial',
  'unset',
  'currentcolor',
  'none',
  'solid',
  'dashed',
  'dotted',
  'inset',
  'auto',
])

/**
 * Сколько блоков `:root` нашлось в файле.
 *
 * Считается при разборе, а утверждается отдельной проверкой: если бы разбор сам на этом
 * настаивал, третий блок красил бы все проверки файла разом, и слом перестал бы указывать на
 * своё утверждение.
 */
let блоковВеличин = 0

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
 * Три куска таблицы стилей: блок величин светлой темы, блок величин тёмной и все правила.
 *
 * «Все правила» — это весь остальной файл, включая то, что стоит внутри блока тёмной темы рядом
 * с её величинами. Первая редакция теряла этот хвост, и правило, дописанное в тёмный медиазапрос,
 * не проверялось ничем.
 */
function куски(css: string): { светлая: string; тёмная: string; правила: string } {
  const чистый = css.replace(/\/\*[\s\S]*?\*\//g, (м) => ' '.repeat(м.length))
  const дляСкобок = чистый.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (м) => ' '.repeat(м.length))

  const начала = [...дляСкобок.matchAll(/(?:^|[\s};])(:root)\s*\{/g)].map(
    (м) => (м.index as number) + м[0].indexOf(':root'),
  )
  if (начала.length < 2) throw new Error('в таблице стилей меньше двух блоков величин `:root`')
  блоковВеличин = начала.length

  const границы = начала.slice(0, 2).map((от) => {
    const открывающая = дляСкобок.indexOf('{', от)
    return { открывающая, закрывающая: конецБлока(дляСкобок, открывающая) }
  })

  let правила = чистый
  for (const { открывающая, закрывающая } of [...границы].reverse()) {
    правила = правила.slice(0, открывающая + 1) + правила.slice(закрывающая)
  }

  return {
    светлая: чистый.slice(границы[0].открывающая + 1, границы[0].закрывающая),
    тёмная: чистый.slice(границы[1].открывающая + 1, границы[1].закрывающая),
    правила,
  }
}

/** Объявления величин в блоке: имя → значение. Повторное имя — отказ проверки. */
function величины(блок: string, где: string): Map<string, string> {
  const найденные = new Map<string, string>()
  for (const м of блок.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    const имя = м[1]
    expect(найденные.has(имя), `величина --${имя} объявлена в ${где} дважды`).toBe(false)
    найденные.set(имя, м[2].trim().replace(/\s+/g, ' '))
  }
  return найденные
}

/** Объявления в правилах: свойство и значение, по порядку. */
function объявленияПравил(правила: string): Array<{ свойство: string; значение: string }> {
  return [...правила.matchAll(/([a-zA-Z-]+)\s*:\s*([^;{}]+);/g)].map((м) => ({
    свойство: м[1].toLowerCase(),
    значение: м[2].trim().replace(/\s+/g, ' '),
  }))
}

const { светлая, тёмная, правила } = куски(СТИЛИ)
const светлыеВеличины = величины(светлая, 'светлой теме')
const тёмныеВеличины = величины(тёмная, 'тёмной теме')

/**
 * Устройство файла: два блока величин и один блок тёмной темы.
 *
 * Утверждение не косметическое. Разбор берёт первые два блока, а браузер применяет все: третий
 * блок величин, дописанный ниже, перебил бы первые два, и проверка величин утверждала бы одно,
 * а экран показывал другое.
 */
test('в таблице стилей ровно два блока величин и один блок тёмной темы', () => {
  expect(блоковВеличин, 'блоков величин `:root` в файле ровно два').toBe(2)

  const запросы = СТИЛИ.match(/@media\s*\(prefers-color-scheme:\s*dark\)/g) ?? []
  expect(запросы.length, 'блок тёмной темы ровно один').toBe(1)

  expect(светлыеВеличины.size, 'в светлом блоке есть величины').toBeGreaterThan(0)
  expect(тёмныеВеличины.size, 'в тёмном блоке есть величины').toBeGreaterThan(0)
})

test('цвета таблицы стилей — те же, что у Fluent 2, в обеих темах', () => {
  for (const [имя, [вСветлой, вТёмной]] of Object.entries(ЦВЕТА)) {
    expect(светлыеВеличины.get(имя), `${имя} в светлой теме`).toBe(вСветлой)
    expect(тёмныеВеличины.get(имя), `${имя} в тёмной теме`).toBe(вТёмной)
  }
})

test('размеры, скругления, отступы и толщины таблицы стилей — из шкал Fluent 2', () => {
  for (const [имя, значение] of Object.entries(ШКАЛЫ)) {
    expect(светлыеВеличины.get(имя), `${имя}`).toBe(значение)
  }
})

/**
 * Закрывающее утверждение: не «сторожим перечисленное», а «постороннего нет».
 *
 * Первые два утверждения сторожат **выписанное**: забытый прежний серый прошёл бы зелёным. Это
 * читает файл с другой стороны — со стороны того, что в нём стоит.
 *
 * Оно закрывает: всякое объявление величины в обоих блоках; всякое цветовое свойство во всех
 * правилах, включая правила внутри блока тёмной темы; и запрещает объявлять величины где-либо
 * ещё. Посторонний цвет не пройдёт независимо от записи — ни `#hex`, ни `rebeccapurple`, ни
 * `hsl()`, ни `oklch()`.
 *
 * Чего оно не закрывает и это названо: **имён**. Лишний токен, чьё значение уже встречается в
 * наборе, пройдёт — утверждение про значения, а не про состав набора.
 */
test('в таблице стилей нет ни одной величины и ни одного цвета вне набора Fluent 2', () => {
  for (const [где, набор, тема] of [
    ['светлой теме', светлыеВеличины, 0],
    ['тёмной теме', тёмныеВеличины, 1],
  ] as const) {
    for (const [имя, значение] of набор) {
      const ожидаемое = ЦВЕТА[имя]?.[тема] ?? ШКАЛЫ[имя] ?? ИСКЛЮЧЕНИЯ[имя]?.значение
      const ссылка = /^var\(--[\w-]+\)$/.test(значение)
      expect(
        ссылка || значение === ожидаемое,
        `величина --${имя} в ${где} — «${значение}»: она не из набора Fluent 2, не ссылка на ` +
          'другую величину и не названа исключением',
      ).toBe(true)
    }
  }

  const шкалы = new Set(Object.values(ШКАЛЫ))

  for (const { свойство, значение } of объявленияПравил(правила)) {
    expect(
      свойство.startsWith('--'),
      `величина «${свойство}» объявлена вне блоков величин: величины живут только в двух блоках`,
    ).toBe(false)

    for (const длина of значение.match(/(?<![\w-])-?\d+(?:\.\d+)?(?:px|rem|em|vh|vw)\b/g) ?? []) {
      expect(
        шкалы.has(длина) || длина in ИСКЛЮЧЕНИЯ_ПРАВИЛ,
        `в правиле «${свойство}: ${значение}» стоит длина «${длина}» — она не из шкал Fluent 2 и ` +
          'не названа исключением',
      ).toBe(true)
    }

    if (!ЦВЕТОВЫЕ.has(свойство)) continue

    const безСсылок = значение.replace(/var\(--[\w-]+\)/g, ' ')
    for (const слово of безСсылок.split(/[\s,]+/).filter((с) => с !== '')) {
      const число = /^-?\d*\.?\d+(?:px|rem|em|%|ms|s)?$/.test(слово)
      expect(
        число || БЕЗОПАСНЫЕ.has(слово.toLowerCase()),
        `в правиле «${свойство}: ${значение}» стоит «${слово}» — цвет обязан приходить ссылкой на ` +
          'величину, а не записью',
      ).toBe(true)
    }
  }
})

test('у каждого исключения есть довод', () => {
  for (const [имя, { довод }] of Object.entries(ИСКЛЮЧЕНИЯ)) {
    expect(довод.trim().length, `исключение --${имя} без довода`).toBeGreaterThan(20)
  }
  for (const [длина, довод] of Object.entries(ИСКЛЮЧЕНИЯ_ПРАВИЛ)) {
    expect(довод.trim().length, `исключение ${длина} без довода`).toBeGreaterThan(20)
  }
})

/**
 * Отключённый вид обязан быть назван и для главной кнопки — **проверка текста, а не поведения**.
 *
 * Что здесь случилось. Правило отключённой кнопки стояло селектором `button:disabled`, а вид
 * главной кнопки — селектором `button.primary`. Вес у них одинаков: одно имя тега и одна запись в
 * средней колонке — класс у одной, псевдокласс у другой. При равном весе побеждает то правило,
 * что стоит ниже, и ниже стоял `button.primary`. Главных кнопок в приложении две — «Обновить
 * данные» и «Войти», — и обе только и бывают отключены. То есть отключённый вид не доходил ни до
 * одной кнопки, которая когда-либо отключается.
 *
 * **Чего эта проверка не доказывает, и это важнее того, что доказывает.** Она читает селектор в
 * тексте файла. Что движок разрешает вес именно так, она не проверяет и проверить не может:
 * браузера здесь нет. Настоящее доказательство снято прогоном в том самом Chrome, которым
 * делаются снимки, и записано числами в `docs/сверка/контраст.md`: до правки отключённая главная
 * кнопка давала 4,53 : 1 белым по синему — ровно как включённая, — после правки 1,65 : 1 серым по
 * серому. Проверка ниже сторожит только то, чтобы селектор не вернули к прежней записи молча.
 *
 * Ограничение того же рода уже названо в шапке файла: правил языка стилей эта проверка не
 * понимает, в том числе того, что одно правило перебивает другое по весомости. Этот дефект в ту
 * дыру и провалился.
 */
test('отключённый вид назван и для главной кнопки, а не только для кнопки вообще', () => {
  const чистый = СТИЛИ.replace(/\/\*[\s\S]*?\*\//g, (м) => ' '.repeat(м.length))

  const место = чистый.indexOf('var(--colorNeutralForegroundDisabled)')
  expect(место, 'в таблице стилей нет правила отключённого вида вовсе').toBeGreaterThan(-1)

  const открывающая = чистый.lastIndexOf('{', место)
  const селектор = чистый.slice(чистый.lastIndexOf('}', открывающая) + 1, открывающая).trim()

  expect(селектор, `селектор отключённого вида сейчас такой: «${селектор}»`).toContain(
    'button:disabled',
  )
  expect(
    селектор,
    'у `button:disabled` и `button.primary` вес правила одинаков, а `button.primary` стоит в ' +
      'файле ниже — значит без отдельного `button.primary:disabled` отключённый вид не доходит ' +
      `до главной кнопки, а её только и отключают. Сейчас селектор такой: «${селектор}»`,
  ).toContain('button.primary:disabled')
})
