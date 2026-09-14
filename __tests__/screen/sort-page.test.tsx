import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, test, vi } from 'vitest'

import { начеканить } from '@/lib/auth/session'
import { ПЕРЕПИСЬ } from './fixture.ts'

/**
 * Порядок таблицы товаров на странице — кусок S12, задача 1, круг проверки кода 1.
 *
 * **Зачем этот файл, когда есть проверки разметки.** Рецензент показал прогоном: отключение отказа
 * на незнакомый порядок не красило ни одной проверки из девятисот с лишним. Проверки разметки
 * рисуют `Dashboard` напрямую и маршрута не касаются вовсе, а весь разбор адреса живёт на
 * странице. Поэтому здесь ходят через настоящую `HomePage` — тем же приёмом, что у вкладок.
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

const monthlyReport = vi.fn(async (_месяц?: string, _зависимости?: unknown, _порядок?: string) => ПЕРЕПИСЬ)
vi.mock('@/lib/metrics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/metrics/report')>()),
  monthlyReport: (месяц?: string, зависимости?: unknown, порядок?: string) =>
    monthlyReport(месяц, зависимости, порядок),
}))

vi.mock('@/lib/metrics/refresh', () => ({ refreshEverything: async () => ({ ok: true }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { default: HomePage } = await import('@/app/page')

beforeEach(() => {
  cookieЗапроса = начеканить(Date.now(), СЕКРЕТ).value
  monthlyReport.mockClear()
})

async function страница(адрес: {
  m?: string | string[]
  tab?: string | string[]
  sort?: string | string[]
}): Promise<string> {
  return renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve(адрес) }))
}

/** Какой порядок ушёл в слой метрик последним вызовом. */
const порядокВызова = () => monthlyReport.mock.calls.at(-1)?.[2]

test('порядок из адреса доезжает до слоя метрик', async () => {
  await страница({ tab: 'tovary', sort: 'cogs-asc' })
  expect(порядокВызова()).toBe('cogs-asc')
})

test('адрес без порядка — прибыль по убыванию', async () => {
  await страница({ tab: 'tovary' })
  expect(порядокВызова()).toBe('profit-desc')
})

test('из двух значений порядка берётся первое, как у месяца и вкладки', async () => {
  await страница({ tab: 'tovary', sort: ['net-asc', 'cogs-desc'] })
  expect(порядокВызова()).toBe('net-asc')
})

test('незнакомый порядок — отказ словами, а не молчаливое умолчание', async () => {
  const html = await страница({ m: '2026-03', tab: 'tovary', sort: 'по-цвету' })
  expect(html).toContain(
    '<p role="alert">Порядка «по-цвету» у таблицы товаров нет. Выберите один из порядков:</p>',
  )
  expect(html, 'таблицы на отказе нет').not.toContain('<h2>Товары</h2>')
  expect(monthlyReport, 'отказ — до похода в базу').not.toHaveBeenCalled()
})

test('отказ называет все шесть порядков ссылками и сохраняет месяц', async () => {
  const html = await страница({ m: '2026-03', tab: 'tovary', sort: 'по-цвету' })
  const ссылки = [...html.matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((м) => м[1])
  expect(ссылки).toEqual([
    '/?m=2026-03&amp;tab=tovary',
    '/?m=2026-03&amp;tab=tovary&amp;sort=profit-asc',
    '/?m=2026-03&amp;tab=tovary&amp;sort=net-desc',
    '/?m=2026-03&amp;tab=tovary&amp;sort=net-asc',
    '/?m=2026-03&amp;tab=tovary&amp;sort=cogs-desc',
    '/?m=2026-03&amp;tab=tovary&amp;sort=cogs-asc',
  ])
})

test('утверждение над таблицей говорит, что счёт идёт по прибыли, когда порядок другой', async () => {
  const поУмолчанию = await страница({ tab: 'tovary' })
  expect(поУмолчанию).toContain('80 % прибыли товаров дают 2 из 2 артикулов;')
  expect(поУмолчанию).not.toContain('считая по убыванию прибыли')

  const поСебестоимости = await страница({ tab: 'tovary', sort: 'cogs-asc' })
  expect(поСебестоимости).toContain(
    '80 % прибыли товаров дают 2 из 2 артикулов — считая по убыванию прибыли, а таблица сейчас упорядочена иначе;',
  )
})
