import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Dashboard, ТЕКСТ_ДАННЫЕ_НЕ_ЧИТАЮТСЯ } from '@/app/page'
import { LoginView } from '@/app/login/form'
import { LogoutButton } from '@/app/logout-button'
import { RefreshView } from '@/app/refresh-panel'
import { МАРТ, ОТКАЗ_ВХОДА, ОТКАЗ_ШАГА } from './fixture.ts'
import { сверитьТекст, сверитьТемы, сверитьШирину } from './guards.ts'

/**
 * Генератор снимков экрана — кусок S10.
 *
 * **Зачем он в репозитории.** Прежде снимки делались руками, а обе ловушки, на которых они
 * спотыкались, были записаны словами в описи рядом. Владелец потребовал обратного: генератор,
 * который только документирует ловушку, наследует её. Оба случая теперь валят прогон ненулевым
 * кодом возврата — см. `guards.ts`.
 *
 * **Почему он запускается через vitest, а не `node`.** Снимок обязан показывать **настоящую**
 * разметку приложения, значит генератор ввозит её компоненты. Разметка написана на JSX, а `node`
 * снимает с файлов только типы и JSX не разбирает; кроме того, приложение ввозит себя через
 * `@/…`, а такого разрешения путей у `node` нет. Vitest умеет и то и другое, и он уже стоит в
 * зависимостях. Отдельная настройка `vitest.screens.config.ts` держит генератор в стороне от
 * `npm test`: обычный прогон проверок ничего в репозиторий не пишет.
 *
 * **Чего этот файл не делает.** Он не считает ни одного числа. Числа приходят раскладкой из
 * `fixture.ts`, а раскладка сверяется с тем, что уже лежит в репозитории и уже принято
 * владельцем.
 */

const КОРЕНЬ = new URL('../../', import.meta.url).pathname
const СНИМКИ = join(КОРЕНЬ, 'docs/screens')
const СТИЛИ = join(КОРЕНЬ, 'app/globals.css')

/** Браузер, которым делаются картинки. Другого на этой машине нет, и подставлять его неоткуда. */
const БРАУЗЕР = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/** Состояние экрана: имя файла, разметка и то, нужна ли ему тёмная пара. */
type Состояние = { имя: string; разметка: ReactElement }

/** Картинка: из какого состояния, в какой теме и на какой ширине. */
type Картинка = { файл: string; состояние: string; тёмная: boolean; ширина: number; высота: number }

/**
 * Пять состояний экрана.
 *
 * Страница отказа базы собрана здесь разметкой, а не взята у самой страницы: `HomePage` требует
 * запроса и соединения с базой, а снимок делается без того и без другого. Текст при этом взят у
 * приложения — постоянной `ТЕКСТ_ДАННЫЕ_НЕ_ЧИТАЮТСЯ`, а не переписан второй раз.
 */
const СОСТОЯНИЯ: Состояние[] = [
  {
    имя: 'obychnyy',
    разметка: (
      <>
        <LogoutButton />
        <RefreshView outcome={{ ok: true }} pending={false}>
          <Dashboard report={МАРТ} />
        </RefreshView>
      </>
    ),
  },
  {
    имя: 'chisla-otstali',
    разметка: (
      <>
        <LogoutButton />
        <p role="status">
          Числа отстали от источников: сырьё менялось после последнего разбора. Нажмите «Обновить
          данные».
        </p>
        <RefreshView outcome={{ ok: true }} pending={false}>
          <Dashboard report={{ ...МАРТ, устарели: true }} />
        </RefreshView>
      </>
    ),
  },
  {
    имя: 'otkaz-shaga',
    разметка: (
      <>
        <LogoutButton />
        <RefreshView outcome={ОТКАЗ_ШАГА} pending={false}>
          <Dashboard report={МАРТ} />
        </RefreshView>
      </>
    ),
  },
  {
    имя: 'otkaz-bazy',
    разметка: (
      <main>
        <h1>Nordic Pet — прибыль</h1>
        <p role="alert">{ТЕКСТ_ДАННЫЕ_НЕ_ЧИТАЮТСЯ}</p>
        <LogoutButton />
      </main>
    ),
  },
  {
    имя: 'vhod',
    разметка: <LoginView исход={ОТКАЗ_ВХОДА} ждём={false} />,
  },
]

