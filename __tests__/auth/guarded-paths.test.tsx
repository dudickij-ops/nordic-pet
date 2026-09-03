import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, test, vi } from 'vitest'

import type { MonthReport } from '@/lib/metrics/report'
import { начеканить } from '@/lib/auth/session'

/**
 * Сторожа на путях — задача 4 куска S6.
 *
 * Здесь подставляется **запрос**: `next/headers` изображает то, что приносит браузер, а
 * сторож, страница и действие настоящие. Числа и работа подставлены тоже — эта проверка не
 * про счёт и не про загрузку, а про то, кого до них допускают.
 *
 * Имя cookie в подставке написано строкой нарочно: подставки `vi.mock` поднимаются наверх
 * файла, раньше любых ввозов, и обращение к ввезённой величине изнутри такой подставки
 * читается до её появления. Что имя то самое, сторожит `session.test.ts`.
 */

const СЕКРЕТ = 'не-настоящий-секрет-подписи-для-проверок-0123456789'
process.env.NORDIC_PET_SESSION_SECRET = СЕКРЕТ

/** Что сейчас приносит браузер. `undefined` — не приносит ничего. */
let cookieЗапроса: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (имя: string) =>
      имя === 'nordic_pet_session' && cookieЗапроса !== undefined
        ? { name: имя, value: cookieЗапроса }
        : undefined,
  }),
}))

const ОТЧЁТ: MonthReport = {
  target: 'проверка',
  month: '2026-03',
  months: [{ month: '2026-03', hasOrders: true }],
  revenue: { gross: '100.00', discounts: '0.00', refunds: '0.00', net: '100.00' },
  costs: { cogs: '40.00', ads: '0.00', fees: '0.00', fixed: '0.00' },
  bottom: { profit: '60.00', marginPct: null, roasByGross: null },
  items: [{ sku: 'NP-СТОРОЖ', units: '1', net: '100.00', cogs: '40.00', profit: '60.00' }],
  honesty: { sharePct: null, skusWithoutPrice: [] },
  gaps: [],
}

const monthlyReport = vi.fn(async (_месяц?: string) => ОТЧЁТ)
vi.mock('@/lib/metrics/report', () => ({ monthlyReport: (месяц?: string) => monthlyReport(месяц) }))

const refreshEverything = vi.fn(async () => ({ ok: true }))
vi.mock('@/lib/metrics/refresh', () => ({ refreshEverything: () => refreshEverything() }))

const revalidatePath = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath }))

const { default: HomePage } = await import('@/app/page')
const { refreshAction } = await import('@/app/refresh-action')

/** Переход, которым Next уводит на вход, приезжает брошенным значением с меткой. */
function этоПереходНаВход(отказ: unknown): boolean {
  const метка = (отказ as { digest?: unknown }).digest
  return typeof метка === 'string' && метка.includes('NEXT_REDIRECT') && метка.includes('/login')
}

beforeEach(() => {
  cookieЗапроса = undefined
  monthlyReport.mockClear()
  monthlyReport.mockImplementation(async (_месяц?: string) => ОТЧЁТ)
  refreshEverything.mockClear()
  revalidatePath.mockClear()
})

test('страница отчёта уводит на вход, а не рисует отчёт', async () => {
  await expect(HomePage({ searchParams: Promise.resolve({}) })).rejects.toSatisfy(этоПереходНаВход)

  expect(monthlyReport, 'не вошедший не должен стоить нам ни одного запроса в базу').not.toHaveBeenCalled()
})

test('страница отчёта с годной cookie печатает числа', async () => {
  cookieЗапроса = начеканить(Date.now(), СЕКРЕТ).value

  const html = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({}) }))

  expect(html).toContain('NP-СТОРОЖ')
  expect(html).toContain('100,00')
})

test('просроченная cookie на страницу отчёта не пускает', async () => {
  cookieЗапроса = начеканить(Date.now() - 13 * 60 * 60 * 1000, СЕКРЕТ).value

  await expect(HomePage({ searchParams: Promise.resolve({}) })).rejects.toSatisfy(этоПереходНаВход)
})

test('действие кнопки в запросе без cookie в базу не идёт', async () => {
  await expect(refreshAction()).rejects.toSatisfy(этоПереходНаВход)

  expect(refreshEverything, 'без входа кнопка не пишет ни строки').not.toHaveBeenCalled()
})

test('действие кнопки с годной cookie работу делает', async () => {
  cookieЗапроса = начеканить(Date.now(), СЕКРЕТ).value

  await expect(refreshAction()).resolves.toEqual({ ok: true })
  expect(refreshEverything).toHaveBeenCalledTimes(1)
})

test('отказ базы летит наружу, а не показывается страницей с кодом «всё хорошо»', async () => {
  cookieЗапроса = начеканить(Date.now(), СЕКРЕТ).value
  monthlyReport.mockImplementation(async (_месяц?: string) => {
    throw new Error('соединение с базой не открылось')
  })

  // Месяц правильной формы: значит отказ пришёл не от разбора адреса, а от работы, и
  // показывать его страницей — значит соврать посетителю кодом ответа «всё хорошо».
  await expect(HomePage({ searchParams: Promise.resolve({ m: '2026-03' }) })).rejects.toThrow(
    'соединение с базой не открылось',
  )
  await expect(HomePage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
    'соединение с базой не открылось',
  )
})

test('кривая форма месяца по-прежнему показывается текстом, а не падением', async () => {
  cookieЗапроса = начеканить(Date.now(), СЕКРЕТ).value
  monthlyReport.mockImplementation(async (_месяц?: string) => {
    throw new Error('месяц обязан быть в форме ГГГГ-ММ (пример: «2026-03»), а пришло «boom»')
  })

  const html = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({ m: 'boom' }) }))

  expect(html).toMatch(/форме ГГГГ-ММ/)
})
