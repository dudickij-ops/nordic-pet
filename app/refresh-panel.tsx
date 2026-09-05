'use client'

import { useActionState, type ReactNode } from 'react'

import type { RefreshOutcome } from '@/lib/metrics/refresh'
import { refreshAction } from './refresh-action'

/** До первого нажатия панель ничего не знает про отказ. */
const INITIAL: RefreshOutcome = { ok: true }

/**
 * Вид панели кнопки «Обновить данные» — задача 8, круг правок 1.
 *
 * Чистый компонент без единого хука: `outcome` и `pending` приходят доводами, а не из
 * `useActionState`. Разделён так нарочно — ради проверки. Клиентский компонент на
 * `useActionState` в проверке без клиентского окружения не отрисовать, а первая редакция
 * держала на нём весь вид панели разом; в итоге половина требования контракта — пометка
 * устаревания — не была ничем сторожена: слом «заменить `stale` на постоянное `false»
 * проходил через `npm test` зелёным на всех проверках.
 *
 * Щель между загрузкой и разбором (контракт S5, «Кнопка „Обновить данные“ и щель между
 * загрузкой и разбором») исполняется здесь двумя вещами разом: текст называет шаг, что
 * случилось и что сделать, а при `stale: true` блок отчёта меняет вид — не только текст
 * под кнопкой. Без второго человек, увидевший прежние числа в прежнем виде, прочитал бы
 * отказ как «ничего не изменилось», а не как «числа устарели».
 *
 * Разметка отчёта приходит детьми: вид её не пересчитывает и не перерисовывает —
 * серверный рендер отчёта не дублируется.
 */
export function RefreshView({
  outcome,
  pending,
  children,
}: {
  outcome: RefreshOutcome
  pending: boolean
  children: ReactNode
}) {
  const stale = outcome.ok === false && outcome.stale

  return (
    <div className="panel">
      {/*
        Полоса действия — вид, кусок S9. Кнопка стоит в своей строке справа: она относится ко
        всему отчёту сразу, а не к какому-то одному его блоку, и потому живёт над ними всеми.
        Отступ строк ниже не тронут нарочно — их цитируют сломы прошлых кусков.
      */}
      <div className="actions">
        <button type="submit" disabled={pending} className="primary">
          Обновить данные
        </button>
      </div>

      {/*
        «Обновление уже идёт» — не отказ шага: ни один шаг не начался, и приписывать отказ
        шагу значило бы соврать о том, что случилось. Поэтому у этого исхода нет `step`, и
        текст показывается сам по себе (S8, задача 6).
      */}
      {outcome.ok === false && 'занято' in outcome && <p role="alert">{outcome.text}</p>}

      {outcome.ok === false && !('занято' in outcome) && (
        <p role="alert">
          Шаг «{outcome.step}»: {outcome.text}
        </p>
      )}

      {/*
        Гашение устаревших чисел переехало со встроенного стиля на класс — кусок S9. **Атрибут
        `data-stale` оставлен нарочно**: на нём держатся принятые проверки прошлого куска, и он
        же — единственный признак состояния, видимый снаружи разметки. У его удаления есть свой
        слом.
      */}
      <div data-stale={stale ? 'true' : 'false'} className={stale ? 'numbers stale' : 'numbers'}>
        {stale && <p className="stale-mark">Числа ниже устарели</p>}
        {children}
      </div>
    </div>
  )
}

/**
 * Панель кнопки «Обновить данные» — тонкая клиентская обёртка.
 *
 * Единственная её работа — достать `outcome` и `pending` из `useActionState` и отдать их
 * виду. Ни текста отказа, ни пометки устаревания она сама не решает — это дело `RefreshView`.
 */
export function RefreshPanel({ children }: { children: ReactNode }) {
  const [outcome, dispatch, pending] = useActionState(refreshAction, INITIAL)

  return (
    <form action={dispatch}>
      <RefreshView outcome={outcome} pending={pending}>
        {children}
      </RefreshView>
    </form>
  )
}