/** Семь картинок описи. Имена и размеры — те же, что у снимков, принятых прошлым куском. */
const КАРТИНКИ: Картинка[] = [
  { файл: '01-obychnyy-shirokiy-svetlaya.png', состояние: 'obychnyy', тёмная: false, ширина: 1280, высота: 1700 },
  { файл: '02-obychnyy-shirokiy-tyomnaya.png', состояние: 'obychnyy', тёмная: true, ширина: 1280, высота: 1700 },
  { файл: '03-obychnyy-uzkiy.png', состояние: 'obychnyy', тёмная: false, ширина: 500, высота: 2000 },
  { файл: '04-chisla-otstali.png', состояние: 'chisla-otstali', тёмная: false, ширина: 1280, высота: 760 },
  { файл: '05-otkaz-shaga.png', состояние: 'otkaz-shaga', тёмная: false, ширина: 1280, высота: 760 },
  { файл: '06-otkaz-bazy.png', состояние: 'otkaz-bazy', тёмная: false, ширина: 1280, высота: 380 },
  { файл: '07-vhod.png', состояние: 'vhod', тёмная: false, ширина: 1280, высота: 620 },
]

/** Три пары «до / после», которые владелец сравнивает глазом. */
const ПАРЫ = new Set([
  '01-obychnyy-shirokiy-svetlaya.png',
  '02-obychnyy-shirokiy-tyomnaya.png',
  '03-obychnyy-uzkiy.png',
])

/**
 * Видимый текст страницы, по порядку.
 *
 * Отличается от переписи экрана (`__tests__/screen/census.test.tsx`) одним: здесь сначала
 * выбрасываются `<script>` и `<style>` целиком. Перепись работает с разметкой компонента, где ни
 * того ни другого нет; в файле снимка таблица стилей вклеена внутрь, и без этого шага её текст
 * уехал бы в сравнение вместе с подписями.
 */
export function видимыйТекст(страница: string): string[] {
  return страница
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '\n')
    .split('\n')
    .map((кусок) => разэкранировать(кусок).trim())
    .filter((кусок) => кусок !== '')
}

