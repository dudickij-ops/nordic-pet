import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import { Dashboard } from '@/app/page'
import type { MonthReport } from '@/lib/metrics/report'
import { ПЕРЕПИСЬ } from './fixture.ts'

/**
 * Разметка вкладок — кусок S11, шаг вкладок (задача В-2).
 *
 * Имена вкладок и заголовки разделов выписаны здесь буквально, а не взяты из приложения: пропавший
 * раздел или вкладка пропали бы и из списка, взятого у приложения, и проверка осталась бы зелёной.
 */

const ВКЛАДКИ = ['glavnoe', 'dengi', 'tovary', 'kachestvo'] as const

function вкладка(tab: (typeof ВКЛАДКИ)[number], отчёт: MonthReport = ПЕРЕПИСЬ): string {
  return renderToStaticMarkup(<Dashboard report={отчёт} tab={tab} />)
}

/** Кусок разметки полосы вкладок. */
function полоса(html: string): string {
  const начало = html.indexOf('<nav class="tabs"')
  expect(начало, 'полоса вкладок на странице').toBeGreaterThanOrEqual(0)
  return html.slice(начало, html.indexOf('</nav>', начало))
}

function ссылки(html: string): Array<[string, string]> {
  return [...полоса(html).matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((м) => [м[1], м[2]])
}

/** Заголовки разделов вкладки, по порядку. Полоса показателей заголовка не несёт — её имя в подписи. */
function разделы(html: string): string[] {
  return [
    ...(html.includes('class="block kpis"') ? ['Показатели месяца'] : []),
    ...[...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map((м) => м[1]),
  ]
}

test('каждый раздел — ровно на одной вкладке, порядок вкладок — порядок отчёта', () => {
  expect(ВКЛАДКИ.map((tab) => разделы(вкладка(tab)))).toEqual([
    ['Показатели месяца', 'Куда ушли деньги', 'Чистая выручка по дням'],
    ['Выручка', 'Затраты', 'Итог', 'Окупаемость рекламы'],
    ['Товары'],
    ['Честность данных', 'Неполнота данных'],
  ])
})

test('в полосе вкладок ровно четыре ссылки, в названном порядке', () => {
  expect(ссылки(вкладка('dengi')).map(([, подпись]) => подпись)).toEqual([
    'Главное',
    'Деньги',
    'Товары',
    'Качество данных',
  ])
})

test('ссылки вкладок сохраняют месяц', () => {
  expect(ссылки(вкладка('tovary')).map(([адрес]) => адрес)).toEqual([
    '/?m=2026-03&amp;tab=glavnoe',
    '/?m=2026-03&amp;tab=dengi',
    '/?m=2026-03&amp;tab=tovary',
    '/?m=2026-03&amp;tab=kachestvo',
  ])
})

test('ни одна ссылка вкладок не ведёт на корень', () => {
  // Отчёт без месяца — у ссылок остаётся вкладка, и корнем не становится ни одна.
  const адреса = ссылки(вкладка('glavnoe', { ...ПЕРЕПИСЬ, month: null })).map(([адрес]) => адрес)
  expect(адреса).toEqual(['/?tab=glavnoe', '/?tab=dengi', '/?tab=tovary', '/?tab=kachestvo'])
})

test('у текущей вкладки признак текущей в разметке, у прочих его нет', () => {
  for (const tab of ВКЛАДКИ) {
    const текущие = [...полоса(вкладка(tab)).matchAll(/href="[^"]*tab=([a-z]+)" aria-current="page"/g)].map((м) => м[1])
    expect(текущие, `на вкладке ${tab}`).toEqual([tab])
  }
})

test('ссылки месяцев сохраняют вкладку', () => {
  const отчёт = { ...ПЕРЕПИСЬ, months: [{ month: '2026-02', hasOrders: true }, ...ПЕРЕПИСЬ.months] }
  expect(вкладка('dengi', отчёт)).toContain('href="/?m=2026-02&amp;tab=dengi"')
  // У «Главного» хвоста нет: адрес без вкладки и есть «Главное».
  expect(вкладка('glavnoe', отчёт)).toContain('href="/?m=2026-02"')
})

/**
 * **Три проверки текста — слабые, и так названы.** Первая доказывает, что в файле страницы нет пометки
 * клиентского кода, а не то, что сборка его не завела. Две другие доказывают наличие правил таблицы
 * стилей, а не то, что браузер их применил; вид — на снимках, контраст — замером перед сдачей.
 */
test('полоса вкладок без клиентского кода', () => {
  expect(readFileSync(join(process.cwd(), 'app', 'page.tsx'), 'utf8')).not.toMatch(/['"]use client['"]/)
})

function правило(селектор: string): string {
  const стили = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8')
  const найдено = стили.split(`${селектор} {`)[1]?.split('}')[0]
  expect(найдено, `правило «${селектор}» есть`).toBeDefined()
  return найдено ?? ''
}

test('у текущей вкладки полоса-указатель толщиной strokeWidthThicker', () => {
  const указатель = правило(".tabs a[aria-current='page']::after")
  expect(указатель).toContain('height: var(--strokeWidthThicker)')
  expect(указатель).toContain('background: var(--colorCompoundBrandStroke)')
})

test('у текущей вкладки насыщенность fontWeightSemibold', () => {
  expect(правило(".tabs a[aria-current='page']")).toContain('font-weight: var(--fontWeightSemibold)')
})
