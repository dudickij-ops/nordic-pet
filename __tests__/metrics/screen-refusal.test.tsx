import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'

import type { MonthReport } from '@/lib/metrics/report'

/**
 * Свой вид у отказа отчёта — задача 4 куска S8, сторона экрана.
 *
 * Подставляется отчёт: эта проверка про то, что страница делает с отказом, а не про то, откуда
 * отказ взялся. Что отказ настоящего отчёта называет свой вид и не несёт адреса базы, сторожит
 * `report-refusal.test.ts`.
 */

const АДРЕС_БАЗЫ = 'postgresql://пользователь-базы:пароль@внутренний-хост.example:5432/nordic_pet'

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ name: 'nordic_pet_session', value: 'что-то' }) }),
}))
vi.mock('@/lib/auth/guard', () => ({ проверитьДоступ: async () => 'пускать' }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const отчёт = vi.fn<(месяц?: string) => Promise<MonthReport>>()
vi.mock('@/lib/metrics/report', async (настоящий) => {
  const модуль = await настоящий<typeof import('@/lib/metrics/report')>()
  return { ...модуль, monthlyReport: (месяц?: string) => отчёт(месяц) }
})

const { ОтказОтчёта } = await import('@/lib/metrics/report')
const { default: HomePage } = await import('@/app/page')

test('сбой базы даёт нашу страницу, а не страницу ошибки хостинга', async () => {
  отчёт.mockImplementation(async () => {
    throw new ОтказОтчёта('данные не читаются', 'Данные сейчас не читаются: база не ответила.')
  })

  const разметка = renderToStaticMarkup(
    await HomePage({ searchParams: Promise.resolve({ m: '2026-03' }) }),
  )

  expect(разметка).toMatch(/не читаются/)
  expect(разметка, 'на странице отказа человеку оставлен выход').toContain('Выйти')
})

test('в разметке страницы отказа нет ни адреса базы, ни имени пользователя базы', async () => {
  // Сообщение отказа несёт подлинную причину вместе с адресом базы — так его и составляет
  // слой метрик. Прежде здесь стояло безобидное сообщение, и проверка была вхолостую: печатать
  // на экран было нечего, и слом «печатать сообщение как есть» оставался зелёным.
  отчёт.mockImplementation(async () => {
    throw new ОтказОтчёта(
      'данные не читаются',
      `не удалось соединиться: ${АДРЕС_БАЗЫ}`,
      new Error(`не удалось соединиться: ${АДРЕС_БАЗЫ}`),
    )
  })

  const разметка = renderToStaticMarkup(
    await HomePage({ searchParams: Promise.resolve({ m: '2026-03' }) }),
  )

  expect(разметка).not.toContain('внутренний-хост.example')
  expect(разметка).not.toContain('пользователь-базы')
  expect(разметка).not.toContain('postgresql://')
})
