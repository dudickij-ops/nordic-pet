import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/**
 * Проверка дефекта приёмки: кнопка «Обновить данные» писала в базу, но экран оставался
 * прежним до ручной перезагрузки страницы — панель отрисована один раз серверным рендером
 * и сама не пересчитывается, а `app/refresh-action.ts` не звал `revalidatePath`.
 *
 * Что эта проверка видит и чего не видит. Она сторожит только шов: `refreshAction()`
 * обязана позвать `revalidatePath('/')` после попытки, удачной или отказной — обеими
 * подставками ниже. Она НЕ видит, что экран действительно перерисовался новыми числами:
 * это уже работа Next.js по кэшу маршрута, здесь не подставленному и не доказуемому без
 * настоящего браузера. Целое — «нажал кнопку, увидел новые числа без перезагрузки» —
 * проверяется только руками, во время приёмки, тем самым запуском, который и нашёл
 * дефект.
 *
 * `refreshEverything` подставлена, чтобы проверка не трогала ни базу, ни сеть: важен
 * только сам факт вызова `revalidatePath`, а не то, что вернула настоящая работа —
 * это уже доказано в `__tests__/metrics/refresh.test.tsx`.
 */

const revalidatePath = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath }))

const refreshEverything = vi.fn()
vi.mock('@/lib/metrics/refresh', () => ({ refreshEverything }))

const { refreshAction } = await import('@/app/refresh-action')

beforeEach(() => {
  revalidatePath.mockClear()
  refreshEverything.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

test('удачный исход: экран ревалидируется', async () => {
  refreshEverything.mockResolvedValue({ ok: true })
  const итог = await refreshAction()
  expect(итог).toEqual({ ok: true })
  expect(revalidatePath).toHaveBeenCalledWith('/')
  expect(revalidatePath).toHaveBeenCalledTimes(1)
})

test('отказной исход: экран тоже ревалидируется — числа устарели, но не остаются прежними на вид', async () => {
  const отказ = { ok: false as const, step: 'разбор' as const, text: 'бы', stale: true }
  refreshEverything.mockResolvedValue(отказ)
  const итог = await refreshAction()
  expect(итог).toEqual(отказ)
  expect(revalidatePath).toHaveBeenCalledWith('/')
  expect(revalidatePath).toHaveBeenCalledTimes(1)
})

test('ошибка устройства (не операционный отказ): ревалидация всё равно доходит', async () => {
  // refreshEverything() может не вернуть RefreshOutcome, а бросить — так падает, например,
  // отсутствие команды в списке (lib/metrics/refresh.ts). try/finally обязан довести
  // вызов revalidatePath и в этом случае.
  refreshEverything.mockRejectedValue(new Error('команды нет в списке'))
  await expect(refreshAction()).rejects.toThrow('команды нет в списке')
  expect(revalidatePath).toHaveBeenCalledWith('/')
  expect(revalidatePath).toHaveBeenCalledTimes(1)
})
