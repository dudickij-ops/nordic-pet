import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import { войти } from '@/lib/auth/login'
import { SESSION_COOKIE, проверить } from '@/lib/auth/session'
import { LoginView } from '@/app/login/form'

/**
 * Вход — задача 2 куска S6.
 *
 * Настоящее хранилище cookie (`cookies()` из `next/headers`) сюда не приходит: вне запроса
 * Next оно отказывает. Подставляется **оно**, а не сам вход: решения — сверять ли, что
 * записывать в cookie, что отвечать на неверный ввод — принимает настоящий код, а подставка
 * только записывает, что ему отдали. Шов между входом и настоящим хранилищем доказывается
 * проходом целиком снаружи (задача 8), и назван в теле pull request отдельной строкой.
 *
 * Логин, пароль и секрет — заведомо ненастоящие: настоящие придумывает владелец и кладёт в
 * переменные проекта.
 */

const СРЕДА = {
  NORDIC_PET_LOGIN: 'не-настоящий-логин',
  NORDIC_PET_PASSWORD: 'не-настоящий-пароль-для-проверок',
  NORDIC_PET_SESSION_SECRET: 'не-настоящий-секрет-подписи-для-проверок-0123456789',
}
const СЕЙЧАС = Date.UTC(2026, 8, 3, 12, 0, 0)
const ДВЕНАДЦАТЬ_ЧАСОВ = 12 * 60 * 60 * 1000

type Запись = { имя: string; значение: string; настройки: Record<string, unknown> }

function хранилище() {
  const записи: Запись[] = []
  return {
    записи,
    set: (имя: string, значение: string, настройки: Record<string, unknown>) => {
      записи.push({ имя, значение, настройки })
    },
  }
}

test('верный вход выдаёт годную подписанную cookie', () => {
  const где = хранилище()

  const исход = войти(СРЕДА.NORDIC_PET_LOGIN, СРЕДА.NORDIC_PET_PASSWORD, {
    env: СРЕДА,
    now: СЕЙЧАС,
    cookies: где,
  })

  expect(исход).toEqual({ ok: true })
  expect(где.записи).toHaveLength(1)
  expect(где.записи[0].имя).toBe(SESSION_COOKIE)
  expect(проверить(где.записи[0].значение, СРЕДА.NORDIC_PET_SESSION_SECRET, СЕЙЧАС)).toBe('годна')
})

test('cookie выдаётся с HttpOnly, Secure и SameSite', () => {
  const где = хранилище()

  войти(СРЕДА.NORDIC_PET_LOGIN, СРЕДА.NORDIC_PET_PASSWORD, {
    env: СРЕДА,
    now: СЕЙЧАС,
    cookies: где,
  })

  const { настройки } = где.записи[0]
  expect(настройки.httpOnly, 'без HttpOnly cookie прочитает сценарий на странице').toBe(true)
  expect(настройки.secure, 'без Secure cookie уедет по незашифрованному соединению').toBe(true)
  expect(настройки.sameSite, 'без SameSite её пошлёт за нас чужой сайт').toBe('lax')
  expect(настройки.path).toBe('/')
  expect(
    (настройки.expires as Date).getTime() - СЕЙЧАС,
    'срок жизни назначается явно: cookie без срока живёт до закрытия браузера, то есть неизвестно сколько',
  ).toBe(ДВЕНАДЦАТЬ_ЧАСОВ)
})

test('неверный вход отвечает одинаково на любой ввод', () => {
  const вводы = [
    ['чужой-логин', СРЕДА.NORDIC_PET_PASSWORD],
    [СРЕДА.NORDIC_PET_LOGIN, 'чужой-пароль'],
    ['чужой-логин', 'чужой-пароль'],
    ['', ''],
    [СРЕДА.NORDIC_PET_LOGIN, СРЕДА.NORDIC_PET_PASSWORD.slice(0, -1)],
  ]

  const исходы = вводы.map(([логин, пароль]) => {
    const где = хранилище()
    const исход = войти(логин, пароль, { env: СРЕДА, now: СЕЙЧАС, cookies: где })
    expect(где.записи, 'неверный вход cookie не выдаёт').toEqual([])
    return JSON.stringify(исход)
  })

  expect(
    new Set(исходы).size,
    'ответы обязаны совпасть до знака: иначе ответ подсказывает, что именно не совпало',
  ).toBe(1)
  expect(JSON.parse(исходы[0])).toEqual({ ok: false, text: 'Логин или пароль не подошли' })
})

test('отказ входа не называет ни пароля, ни секрета', () => {
  const где = хранилище()

  const исход = войти('чужой-логин', 'чужой-пароль', { env: СРЕДА, now: СЕЙЧАС, cookies: где })
  const наэкран = JSON.stringify(исход) + renderToStaticMarkup(<LoginView исход={исход} ждём={false} />)

  expect(наэкран).not.toContain(СРЕДА.NORDIC_PET_PASSWORD)
  expect(наэкран).not.toContain(СРЕДА.NORDIC_PET_SESSION_SECRET)
  expect(наэкран).not.toContain('чужой-пароль')
})

test('неназванные переменные входа — отказ, называющий, что сделать', () => {
  const где = хранилище()

  const исход = войти('кто-то', 'что-то', { env: {}, now: СЕЙЧАС, cookies: где })

  expect(исход.ok).toBe(false)
  const текст = (исход as { text: string }).text
  expect(текст).toContain('NORDIC_PET_LOGIN')
  expect(текст).toContain('NORDIC_PET_PASSWORD')
  expect(текст).toContain('NORDIC_PET_SESSION_SECRET')
  expect(текст, 'человек должен узнать, где эти переменные заводятся').toMatch(/Vercel/)
  expect(где.записи, 'ненастроенный вход не выдаёт cookie').toEqual([])
})

test('страница входа не показывает ни чисел отчёта, ни ссылок на него', () => {
  const html = renderToStaticMarkup(
    <LoginView исход={{ ok: false, text: 'Логин или пароль не подошли' }} ждём={false} />,
  )

  expect(html).toContain('Логин или пароль не подошли')
  for (const поле of ['Чистая выручка', 'Себестоимость', 'Реклама', 'Прибыль', 'Обновить данные'])
    expect(html, `на странице входа не место полю «${поле}»`).not.toContain(поле)
  expect(html, 'ссылки на отчёт со страницы входа не ведут').not.toMatch(/href="\/(\?|")/)
})
