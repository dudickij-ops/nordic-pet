'use server'

import { refreshEverything, type RefreshOutcome } from '@/lib/metrics/refresh'

/**
 * Серверное действие кнопки «Обновить данные» — задача 8.
 *
 * Тонкая обёртка: вся работа в `refreshEverything()`, боевым путём (без единой
 * подставки) — теми же тремя работами, что уже доказаны на командах `ingest:sheets`,
 * `ingest:ads` и `facts` из `lib/commands.ts`.
 *
 * Действие зовётся и напрямую (проверка «кнопка стучится только в Google» вызывает его
 * без единого довода), и как `action` формы в `useActionState`: React подставляет туда
 * `(previousState, formData)`, которые здесь не объявлены и просто отбрасываются.
 */
export async function refreshAction(): Promise<RefreshOutcome> {
  return refreshEverything()
}
