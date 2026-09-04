import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { NextRequest } from 'next/server'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { начеканить, SESSION_COOKIE } from '@/lib/auth/session'
import { config, ИСКЛЮЧЕНИЯ, proxy } from '@/proxy'

/**
 * Первый слой закрытия — задача 3 куска S6.
 *
 * Устройство здесь не «закрываем перечисленные пути», а «закрыто всё, кроме перечисленных
 * исключений». Разница вся в том, что случится с путём, который заведут завтра: в первом
 * случае он открыт по забывчивости, во втором — закрыт, пока кто-то сознательно не впишет
 * его в список. Поэтому и проверка ниже читает список путей приложения **с диска**, а не
 * из руками написанного перечня: путь, заведённый завтра, попадёт в неё сам.
 */

const СЕКРЕТ = 'не-настоящий-секрет-подписи-для-проверок-0123456789'
const ЧАС = 60 * 60 * 1000
const прежнийСекрет = process.env.NORDIC_PET_SESSION_SECRET

beforeAll(() => {
  process.env.NORDIC_PET_SESSION_SECRET = СЕКРЕТ
})

afterAll(() => {
  if (прежнийСекрет === undefined) delete process.env.NORDIC_PET_SESSION_SECRET
  else process.env.NORDIC_PET_SESSION_SECRET = прежнийСекрет
})

const ГОДНАЯ = () => начеканить(Date.now(), СЕКРЕТ).value

function запрос(путь: string, cookie?: string, метод = 'GET'): NextRequest {
  const заявка = new NextRequest(new URL(`https://пример.invalid${путь}`), { method: метод })
  if (cookie !== undefined) заявка.cookies.set(SESSION_COOKIE, cookie)
  return заявка
}

/** Куда увёл первый слой; `null` — значит пропустил дальше. */
function куда(путь: string, cookie?: string, метод = 'GET'): string | null {
  return proxy(запрос(путь, cookie, метод)).headers.get('location')
}

/**
 * Пути приложения, прочитанные с диска: каждый каталог с `page` или `route` — это адрес.
 * Скобочные группы адреса не образуют и потому отбрасываются.
 */
function путиПриложения(корень = 'app', префикс = ''): string[] {
  const пути: string[] = []
  for (const запись of readdirSync(корень, { withFileTypes: true })) {
    if (запись.isDirectory()) {
      const кусок = запись.name.startsWith('(') && запись.name.endsWith(')') ? '' : `/${запись.name}`
      пути.push(...путиПриложения(join(корень, запись.name), префикс + кусок))
    } else if (/^(page|route)\.(tsx?|jsx?)$/.test(запись.name)) {
      пути.push(префикс === '' ? '/' : префикс)
    }
  }
  return [...new Set(пути)]
}

test('страница отчёта без cookie не отдаёт чисел', () => {
  expect(куда('/')).toContain('/login')
  expect(куда('/?m=2026-03')).toContain('/login')
  expect(proxy(запрос('/')).status, 'разворот, а не страница').toBe(307)
  expect(куда('/', ГОДНАЯ()), 'с годной cookie отчёт открывается').toBeNull()
})

test('действие кнопки без cookie отказывает и работы не делает', () => {
  // Серверное действие — это POST на тот путь, где оно живёт: «Server Functions are not
  // separate routes… they are handled as POST requests to the route where they are used»
  // (nextjs.org/docs/app/api-reference/file-conventions/proxy, «Execution order»). Значит
  // первый слой обязан развернуть и его — до того, как что-нибудь будет записано.
  expect(куда('/', undefined, 'POST')).toContain('/login')
  expect(куда('/login', undefined, 'POST'), 'войти можно без cookie, иначе войти нельзя вовсе').toBeNull()
})

test('новый путь без записи в исключениях требует входа', () => {
  for (const путь of [
    '/завтрашний-путь',
    '/api/числа',
    '/health/подробности',
    '/health-и-ещё',
    '/login/что-то',
    '/отчёт/2026-03',
  ])
    expect(куда(путь), путь).toContain('/login')
})

