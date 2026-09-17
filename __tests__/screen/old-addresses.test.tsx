import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, test, vi } from 'vitest'

import { начеканить } from '@/lib/auth/session'
import { ПЕРЕПИСЬ } from './fixture.ts'

/**
 * Старые адреса — кусок S13, решение владельца Э2 (отменяет решения S11 В2–В4). Закладки со вкладкой
 * (`?tab=`) и порядком товаров (`?sort=`) открывают тот же единственный экран, а не отказ и не ошибку.
 *
 * Подставки — запрос (cookie), отчёт, кнопка и переход — перенесены без изменений из удалённой проверки
 * вкладок на странице (`__tests__/screen/tabs-page.test.tsx`). Секрет подписи заведомо ненастоящий.
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

/**
 * Круг проверки кода 3. Утверждение «действие не уводит со страницы» держалось на том, что вызов
 * не бросил исключения, — то есть краснело на любой ошибке, а не на уходе. Уйти со страницы
 * действие может ровно одним способом — переходом, и теперь он под наблюдением поимённо.
 * Настоящее поведение перехода сохранено: подставка записывает вызов и зовёт настоящий `redirect`,
 * который в Next останавливает работу броском.
 */
const переход = vi.fn()
vi.mock('next/navigation', async (importOriginal) => {
  const настоящий = await importOriginal<typeof import('next/navigation')>()
  return {
    ...настоящий,
    redirect: (путь: string) => {
      переход(путь)
      return настоящий.redirect(путь)
    },
  }
})

const { default: HomePage } = await import('@/app/page')
const { refreshAction } = await import('@/app/refresh-action')

beforeEach(() => {
  cookieЗапроса = начеканить(Date.now(), СЕКРЕТ).value
  monthlyReport.mockClear()
  refreshEverything.mockClear()
  revalidatePath.mockClear()
  переход.mockClear()
})

test('старые адреса со вкладкой и порядком открывают тот же единственный экран', async () => {
  cookieЗапроса = начеканить(Date.now(), СЕКРЕТ).value
  const обычный = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({ m: '2026-03' }) }))
  for (const хвост of [{ tab: 'dengi' }, { tab: 'boom' }, { sort: 'net-asc' }, { tab: 'tovary', sort: 'boom' }]) {
    const старый = renderToStaticMarkup(
      await HomePage({ searchParams: Promise.resolve({ m: '2026-03', ...хвост }) as Promise<{ m?: string }> }),
    )
    expect(старый).toBe(обычный)
    expect(старый).not.toContain('role="alert"')
  }
})

/**
 * Перенесена без изменения тела из удалённой проверки вкладок на странице (`tabs-page.test.tsx`), кусок S13,
 * задача 8: файл вкладок ушёл, а утверждение о кнопке к вкладкам не относится.
 */
test('после «Обновить данные» действие не уводит со страницы', async () => {
  // Уйти со страницы можно, только если действие уведёт её само — переходом после работы. Что
  // Next при перерисовке сохраняет адрес — его поведение, а не наш код: оно наблюдается живым
  // проходом (в S11 — по четырём вкладкам; с S13 вкладок нет, экран один).
  // Круг проверки кода 4. Порядок здесь — не вкусовщина: уход со страницы в Next это **бросок**,
  // поэтому ожидание исхода отклоняется раньше, чем дело дойдёт до строки про переход, и красное
  // снова приходит от «не бросило исключения». Исход забирается обеими руками, и первым
  // утверждается именно переход — тогда слом «дописать действию переход» красит свою строку.
  const исход = await refreshAction().then(
    (значение) => ({ вид: 'исход' as const, значение }),
    (ошибка) => ({ вид: 'бросок' as const, ошибка }),
  )
  expect(переход, 'действие не уводит со страницы: перехода не было').not.toHaveBeenCalled()
  expect(исход).toEqual({ вид: 'исход', значение: { ok: true } })
  expect(revalidatePath.mock.calls).toEqual([['/']])
})