/** Обратный перевод пяти сущностей, которые ставит отрисовка. Больше в этих файлах не бывает. */
function разэкранировать(кусок: string): string {
  return кусок
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/**
 * Величины светлой и тёмной темы, вынутые из таблицы стилей.
 *
 * Тема снимка задаётся дописыванием одного из этих наборов в конец вклеенной таблицы стилей: у
 * `:root` в конце файла та же весомость, что и у `:root` внутри `@media`, и потому побеждает
 * последний. Так тема снимка перестаёт зависеть от настройки машины вовсе — а что подстановка
 * вообще сработала, сторожит `сверитьТемы`.
 */
export function величиныТемы(css: string): { светлая: string; тёмная: string } {
  const media = css.indexOf('@media (prefers-color-scheme: dark)')
  if (media < 0) throw new Error('в таблице стилей нет блока тёмной темы')

  return { светлая: блокRoot(css, 0, media), тёмная: блокRoot(css, media, css.length) }
}

/** Содержимое первого `:root { … }` в куске текста, со счётом вложенных скобок. */
function блокRoot(css: string, от: number, до: number): string {
  const начало = css.indexOf(':root', от)
  if (начало < 0 || начало >= до) throw new Error('в таблице стилей не нашлось объявления :root')

  const открывающая = css.indexOf('{', начало)
  let глубина = 0
  for (let i = открывающая; i < до; i += 1) {
    if (css[i] === '{') глубина += 1
    if (css[i] === '}') {
      глубина -= 1
      if (глубина === 0) return css.slice(открывающая + 1, i)
    }
  }
  throw new Error('объявление :root не закрыто')
}

/** Готовая страница снимка: разметка состояния плюс вклеенная таблица стилей с пришпиленной темой. */
export function страница(имя: string, разметка: string, css: string, тёмная: boolean): string {
  const темы = величиныТемы(css)
  const схема = тёмная ? 'dark' : 'light'
  return (
    `<!doctype html><html lang="ru" style="color-scheme:${схема}"><head><meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${имя}</title>\n` +
    `<style>${css}\n:root{${тёмная ? темы.тёмная : темы.светлая}}</style></head>` +
    `<body>${разметка}</body></html>\n`
  )
}

/** Ширина, о которой сообщает сама страница. Спрашивается отдельным заходом браузера. */
function ширинаСтраницы(путь: string, ширина: number, высота: number): number {
  const проба = `${путь}.проба.html`
  const текст = readFileSync(путь, 'utf8').replace(
    '</body>',
    '<script>document.title=String(document.documentElement.clientWidth)</script></body>',
  )
  writeFileSync(проба, текст)
  try {
    const вывод = браузер(['--dump-dom', `--window-size=${ширина},${высота}`, `file://${проба}`])
    const найдено = /<title>(\d+)<\/title>/.exec(вывод)
    if (найдено === null) throw new Error(`браузер не сообщил ширину для ${путь}`)
    return Number(найдено[1])
  } finally {
    rmSync(проба, { force: true })
  }
}

/** Один заход браузера. Отказ браузера — отказ прогона: молча снимков не бывает. */
function браузер(доводы: string[]): string {
  const итог = spawnSync(
    БРАУЗЕР,
    ['--headless', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=2000', ...доводы],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  if (итог.error !== undefined) throw итог.error
  if (итог.status !== 0) {
    throw new Error(`браузер вернул ${итог.status}: ${(итог.stderr ?? '').slice(0, 400)}`)
  }
  return итог.stdout ?? ''
}

/** Хеш файла — им сравниваются светлая и тёмная страницы одного состояния. */
function хеш(текст: string): string {
  return createHash('sha256').update(текст).digest('hex').slice(0, 16)
}

/**
 * Собрать снимки.
 *
 * `куда` — каталог; `толькоПары` оставляет три картинки, по которым владелец сравнивает «до» и
 * «после», и две страницы, из которых они сняты.
 */
export function собратьСнимки({ куда, толькоПары = false }: { куда?: string; толькоПары?: boolean } = {}): {
  страницы: string[]
  картинки: string[]
} {
  const каталог = куда ?? СНИМКИ
  mkdirSync(каталог, { recursive: true })

  const css = readFileSync(СТИЛИ, 'utf8')
  const нужны = толькоПары
    ? new Set(КАРТИНКИ.filter((к) => ПАРЫ.has(к.файл)).map((к) => к.состояние))
    : new Set(СОСТОЯНИЯ.map((с) => с.имя))

  const страницы: string[] = []
  for (const состояние of СОСТОЯНИЯ) {
    if (!нужны.has(состояние.имя)) continue
    const разметка = renderToStaticMarkup(состояние.разметка)
    const хеши: string[] = []

    for (const тёмная of [false, true]) {
      const имяФайла = `${состояние.имя}${тёмная ? '-dark' : ''}.html`
      const путь = join(каталог, имяФайла)
      const было = existsSync(путь) ? видимыйТекст(readFileSync(путь, 'utf8')) : null

      const текст = страница(состояние.имя, разметка, css, тёмная)
      writeFileSync(путь, текст)
      хеши.push(хеш(текст))
      страницы.push(имяФайла)

      if (было !== null) сверитьТекст(имяФайла, было, видимыйТекст(текст))
    }

    сверитьТемы(состояние.имя, хеши[0], хеши[1])
  }

  const картинки: string[] = []
  for (const картинка of КАРТИНКИ) {
    if (толькоПары && !ПАРЫ.has(картинка.файл)) continue
    const страницаКартинки = join(каталог, `${картинка.состояние}${картинка.тёмная ? '-dark' : ''}.html`)

    сверитьШирину(картинка.файл, картинка.ширина, ширинаСтраницы(страницаКартинки, картинка.ширина, картинка.высота))

    браузер([
      `--screenshot=${join(каталог, картинка.файл)}`,
      `--window-size=${картинка.ширина},${картинка.высота}`,
      `file://${страницаКартинки}`,
    ])
    картинки.push(картинка.файл)
  }

  return { страницы, картинки }
}