test('список исключений ровно из одной строки, и она та самая', () => {
  expect([...ИСКЛЮЧЕНИЯ]).toEqual(['/health'])
})

test('/health открыта без cookie', () => {
  expect(куда('/health')).toBeNull()
})

test('чужая, просроченная и порченая cookie ко входу не пускают', () => {
  const годная = ГОДНАЯ()
  const подделанная = годная.slice(0, -1) + (годная.endsWith('a') ? 'b' : 'a')

  expect(куда('/', подделанная), 'подделанная подпись').toContain('/login')
  expect(куда('/', начеканить(Date.now() - 13 * ЧАС, СЕКРЕТ).value), 'просроченная').toContain('/login')
  expect(куда('/', 'совсем-не-cookie'), 'порченая').toContain('/login')
  expect(куда('/', ''), 'пустая').toContain('/login')
})

test('без секрета подписи закрыто всё, кроме исключений', () => {
  delete process.env.NORDIC_PET_SESSION_SECRET
  try {
    expect(куда('/', ГОДНАЯ()), 'проверить подпись нечем — значит не пускаем').toContain('/login')
    expect(куда('/health'), 'открытое остаётся открытым: оно не зависит от подписи').toBeNull()
  } finally {
    process.env.NORDIC_PET_SESSION_SECRET = СЕКРЕТ
  }
})

/**
 * Образец путей `config.matcher` — единственная часть первого слоя, которой не видит ни одна
 * проверка выше: все они зовут `proxy(запрос)` напрямую и потому доказывают лишь то, как слой
 * решает, будучи позван. Кого звать — решает образец, и решает он это до всякого нашего кода.
 * Опечатка в нём — скажем, `_next` вместо `_next/static` — молча выведет из-под закрытия всё,
 * что начинается на `_next`, включая обращения за данными маршрутов, а набор останется
 * зелёным: слой на месте, просто его перестали звать.
 *
 * Сторожится смысл, а не написание. Сравнение строки образца с литералом сказало бы только,
 * что строку не меняли, и ничего — о том, какие пути она накрывает; переписанный иначе, но
 * равный по смыслу образец краснел бы зря, а расширенное исключение внутри той же строки
 * прошло бы незамеченным. Поэтому из образца собирается регулярное выражение и по нему
 * прогоняется таблица путей: заведомо закрытых и заведомо выведенных.
 */
test('образец путей зовёт первый слой на всё, кроме сборочной выдачи', () => {
  const образцы = config.matcher.map((строка) => new RegExp(`^${строка}$`))
  const накрыт = (путь: string) => образцы.some((образец) => образец.test(путь))

  for (const путь of [
    '/',
    '/login',
    '/health',
    '/api/числа',
    '/завтрашний-путь',
    // Обращение за данными маршрута отдаёт содержимое страницы в обход разметки. Выведи его
    // из-под слоя — и числа отчёта уедут постороннему, ни одного экрана не открывшему. Именно
    // эта строка краснеет, если выведенное расширят с `_next/static` до `_next`.
    '/_next/data/build/страница.json',
  ])
    expect(накрыт(путь), `путь ${путь} обязан попадать под первый слой`).toBe(true)

  for (const путь of ['/_next/static/chunks/main.js', '/_next/image', '/favicon.ico'])
    expect(накрыт(путь), `путь ${путь} — сборочная выдача, звать на неё слой незачем`).toBe(false)
})

test('каждый путь приложения либо в исключениях, либо закрыт', () => {
  const пути = путиПриложения()

  expect(пути, 'страница отчёта обязана быть среди найденных — иначе проверка ничего не читает').toContain('/')
  expect(пути).toContain('/health')
  expect(пути).toContain('/login')

  for (const путь of пути) {
    if ((ИСКЛЮЧЕНИЯ as readonly string[]).includes(путь) || путь === '/login') continue
    expect(куда(путь), `путь ${путь} не в исключениях, значит обязан требовать входа`).toContain(
      '/login',
    )
  }
})
