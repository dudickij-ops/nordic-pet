import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'

import type { MonthReport } from '@/lib/metrics/report'

/**
 * Выход — задача 3 куска S8.
 *
 * Подставляется **запрос**: `next/headers` изображает браузер и записывает, что у него попросили
 * удалить. Само действие настоящее.
 *
 * Имя cookie в подставке написано строкой нарочно: подставки `vi.mock` поднимаются наверх файла,
 * раньше любых ввозов, и обращение к ввезённой величине изнутри такой подставки читается до её
 * появления. Что имя то самое, сторожит `session.test.ts`.
 */

const удалённые: string[] = []

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (имя: string) => (имя === 'nordic_pet_session' ? { name: имя, value: 'что-то' } : undefined),
    delete: (имя: string) => {
      удалённые.push(имя)
    },
  }),
}))

const ОТЧЁТ: MonthReport = {
  target: 'проверка',
  month: '2026-03',
  months: [{ month: '2026-03', hasOrders: true }],
  revenue: { gross: '100.00', discounts: '0.00', refunds: '0.00', net: '100.00' },
  costs: { cogs: '40.00', ads: '0.00', fees: '0.00', fixed: '0.00' },
  bottom: { profit: '60.00', marginPct: null, roasByGross: null },
  items: [],
  honesty: { sharePct: null, skusWithoutPrice: [] },
  gaps: [],
}

vi.mock('@/lib/metrics/report', () => ({ monthlyReport: async () => ОТЧЁТ }))
vi.mock('@/lib/auth/guard', () => ({ проверитьДоступ: async () => 'пускать' }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { logoutAction } = await import('@/app/logout-action')
const { default: HomePage } = await import('@/app/page')

/** Переход, которым Next уводит на вход, приезжает брошенным значением с меткой. */
function этоПереходНаВход(отказ: unknown): boolean {
  const метка = (отказ as { digest?: unknown }).digest
  return typeof метка === 'string' && метка.includes('/login')
}

/**
 * Наблюдается именно удаление cookie входа, а не «выход отработал»: подписанная cookie не
 * опирается на хранимое состояние, и заставить сервер перестать её принимать нечем. Выход
 * убирает её из браузера — это и есть всё, что он умеет, и это названо в теле pull request.
 */
test('выход удаляет именно cookie входа', async () => {
  удалённые.length = 0

  await expect(logoutAction()).rejects.toSatisfy(этоПереходНаВход)

  expect(удалённые).toEqual(['nordic_pet_session'])
})

test('выход уводит человека на страницу входа', async () => {
  удалённые.length = 0
  let ушёл = false
  try {
    await logoutAction()
  } catch (отказ) {
    ушёл = этоПереходНаВход(отказ)
  }
  expect(ушёл).toBe(true)
})

test('на странице отчёта есть кнопка выхода', async () => {
  const разметка = renderToStaticMarkup(
    await HomePage({ searchParams: Promise.resolve({ m: '2026-03' }) }),
  )
  expect(разметка).toContain('Выйти')
  expect(разметка, 'кнопка выхода — форма, а не ссылка: по ссылкам ходят предзагрузчики').toMatch(
    /<form[^>]*>\s*<button[^>]*type="submit"[^>]*>Выйти<\/button>/,
  )
})
