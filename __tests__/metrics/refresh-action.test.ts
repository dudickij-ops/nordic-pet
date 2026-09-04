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

/**
 * Обвязка S6, добавленная с разрешения владельца. Страница отчёта и серверное действие
 * кнопки закрыты сторожем доступа, а сторож читает cookie из запроса Next — вне запроса
 * чтение отказывает, и прямой вызов, каким он написан ниже, до работы бы не дошёл.
 *
 * Здесь изображается **запрос с годной cookie**: подставляется окружение вокруг вызова, а
 * не сам сторож — он остаётся настоящим и продолжает работать. Ни одно утверждение этого
 * файла не тронуто; что они уцелели, доказано прогоном прежних сломов S5 по именам —
 * вывод в теле pull request.
 *
 * Секрет и cookie заведомо ненастоящие: настоящие придумывает владелец и кладёт в
 * переменные проекта.
 */
const СЕКРЕТ_ПРОВЕРКИ = 'не-настоящий-секрет-подписи-для-проверок-0123456789'
process.env.NORDIC_PET_SESSION_SECRET = СЕКРЕТ_ПРОВЕРКИ

vi.mock('next/headers', () => ({
  cookies: async () => {
    // Ввоз внутри, а не наверху файла: подставки поднимаются выше любых ввозов, и величина
    // из тела файла на момент первого срабатывания подставки ещё не существует.
    const { начеканить, SESSION_COOKIE } = await import('@/lib/auth/session')
    const годная = начеканить(Date.now(), СЕКРЕТ_ПРОВЕРКИ).value
    return {
      get: (имя: string) => (имя === SESSION_COOKIE ? { name: имя, value: годная } : undefined),
    }
  },
}))


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
