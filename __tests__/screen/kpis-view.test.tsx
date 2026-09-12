import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import { Dashboard } from '@/app/page'
import type { MonthReport } from '@/lib/metrics/report'
import { ПЕРЕПИСЬ } from './fixture.ts'

/**
 * Вид полосы показателей — кусок S11, шаг 7.
 *
 * Разметка ничего не считает: значение, дельта со знаком и её смысл приходят готовыми. Главные
 * условия владельца: значение стоит всегда, пустой бывает только дельта — одной короткой строкой;
 * смысл дельты назван словом, а не только цветом.
 */

type Полоса = NonNullable<MonthReport['kpis']>

function сПолосой(полоса: Полоса | undefined): string {
  return renderToStaticMarkup(<Dashboard report={{ ...ПЕРЕПИСЬ, kpis: полоса }} />)
}

/** Кусок разметки полосы — чтобы слова соседних блоков не попадали в утверждения о ней. */
function блок(разметка: string): string {
  const начало = разметка.indexOf('<section class="block kpis"')
  expect(начало, 'полоса на странице').toBeGreaterThanOrEqual(0)
  return разметка.slice(начало, разметка.indexOf('</section>', начало))
}

function строкиДельт(разметка: string): string[] {
  return [...блок(разметка).matchAll(/<span class="kpi-delta">([^<]*)<\/span>/g)].map((м) => м[1])
}

const ПОЛОСА = ПЕРЕПИСЬ.kpis as Полоса

/** Базы нет: прошлый месяц без заказов, дельты пусты у всех разом — как решает SQL. */
const БЕЗ_БАЗЫ: Полоса = {
  ...ПОЛОСА,
  hasBase: false,
  items: ПОЛОСА.items.map((п) => ({ ...п, delta: null, verdict: null })),
}

test('полоса рисуется только тогда, когда в отчёте есть её поле', () => {
  expect(сПолосой(undefined)).not.toContain('kpi-list')
  expect(сПолосой(ПОЛОСА)).toContain('kpi-list')
})

test('нет базы для сравнения — значения четырёх показателей стоят числами, пуста только дельта', () => {
  const разметка = блок(сПолосой(БЕЗ_БАЗЫ))
  const значения = [...разметка.matchAll(/<span class="kpi-value">([^<]*)<\/span>/g)].map((м) => м[1])
  expect(значения).toEqual(['2\u00A0323,23 €', '34,5 %', '2\u00A0424,24 €', '25,6 %'])
  expect(строкиДельт(сПолосой(БЕЗ_БАЗЫ))).toEqual(Array(4).fill('нет базы: в 2026-02 заказов нет'))
})

test('нет базы — слова, а не ноль', () => {
  const разметка = блок(сПолосой(БЕЗ_БАЗЫ))
  expect(разметка).not.toMatch(/kpi-delta">[^<]*0,0/)
  expect(разметка).not.toContain('data-verdict')
})

test('месяца для сравнения нет вовсе — «нет базы для сравнения» без месяца', () => {
  expect(строкиДельт(сПолосой({ ...БЕЗ_БАЗЫ, prevMonth: null }))).toEqual(Array(4).fill('нет базы для сравнения'))
})

test('разметка печатает дельту и её смысл, которые ей дали, а не выводит смысл из знака', () => {
  // Смысл нарочно расходится со знаком: рост прибыли помечен «хуже», падение доли рекламы — «хуже».
  const полоса: Полоса = {
    ...ПОЛОСА,
    items: [
      { key: 'profit', unit: 'eur', value: '10.00', delta: '+1.00', verdict: 'хуже' },
      { key: 'ad_share', unit: 'pp', value: '20.0', delta: '-0.5', verdict: 'хуже' },
    ],
  }
  const разметка = блок(сПолосой(полоса))
  expect([...разметка.matchAll(/data-verdict="([^"]*)"/g)].map((м) => м[1])).toEqual(['хуже', 'хуже'])
  expect(строкиДельт(сПолосой(полоса))).toEqual([
    '+1,00\u00A0€ к 2026-02 · хуже',
    '−0,5\u00A0п.\u00A0п. к 2026-02 · хуже',
  ])
})

test('смысл дельты назван не только цветом: у каждой строки знак и слово', () => {
  for (const строка of строкиДельт(сПолосой(ПОЛОСА))) {
    expect(строка).toMatch(/^[+−]\d.* к 2026-02 · (лучше|хуже)$/)
  }
})

test('подписи называют базу отношений, дельты маржи и доли рекламы — в процентных пунктах', () => {
  const разметка = блок(сПолосой(ПОЛОСА))
  const подписи = [...разметка.matchAll(/<span class="kpi-label">([^<]*)<\/span>/g)].map((м) => м[1])
  expect(подписи).toEqual(['Прибыль', 'Маржа от чистой выручки', 'Чистая выручка', 'Доля рекламы от оборота'])
  expect(строкиДельт(сПолосой(ПОЛОСА)).filter((с) => с.includes('п.\u00A0п.'))).toHaveLength(2)
})

test('база есть, а дельты нет — «нет данных» у этой карточки, остальные с числами', () => {
  const полоса: Полоса = {
    ...ПОЛОСА,
    items: ПОЛОСА.items.map((п) => (п.key === 'ad_share' ? { ...п, delta: null, verdict: null } : п)),
  }
  expect(строкиДельт(сПолосой(полоса))[3]).toBe('к 2026-02: нет данных')
})

/**
 * **Две проверки текста таблицы стилей — слабые, и так названы.** Они доказывают наличие правил, а не
 * то, что браузер их применил; вид виден на снимках, контраст — замером перед сдачей. Граница
 * зелёного — «ровно одно правило» — утверждается в проверке чисел таблицы стилей, не здесь.
 */
function правилоДельты(смысл: string): string {
  const стили = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8')
  const правило = стили.match(new RegExp(`\\.kpi\\[data-verdict='${смысл}'\\] \\.kpi-delta \\{([^}]*)\\}`))?.[1]
  expect(правило, `правило цвета дельты «${смысл}» есть`).toBeDefined()
  return правило ?? ''
}

test('дельта «хуже» — свой токен красного, а не токен отказа', () => {
  // Верно по имени, и в светлой теме по значению. В тёмной значение совпадает с текстом отказа (#e37d80):
  // различает их форма — утверждение ниже.
  const правило = правилоДельты('хуже')
  expect(правило).toContain('color: var(--colorPaletteRedForeground3)')
  expect(правило).not.toMatch(/--danger|colorPaletteRedForeground1|colorPaletteRedBorder2|colorPaletteRedBackground1/)
})

test('дельта — простой текст: без фона и рамки, в отличие от плашки отказа', () => {
  const стили = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const правилаДельты = [...стили.matchAll(/([^{}]*\.kpi-delta[^{}]*)\{([^}]*)\}/g)]
  expect(правилаДельты.length, 'правила строки дельты найдены').toBeGreaterThanOrEqual(3)
  for (const [, селектор, тело] of правилаДельты) {
    expect(тело, `правило «${селектор.trim()}»`).not.toMatch(/background|border|outline|box-shadow/)
  }
})

test('дельта «лучше» — зелёный', () => {
  expect(правилоДельты('лучше')).toContain('color: var(--colorPaletteGreenForeground1)')
})
