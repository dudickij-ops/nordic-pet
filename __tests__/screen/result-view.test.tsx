import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import { Dashboard } from '@/app/page'
import { percent, ratio } from '@/lib/metrics/format'
import type { MonthReport } from '@/lib/metrics/report'
import { ПЕРЕПИСЬ } from './fixture.ts'

/**
 * Вид блока «Результат месяца» — кусок S13, задача 9; до него — полоса показателей куска S11, шаг 7.
 *
 * Разметка ничего не считает: значение, дельта со знаком и её смысл приходят готовыми. Главные
 * условия владельца: значение стоит всегда; дельта у числа — только при базе, а без базы о том, что
 * сравнить не с чем, говорит одна строка на весь блок; смысл дельты назван словом, а не только цветом.
 */

type Полоса = NonNullable<MonthReport['kpis']>

function сПолосой(полоса: Полоса | undefined): string {
  return renderToStaticMarkup(<Dashboard report={{ ...ПЕРЕПИСЬ, kpis: полоса }} />)
}

function сОтчётом(правка: Partial<MonthReport>): string {
  return renderToStaticMarkup(<Dashboard report={{ ...ПЕРЕПИСЬ, ...правка }} />)
}

/** Кусок разметки блока результата — чтобы слова соседних блоков не попадали в утверждения о нём. */
function блок(разметка: string): string {
  const начало = разметка.indexOf('<section class="block result"')
  expect(начало, 'блок результата на странице').toBeGreaterThanOrEqual(0)
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

test('дельты рисуются только тогда, когда в отчёте есть поле полосы', () => {
  expect(сПолосой(undefined)).not.toContain('kpi-delta')
  expect(сПолосой(ПОЛОСА)).toContain('kpi-delta')
})

test('нет базы для сравнения — три числа результата стоят числами, строк дельты у чисел нет', () => {
  const разметка = блок(сПолосой(БЕЗ_БАЗЫ))
  expect(разметка.match(/<p class="result-profit">([^<]*)<\/p>/)?.[1]).toBe('9 999,99 €')
  const значения = [...разметка.matchAll(/<dd>([^<]*)/g)].map((м) => м[1])
  expect(значения).toEqual(['4 444,44 €', '12,3 %', ratio('45.6')])
  expect(строкиДельт(сПолосой(БЕЗ_БАЗЫ))).toEqual([])
})

test('нет базы — слова, а не ноль', () => {
  const разметка = блок(сПолосой(БЕЗ_БАЗЫ))
  expect(разметка).not.toMatch(/kpi-delta">[^<]*0,0/)
  expect(разметка).not.toContain('class="kpi"')
  expect(разметка).toContain('Сравнить с 2026-02 нельзя: в 2026-02 заказов нет.')
})

test('месяца для сравнения нет вовсе — одна строка без месяца', () => {
  const разметка = блок(сПолосой({ ...БЕЗ_БАЗЫ, prevMonth: null }))
  expect(строкиДельт(сПолосой({ ...БЕЗ_БАЗЫ, prevMonth: null }))).toEqual([])
  expect(разметка.match(/Сравнить не с чем: прошлого месяца в данных нет\./g)?.length).toBe(1)
})

test('разметка печатает дельту и её смысл, которые ей дали, а не выводит смысл из знака', () => {
  // Смысл нарочно расходится со знаком: рост прибыли помечен «хуже», падение маржи — тоже «хуже».
  const полоса: Полоса = {
    ...ПОЛОСА,
    items: [
      { key: 'profit', unit: 'eur', value: '10.00', delta: '+1.00', verdict: 'хуже' },
      { key: 'margin', unit: 'pp', value: '20.0', delta: '-0.5', verdict: 'хуже' },
    ],
  }
  const разметка = блок(сПолосой(полоса))
  expect([...разметка.matchAll(/class="kpi" data-verdict="([^"]*)"/g)].map((м) => м[1])).toEqual(['хуже', 'хуже'])
  expect(строкиДельт(сПолосой(полоса))).toEqual([
    '+1,00 € к 2026-02 · хуже',
    '−0,5 п. п. к 2026-02 · хуже',
  ])
})

test('смысл дельты назван не только цветом: у каждой строки знак и слово', () => {
  for (const строка of строкиДельт(сПолосой(ПОЛОСА))) {
    expect(строка).toMatch(/^[+−]\d.* к 2026-02 · (лучше|хуже)$/)
  }
})

test('подписи называют базу отношений, дельта маржи — в процентных пунктах', () => {
  const разметка = блок(сПолосой(ПОЛОСА))
  const подписи = [...разметка.matchAll(/<(?:h2|dt)>([^<]*)<\/(?:h2|dt)>/g)].map((м) => м[1])
  expect(подписи).toEqual(['Прибыль', 'Чистая выручка', 'Маржа от чистой выручки', 'Окупаемость рекламы по обороту'])
  expect(строкиДельт(сПолосой(ПОЛОСА)).filter((с) => с.includes('п. п.'))).toHaveLength(1)
})

test('база есть, а дельты нет — «нет данных» у этого числа, остальные с числами', () => {
  const полоса: Полоса = {
    ...ПОЛОСА,
    items: ПОЛОСА.items.map((п) => (п.key === 'net' ? { ...п, delta: null, verdict: null } : п)),
  }
  expect(строкиДельт(сПолосой(полоса))).toEqual([
    '+141,41 € к 2026-02 · лучше',
    'к 2026-02: нет данных',
    '−2,7 п. п. к 2026-02 · хуже',
  ])
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

/* ——— Кусок S13, задача 9: результат месяца ——— */

test('прибыль — единственное число крупного кегля', () => {
  const html = сОтчётом({})
  expect(html.match(/class="result-profit"/g)?.length).toBe(1)
  const стили = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8')
  expect(стили.match(/font-size:\s*var\(--fontSizeHero700\)/g)?.length).toBe(1)
})

test('нет базы — одна строка на блок, а не по строке на число', () => {
  const html = сОтчётом({ kpis: { ...ПЕРЕПИСЬ.kpis!, hasBase: false, prevMonth: '2026-02' } })
  expect(html.match(/заказов нет/g)?.length).toBe(1)
  expect(html).toContain('Сравнить с 2026-02 нельзя: в 2026-02 заказов нет.')
})

test('у окупаемости слово признака и порог; признака нет — слова нет', () => {
  const есть = сОтчётом({})
  expect(есть).toContain(`окупается · порог ${ratio(ПЕРЕПИСЬ.payback!.breakevenRoas)}`)
  const нет = сОтчётом({ findings: { ...ПЕРЕПИСЬ.findings!, adsVerdict: null } })
  expect(нет).not.toContain('· порог')
})

test('слово признака рекламы берётся из признака, а не из сравнения чисел', () => {
  const html = сОтчётом({ findings: { ...ПЕРЕПИСЬ.findings!, adsVerdict: 'не окупается' } })
  expect(html).toContain('не окупается · порог')
})

test('под прибылью — доля по настоящей цене со ссылкой на блок качества', () => {
  const html = сОтчётом({})
  // Доля стоит внутри предложения — знак процента через неразрывный пробел, как у всех предложений экрана.
  expect(percent(ПЕРЕПИСЬ.honesty.sharePct)).toBe('78,9 %')
  expect(html).toContain('Посчитано по настоящей цене поставщика: 78,9 %')
  expect(html).toContain('href="#kachestvo"')
})

test('пометка «приблизительно» — только по признаку', () => {
  expect(сОтчётом({})).toContain('приблизительно')
  expect(сОтчётом({ findings: { ...ПЕРЕПИСЬ.findings!, approximate: false } })).not.toContain('приблизительно')
})

test('на экране нет NaN', () => {
  expect(сОтчётом({})).not.toContain('NaN')
  expect(
    сОтчётом({
      bottom: { ...ПЕРЕПИСЬ.bottom, marginPct: null, roasByGross: null },
      honesty: { ...ПЕРЕПИСЬ.honesty, sharePct: null },
    }),
  ).not.toContain('NaN')
})
