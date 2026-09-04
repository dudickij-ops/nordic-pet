import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'

import type { MonthReport } from '@/lib/metrics/report'

/**
 * Пометка устаревания при холодном открытии — задача 5 куска S8, сторона экрана.
 *
 * Прежде пометка приходила только от неудачного нажатия кнопки, то есть только тому, кто
 * нажимал. Человек, открывший страницу заново, видел устаревшие числа молча.
 */

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ name: 'nordic_pet_session', value: 'что-то' }) }),
}))
vi.mock('@/lib/auth/guard', () => ({ проверитьДоступ: async () => 'пускать' }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

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

let устарели = false
vi.mock('@/lib/metrics/report', async (настоящий) => {
  const модуль = await настоящий<typeof import('@/lib/metrics/report')>()
  return { ...модуль, monthlyReport: async () => ({ ...ОТЧЁТ, устарели }) }
})

const { default: HomePage } = await import('@/app/page')

async function разметка(): Promise<string> {
  return renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({ m: '2026-03' }) }))
}

test('сырьё новее фактов — на экране пометка, и она говорит, что нажать', async () => {
  устарели = true
  const html = await разметка()
  expect(html).toMatch(/отстали от источников/i)
  expect(html).toMatch(/Обновить данные/)
})

test('свежие числа пометки не несут', async () => {
  устарели = false
  const html = await разметка()
  expect(html).not.toMatch(/отстали от источников/i)
})
