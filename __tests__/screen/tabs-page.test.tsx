import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, test, vi } from 'vitest'

import { начеканить } from '@/lib/auth/session'
import { ПЕРЕПИСЬ } from './fixture.ts'

/**
 * Вкладки на странице — кусок S11, шаг вкладок (задача В-1).
 *
 * Подставлены запрос (cookie), отчёт и работа кнопки — тем же приёмом, что у сторожей S6. Страница,
 * сторож и действие настоящие: проверяется, что вкладка берётся из адреса, что адрес без вкладки —
 * «Главное», что незнакомая вкладка — отказ словами со ссылками, и что кнопка не уводит со страницы.
 * Отчёт — раскладка переписи: в ней есть поля всех блоков, и каждый раздел узнаётся по заголовку.
 */

const СЕКРЕТ = 'не-настоящий-секрет-подписи-для-проверок-0123456789'
process.env.NORDIC_PET_SESSION_SECRET = СЕКРЕТ

let cookieЗапроса: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (имя: string) =>
      имя === 'nordic_pet_session' && cookieЗапроса !== undefined
        ? { name: имя, value: cookieЗапроса }
        : undefined,
  }),
}))

const monthlyReport = vi.fn(async (_месяц?: string) => ПЕРЕПИСЬ)
vi.mock('@/lib/metrics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/metrics/report')>()),
  monthlyReport: (месяц?: string) => monthlyReport(месяц),
}))

const refreshEverything = vi.fn(async () => ({ ok: true }))
vi.mock('@/lib/metrics/refresh', () => ({ refreshEverything: () => refreshEverything() }))

const revalidatePath = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath }))

const { default: HomePage } = await import('@/app/page')
const { refreshAction } = await import('@/app/refresh-action')

beforeEach(() => {
  cookieЗапроса = начеканить(Date.now(), СЕКРЕТ).value
  monthlyReport.mockClear()
  refreshEverything.mockClear()
  revalidatePath.mockClear()
})

async function страница(адрес: { m?: string | string[]; tab?: string | string[] }): Promise<string> {
  return renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve(адрес) }))
}

/** Заголовки разделов на странице, по порядку. Полоса показателей заголовка не несёт — её имя в подписи. */
function разделы(html: string): string[] {
  return [
    ...(html.includes('class="block kpis"') ? ['Показатели месяца'] : []),
    ...[...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map((м) => м[1]),
  ]
}

test('вкладка из адреса определяет, какие разделы на экране', async () => {
  expect(разделы(await страница({ tab: 'dengi' }))).toEqual(['Выручка', 'Затраты', 'Итог', 'Окупаемость рекламы'])
  expect(разделы(await страница({ tab: 'tovary' }))).toEqual(['Товары'])
  expect(разделы(await страница({ tab: 'kachestvo' }))).toEqual(['Честность данных', 'Неполнота данных'])
  expect(разделы(await страница({ tab: 'glavnoe' }))).toEqual([
    'Показатели месяца',
    'Куда ушли деньги',
    'Чистая выручка по дням',
  ])
})

test('адрес без вкладки — первая вкладка, и только она', async () => {
  const html = await страница({})
  expect(разделы(html)).toEqual(['Показатели месяца', 'Куда ушли деньги', 'Чистая выручка по дням'])
  expect(html).toContain('<a href="/?m=2026-03&amp;tab=glavnoe" aria-current="page">Главное</a>')
})

test('из двух значений вкладки берётся первое, как у месяца', async () => {
  expect(разделы(await страница({ tab: ['tovary', 'dengi'] }))).toEqual(['Товары'])
})

test('неизвестная вкладка — отказ словами, а не первая вкладка', async () => {
  const html = await страница({ tab: 'boom' })
  expect(html).toContain('<p role="alert">Раздела «boom» в отчёте нет. Выберите один из разделов:</p>')
  expect(разделы(html)).toEqual([])
  expect(monthlyReport, 'отказ — до похода в базу').not.toHaveBeenCalled()
})

test('отказ на незнакомую вкладку называет разделы ссылками, и первая — «Главное»', async () => {
  const сМесяцем = await страница({ m: '2026-03', tab: 'boom' })
  const ссылки = [...сМесяцем.matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((м) => [м[1], м[2]])
  expect(ссылки).toEqual([
    ['/?m=2026-03&amp;tab=glavnoe', 'Главное'],
    ['/?m=2026-03&amp;tab=dengi', 'Деньги'],
    ['/?m=2026-03&amp;tab=tovary', 'Товары'],
    ['/?m=2026-03&amp;tab=kachestvo', 'Качество данных'],
  ])
  expect(сМесяцем, 'текущей вкладки на отказе нет').not.toContain('aria-current')
  expect(сМесяцем, 'кнопка выхода на месте').toContain('Выйти')
  // Кривой месяц в ссылки не переносится: ссылка вела бы на второй отказ.
  expect(await страница({ m: 'boom', tab: 'boom' })).toContain('<a href="/?tab=glavnoe">Главное</a>')
})

test('после «Обновить данные» действие не уводит со страницы', async () => {
  // Уйти со вкладки можно, только если действие уведёт страницу само — переходом после работы. Что
  // Next при перерисовке сохраняет адрес вместе с вкладкой — его поведение, а не наш код: оно
  // наблюдается живым проходом по четырём вкладкам (задача 18).
  await expect(refreshAction()).resolves.toEqual({ ok: true })
  expect(revalidatePath.mock.calls).toEqual([['/']])
})
