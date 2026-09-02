'use client'

import { useActionState, type ReactNode } from 'react'

import type { RefreshOutcome } from '@/lib/metrics/refresh'
import { refreshAction } from './refresh-action'

/** До первого нажатия панель ничего не знает про отказ. */
const INITIAL: RefreshOutcome = { ok: true }

/**
 * Панель кнопки «Обновить данные» — задача 8.
 *
 * Оборачивает уже готовую разметку отчёта, которая приходит детьми: панель её не
 * пересчитывает и не перерисовывает — серверный рендер отчёта не дублируется, — только
 * решает, как показать отказ.
 *
 * Щель между загрузкой и разбором (контракт S5, «Кнопка „Обновить данные“ и щель между
 * загрузкой и разбором») исполняется здесь двумя вещами разом: текст называет шаг, что
 * случилось и что сделать, а при `stale: true` блок отчёта меняет вид — не только текст
 * под кнопкой. Без второго человек, увидевший прежние числа в прежнем виде, прочитал бы
 * отказ как «ничего не изменилось», а не как «числа устарели».
 */
export function RefreshPanel({ children }: { children: ReactNode }) {
  const [outcome, dispatch, pending] = useActionState(refreshAction, INITIAL)
  const stale = outcome.ok === false && outcome.stale

  return (
    <div>
      <form action={dispatch}>
        <button type="submit" disabled={pending}>
          Обновить данные
        </button>
      </form>

      {outcome.ok === false && (
        <p role="alert">
          Шаг «{outcome.step}»: {outcome.text}
        </p>
      )}

      <div
        data-stale={stale ? 'true' : 'false'}
        style={stale ? { opacity: 0.5, filter: 'grayscale(1)' } : undefined}
      >
        {stale && <p>Числа ниже устарели</p>}
        {children}
      </div>
    </div>
  )
}
