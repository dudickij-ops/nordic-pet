'use server'

import { revalidatePath } from 'next/cache'

import { refreshEverything, type RefreshOutcome } from '@/lib/metrics/refresh'

/**
 * Серверное действие кнопки «Обновить данные» — задача 8, дефект приёмки (щель после
 * задачи 8): нажатие писало в базу, но экран оставался прежним до перезагрузки страницы.
 *
 * Тонкая обёртка: вся работа в `refreshEverything()`, боевым путём (без единой
 * подставки) — теми же тремя работами, что уже доказаны на командах `ingest:sheets`,
 * `ingest:ads` и `facts` из `lib/commands.ts`.
 *
 * Действие зовётся и напрямую (проверка «кнопка стучится только в Google» вызывает его
 * без единого довода), и как `action` формы в `useActionState`: React подставляет туда
 * `(previousState, formData)`, которые здесь не объявлены и просто отбрасываются.
 *
 * `revalidatePath('/')` зовётся после попытки **всегда**, независимо от исхода: разметка
 * отчёта приходит панели детьми и отрисована один раз серверным рендером — сама она не
 * пересчитывается, и без ревалидации новые числа появлялись только после ручной
 * перезагрузки страницы. При удаче ревалидация приносит на экран новые числа; при отказе
 * — те же прежние числа, но уже с пометкой устаревания, которую несёт сам `RefreshOutcome`
 * (`stale`) и рисует `RefreshView`. `try/finally` — чтобы вызов дошёл и в том редком
 * случае, когда `refreshEverything()` не вернула исход, а бросила ошибку устройства
 * (имя команды не нашлось в списке, см. `lib/metrics/refresh.ts`).
 */
export async function refreshAction(): Promise<RefreshOutcome> {
  try {
    return await refreshEverything()
  } finally {
    revalidateAfterAttempt()
  }
}

/**
 * `revalidatePath` работает только внутри настоящего запроса Next — так и написано в
 * официальной документации («revalidatePath can be called in Server Functions and Route
 * Handlers», nextjs.org/docs/app/api-reference/functions/revalidatePath, раздел «Usage»).
 * Вне запроса Next бросает собственную ошибку устройства «Invariant: static generation
 * store missing» (код `E263`, видно в исходнике самого пакета —
 * `node_modules/next/dist/server/web/spec-extension/revalidate.js`; отдельной страницы
 * документации на эту ошибку нет, это подтверждено чтением исходника, а не догадкой).
 *
 * Действие зовётся и напрямую, без запроса Next — так делает принятая проверка «кнопка
 * стучится только в Google» (`__tests__/metrics/refresh.test.tsx`), которую эта задача не
 * открывает и не правит. Гасим ровно эту одну ошибку устройства: она возможна только вне
 * запроса, а в бою у настоящего нажатия кнопки запрос есть всегда, и эта ветка не сработает
 * никогда. Любая другая ошибка `revalidatePath` (неверный путь, вызов во время рендера и
 * так далее) — настоящая, и летит наружу как обычно.
 */
function revalidateAfterAttempt(): void {
  try {
    revalidatePath('/')
  } catch (error) {
    const внеЗапроса =
      error instanceof Error && error.message.startsWith('Invariant: static generation store missing')
    if (!внеЗапроса) throw error
  }
}
